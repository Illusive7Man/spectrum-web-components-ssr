/**
 * Client-side hooks around the first ("hydrating") update of every Lit element that has a server-rendered
 * (declarative) shadow root: one rendered by @lit-labs/ssr (it contains the `<!--lit-part-->` marker of the render
 * result) or the shadow root of a Spectrum (`sp-*`) element. Other Lit elements - client-rendered ones, or ones with
 * a declarative shadow root from another source - are left alone (lit's own hydration support applies to them).
 * Installed by chaining onto `globalThis.litElementHydrateSupport`, which
 * `@lit-labs/ssr-client/lit-element-hydrate-support.js` defines and `lit-element` calls once when `LitElement` is
 * created - so this module must be evaluated before `lit-element` (it is, through `swc-ssr/client`, which must be the
 * first import of the client bundle). It must not import `lit` / `lit-element` itself.
 *
 * 1. Hydration adapters (`registerHydrationAdapter`): per-tag code that runs right before the hydrating update
 *    (`beforeHydrate`, at the start of the first `performUpdate()`) and right after it (`afterHydrate`), to give the
 *    element the state the server rendered it with, so that its first client render matches the server markup (the
 *    counterpart of the server adapters in `swc-ssr/server`), and to hide server-rendered shadow content from code
 *    that does not expect any before the first render. Built in: see "Built-in adapters" below.
 * 2. The initial `slotchange`: for declarative shadow roots the browser assigns slots while parsing, long before the
 *    element is upgraded and its `@slotchange` listeners exist, so the `slotchange` a client-rendered element gets
 *    after its first render never reaches a hydrated one. Many Spectrum components finish their setup there
 *    (`tabs/src/Tabs.js` `onSlotChange` -> tab list, selection indicator, roving tabindex; `menu/src/MenuGroup.js`
 *    header id; `split-view/src/SplitView.js` `enoughChildren`; `swatch/src/SwatchGroup.js`, `sidenav`, `tags`, ...),
 *    and the server renders that state: `swc-ssr/server` invokes the `<slot @slotchange=${listener}>` listeners of
 *    the first render result (and dispatches one event at the shadow root) before it renders the final markup. The
 *    client does the same: at the start of the first update the element's `render()` result is searched for
 *    `@slotchange` bindings, and each listener is called with a synthetic `slotchange` event targeting the matching
 *    (server-rendered) slot, if that slot has assigned nodes - right away when the slotchange changes what the
 *    element renders (its first render would not match the server markup otherwise), else in a microtask after the
 *    hydrating update, when client-side rendering would get the event (see `planSlotchange`). If that is not possible
 *    (`render()` throws), real `slotchange` events are dispatched at the slots after the hydrating update instead.
 *    The plan calls `render()` once more than client-side rendering does; it runs after `willUpdate()` (and the
 *    controllers' `hostUpdate()`), right before the hydrating render, so that `render()` sees the state
 *    `willUpdate()` computes. An adapter can move it to the start of the update
 *    (`slotchangePlan: 'before-willupdate'`) when the element's `willUpdate()` has to see what the initial
 *    slotchange sets.
 * 3. Recovery from hydration mismatches: when `hydrate()` of an element's shadow root throws (its first client
 *    render differs structurally from the server markup), lit-element would leave a half-hydrated shadow root and
 *    append a second copy of the content on the next update. Instead the server content is discarded (except
 *    `<style>`), the element renders client-side, and the mismatch is reported with `console.error` (so
 *    `hydrateSpectrum()` lists it in `HydrationReport.errors`).
 * 4. The server's `<style>` elements: a hydrated element adopts the complete stylesheets of its class in place of
 *    trimmed server CSS (and, with `removeServerStyles`, in place of the complete server CSS); see server-styles.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {digestForTemplateResult} from '@lit-labs/ssr-client';
import {hasServerMarkers, isSpectrumTag} from './elements.js';
import {afterHydratingUpdate} from './server-styles.js';
import {pinElementMedia, restoreElementMedia} from './match-media.js';
import {
  childPositions,
  collectSlotchangeBindings,
  findBoundSlot,
  type SlotchangeBinding,
} from '../shared/slot-bindings.js';

export interface HydrationAdapter {
  /** Tag name (lowercase) or pattern of the elements this adapter applies to. */
  tag: string | RegExp;
  /**
   * Runs at the start of the element's first `performUpdate()`, whose `update()` hydrates the server-rendered
   * shadow root (`willUpdate()` / `render()` have not run yet). Light DOM, attributes and the declarative shadow
   * root are available.
   */
  beforeHydrate?(element: HTMLElement): void;
  /** Runs right after the hydrating `update()` (before `firstUpdated()`). */
  afterHydrate?(element: HTMLElement): void;
  /**
   * When the initial `slotchange` is planned (see (2) in the file comment; the plan calls `render()`):
   * `'after-willupdate'` (default) right before the hydrating render, after `willUpdate()`;
   * `'before-willupdate'` at the start of the first `performUpdate()`, right after `beforeHydrate`, so that the
   * listeners invoked to make the first render match the server markup run before `willUpdate()`.
   * The last matching adapter that sets it wins.
   */
  slotchangePlan?: 'before-willupdate' | 'after-willupdate';
}

const adapters: HydrationAdapter[] = [];

/** Registers client-side hydration behaviour for a tag (Spectrum-specific code lives in adapters only). */
export function registerHydrationAdapter(adapter: HydrationAdapter): void {
  adapters.push(adapter);
}

const matches = (adapter: HydrationAdapter, tag: string): boolean =>
  typeof adapter.tag === 'string' ? adapter.tag === tag : adapter.tag.test(tag);

type RenderFunction = (value: unknown, container: HTMLElement | DocumentFragment, options?: any) => unknown;

/** Elements whose first update hydrates a declarative shadow root. */
const hydrating = new WeakSet<object>();
/** Elements whose `beforeHydrate` step already ran. */
const prepared = new WeakSet<object>();
/** How each prepared element's initial slotchange is emulated. */
const slotchangePlans = new WeakMap<object, SlotchangePlan>();

/** The `slotchangePlan` of the last matching adapter that sets one (default `'after-willupdate'`). */
function slotchangePlanTiming(tag: string): 'before-willupdate' | 'after-willupdate' {
  let timing: 'before-willupdate' | 'after-willupdate' = 'after-willupdate';
  for (const adapter of adapters) {
    if (adapter.slotchangePlan && matches(adapter, tag)) {
      timing = adapter.slotchangePlan;
    }
  }
  return timing;
}

function runAdapters(element: HTMLElement, hook: 'beforeHydrate' | 'afterHydrate'): void {
  const tag = element.localName;
  for (const adapter of adapters) {
    const callback = adapter[hook];
    if (!callback || !matches(adapter, tag)) {
      continue;
    }
    try {
      callback.call(adapter, element);
    } catch (error) {
      console.error(`[swc-ssr] hydration adapter (${hook}) for <${tag}> failed:`, error);
    }
  }
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Initial slotchange (2)
 * -------------------------------------------------------------------------------------------------------------- */

function reportListenerFailure(element: HTMLElement, error: unknown): void {
  console.warn(`[swc-ssr] <${element.localName}> initial slotchange listener failed during hydration:`, error);
}

/**
 * Calls the template `@slotchange` listeners like the browser delivers the initial events: every slot with assigned
 * nodes gets one (tree order), and it bubbles, so a listener bound to an ancestor slot hears it as well, with the
 * inner slot as `target` (`help-text/src/HelpTextManager.js` listens on an outer slot whose fallback content holds
 * the `help-text` slot that receives the nodes). Same as swc-ssr/server.
 */
function invokeSlotchangeListeners(element: any, bindings: SlotchangeBinding[]): void {
  const root: ShadowRoot | null = element.shadowRoot;
  if (!root) {
    return;
  }
  const bound: Array<{slot: HTMLSlotElement; listener: unknown}> = [];
  for (const binding of bindings) {
    const slot = findBoundSlot<HTMLSlotElement>(root, binding);
    if (slot) {
      bound.push({slot, listener: binding.listener});
    }
  }
  const assigned = Array.from(root.querySelectorAll('slot')).filter((slot) => slot.assignedNodes().length > 0);
  for (const slot of assigned) {
    for (let node: Node | null = slot; node && node !== root; node = node.parentNode) {
      for (const binding of bound) {
        if (binding.slot !== node) {
          continue;
        }
        const event = new Event('slotchange', {bubbles: true});
        Object.defineProperties(event, {
          target: {value: slot, configurable: true},
          currentTarget: {value: node, configurable: true},
          srcElement: {value: slot, configurable: true},
          composedPath: {value: () => [slot], configurable: true},
        });
        const {listener} = binding;
        try {
          let result: unknown;
          if (typeof listener === 'function') {
            result = listener.call(element, event);
          } else if (listener && typeof (listener as EventListenerObject).handleEvent === 'function') {
            result = (listener as EventListenerObject).handleEvent(event);
          }
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            (result as Promise<unknown>).then(undefined, (error: unknown) => reportListenerFailure(element, error));
          }
        } catch (error) {
          reportListenerFailure(element, error);
        }
      }
    }
  }
}

/**
 * Digests of the template results `value` renders, in document order (the `<!--lit-part DIGEST-->` markers the
 * server emits for them), or undefined when that is not known before rendering (a directive in a text position).
 */
function renderedDigests(value: unknown, out: string[] = [], depth = 0): string[] | undefined {
  if (value === null || typeof value !== 'object' || depth > 64 || value instanceof Node) {
    return out;
  }
  const result = value as {_$litType$?: unknown; strings?: ArrayLike<string>; values?: unknown[]};
  if (result._$litType$ !== undefined) {
    if (typeof result._$litType$ !== 'number' || !result.strings || !Array.isArray(result.values)) {
      return undefined;
    }
    out.push(digestForTemplateResult(result as never));
    const positions = childPositions(result.strings);
    for (let i = 0; i < result.values.length; i++) {
      if (positions[i] && renderedDigests(result.values[i], out, depth + 1) === undefined) {
        return undefined;
      }
    }
    return out;
  }
  if ('_$litDirective$' in result) {
    return undefined;
  }
  if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
    for (const item of value as Iterable<unknown>) {
      if (renderedDigests(item, out, depth + 1) === undefined) {
        return undefined;
      }
    }
  }
  return out;
}

/** Digests of the server-rendered templates of a declarative shadow root (nested shadow roots excluded). */
function serverDigests(root: ShadowRoot): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const data = (node as Comment).data;
    if (data.startsWith('lit-part ')) {
      out.push(data.slice('lit-part '.length));
    }
  }
  return out;
}

/** When the initial slotchange of a hydrating element is emulated (see (2) in the file comment). */
type SlotchangePlan =
  | {when: 'after'; bindings: SlotchangeBinding[]}
  | {when: 'done'}
  | {when: 'root'}
  | {when: 'dispatch'};

/**
 * Decides (at the start of the first update) how the initial slotchange is emulated:
 *  - the first client render already matches the server markup (same templates): the listeners are called after the
 *    hydrating update, in a microtask - when client-side rendering would get the event, after the updates of the
 *    elements enabled together with this one (e.g. `sidenav/src/Sidenav.js` relies on its items having updated);
 *  - it does not (the server markup shows post-slotchange state, e.g. `split-view`'s splitter or `tray`'s dismiss
 *    helpers): the listeners are called now, so that the first render matches;
 *  - no template listeners: only the shadow root gets an event; `render()` throws: real events after hydration.
 */
function planSlotchange(element: any): SlotchangePlan {
  const root: ShadowRoot | null = element.shadowRoot;
  if (!root || typeof element.render !== 'function') {
    return {when: 'dispatch'};
  }
  let value: unknown;
  let bindings: SlotchangeBinding[];
  try {
    value = element.render();
    bindings = collectSlotchangeBindings(value);
  } catch {
    return {when: 'dispatch'};
  }
  if (bindings.length === 0) {
    return {when: 'root'};
  }
  const expected = renderedDigests(value);
  const actual = serverDigests(root);
  if (expected !== undefined && expected.length === actual.length && expected.every((digest, i) => digest === actual[i])) {
    return {when: 'after', bindings};
  }
  invokeSlotchangeListeners(element, bindings);
  return {when: 'done'};
}

/**
 * After the initial slotchange: the event a browser fires at a slot also bubbles to the shadow root, where
 * `swatch/src/SwatchGroup.js` waits for it (`this.shadowRoot.addEventListener('slotchange', ..., {once: true})`,
 * added in its first `willUpdate()`). One non-bubbling `slotchange` is dispatched at the shadow root itself (not at
 * the slots, whose template listeners are invoked directly), after the listeners; the server does the same.
 */
function dispatchSlotchangeAtRoot(element: HTMLElement): void {
  const root = element.shadowRoot;
  if (!root || !element.isConnected) {
    return;
  }
  if (Array.from(root.querySelectorAll('slot')).some((slot) => slot.assignedNodes().length > 0)) {
    root.dispatchEvent(new Event('slotchange'));
  }
}

/** The fallback: real `slotchange` events at every slot with assigned nodes, after the hydrating update. */
function dispatchInitialSlotchange(element: HTMLElement): void {
  queueMicrotask(() => {
    const root = element.shadowRoot;
    if (!root || !element.isConnected) {
      return;
    }
    for (const slot of Array.from(root.querySelectorAll('slot'))) {
      if (slot.assignedNodes().length > 0) {
        slot.dispatchEvent(new Event('slotchange', {bubbles: true}));
      }
    }
  });
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Mismatch recovery (3)
 * -------------------------------------------------------------------------------------------------------------- */

/** Rethrows `error` when the element cannot render at all. */
function recover(element: any, error: unknown, render: RenderFunction): void {
  let value: unknown;
  try {
    value = element.render();
  } catch {
    throw error;
  }
  const root: ShadowRoot = element.renderRoot;
  for (const node of Array.from(root.childNodes)) {
    const isStyle =
      node.nodeType === 1 &&
      ((node as Element).localName === 'style' ||
        ((node as Element).localName === 'link' && /stylesheet/i.test((node as Element).getAttribute('rel') ?? '')));
    if (!isStyle) {
      node.remove();
    }
  }
  delete (root as any)['_$litPart$'];
  render(value, root, element.renderOptions);
  const message = (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, '');
  console.error(
    `[swc-ssr] <${element.localName}> hydration mismatch: ${message}. ` +
      'The server-rendered shadow root was discarded and rendered on the client.'
  );
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Installation
 * -------------------------------------------------------------------------------------------------------------- */

/**
 * Whether the hooks apply to an element whose render root is the pre-existing (declarative) shadow root `root`:
 * one rendered by @lit-labs/ssr (server markers), or a Spectrum element's.
 */
const isServerRendered = (element: HTMLElement, root: ShadowRoot): boolean =>
  hasServerMarkers(root) || isSpectrumTag(element.localName);

function patchLitElement(LitElement: any, render: RenderFunction): void {
  const proto = LitElement.prototype;
  const createRenderRoot = proto.createRenderRoot;
  proto.createRenderRoot = function (this: any) {
    const declarative = this.shadowRoot != null;
    const root = createRenderRoot.call(this);
    if (declarative && root === this.shadowRoot && isServerRendered(this, root)) {
      hydrating.add(this);
    }
    return root;
  };
  /** Start of the first update (before `willUpdate()`): adapters, and the slotchange plan when planned early. */
  const prepare = (element: any): void => {
    prepared.add(element);
    runAdapters(element, 'beforeHydrate');
    if (slotchangePlanTiming(element.localName) === 'before-willupdate') {
      slotchangePlans.set(element, planSlotchange(element));
    }
  };
  const performUpdate = proto.performUpdate;
  proto.performUpdate = function (this: any) {
    if (hydrating.has(this) && !prepared.has(this)) {
      prepare(this);
    }
    return performUpdate.call(this);
  };
  const update = proto.update;
  proto.update = function (this: any, changedProperties: unknown) {
    if (!hydrating.has(this)) {
      return update.call(this, changedProperties);
    }
    hydrating.delete(this);
    if (!prepared.has(this)) {
      prepare(this);
    }
    // After willUpdate() / hostUpdate(), right before the hydrating render (unless an adapter planned it early).
    if (!slotchangePlans.has(this)) {
      slotchangePlans.set(this, planSlotchange(this));
    }
    try {
      update.call(this, changedProperties);
    } catch (error) {
      recover(this, error, render);
      afterHydratingUpdate(this);
      runAdapters(this, 'afterHydrate');
      return;
    }
    afterHydratingUpdate(this);
    runAdapters(this, 'afterHydrate');
    const plan = slotchangePlans.get(this) ?? {when: 'dispatch'};
    slotchangePlans.delete(this);
    if (plan.when === 'dispatch') {
      dispatchInitialSlotchange(this);
    } else {
      queueMicrotask(() => {
        if (plan.when === 'after') {
          invokeSlotchangeListeners(this, plan.bindings);
        }
        dispatchSlotchangeAtRoot(this);
      });
    }
  };
}

/** Chains the hooks onto `globalThis.litElementHydrateSupport` (idempotent). */
export function installHydrationHooks(render: RenderFunction): void {
  const g = globalThis as any;
  if (g.__swcSsrHydrationHooks) {
    return;
  }
  g.__swcSsrHydrationHooks = true;
  const base = g.litElementHydrateSupport;
  g.litElementHydrateSupport = (args: {LitElement: unknown}) => {
    base?.(args);
    patchLitElement(args.LitElement, render);
  };
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Built-in adapters
 * -------------------------------------------------------------------------------------------------------------- */

const isUpgraded = (element: Element): boolean => {
  const ctor = customElements.get(element.localName);
  return ctor !== undefined && element instanceof ctor;
};

/**
 * `MenuItem.itemChildren` (`menu/src/MenuItem.js`) computed from the item's declarative shadow root, for an item that
 * is not upgraded yet: clones of the elements assigned to its `icon` slot (without `slot`, with class `icon`) and of
 * the nodes assigned to its default slot.
 */
function itemChildrenFromDom(item: Element): {icon: Element[]; content: Node[]} {
  const root = item.shadowRoot;
  const iconSlot = root?.querySelector<HTMLSlotElement>('slot[name="icon"]');
  const contentSlot = root?.querySelector<HTMLSlotElement>('slot:not([name])');
  if (!iconSlot || !contentSlot) {
    return {icon: [], content: []};
  }
  const icon = iconSlot.assignedElements().map((element) => {
    const clone = element.cloneNode(true) as Element;
    clone.removeAttribute('slot');
    clone.classList.toggle('icon');
    return clone;
  });
  const content = contentSlot.assignedNodes().map((node) => node.cloneNode(true));
  return {icon, content};
}

/**
 * `sp-picker` (`picker/src/Picker.js`): the server renders the button with the selected item's icon and label
 * (`value && selectedItem`). In the browser `selectedItem` is only found after the first update
 * (`manageSelection()` runs two animation frames later), so the first client render would be the placeholder branch
 * and `hydrate()` fails ("Unexpected TemplateResult rendered to part"). The adapter selects the item the way
 * `manageSelection()` does before the hydrating update, when the server markup shows a selected item.
 */
registerHydrationAdapter({
  tag: 'sp-picker',
  beforeHydrate(element) {
    const picker = element as any;
    const value = picker.value ?? element.getAttribute('value');
    if (!value || picker.selectedItem) {
      return;
    }
    // Server markup with a selected item: `<span id="label" class="label">` (otherwise `<slot id="label">`).
    if (!element.shadowRoot?.querySelector('span#label')) {
      return;
    }
    const item = Array.from(element.querySelectorAll('sp-menu-item')).find(
      (candidate) =>
        ((candidate as any).value ?? candidate.getAttribute('value')) === value && !candidate.hasAttribute('disabled')
    );
    if (!item) {
      return;
    }
    picker.selectedItem = item;
    const content = picker.selectedItemContent;
    if (!isUpgraded(item) || !content || (content.icon.length === 0 && content.content.length === 0)) {
      picker.selectedItemContent = itemChildrenFromDom(item);
    }
  },
});

/**
 * Components that render from a `MatchMediaController` (`reactive-controllers/src/MatchMedia.js`; found by grepping
 * the `src/*.js` files of every `@spectrum-web-components` package for `MatchMediaController`):
 *  - `sp-picker` (`picker/src/Picker.js`, `isMobile` / `isTouchDevice`: `sp-tray` instead of `sp-popover` as the
 *    overlay container, menu drag-and-select), `sp-action-menu` (`action-menu/src/ActionMenu.js`, the same plus
 *    `mobile-view` on its `sp-menu`), `sp-contextual-help` (`contextual-help/src/ContextualHelp.js`: the overlay's
 *    `type` / `placement`, the trigger's `aria-haspopup`);
 *  - not `sp-tray` (`tray/src/Tray.js`, `prefersMotion`): it reads it only in event handlers, not in `render()`.
 * The server's `matchMedia()` never matches, a phone's `IS_MOBILE` does. The controllers are pinned to the server's
 * value for the hydrating update and restored right after it with `requestUpdate()` (see `match-media.ts`), so the
 * hydrating render matches the server markup and the next update renders the mobile state. Restoring happens before
 * `firstUpdated()`, so `Picker.bindEvents()` picks the mobile interaction strategy.
 *
 * Review finding (fixed): the adapter matched only those three tags, so a subclass registered under another tag
 * (`class MyPicker extends Picker`, `<my-picker>`) or an application component with its own controller hydrated with
 * the phone's value (a mismatch). It now applies to every hydrating element and acts only on elements that have
 * `MatchMediaController`s (found by shape, `findMatchMediaControllers`).
 */
const mediaPinned = new WeakSet<object>();
registerHydrationAdapter({
  tag: /^/,
  beforeHydrate(element) {
    if (pinElementMedia(element) > 0) {
      mediaPinned.add(element);
    }
  },
  afterHydrate(element) {
    if (mediaPinned.delete(element)) {
      restoreElementMedia(element as unknown as {requestUpdate?: (name?: PropertyKey, oldValue?: unknown) => void});
    }
  },
});

/**
 * `sp-slider` (`slider/src/HandleController.js`): Lit reads `tabIndex` at the start of the first update, which goes
 * through `focusElement` -> `getActiveHandleElements()` -> `getHandleElements()`. That caches the `.handle > input`
 * elements of the shadow root and reads `input.model`, a property binding that only exists once the shadow root is
 * (hydrated or) rendered; with a server-rendered shadow root the inputs are already there and an editable slider
 * throws ("Cannot read properties of undefined (reading 'handle')"). Until the hydrating update is done the
 * controller finds no handle elements - what client-side rendering sees at that point (the cache may also be
 * cleared and rebuilt in between, e.g. by the slotchange listener) - and its cache is rebuilt afterwards.
 */
registerHydrationAdapter({
  tag: 'sp-slider',
  beforeHydrate(element) {
    const controller = (element as any).handleController;
    if (controller) {
      Object.defineProperty(controller, 'getHandleElements', {value: () => undefined, configurable: true, writable: true});
    }
  },
  afterHydrate(element) {
    const controller = (element as any).handleController;
    if (controller && Object.prototype.hasOwnProperty.call(controller, 'getHandleElements')) {
      delete controller.getHandleElements;
      controller.clearHandleComponentCache?.();
    }
  },
});

/**
 * `sp-menu` / `sp-menu-group` and every element built on `Menu` (`menu/src/Menu.js`; found by shape, so subclasses
 * count): hydrated more than a frame after its items were defined, it never finishes updating, and neither does
 * anything that awaits it (`sp-picker`, `sp-action-menu`, `sp-combobox`; `hydrateSpectrum()` then waits out its
 * timeout twice). A menu item announces itself to its menu from a task of its own
 * (`sp-menu-item-added-or-updated`), which reaches the menu's listener even while the menu still carries
 * `defer-hydration`; `addChildItem()` -> `handleItemsChanged()` -> `updateCache()` then runs before the menu's first
 * update, where it waits for `updateComplete`, and `getUpdateComplete()` waits for `cacheUpdated`, which is that very
 * `updateCache()` call: a cycle. Client-side rendering never gets there (the menu has updated by then), and
 * hydrating right after the definitions (the same frame) does not either. The cycle is broken at the end of the
 * hydrating update with a `cacheUpdated` that settles with the next frame - what `updateCache()` itself waits for -
 * so `getUpdateComplete()` continues, which in turn lets the pending `updateCache()` run its tail.
 */
registerHydrationAdapter({
  tag: /^/,
  afterHydrate(element) {
    const menu = element as any;
    if (menu._willUpdateItems !== true || menu.hasUpdated !== false || typeof menu.updateCache !== 'function') {
      return;
    }
    menu.cacheUpdated = new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  },
});

/**
 * `sp-breadcrumbs` (`breadcrumbs/src/Breadcrumbs.js`): with a server-rendered shadow root, `breadcrumbsElements`
 * (assigned elements of its slot) already lists the items before the first render, while `items` / `visibleItems`
 * are still empty: the first client render takes the overflow-menu branch and throws reading
 * `this.items[this.items.length - 1].value`. In client-side rendering the slot does not exist yet at that point, so
 * no menu is rendered. The server (adapters/breadcrumbs.ts) renders the items it considers visible and marks the
 * others `hidden`; the adapter restores exactly that state (item list, visibility) before hydrating, so the first
 * client render matches the server markup. The browser re-measures afterwards (slotchange / ResizeObserver).
 */
registerHydrationAdapter({
  tag: 'sp-breadcrumbs',
  beforeHydrate(element) {
    const breadcrumbs = element as any;
    let crumbs: HTMLElement[];
    try {
      crumbs = Array.from(breadcrumbs.breadcrumbsElements ?? []);
    } catch {
      return;
    }
    if (crumbs.length === 0) {
      return;
    }
    breadcrumbs.items = crumbs.map((crumb, index) => ({
      label: crumb.innerText,
      href: (crumb as any).href ?? crumb.getAttribute('href') ?? undefined,
      value: (crumb as any).value || crumb.getAttribute('value') || index.toString(),
      offsetWidth: crumb.offsetWidth,
      isVisible: !crumb.hasAttribute('hidden'),
      lang: crumb.getAttribute('lang') ?? undefined,
      dir: crumb.getAttribute('dir') === 'rtl' || crumb.getAttribute('dir') === 'ltr' ? crumb.getAttribute('dir') : undefined,
    }));
    breadcrumbs.visibleItems = crumbs.filter((crumb) => !crumb.hasAttribute('hidden')).length;
  },
});

/**
 * `sp-checkbox` (`checkbox/src/Checkbox.js`): when disabled, `updated()` moves the host's `tabIndex` to the native
 * input (`this.inputElement.tabIndex = this.tabIndex; this.tabIndex = -1`). The server renders the end state, so the
 * host arrives with `tabindex="-1"` and the first client `updated()` would move -1 instead of the value client-side
 * rendering moves. Before hydrating, the host gets back the value the server moved to the input (0 if none).
 */
registerHydrationAdapter({
  tag: 'sp-checkbox',
  beforeHydrate(element) {
    const input = element.shadowRoot?.querySelector('#input');
    if (input && element.hasAttribute('disabled') && element.getAttribute('tabindex') === '-1') {
      const moved = Number(input.getAttribute('tabindex') ?? '0');
      (element as any).tabIndex = Number.isNaN(moved) ? 0 : moved;
    }
  },
});
