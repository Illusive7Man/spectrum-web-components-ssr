/**
 * Pass-2 facades: the light DOM, shadow roots and slots of every element rendered in pass 1, exposed through the
 * standard DOM API on live objects.
 *
 * - A marked custom element node (`data-swc-ssr`) is represented by the real custom element instance that will
 *   be rendered in pass 2 (pre-instantiated into the context's pool), so queries return real instances.
 * - Any other element is represented by a lightweight detached `ServerElement` wrapper (a `ServerSlotElement` for
 *   `<slot>`), text nodes by `ServerText`.
 * - Every facade gets a structure backing (see `dom-shim/hooks.ts`) answering `childNodes` / `parentNode` /
 *   `assignedSlot` / `assignedNodes` from the server tree; the rest of the DOM API (`querySelector`, `children`,
 *   `textContent`, `closest`, `matches`, ...) is derived from that by the shim extras. Backings are set on the
 *   INSTANCE (own property), so only pass-2 elements are affected.
 * - Hosts get a shadow root (the shim's ShadowRoot) backed by their pass-1 shadow content, set as `renderRoot`, so
 *   `@query` / `@queryAssignedNodes` decorators resolve to real instances and slot facades.
 */
import {
  BACKING,
  setBacking,
  setConstructionHook,
  type StructureBacking,
} from '../dom-shim/hooks.js';
import {ServerSlotElement, ServerText, createPlainElement} from '../dom-shim/nodes.js';
import {constructElement} from './construct.js';
import {errorMessage, withElementScope, type ElementRecord, type RenderContext} from './context.js';
import type {ElementReport, LifecycleMode} from './types.js';
import {connectElement, hasCommittedRender, markManaged, unmarkManaged, withoutAttributeReactions} from './lifecycle.js';
import {findAdapter} from './adapters/registry.js';
import {resolveRenderOptions} from './render-options.js';
import type {LightMutations} from './light-mutations.js';
import {
  MARKER_ATTRIBUTE,
  childNodes,
  isDocumentNode,
  isElementNode,
  isTextNode,
  type ServerTree,
  type TreeDocumentNode,
  type TreeElementNode,
  type TreeNode,
} from './server-tree.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Facade = any;

const EMPTY_CONNECTED: StructureBacking = {
  childNodes: () => [],
  parentNode: () => null,
  isConnected: () => true,
};

/** Backing for elements rendered without tree information (pass 1, or new in pass 2): connected, no children. */
export function emptyBacking(): StructureBacking {
  return EMPTY_CONNECTED;
}

const hasOwnBacking = (node: object) => Object.prototype.hasOwnProperty.call(node, BACKING);

/**
 * Event-path links of plain element facades (`__host` / `__eventTargetParent`, read by the shim's EventTarget),
 * computed lazily from the tree.
 *
 * Retention path (fixed): the links used to be per-facade accessors whose getters were closures over the realm.
 * V8 keeps an accessor's getter/setter in the hidden class (map) that the property transition creates, and that
 * descriptor array is shared with the long-lived maps of the same element class (it was reachable from
 * `document.documentElement`'s map). The first facade of the process therefore pinned its realm - and with it a
 * whole render - forever. All facades now share the same two accessor functions, which find their realm and tree
 * node in a WeakMap.
 */
const eventLinks = new WeakMap<object, {realm: TreeRealm; node: TreeNode}>();
const HOST_LINK: PropertyDescriptor = {
  get(this: object) {
    const link = eventLinks.get(this);
    return link ? link.realm.hostInstanceOf(link.node) : undefined;
  },
  set() {},
  configurable: true,
};
const EVENT_PARENT_LINK: PropertyDescriptor = {
  get(this: object) {
    const link = eventLinks.get(this);
    return link ? link.realm.eventParentOf(link.node) : undefined;
  },
  set() {},
  configurable: true,
};

/**
 * Attaches (or reuses) the element's shadow root, gives it `backing`, and makes it the Lit `renderRoot`.
 *
 * The shadow content in `backing` is the element's render from the previous pass: it stands for what the
 * element's own `render()` commits in this pass. A browser commits that content in the element's first update,
 * after `render()`; until then the render root is empty (client-side rendering). Code that runs earlier - the
 * constructor, attribute/property setters, `connectedCallback`, Lit's initialization of `wrapped` properties at the
 * start of the first update, `willUpdate`, controllers' `hostUpdate` - must not see it, so for elements whose
 * lifecycle swc-ssr drives the content only appears once their first update has rendered (`hasCommittedRender`).
 *
 * Exposing it earlier is not just a timing difference: the markup carries attributes, but no property bindings of
 * plain elements. E.g. `slider/src/HandleController.js` reads `input.model.handle` (`.model=${model}` on the
 * handle's `<input>`) from `focusElement`, which the wrapped `tabIndex` getter (`shared/src/focusable.js`) calls
 * before the first render. In pass 2 the pass-1 shadow had no handles, so the read was skipped; when a page needs a
 * third pass (any element that only appeared in pass 2 failed there, e.g. in `sp-dialog`), the pass-2 shadow has
 * the handle inputs, without `model`, and the getter threw - for every page containing both components.
 */
export function attachShadowRoot(element: Facade, backing: StructureBacking): Facade {
  let root = element.__shadowRoot ?? element.shadowRoot;
  if (!root && typeof element.attachShadow === 'function') {
    const options = element.constructor?.shadowRootOptions ?? {mode: 'open'};
    root = element.attachShadow({...options});
  }
  if (root) {
    setBacking(root, backing === EMPTY_CONNECTED ? backing : committedContentOnly(element, backing));
    Object.defineProperty(element, 'renderRoot', {value: root, configurable: true, enumerable: true, writable: true});
  }
  return root;
}

/** `backing` whose child nodes are hidden until `element` has rendered in this pass (see `attachShadowRoot`). */
function committedContentOnly(element: Facade, backing: StructureBacking): StructureBacking {
  return {
    ...backing,
    childNodes: () => (hasCommittedRender(element) ? backing.childNodes() : []),
  };
}

export class TreeRealm {
  private readonly facades = new Map<TreeNode, Facade>();
  private readonly backings = new Map<TreeNode, StructureBacking>();
  private readonly childCache = new Map<TreeNode, Facade[]>();
  private readonly slotIndexes = new Map<TreeDocumentNode, Map<string, TreeElementNode>>();
  private readonly instances = new Map<TreeElementNode, HTMLElement>();
  private readonly nodesByFacade = new WeakMap<object, TreeNode>();
  private readonly constructing = new Set<TreeElementNode>();
  private readonly failed = new Set<TreeElementNode>();
  /** Nodes whose element opted out of SSR (`renderOptions` `disableSsr`): never pooled, plain facades. */
  private readonly ssrDisabled = new Set<TreeElementNode>();
  /** Effective lifecycle of each pooled instance (class, adapter, options and its `renderOptions`). */
  private readonly modes = new WeakMap<HTMLElement, LifecycleMode>();
  /** Attribute changes made on plain elements during this pass (see light-mutations.ts). */
  readonly lightMutations: LightMutations = new Map();
  /** Set when the render is over: no further instances are created (see `dispose`). */
  private disposed = false;

  constructor(
    private readonly context: RenderContext,
    readonly tree: ServerTree
  ) {}

  private get previous(): RenderContext {
    return this.context.previous!;
  }

  /* ------------------------------------------------------------------------------------------------------------ *
   * Facades
   * ------------------------------------------------------------------------------------------------------------ */

  facadeOf(node: TreeNode | null | undefined): Facade | null {
    if (!node) {
      return null;
    }
    const cached = this.facades.get(node);
    if (cached !== undefined) {
      return cached;
    }
    if (isTextNode(node)) {
      const text = new ServerText(node.data);
      setBacking(text, this.backingFor(node));
      this.facades.set(node, text);
      this.nodesByFacade.set(text, node);
      return text;
    }
    if (!isElementNode(node)) {
      return null;
    }
    if (this.tree.idOf(node) !== undefined) {
      const instance = this.instanceForNode(node);
      if (instance) {
        return instance;
      }
    }
    const wrapper: Facade = node.name === 'slot' ? new ServerSlotElement() : createPlainElement(node.name);
    for (const [name, value] of Object.entries(node.attribs)) {
      if (name !== MARKER_ATTRIBUTE) {
        wrapper.setAttribute(name, value);
      }
    }
    this.facades.set(node, wrapper);
    this.nodesByFacade.set(wrapper, node);
    setBacking(wrapper, this.backingFor(node));
    this.recordMutations(wrapper, node);
    // Event-path links used by the shim's EventTarget (computed lazily from the tree).
    eventLinks.set(wrapper, {realm: this, node});
    Object.defineProperty(wrapper, '__host', HOST_LINK);
    Object.defineProperty(wrapper, '__eventTargetParent', EVENT_PARENT_LINK);
    const shadow = this.tree.shadowOf(node);
    if (shadow) {
      attachShadowRoot(wrapper, this.shadowBackingFor(shadow));
    }
    return wrapper;
  }

  /** Records attribute changes on a plain element facade (applied to the pass output later). */
  private recordMutations(wrapper: Facade, node: TreeElementNode): void {
    const record = (name: string, value: string | null): void => {
      let changes = this.lightMutations.get(node);
      if (!changes) {
        changes = new Map();
        this.lightMutations.set(node, changes);
      }
      changes.set(String(name).toLowerCase(), value);
    };
    const setAttribute = wrapper.setAttribute;
    const removeAttribute = wrapper.removeAttribute;
    Object.defineProperty(wrapper, 'setAttribute', {
      value(this: Facade, name: string, value: unknown) {
        setAttribute.call(this, name, value);
        record(name, String(value));
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(wrapper, 'removeAttribute', {
      value(this: Facade, name: string) {
        const had = this.hasAttribute(name);
        removeAttribute.call(this, name);
        if (had) {
          record(name, null);
        }
      },
      configurable: true,
      writable: true,
    });
  }

  nodeOf(facade: object): TreeNode | undefined {
    return this.nodesByFacade.get(facade);
  }

  backingFor(node: TreeNode): StructureBacking {
    let backing = this.backings.get(node);
    if (backing) {
      return backing;
    }
    const isSlot = isElementNode(node) && node.name === 'slot' && this.tree.idOf(node) === undefined;
    backing = {
      childNodes: () => this.childrenOf(node),
      parentNode: () => this.parentOf(node),
      isConnected: () => true,
      assignedSlot: () => this.assignedSlotOf(node),
      ...(isSlot ? {assignedNodes: (flatten: boolean) => this.assignedNodes(node as TreeElementNode, flatten)} : {}),
    };
    this.backings.set(node, backing);
    return backing;
  }

  shadowBackingFor(shadow: TreeDocumentNode): StructureBacking {
    let backing = this.backings.get(shadow);
    if (!backing) {
      backing = {
        childNodes: () => this.childrenOf(shadow),
        parentNode: () => null,
        isConnected: () => true,
      };
      this.backings.set(shadow, backing);
    }
    return backing;
  }

  private childrenOf(node: TreeNode): Facade[] {
    let children = this.childCache.get(node);
    if (!children) {
      children = isElementNode(node) || isDocumentNode(node)
        ? childNodes(node).map((child) => this.facadeOf(child)).filter((child) => child !== null)
        : [];
      this.childCache.set(node, children);
    }
    return children;
  }

  private parentOf(node: TreeNode): Facade | null {
    const parent = node.parent;
    if (!parent) {
      return null;
    }
    if (isElementNode(parent)) {
      return this.facadeOf(parent);
    }
    if (isDocumentNode(parent)) {
      const host = this.tree.hostOf(parent);
      return host ? this.shadowRootObject(host) : null;
    }
    return null;
  }

  private shadowRootObject(host: TreeElementNode): Facade | null {
    const facade = this.facadeOf(host);
    return facade ? (facade.renderRoot ?? facade.__shadowRoot ?? facade.shadowRoot ?? null) : null;
  }

  /** Number of shadow roots `node` is nested in (0 = document level). */
  scopeDepth(node: TreeNode): number {
    let depth = 0;
    let current: TreeNode | null | undefined = node.parent;
    while (current) {
      if (isDocumentNode(current)) {
        const host = this.tree.hostOf(current);
        if (!host) {
          break;
        }
        depth++;
        current = host.parent;
      } else {
        current = current.parent;
      }
    }
    return depth;
  }

  /** The custom element instance whose shadow contains `node` (undefined at document level). */
  hostInstanceOf(node: TreeNode): Facade | undefined {
    let current: TreeNode | null = node.parent;
    while (current && !isDocumentNode(current)) {
      current = current.parent;
    }
    if (current && isDocumentNode(current)) {
      const host = this.tree.hostOf(current);
      return host ? (this.facadeOf(host) ?? undefined) : undefined;
    }
    return undefined;
  }

  /**
   * Event-target parent like upstream's `addElementToEventPath`: the assigned slot when the nearest custom
   * element ancestor has one for this subtree, else that custom element / slot / shadow root / server root.
   */
  eventParentOf(node: TreeNode): Facade {
    let child: TreeNode = node;
    let parent: TreeNode | null = node.parent;
    while (parent && isElementNode(parent) && this.tree.idOf(parent) === undefined && parent.name !== 'slot') {
      child = parent;
      parent = parent.parent;
    }
    const serverRoot = (globalThis as any).litServerRoot;
    if (!parent) {
      return serverRoot;
    }
    if (isDocumentNode(parent)) {
      const host = this.tree.hostOf(parent);
      return host ? (this.shadowRootObject(host) ?? serverRoot) : serverRoot;
    }
    if (!isElementNode(parent)) {
      return serverRoot;
    }
    if (this.tree.idOf(parent) === undefined) {
      // A <slot> (fallback content)
      return this.facadeOf(parent);
    }
    const shadow = this.tree.shadowOf(parent);
    const slot = shadow ? this.slotFor(shadow, this.slotNameOf(child)) : undefined;
    return slot ? this.facadeOf(slot) : this.facadeOf(parent);
  }

  /* ------------------------------------------------------------------------------------------------------------ *
   * Slots
   * ------------------------------------------------------------------------------------------------------------ */

  private slotNameOf(node: TreeNode): string {
    if (!isElementNode(node)) {
      return '';
    }
    const facade = this.facades.get(node);
    const value = facade ? facade.getAttribute('slot') : node.attribs.slot;
    return value ?? '';
  }

  private slotFor(shadow: TreeDocumentNode, name: string): TreeElementNode | undefined {
    let index = this.slotIndexes.get(shadow);
    if (!index) {
      index = new Map();
      const stack: TreeNode[] = [...shadow.children].reverse();
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (!isElementNode(current)) {
          continue;
        }
        if (current.name === 'slot' && this.tree.idOf(current) === undefined) {
          const slotName = current.attribs.name ?? '';
          if (!index.has(slotName)) {
            index.set(slotName, current);
          }
        }
        for (let i = current.children.length - 1; i >= 0; i--) {
          stack.push(current.children[i]);
        }
      }
      this.slotIndexes.set(shadow, index);
    }
    return index.get(name);
  }

  private assignedSlotOf(node: TreeNode): Facade | null {
    const parent = node.parent;
    if (!parent || !isElementNode(parent)) {
      return null;
    }
    const shadow = this.tree.shadowOf(parent);
    if (!shadow) {
      return null;
    }
    const slot = this.slotFor(shadow, this.slotNameOf(node));
    return slot ? this.facadeOf(slot) : null;
  }

  private assignedNodes(slot: TreeElementNode, flatten: boolean): Facade[] {
    let root: TreeNode = slot;
    while (root.parent) {
      root = root.parent;
    }
    const host = isDocumentNode(root) ? this.tree.hostOf(root) : undefined;
    let assigned: TreeNode[] = [];
    if (host && isDocumentNode(root)) {
      const name = slot.attribs.name ?? '';
      if (this.slotFor(root, name) === slot) {
        assigned = childNodes(host).filter((child) => this.slotNameOf(child) === name && (isElementNode(child) || name === ''));
      }
    }
    if (!flatten) {
      return assigned.map((node) => this.facadeOf(node)).filter((node) => node !== null);
    }
    const source = assigned.length > 0 ? assigned : childNodes(slot);
    const result: Facade[] = [];
    for (const node of source) {
      if (isElementNode(node) && node.name === 'slot' && this.tree.idOf(node) === undefined) {
        result.push(...this.assignedNodes(node, true));
      } else {
        const facade = this.facadeOf(node);
        if (facade !== null) {
          result.push(facade);
        }
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------------------------------------------------ *
   * Instances (the pool)
   * ------------------------------------------------------------------------------------------------------------ */

  recordOf(node: TreeElementNode): ElementRecord | undefined {
    const id = this.tree.idOf(node);
    return id === undefined || this.disposed ? undefined : this.previous.records.get(id);
  }

  instanceForKey(key: string): HTMLElement | undefined {
    if (this.disposed) {
      return undefined;
    }
    const pooled = this.context.pool.get(key);
    if (pooled) {
      return pooled;
    }
    const record = this.previous.recordsByKey.get(key);
    const node = record ? this.tree.byId(record.id) : undefined;
    return node ? this.instanceForNode(node) : undefined;
  }

  instanceForNode(node: TreeElementNode): HTMLElement | undefined {
    const existing = this.instances.get(node);
    if (existing || this.disposed) {
      return existing;
    }
    const record = this.recordOf(node);
    if (!record) {
      return undefined;
    }
    const pooled = this.context.pool.get(record.key);
    if (pooled) {
      return pooled;
    }
    return this.createInstance(node, record);
  }

  /** Pass-1 instances found in recorded property values are replaced by their pass-2 counterparts. */
  translate(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !this.disposed) {
      const key = this.previous.keyByInstance.get(value);
      if (key !== undefined) {
        return this.instanceForKey(key) ?? value;
      }
    }
    return value;
  }

  private createInstance(node: TreeElementNode, record: ElementRecord): HTMLElement | undefined {
    const ctor = (globalThis as any).customElements.get(record.tag) as (new () => HTMLElement) | undefined;
    if (!ctor || this.disposed) {
      return undefined;
    }
    if (this.constructing.has(node) || this.failed.has(node) || this.ssrDisabled.has(node)) {
      return undefined;
    }
    const report = this.context.reportFor(record.key, record.tag);
    const backing = this.backingFor(node);
    const register = (element: HTMLElement) => {
      this.context.pool.set(record.key, element);
      this.context.keyByInstance.set(element, record.key);
      this.instances.set(node, element);
      this.facades.set(node, element);
      this.nodesByFacade.set(element, node);
    };
    const previousHook = setConstructionHook((element: any) => {
      if (element.localName === record.tag && !hasOwnBacking(element)) {
        setBacking(element, backing);
        // Queries made by the constructor may walk back up to this element: let them find it.
        register(element);
        return backing;
      }
      return undefined;
    });
    this.constructing.add(node);
    let element: HTMLElement;
    try {
      element = constructElement(ctor);
    } catch (error) {
      report.errors.push(`constructor: ${errorMessage(error)}`);
      this.failed.add(node);
      this.context.pool.delete(record.key);
      this.instances.delete(node);
      this.facades.delete(node);
      return undefined;
    } finally {
      setConstructionHook(previousHook);
      this.constructing.delete(node);
    }
    register(element);
    const adapter = findAdapter(record.tag);
    if (adapter?.prepare) {
      try {
        // Not rendered in this pass yet: no id (review L3: real pass number, previous id and key).
        adapter.prepare(element, {
          id: -1,
          pass: this.context.pass,
          key: record.key,
          previousId: record.id,
          tree: this.tree,
          report,
        });
      } catch (error) {
        report.errors.push(`adapter prepare: ${errorMessage(error)}`);
      }
    }
    this.attach(element, node);
    // The class-level mode decides whether the shadow content is hidden until the first update (`markManaged`)
    // already while the attributes / properties are applied; the element's render options can only lower it.
    const classMode = this.context.lifecycleFor(record.tag, adapter?.lifecycle, ctor);
    if (classMode === 'full') {
      markManaged(element, report);
    }
    withElementScope(report, () => {
      for (const [name, value] of record.attributes) {
        try {
          setAttributeAndNotify(element, name, value);
        } catch (error) {
          report.errors.push(`setAttribute(${name}): ${errorMessage(error)}`);
        }
      }
      for (const [name, value] of record.properties) {
        try {
          (element as any)[name] = this.translate(value);
        } catch (error) {
          report.errors.push(`property ${name}: ${errorMessage(error)}`);
        }
      }
    });
    // Review H1: upstream `LitElementRenderer.renderOptions` apply to pre-instantiated elements too, evaluated (as
    // upstream does) once the element has its attributes, before anything connects or updates it.
    const renderOptions = resolveRenderOptions(element, report);
    if (renderOptions?.disableSsr) {
      // No pooling, no connect, no lifecycle: the renderer builds the element as upstream does and renders it
      // without a shadow root; the other elements see a plain facade of it.
      this.ssrDisabled.add(node);
      this.context.pool.delete(record.key);
      this.instances.delete(node);
      this.facades.delete(node);
      this.nodesByFacade.delete(element);
      unmarkManaged(element);
      return undefined;
    }
    const mode = this.context.lifecycleFor(record.tag, adapter?.lifecycle, ctor, renderOptions);
    if (mode !== 'full') {
      unmarkManaged(element);
    }
    this.modes.set(element, mode);
    return element;
  }

  /** Gives an instance its tree backing, shadow root facade and event-path links. */
  attach(element: HTMLElement, node: TreeElementNode): void {
    const backing = this.backingFor(node);
    if ((element as any)[BACKING] !== backing) {
      setBacking(element, backing);
    }
    const shadow = this.tree.shadowOf(node);
    attachShadowRoot(element, shadow ? this.shadowBackingFor(shadow) : EMPTY_CONNECTED);
    const host = this.hostInstanceOf(node);
    if (host !== undefined) {
      (element as any).__host = host;
    }
    (element as any).__eventTargetParent = this.eventParentOf(node);
  }

  /**
   * Called when the render is over. The node objects keep their structure backings: like elements removed from a
   * browser document they still answer DOM queries (component code may still run from async continuations, e.g.
   * `slider/src/Slider.js` `getUpdateComplete()` reads its `@query` number field after a dynamic import resolved).
   * What only the render needed is released (the context drops its pool, records and link to the previous pass),
   * and no new instances are created for nodes nobody asked for yet.
   */
  dispose(): void {
    this.disposed = true;
    this.constructing.clear();
    this.failed.clear();
    this.ssrDisabled.clear();
    this.lightMutations.clear();
  }

  /**
   * Creates every element of the pass-1 tree (document order: element, its shadow content, its light children),
   * then connects them in the same order: like a browser inserting a parsed fragment, all elements exist before
   * the first `connectedCallback` runs.
   */
  preinstantiate(): Array<{element: HTMLElement; report: ElementReport}> {
    // A Set (review L4: `created.includes(element)` made this quadratic in the number of elements).
    const unique = new Set<HTMLElement>();
    for (const node of this.tree.markedNodes()) {
      const element = this.instanceForNode(node);
      if (element) {
        unique.add(element);
      }
    }
    const created = [...unique];
    // Browser order: the elements of one tree scope connect and update before the elements inside their shadow
    // roots, which only come to life when their host renders (client-side rendering) or hydrates (SSR + hydration).
    // E.g. a picker's light-DOM menu items update before the sp-menu in the picker's shadow root, which decides
    // e.g. which item `menu/src/Menu.js`'s roving tabindex starts on. Stable sort: document order within a depth.
    const depth = new Map<HTMLElement, number>();
    for (const element of created) {
      const node = this.nodesByFacade.get(element);
      depth.set(element, node ? this.scopeDepth(node) : 0);
    }
    created.sort((a, b) => depth.get(a)! - depth.get(b)!);
    const result: Array<{element: HTMLElement; report: ElementReport}> = [];
    for (const element of created) {
      const key = this.context.keyByInstance.get(element)!;
      const tag = element.localName;
      const report = this.context.reportFor(key, tag);
      const mode = this.modes.get(element) ?? this.context.lifecycleFor(tag, findAdapter(tag)?.lifecycle);
      if (mode !== 'none') {
        connectElement(element, report, this.context.session);
      }
      result.push({element, report});
    }
    return result;
  }
}

/** `setAttribute` + `attributeChangedCallback` for observed attributes (what a browser parser would do). */
export function setAttributeAndNotify(element: any, name: string, value: string): void {
  const old = element.getAttribute(name);
  // Notified explicitly below (also for elements that are not connected yet).
  withoutAttributeReactions(() => element.setAttribute(name, value));
  const observed: string[] = element.constructor?.observedAttributes ?? [];
  if (old !== value && observed.includes(name) && typeof element.attributeChangedCallback === 'function') {
    element.attributeChangedCallback(name, old, value);
  }
}
