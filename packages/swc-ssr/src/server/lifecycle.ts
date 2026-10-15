/**
 * The server lifecycle extension.
 *
 * Upstream `LitElementRenderer` runs `willUpdate()` + attribute reflection only. Many components compute render
 * state later (`firstUpdated`, `updated`, controllers' `hostUpdated`, rAF callbacks, `updateComplete.then(...)`),
 * so in `full` mode the renderer runs a faithful copy of `ReactiveElement.performUpdate()` instead, minus the DOM
 * commit:
 *
 *   willUpdate -> controllers.hostUpdate -> update (component chain; LitElement's render/commit step reduced to
 *   attribute reflection) -> controllers.hostUpdated -> firstUpdated (once) -> updated
 *
 * then flushes queued animation frames / microtasks and repeats while the element has pending changes
 * (bounded). Every hook runs in its own try/catch; errors go to the element report and never abort the render.
 *
 * Only Lit's public/protected API and the `_$LE` helpers from `lit-element/private-ssr-support.js` are used; the
 * few prototype patches below are gated by a per-instance flag, so elements not managed by swc-ssr behave exactly
 * as before.
 */
import {collectSlotchangeBindings, findBoundSlot} from '../shared/slot-bindings.js';
import {LitElement, ReactiveElement, type PropertyValues} from 'lit';
import {_$LE} from 'lit-element/private-ssr-support.js';
import {runInContext, errorMessage, withElementScope, type RenderContext, type RenderSession} from './context.js';
import type {ElementReport} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const {changedProperties} = _$LE as unknown as {changedProperties: (el: LitElement) => PropertyValues};

/** Set on instances whose lifecycle is driven by swc-ssr in `full` mode. */
export const SSR_MANAGED = Symbol.for('swc-ssr.managed');
/** Set once swc-ssr called the element's `connectedCallback`. */
export const SSR_CONNECTED = Symbol.for('swc-ssr.connected');
const WRAPPED_INITIALIZED = Symbol.for('swc-ssr.wrapped-initialized');
const SSR_RENDERED = Symbol.for('swc-ssr.rendered');
const SSR_REPORT = Symbol.for('swc-ssr.report');

const MAX_FRAMES_PER_SETTLE = 8;
const MICROTASK_TICKS = 64;

/* ------------------------------------------------------------------------------------------------------------ *
 * Flag-gated prototype patches
 * ------------------------------------------------------------------------------------------------------------ */

const controllersByHost = new WeakMap<object, Set<any>>();
const PATCHED = Symbol.for('swc-ssr.lifecycle-patched');

function installPatches(): void {
  const reactiveProto = ReactiveElement.prototype as any;
  const litProto = LitElement.prototype as any;
  if (reactiveProto[PATCHED]) {
    return;
  }
  reactiveProto[PATCHED] = true;

  // Controllers are stored under a minified private name in production builds; track them ourselves.
  const addController = reactiveProto.addController;
  reactiveProto.addController = function (this: object, controller: unknown) {
    let set = controllersByHost.get(this);
    if (!set) {
      set = new Set();
      controllersByHost.set(this, set);
    }
    set.add(controller);
    return addController.call(this, controller);
  };
  const removeController = reactiveProto.removeController;
  reactiveProto.removeController = function (this: object, controller: unknown) {
    controllersByHost.get(this)?.delete(controller);
    return removeController.call(this, controller);
  };

  // LitElement.update() renders and commits into the render root. On the server the shadow is rendered by the
  // ElementRenderer, so managed elements call render() (as the browser does: render() may have side effects
  // components rely on), reflect attributes, and skip the commit. After the first render the initial
  // `slotchange` events the browser would fire are emulated (see dispatchInitialSlotchange).
  const litUpdate = litProto.update;
  litProto.update = function (this: any, changed: PropertyValues) {
    if (!this[SSR_MANAGED]) {
      return litUpdate.call(this, changed);
    }
    let value: unknown;
    try {
      value = this.render();
    } catch (error) {
      const report: ElementReport | undefined = this[SSR_REPORT];
      report?.warnings.push(`render() during update: ${errorMessage(error)}`);
    }
    reactiveProto.update.call(this, changed);
    if (!this[SSR_RENDERED]) {
      setFlag(this, SSR_RENDERED);
      if (value !== undefined) {
        queueMicrotask(() => dispatchInitialSlotchange(this, value));
      }
    }
  };

  // There is no asynchronous update cycle on the server: updates of managed elements are "complete" right away
  // (subclass overrides such as `async getUpdateComplete() { await super.getUpdateComplete(); ... }` still run).
  const getUpdateComplete = reactiveProto.getUpdateComplete;
  reactiveProto.getUpdateComplete = function (this: any) {
    if (this[SSR_MANAGED]) {
      return Promise.resolve(true);
    }
    return getUpdateComplete.call(this);
  };

  installAttributeReactions(reactiveProto);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Attribute reactions
 * ------------------------------------------------------------------------------------------------------------ */

/** Depth of renderer-driven attribute writes, which call `attributeChangedCallback` themselves. */
let reactionsSuppressed = 0;

/**
 * Runs `fn` without attribute reactions: for the renderer's own attribute writes (upstream
 * `ElementRenderer.setAttribute` and swc-ssr's replays call `attributeChangedCallback` explicitly).
 */
export function withoutAttributeReactions<T>(fn: () => T): T {
  const resume = suspendAttributeReactions();
  try {
    return fn();
  } finally {
    resume();
  }
}

/** `withoutAttributeReactions` for code that cannot run in a callback (a `super()` call); returns the resume function. */
export function suspendAttributeReactions(): () => void {
  reactionsSuppressed++;
  let resumed = false;
  return () => {
    if (!resumed) {
      resumed = true;
      reactionsSuppressed--;
    }
  };
}

/** Observed attributes per class (Lit's `observedAttributes` getter builds a new array on every read). */
const observedByClass = new WeakMap<object, ReadonlySet<string>>();

function observedAttributesOf(element: any): ReadonlySet<string> {
  const ctor = element.constructor;
  let observed = observedByClass.get(ctor);
  if (!observed) {
    let list: unknown;
    try {
      list = ctor?.observedAttributes;
    } catch {
      list = undefined;
    }
    observed = new Set(Array.isArray(list) ? list.map((name) => String(name).toLowerCase()) : []);
    observedByClass.set(ctor, observed);
  }
  return observed;
}

/**
 * Browsers run a custom element's `attributeChangedCallback` for every change of an observed attribute
 * (`setAttribute` / `removeAttribute` / `toggleAttribute`), whoever makes it - also the component's own code. The
 * `@lit-labs/ssr-dom-shim` `Element` only stores the attribute, so a component that sets an observed attribute on
 * itself never saw its property follow on the server. Example: `field-label/src/FieldLabel.js` `willUpdate()` sets
 * its generated `id` attribute and relies on the `id` property (`@property() id`) following it; on the server the
 * property stayed '' and `applyTargetLabel()` appended an empty id to the target's `aria-labelledby` (`"label "`,
 * which became `"label  sp-field-label-N"` after hydration: the slider section of the full-catalog page).
 *
 * The reaction runs for elements swc-ssr connected (their component code runs) and not for the renderer's own
 * writes (`withoutAttributeReactions`), which notify explicitly. Lit's own reflection (`__propertyToAttribute`)
 * is ignored by Lit's `attributeChangedCallback` (`__reflectingProperty`), as in browsers. Errors of the callback
 * are reported on the element, never thrown into the code that changed the attribute (browsers report them too).
 */
function installAttributeReactions(reactiveProto: any): void {
  const base = Object.getPrototypeOf(reactiveProto);
  const react = (element: any, name: string, old: string | null): void => {
    const value: string | null = element.getAttribute(name);
    const key = name.toLowerCase();
    if (old === value || !observedAttributesOf(element).has(key) || typeof element.attributeChangedCallback !== 'function') {
      return;
    }
    try {
      element.attributeChangedCallback(key, old, value);
    } catch (error) {
      const report = reactionReports.get(element);
      if (report) {
        record(report, `attributeChangedCallback(${name})`, error);
      }
    }
  };
  const active = (element: any): boolean => reactionsSuppressed === 0 && !!element[SSR_CONNECTED];
  // (The shim's `toggleAttribute` calls `setAttribute` / `removeAttribute`, so it reacts through them.)
  for (const method of ['setAttribute', 'removeAttribute'] as const) {
    const original = base?.[method];
    if (typeof original !== 'function' || Object.prototype.hasOwnProperty.call(reactiveProto, method)) {
      continue;
    }
    Object.defineProperty(reactiveProto, method, {
      value: function (this: any, name: string, ...rest: unknown[]) {
        if (!active(this)) {
          return original.call(this, name, ...rest);
        }
        const key = String(name);
        const old: string | null = this.getAttribute(key);
        const result = original.call(this, name, ...rest);
        react(this, key, old);
        return result;
      },
      configurable: true,
      writable: true,
    });
  }
}

/** Reports of connected elements (errors of attribute reactions go there). */
const reactionReports = new WeakMap<object, ElementReport>();

installPatches();

/* ------------------------------------------------------------------------------------------------------------ *
 * Lifecycle steps
 * ------------------------------------------------------------------------------------------------------------ */

export function isReactiveElement(element: unknown): boolean {
  return element instanceof ReactiveElement;
}

function setFlag(element: object, flag: symbol): void {
  Object.defineProperty(element, flag, {value: true, configurable: true, enumerable: false, writable: true});
}

/** Marks an element as driven by the swc-ssr lifecycle (`full` mode); errors of patched hooks go to `report`. */
export function markManaged(element: object, report: ElementReport): void {
  setFlag(element, SSR_MANAGED);
  Object.defineProperty(element, SSR_REPORT, {value: report, configurable: true, enumerable: false, writable: true});
}

/**
 * Undoes `markManaged` for an element whose effective lifecycle turned out lower than `full` once its
 * `LitElementRenderer.renderOptions` were known (they are evaluated after its attributes are set, see
 * render-options.ts). Must happen before the element's first update.
 */
export function unmarkManaged(element: any): void {
  if (element?.[SSR_MANAGED]) {
    element[SSR_MANAGED] = false;
  }
}

/** Whether the element's lifecycle is driven by swc-ssr (`full` mode). */
export function isManaged(element: any): boolean {
  return !!element?.[SSR_MANAGED];
}

/** The reactive controllers of an element (tracked by the `addController` patch above). */
export function controllersOf(element: object): readonly unknown[] {
  return [...(controllersByHost.get(element) ?? [])];
}

/**
 * Whether the element's own shadow content (the previous pass's render of it, see `realm.ts` `attachShadowRoot`)
 * may be exposed through its render root: always for elements whose lifecycle swc-ssr does not drive, and for
 * `full`-mode elements only once their first update in this pass has rendered (the point where the browser
 * commits the first render into the render root).
 */
export function hasCommittedRender(element: any): boolean {
  return !element?.[SSR_MANAGED] || !!element[SSR_RENDERED];
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Initial slotchange emulation
 * ------------------------------------------------------------------------------------------------------------ */

export {collectSlotchangeBindings} from '../shared/slot-bindings.js';

/**
 * When a component first renders, the browser assigns the host's children to the new slots and fires
 * `slotchange` on every slot that got assigned nodes. Many components initialize from that event
 * (e.g. `tabs/src/Tabs.js` `onSlotChange` / `managePanels`). Lit SSR never attaches event listeners, so the
 * `@slotchange` listeners found in the first render result are invoked with a synthetic event whose target is
 * the slot facade of the element's render root.
 */
function dispatchInitialSlotchange(element: any, value: unknown): void {
  const report: ElementReport | undefined = element[SSR_REPORT];
  const root = element.renderRoot;
  if (!root || typeof root.querySelector !== 'function' || typeof root.querySelectorAll !== 'function') {
    return;
  }
  // The slot element each listener is bound to.
  const bound: Array<{slot: any; listener: unknown}> = [];
  for (const binding of collectSlotchangeBindings(value)) {
    const slot = findBoundSlot<any>(root, binding);
    if (slot) {
      bound.push({slot, listener: binding.listener});
    }
  }
  // Every slot with assigned nodes gets the event (tree order). It bubbles: a listener on an ancestor slot hears it
  // too, with the inner slot as target - e.g. help-text/src/HelpTextManager.js listens on an outer slot whose
  // fallback content holds the `help-text` slot that actually receives the nodes.
  const slots: any[] = [...root.querySelectorAll('slot')];
  const assigned = slots.filter((slot) => typeof slot.assignedNodes === 'function' && slot.assignedNodes().length > 0);
  for (const slot of assigned) {
    for (let node = slot; node && node !== root; node = node.parentNode) {
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
          if (typeof listener === 'function') {
            catchAsync(listener.call(element, event), report, 'slotchange listener');
          } else if (listener && typeof (listener as EventListenerObject).handleEvent === 'function') {
            catchAsync((listener as EventListenerObject).handleEvent(event), report, 'slotchange listener');
          }
        } catch (error) {
          if (report) {
            record(report, 'slotchange listener', error);
          }
        }
      }
    }
  }
  // In a browser the event bubbles to the shadow root, where `swatch/src/SwatchGroup.js` listens
  // (`this.shadowRoot.addEventListener('slotchange', ..., {once: true})` in its first `willUpdate()`): dispatch one
  // `slotchange` at the shadow root itself too, if any of its slots has assigned nodes.
  if (typeof root.dispatchEvent === 'function' && assigned.length > 0) {
    try {
      root.dispatchEvent(new Event('slotchange'));
    } catch (error) {
      if (report) {
        record(report, 'slotchange listener', error);
      }
    }
  }
}

function record(report: ElementReport, step: string, error: unknown): void {
  report.errors.push(`${step}: ${errorMessage(error)}`);
}

function catchAsync(result: unknown, report: ElementReport | undefined, step: string): void {
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    (result as Promise<unknown>).then(undefined, (error) => {
      if (report) {
        record(report, `${step} (async)`, error);
      }
    });
  }
}

/**
 * Calls the element's `connectedCallback` once. Lit's `enableUpdating` is replaced by a no-op first (as
 * `LitElementRenderer` does) so no asynchronous update cycle is ever started on the server. Elements connected for
 * a render (`session`) are disconnected when it ends (`disconnectAll`).
 */
export function connectElement(element: any, report: ElementReport, session?: RenderSession): void {
  if (element[SSR_CONNECTED]) {
    return;
  }
  setFlag(element, SSR_CONNECTED);
  reactionReports.set(element, report);
  session?.connected.push({element, report});
  if (isReactiveElement(element)) {
    element.enableUpdating = () => {};
  }
  try {
    withElementScope(report, () => element.connectedCallback?.());
  } catch (error) {
    record(report, 'connectedCallback', error);
  }
}

export function isConnectedBySsr(element: any): boolean {
  return !!element?.[SSR_CONNECTED];
}

/**
 * Calls `disconnectedCallback` on every element the render connected (all passes, connection order), as a browser
 * does when the rendered tree is removed. Errors become warnings of the element's report.
 *
 * Retention path (fixed): `connectedCallback` (and controllers' `hostConnected`) register instances in
 * module-level singletons that only `disconnectedCallback` / `hostDisconnected` undo, e.g.
 * `reactive-controllers/src/LanguageResolution.js` -> `AttributeObserver.js` (a module-level Map of listeners on
 * `document.documentElement`: one bound listener per connected component with a LanguageResolutionController -
 * slider, number field, ...), `iconset/src/Iconset.js` -> `IconsetRegistry`, listeners added to `document`.
 * Without the disconnect every render's elements (pass 1, which is discarded, and the final pass) stayed reachable
 * from those singletons, and through each element's structure backing the whole render (realm, server tree,
 * contexts): about 226 MB per full-catalog render.
 */
export function disconnectAll(session: RenderSession): void {
  for (const {element, report} of session.connected.splice(0)) {
    if (!element || !(element as any)[SSR_CONNECTED]) {
      continue;
    }
    (element as any)[SSR_CONNECTED] = false;
    try {
      const result = withElementScope(report, () => (element as any).disconnectedCallback?.());
      if (result && typeof result.then === 'function') {
        result.then(undefined, () => {});
      }
    } catch (error) {
      report.warnings.push(`disconnectedCallback: ${errorMessage(error)}`);
    }
  }
}

/** Upstream semantics (`none` / `connected` modes): `willUpdate` + attribute reflection. */
export function runBaseUpdate(element: any, report: ElementReport): void {
  if (!isReactiveElement(element)) {
    return;
  }
  withElementScope(report, () => baseUpdate(element, report));
}

function baseUpdate(element: any, report: ElementReport): void {
  const changed = changedProperties(element as LitElement);
  try {
    (element as any).willUpdate(changed);
  } catch (error) {
    record(report, 'willUpdate', error);
  }
  try {
    (ReactiveElement.prototype as any).update.call(element, changed);
  } catch (error) {
    record(report, 'update (reflect)', error);
  }
}

/**
 * Lit's first update marks properties with user-defined accessors (`wrapped`) as changed
 * (`ReactiveElement.performUpdate`); upstream SSR skips that, `full` mode replicates it through the public
 * `requestUpdate(name, oldValue, options)`.
 *
 * The getters run before the element has rendered, so - as in the browser - they see an empty render root (see
 * `hasCommittedRender`). A getter that throws anyway is recorded in the element report like every other hook;
 * the remaining properties are still initialized and the render goes on.
 */
function initializeWrappedProperties(element: any, changed: PropertyValues, report: ElementReport): void {
  if (element[WRAPPED_INITIALIZED] || element.hasUpdated) {
    return;
  }
  setFlag(element, WRAPPED_INITIALIZED);
  const properties: Map<PropertyKey, any> | undefined = element.constructor?.elementProperties;
  if (!properties) {
    return;
  }
  for (const [name, options] of properties) {
    if (options?.wrapped !== true || changed.has(name)) {
      continue;
    }
    try {
      if (element[name] !== undefined) {
        element.requestUpdate(name, undefined, options);
      }
    } catch (error) {
      record(report, `initialize wrapped property ${String(name)}`, error);
    }
  }
}

/**
 * One synchronous update cycle (`full` mode). Runs in the element's render scope: promises its hooks create carry
 * its report (unhandled rejections are attributed to it, see context.ts).
 */
export function runFullUpdate(element: any, report: ElementReport): void {
  if (!isReactiveElement(element)) {
    return;
  }
  withElementScope(report, () => fullUpdate(element, report));
}

function fullUpdate(element: any, report: ElementReport): void {
  initializeWrappedProperties(element, changedProperties(element as LitElement), report);
  const changed = changedProperties(element as LitElement);
  const controllers = [...(controllersByHost.get(element) ?? [])];
  try {
    element.willUpdate(changed);
  } catch (error) {
    record(report, 'willUpdate', error);
  }
  for (const controller of controllers) {
    try {
      controller.hostUpdate?.();
    } catch (error) {
      record(report, `${controller?.constructor?.name ?? 'controller'}.hostUpdate`, error);
    }
  }
  try {
    element.update(changed);
  } catch (error) {
    record(report, 'update', error);
  }
  if (changedProperties(element as LitElement) === changed) {
    // The component's update() threw before reaching ReactiveElement.update(): reflect and mark as updated.
    try {
      (ReactiveElement.prototype as any).update.call(element, changed);
    } catch (error) {
      record(report, 'update (reflect)', error);
    }
  }
  // From here on (hostUpdated, firstUpdated, updated, ...) the render root shows the element's content, also when
  // its update() did not get as far as LitElement.update().
  if (!element[SSR_RENDERED]) {
    setFlag(element, SSR_RENDERED);
  }
  for (const controller of controllers) {
    try {
      catchAsync(controller.hostUpdated?.(), report, 'hostUpdated');
    } catch (error) {
      record(report, `${controller?.constructor?.name ?? 'controller'}.hostUpdated`, error);
    }
  }
  if (!element.hasUpdated) {
    element.hasUpdated = true;
    try {
      catchAsync(element.firstUpdated(changed), report, 'firstUpdated');
    } catch (error) {
      record(report, 'firstUpdated', error);
    }
  }
  try {
    catchAsync(element.updated(changed), report, 'updated');
  } catch (error) {
    record(report, 'updated', error);
  }
}

/** Reflects pending property changes to attributes (and marks the element as updated). */
export function reflectPending(element: any, report: ElementReport): void {
  if (!isReactiveElement(element)) {
    return;
  }
  try {
    (ReactiveElement.prototype as any).update.call(element, changedProperties(element as LitElement));
  } catch (error) {
    record(report, 'update (reflect)', error);
  }
}

export function hasPendingUpdate(element: any): boolean {
  if (!isReactiveElement(element)) {
    return false;
  }
  return element.isUpdatePending === true || changedProperties(element as LitElement).size > 0;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Settling: animation frames + microtasks
 * ------------------------------------------------------------------------------------------------------------ */

/** Lets pending promise continuations run (microtasks only: no I/O of other requests interleaves). */
export async function drainMicrotasks(ticks = MICROTASK_TICKS): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await undefined;
  }
}

/** Runs the callbacks of one animation frame (those queued before the frame started). */
export function flushFrame(context: RenderContext): void {
  const session = context.session;
  const entries = session.raf.entries.splice(0);
  const time = ++session.frame * 16;
  for (const {callback} of entries) {
    try {
      callback(time);
    } catch (error) {
      const target = session.lastReport;
      if (target) {
        record(target, 'requestAnimationFrame callback', error);
      } else {
        session.orphanWarnings.push(`requestAnimationFrame callback: ${errorMessage(error)}`);
      }
    }
  }
}

/** Drains microtasks and flushes queued animation frames until nothing is left (bounded). */
export async function settle(context: RenderContext): Promise<void> {
  await drainMicrotasks();
  context.session.checkAborted();
  for (let frame = 0; frame < MAX_FRAMES_PER_SETTLE && context.session.raf.size > 0; frame++) {
    runInContext(context, () => flushFrame(context));
    await drainMicrotasks();
    context.session.checkAborted();
  }
}

const MAX_DOCUMENT_ROUNDS = 6;

/**
 * Pass 2, before rendering: runs the update cycle of every pre-instantiated `full`-mode element in document
 * order (parents before children, hosts before their shadow content: the order in which the browser's
 * microtask-scheduled first updates run), then settles frames/microtasks, and repeats for elements that
 * requested further updates. This reproduces the browser's ordering: all first updates happen before the first
 * animation frame, so e.g. a menu has updated before its items announce themselves from a rAF callback.
 */
export async function runDocumentLifecycle(
  context: RenderContext,
  elements: ReadonlyArray<{element: any; report: ElementReport}>
): Promise<void> {
  const managed = elements.filter(({element}) => element?.[SSR_MANAGED] && isReactiveElement(element));
  for (let round = 0; round < MAX_DOCUMENT_ROUNDS; round++) {
    context.session.checkAborted();
    const due = managed.filter(({element}) => !element.hasUpdated || hasPendingUpdate(element));
    if (due.length === 0 && context.session.raf.size === 0) {
      break;
    }
    runInContext(context, () => {
      for (const {element, report} of due) {
        context.session.lastReport = report;
        runFullUpdate(element, report);
      }
    });
    await settle(context);
  }
}
