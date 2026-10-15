/**
 * The DOM shim "extras": everything Spectrum Web Components (1st-gen, 1.12.x) need on top of
 * `@lit-labs/ssr-dom-shim` to be imported, constructed and rendered on the server.
 *
 * Rules followed here:
 *  - every addition is guarded (`defineIfAbsent` / `??=`) so a newer `@lit-labs/ssr-dom-shim` that implements
 *    the same API takes precedence;
 *  - the light-DOM API answers from a per-node "backing" (see `hooks.ts`) and otherwise returns empty results, so
 *    constructors never throw (`this.querySelector is not a function` in
 *    `@spectrum-web-components/shared/src/observe-slot-presence.js`);
 *  - nothing here flips Lit into browser mode: `isServer` comes from the `node` export condition of `lit-html`,
 *    which no global can change.
 */
import {webcrypto} from 'node:crypto';
import {
  Node as ShimNodeClass,
  Element as ShimElementClass,
  HTMLElement as ShimHTMLElementClass,
  HTMLSlotElement as ShimHTMLSlotElementClass,
  ShadowRoot as ShimShadowRootClass,
  Document as ShimDocumentClass,
  document as shimDocument,
} from '@lit-labs/ssr-dom-shim';
import {cancelFrame, getBacking, getRandomSource, logListener, requestFrame} from './hooks.js';
import {
  ServerComment,
  ServerElement,
  ServerFragment,
  ServerText,
  TokenList,
  childNodesOf,
  classListOf,
  cloneNode,
  createElementForTag,
  datasetOf,
  dropInnerHTML,
  dropReplaceChildren,
  dropTextContent,
  emptyRect,
  insertBefore,
  isMutable,
  nodeList,
  parseHTML,
  registerElementClass,
  removeChild,
  serializeChildren,
  serializeNode,
  styleOf,
  textContentOf,
  toNode,
  ELEMENT_NODE,
  TEXT_NODE,
  DOCUMENT_FRAGMENT_NODE,
  DOCUMENT_NODE,
} from './nodes.js';
import {closest, matches, queryAll, queryOne} from './select.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

const NodeProto = (ShimNodeClass as any).prototype;
const ElementProto = (ShimElementClass as any).prototype;
const HTMLElementProto = (ShimHTMLElementClass as any).prototype;
const SlotProto = (ShimHTMLSlotElementClass as any).prototype;
const ShadowRootProto = (ShimShadowRootClass as any).prototype;
const DocumentProto = (ShimDocumentClass as any).prototype;

const OURS = Symbol.for('swc-ssr.shim');

function defineIfAbsent(target: object, name: PropertyKey, descriptor: PropertyDescriptor): void {
  if (name in target) {
    return;
  }
  if ('value' in descriptor && typeof descriptor.value === 'function') {
    descriptor.value[OURS] = true;
  }
  Object.defineProperty(target, name, {configurable: true, enumerable: false, ...descriptor});
}

const method = (fn: (...args: any[]) => unknown): PropertyDescriptor => ({value: fn, writable: true});
const getter = (get: (this: AnyNode) => unknown, set?: (this: AnyNode, value: any) => void): PropertyDescriptor => ({
  get,
  set: set ?? (() => {}),
});
const constant = (value: unknown): PropertyDescriptor => getter(() => value);

/** Reflects a string attribute (`id`, `slot`, `title`, ...). */
const stringAttribute = (attribute: string): PropertyDescriptor =>
  getter(
    function () {
      return this.getAttribute(attribute) ?? '';
    },
    function (value) {
      this.setAttribute(attribute, String(value ?? ''));
    }
  );

/** Reflects a boolean attribute (`hidden`, `inert`). */
const booleanAttribute = (attribute: string): PropertyDescriptor =>
  getter(
    function () {
      return this.hasAttribute(attribute);
    },
    function (value) {
      if (value) {
        this.setAttribute(attribute, '');
      } else {
        this.removeAttribute(attribute);
      }
    }
  );

const childList = (node: AnyNode): AnyNode[] => childNodesOf(node);
const elementChildren = (node: AnyNode): AnyNode[] => childList(node).filter((n) => n?.nodeType === ELEMENT_NODE);

function siblingOf(node: AnyNode, offset: 1 | -1, elementsOnly: boolean): AnyNode | null {
  const parent = node.parentNode;
  if (!parent) {
    return null;
  }
  const siblings = elementsOnly ? elementChildren(parent) : childList(parent);
  const index = siblings.indexOf(node);
  return index === -1 ? null : (siblings[index + offset] ?? null);
}

function setTextContent(node: AnyNode, value: unknown): void {
  if (!isMutable(node)) {
    // swc-ssr server (review L5): a tree-backed node cannot change; the drop is reported to the render (nodes.ts).
    dropTextContent(node, value);
    return;
  }
  for (const child of [...childList(node)]) {
    removeChild(node, child);
  }
  const text = value == null ? '' : String(value);
  if (text) {
    insertBefore(node, new ServerText(text), null);
  }
}

function setInnerHTML(node: AnyNode, html: unknown): void {
  const target = node.localName === 'template' && node.content ? node.content : node;
  if (!isMutable(target)) {
    // swc-ssr server (review L5): a tree-backed node cannot change; the drop is reported to the render (nodes.ts).
    dropInnerHTML(target, html);
    return;
  }
  for (const child of [...childList(target)]) {
    removeChild(target, child);
  }
  for (const child of parseHTML(String(html ?? ''))) {
    insertBefore(target, child, null);
  }
}

function insertAdjacent(element: AnyNode, where: string, node: AnyNode): AnyNode | null {
  const parent = element.parentNode;
  switch (String(where).toLowerCase()) {
    case 'beforebegin':
      if (parent) insertBefore(parent, node, element);
      return parent ? node : null;
    case 'afterbegin':
      insertBefore(element, node, childList(element)[0] ?? null);
      return node;
    case 'beforeend':
      insertBefore(element, node, null);
      return node;
    case 'afterend':
      if (parent) insertBefore(parent, node, element.nextSibling);
      return parent ? node : null;
    default:
      return null;
  }
}

/** `getComputedStyle(el).direction`: nearest `dir` attribute up the (composed) ancestor chain. */
function directionOf(element: AnyNode): string {
  let node = element;
  for (let depth = 0; node && depth < 1000; depth++) {
    const dir = typeof node.getAttribute === 'function' ? node.getAttribute('dir') : null;
    if (dir === 'rtl' || dir === 'ltr') {
      return dir;
    }
    const parent = node.parentElement;
    if (parent) {
      node = parent;
      continue;
    }
    const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    node = root && root !== node && root.host ? root.host : null;
  }
  const rootDir = (shimDocument as any).documentElement?.getAttribute?.('dir');
  return rootDir === 'rtl' ? 'rtl' : 'ltr';
}

function computedStyle(element: AnyNode): CSSStyleDeclaration {
  const direction = element ? directionOf(element) : 'ltr';
  const values: Record<string, string> = {direction};
  const declaration = {
    direction,
    getPropertyValue: (name: string) => values[String(name)] ?? '',
    getPropertyPriority: () => '',
    item: () => '',
    length: 0,
    cssText: '',
  };
  return new Proxy(declaration, {
    get: (target, key) => (typeof key === 'string' && !(key in target) ? '' : Reflect.get(target, key)),
  }) as unknown as CSSStyleDeclaration;
}

const cssEscape = (value: string): string =>
  String(value).replace(/([\0-\x1f\x7f]|^-?\d)|^-$|[^\0-\x1f\x7f-￿\w-]/g, (match, control) =>
    control ? `\\${match.charCodeAt(0).toString(16)} ` : `\\${match}`
  );

/**
 * The server's `matchMedia()`: no media query ever matches (there is no viewport, pointer or color scheme on the
 * server). Components render their "no query matches" state, e.g. `sp-picker` / `sp-action-menu` /
 * `sp-contextual-help` (`reactive-controllers/src/MatchMedia.js`, `IS_MOBILE`) their desktop state. The client
 * hydration adapters of those components (swc-ssr/client `hooks.ts`, `match-media.ts`) pin their controllers to this
 * value (`SERVER_MEDIA_MATCHES = false`) for the hydrating update, so a phone hydrates the desktop markup and then
 * re-renders in its mobile state. Keep the two in sync if this ever becomes configurable.
 */
function mediaQueryList(media: string) {
  return {
    matches: false,
    media: String(media),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  };
}

function animation() {
  const done = Promise.resolve();
  return {
    finished: done,
    ready: done,
    currentTime: 0,
    playState: 'finished',
    onfinish: null,
    oncancel: null,
    cancel() {},
    finish() {},
    play() {},
    pause() {},
    reverse() {},
    commitStyles() {},
    persist() {},
    addEventListener() {},
    removeEventListener() {},
  };
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Event classes (only what the browser has and Node does not). Init-dict values are exposed through prototype
 * getters so subclasses (e.g. `MenuItemKeydownEvent` in `menu/src/MenuItem.js`) can override them.
 * ------------------------------------------------------------------------------------------------------------ */

const INIT = Symbol('init');
const initOf = (event: AnyNode): Record<string, any> => event[INIT] ?? {};

function installEventClasses(g: any): void {
  const BaseEvent: typeof Event = g.Event;
  const initGetters = (target: object, defaults: Record<string, unknown>) => {
    for (const [key, fallback] of Object.entries(defaults)) {
      Object.defineProperty(target, key, {
        get(this: AnyNode) {
          const value = initOf(this)[key];
          return value === undefined ? fallback : value;
        },
        configurable: true,
        enumerable: true,
      });
    }
  };
  const modifierState = function (this: AnyNode, key: string) {
    const init = initOf(this);
    return !!init[`modifier${key}`] || !!init[`${String(key).toLowerCase()}Key`];
  };

  class UIEventShim extends BaseEvent {
    constructor(type: string, init: Record<string, unknown> = {}) {
      super(type, init as EventInit);
      Object.defineProperty(this, INIT, {value: init, enumerable: false});
    }
  }
  initGetters(UIEventShim.prototype, {detail: 0, view: null, which: 0});

  class FocusEventShim extends UIEventShim {}
  initGetters(FocusEventShim.prototype, {relatedTarget: null});

  class MouseEventShim extends UIEventShim {}
  initGetters(MouseEventShim.prototype, {
    screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, offsetX: 0, offsetY: 0, movementX: 0,
    movementY: 0, button: 0, buttons: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    relatedTarget: null,
  });
  Object.defineProperty(MouseEventShim.prototype, 'getModifierState', {value: modifierState, configurable: true});

  class PointerEventShim extends MouseEventShim {}
  initGetters(PointerEventShim.prototype, {
    pointerId: 0, pointerType: '', width: 1, height: 1, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0,
    twist: 0, isPrimary: false,
  });

  class WheelEventShim extends MouseEventShim {}
  initGetters(WheelEventShim.prototype, {deltaX: 0, deltaY: 0, deltaZ: 0, deltaMode: 0});

  class DragEventShim extends MouseEventShim {}
  initGetters(DragEventShim.prototype, {dataTransfer: null});

  class KeyboardEventShim extends UIEventShim {
    static readonly DOM_KEY_LOCATION_STANDARD = 0;
    static readonly DOM_KEY_LOCATION_LEFT = 1;
    static readonly DOM_KEY_LOCATION_RIGHT = 2;
    static readonly DOM_KEY_LOCATION_NUMPAD = 3;
  }
  initGetters(KeyboardEventShim.prototype, {
    key: '', code: '', location: 0, repeat: false, isComposing: false, altKey: false, ctrlKey: false,
    metaKey: false, shiftKey: false, charCode: 0, keyCode: 0,
  });
  Object.defineProperty(KeyboardEventShim.prototype, 'getModifierState', {value: modifierState, configurable: true});

  class InputEventShim extends UIEventShim {}
  initGetters(InputEventShim.prototype, {data: null, inputType: '', isComposing: false, dataTransfer: null});

  class CompositionEventShim extends UIEventShim {}
  initGetters(CompositionEventShim.prototype, {data: ''});

  class TouchEventShim extends UIEventShim {}
  initGetters(TouchEventShim.prototype, {
    touches: [], targetTouches: [], changedTouches: [], altKey: false, ctrlKey: false, metaKey: false,
    shiftKey: false,
  });

  class InitEvent extends BaseEvent {
    constructor(type: string, init: Record<string, unknown> = {}) {
      super(type, init as EventInit);
      Object.defineProperty(this, INIT, {value: init, enumerable: false});
    }
  }
  class AnimationEventShim extends InitEvent {}
  initGetters(AnimationEventShim.prototype, {animationName: '', elapsedTime: 0, pseudoElement: ''});
  class TransitionEventShim extends InitEvent {}
  initGetters(TransitionEventShim.prototype, {propertyName: '', elapsedTime: 0, pseudoElement: ''});
  class ToggleEventShim extends InitEvent {}
  initGetters(ToggleEventShim.prototype, {oldState: '', newState: ''});
  class ErrorEventShim extends InitEvent {}
  initGetters(ErrorEventShim.prototype, {message: '', filename: '', lineno: 0, colno: 0, error: null});

  const classes: Record<string, unknown> = {
    UIEvent: UIEventShim,
    FocusEvent: FocusEventShim,
    MouseEvent: MouseEventShim,
    PointerEvent: PointerEventShim,
    WheelEvent: WheelEventShim,
    DragEvent: DragEventShim,
    KeyboardEvent: KeyboardEventShim,
    InputEvent: InputEventShim,
    CompositionEvent: CompositionEventShim,
    TouchEvent: TouchEventShim,
    AnimationEvent: AnimationEventShim,
    TransitionEvent: TransitionEventShim,
    ToggleEvent: ToggleEventShim,
    ErrorEvent: ErrorEventShim,
  };
  for (const [name, ctor] of Object.entries(classes)) {
    if (typeof g[name] === 'undefined') {
      Object.defineProperty(ctor, 'name', {value: name});
      g[name] = ctor;
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Prototype extras
 * ------------------------------------------------------------------------------------------------------------ */

function installNodeExtras(): void {
  const nodeConstants = {
    ELEMENT_NODE: 1, ATTRIBUTE_NODE: 2, TEXT_NODE: 3, CDATA_SECTION_NODE: 4, ENTITY_REFERENCE_NODE: 5,
    ENTITY_NODE: 6, PROCESSING_INSTRUCTION_NODE: 7, COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10,
    DOCUMENT_FRAGMENT_NODE: 11, NOTATION_NODE: 12, DOCUMENT_POSITION_DISCONNECTED: 1,
    DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_CONTAINS: 8,
    DOCUMENT_POSITION_CONTAINED_BY: 16, DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
  };
  for (const [name, value] of Object.entries(nodeConstants)) {
    defineIfAbsent(ShimNodeClass, name, {value, writable: false, enumerable: true});
    defineIfAbsent(NodeProto, name, {value, writable: false, enumerable: true});
  }

  // Structure (answered from the node's backing; empty without one).
  defineIfAbsent(NodeProto, 'childNodes', getter(function () {
    return nodeList([...childList(this)]);
  }));
  defineIfAbsent(NodeProto, 'firstChild', getter(function () {
    return childList(this)[0] ?? null;
  }));
  defineIfAbsent(NodeProto, 'lastChild', getter(function () {
    const children = childList(this);
    return children[children.length - 1] ?? null;
  }));
  defineIfAbsent(NodeProto, 'parentNode', getter(function () {
    return getBacking(this)?.parentNode() ?? null;
  }));
  defineIfAbsent(NodeProto, 'parentElement', getter(function () {
    const parent = this.parentNode;
    return parent && parent.nodeType === ELEMENT_NODE ? parent : null;
  }));
  defineIfAbsent(NodeProto, 'nextSibling', getter(function () {
    return siblingOf(this, 1, false);
  }));
  defineIfAbsent(NodeProto, 'previousSibling', getter(function () {
    return siblingOf(this, -1, false);
  }));
  defineIfAbsent(NodeProto, 'isConnected', getter(function () {
    return getBacking(this)?.isConnected?.() ?? false;
  }));
  defineIfAbsent(NodeProto, 'ownerDocument', getter(() => shimDocument));
  defineIfAbsent(NodeProto, 'hasChildNodes', method(function (this: AnyNode) {
    return childList(this).length > 0;
  }));
  defineIfAbsent(NodeProto, 'contains', method(function (this: AnyNode, other: AnyNode) {
    for (let node = other; node; node = node.parentNode) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }));
  defineIfAbsent(NodeProto, 'textContent', getter(
    function () {
      return textContentOf(this);
    },
    function (value) {
      setTextContent(this, value);
    }
  ));
  defineIfAbsent(NodeProto, 'appendChild', method(function (this: AnyNode, node: AnyNode) {
    return insertBefore(this, node, null);
  }));
  defineIfAbsent(NodeProto, 'insertBefore', method(function (this: AnyNode, node: AnyNode, ref: AnyNode) {
    return insertBefore(this, node, ref ?? null);
  }));
  defineIfAbsent(NodeProto, 'removeChild', method(function (this: AnyNode, node: AnyNode) {
    return removeChild(this, node);
  }));
  defineIfAbsent(NodeProto, 'replaceChild', method(function (this: AnyNode, node: AnyNode, old: AnyNode) {
    insertBefore(this, node, old);
    removeChild(this, old);
    return old;
  }));
  defineIfAbsent(NodeProto, 'cloneNode', method(function (this: AnyNode, deep?: boolean) {
    return cloneNode(this, !!deep);
  }));
  defineIfAbsent(NodeProto, 'normalize', method(() => {}));
  defineIfAbsent(NodeProto, 'isEqualNode', method(function (this: AnyNode, other: AnyNode) {
    return other === this;
  }));
  defineIfAbsent(NodeProto, 'isSameNode', method(function (this: AnyNode, other: AnyNode) {
    return other === this;
  }));
  defineIfAbsent(NodeProto, 'compareDocumentPosition', method(() => 1));
}

function installParentNodeExtras(proto: object): void {
  defineIfAbsent(proto, 'children', getter(function () {
    return nodeList(elementChildren(this));
  }));
  defineIfAbsent(proto, 'firstElementChild', getter(function () {
    return elementChildren(this)[0] ?? null;
  }));
  defineIfAbsent(proto, 'lastElementChild', getter(function () {
    const children = elementChildren(this);
    return children[children.length - 1] ?? null;
  }));
  defineIfAbsent(proto, 'childElementCount', getter(function () {
    return elementChildren(this).length;
  }));
  defineIfAbsent(proto, 'querySelector', method(function (this: AnyNode, selector: string) {
    return queryOne(this, selector);
  }));
  defineIfAbsent(proto, 'querySelectorAll', method(function (this: AnyNode, selector: string) {
    return nodeList(queryAll(this, selector));
  }));
  defineIfAbsent(proto, 'getElementsByTagName', method(function (this: AnyNode, tag: string) {
    return nodeList(queryAll(this, String(tag) === '*' ? '*' : String(tag).toLowerCase()));
  }));
  defineIfAbsent(proto, 'getElementsByClassName', method(function (this: AnyNode, names: string) {
    const selector = String(names)
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => `.${cssEscape(name)}`)
      .join('');
    return nodeList(selector ? queryAll(this, selector) : []);
  }));
  defineIfAbsent(proto, 'append', method(function (this: AnyNode, ...nodes: unknown[]) {
    for (const node of nodes) {
      insertBefore(this, toNode(node), null);
    }
  }));
  defineIfAbsent(proto, 'prepend', method(function (this: AnyNode, ...nodes: unknown[]) {
    const first = childList(this)[0] ?? null;
    for (const node of nodes) {
      insertBefore(this, toNode(node), first);
    }
  }));
  defineIfAbsent(proto, 'replaceChildren', method(function (this: AnyNode, ...nodes: unknown[]) {
    if (!isMutable(this)) {
      // swc-ssr server (review L5): a tree-backed node cannot change; the drop is reported to the render (nodes.ts).
      dropReplaceChildren(this, nodes);
      return;
    }
    for (const child of [...childList(this)]) {
      removeChild(this, child);
    }
    for (const node of nodes) {
      insertBefore(this, toNode(node), null);
    }
  }));
  defineIfAbsent(proto, 'innerHTML', getter(
    function () {
      return serializeChildren(this);
    },
    function (value) {
      setInnerHTML(this, value);
    }
  ));
}

function installElementExtras(): void {
  installParentNodeExtras(ElementProto);
  defineIfAbsent(ElementProto, 'nodeType', constant(ELEMENT_NODE));
  defineIfAbsent(ElementProto, 'nodeName', getter(function () {
    return this.tagName;
  }));
  defineIfAbsent(ElementProto, 'nextElementSibling', getter(function () {
    return siblingOf(this, 1, true);
  }));
  defineIfAbsent(ElementProto, 'previousElementSibling', getter(function () {
    return siblingOf(this, -1, true);
  }));
  defineIfAbsent(ElementProto, 'closest', method(function (this: AnyNode, selector: string) {
    return closest(this, selector);
  }));
  defineIfAbsent(ElementProto, 'matches', method(function (this: AnyNode, selector: string) {
    return matches(this, selector);
  }));
  defineIfAbsent(ElementProto, 'webkitMatchesSelector', method(function (this: AnyNode, selector: string) {
    return matches(this, selector);
  }));
  defineIfAbsent(ElementProto, 'assignedSlot', getter(function () {
    return getBacking(this)?.assignedSlot?.() ?? null;
  }));
  defineIfAbsent(ElementProto, 'outerHTML', getter(function () {
    return serializeNode(this);
  }));
  defineIfAbsent(ElementProto, 'remove', method(function (this: AnyNode) {
    const parent = this.parentNode;
    if (parent) {
      removeChild(parent, this);
    }
  }));
  defineIfAbsent(ElementProto, 'before', method(function (this: AnyNode, ...nodes: unknown[]) {
    const parent = this.parentNode;
    if (parent) {
      for (const node of nodes) insertBefore(parent, toNode(node), this);
    }
  }));
  defineIfAbsent(ElementProto, 'after', method(function (this: AnyNode, ...nodes: unknown[]) {
    const parent = this.parentNode;
    if (parent) {
      const next = this.nextSibling;
      for (const node of nodes) insertBefore(parent, toNode(node), next);
    }
  }));
  defineIfAbsent(ElementProto, 'replaceWith', method(function (this: AnyNode, ...nodes: unknown[]) {
    const parent = this.parentNode;
    if (parent) {
      for (const node of nodes) insertBefore(parent, toNode(node), this);
      removeChild(parent, this);
    }
  }));
  defineIfAbsent(ElementProto, 'insertAdjacentElement', method(function (this: AnyNode, where: string, el: AnyNode) {
    return insertAdjacent(this, where, el);
  }));
  defineIfAbsent(ElementProto, 'insertAdjacentText', method(function (this: AnyNode, where: string, text: string) {
    insertAdjacent(this, where, new ServerText(text));
  }));
  defineIfAbsent(ElementProto, 'insertAdjacentHTML', method(function (this: AnyNode, where: string, html: string) {
    for (const node of parseHTML(html)) {
      insertAdjacent(this, where, node);
    }
  }));
  defineIfAbsent(ElementProto, 'getAttributeNames', method(function (this: AnyNode) {
    return ((this.attributes ?? []) as {name: string}[]).map(({name}) => name);
  }));
  defineIfAbsent(ElementProto, 'hasAttributes', method(function (this: AnyNode) {
    return (this.attributes ?? []).length > 0;
  }));
  defineIfAbsent(ElementProto, 'getAttributeNS', method(function (this: AnyNode, _ns: string, name: string) {
    return this.getAttribute(name);
  }));
  defineIfAbsent(ElementProto, 'setAttributeNS', method(function (this: AnyNode, _ns: string, name: string, v: string) {
    this.setAttribute(name, v);
  }));
  defineIfAbsent(ElementProto, 'removeAttributeNS', method(function (this: AnyNode, _ns: string, name: string) {
    this.removeAttribute(name);
  }));
  defineIfAbsent(ElementProto, 'classList', getter(
    function () {
      return classListOf(this);
    },
    function (value) {
      this.setAttribute('class', String(value));
    }
  ));
  defineIfAbsent(ElementProto, 'part', getter(function () {
    return new TokenList(this, 'part');
  }));
  defineIfAbsent(ElementProto, 'className', stringAttribute('class'));
  defineIfAbsent(ElementProto, 'id', stringAttribute('id'));
  defineIfAbsent(ElementProto, 'slot', stringAttribute('slot'));
  defineIfAbsent(ElementProto, 'innerText', getter(
    function () {
      return textContentOf(this);
    },
    function (value) {
      setTextContent(this, value);
    }
  ));
  defineIfAbsent(ElementProto, 'outerText', getter(function () {
    return textContentOf(this);
  }));
  defineIfAbsent(ElementProto, 'getBoundingClientRect', method(() => emptyRect()));
  defineIfAbsent(ElementProto, 'getClientRects', method(() => nodeList([])));
  defineIfAbsent(ElementProto, 'scrollIntoView', method(() => {}));
  defineIfAbsent(ElementProto, 'scrollIntoViewIfNeeded', method(() => {}));
  defineIfAbsent(ElementProto, 'scrollTo', method(() => {}));
  defineIfAbsent(ElementProto, 'scrollBy', method(() => {}));
  defineIfAbsent(ElementProto, 'scroll', method(() => {}));
  for (const name of ['scrollTop', 'scrollLeft']) {
    defineIfAbsent(ElementProto, name, getter(() => 0));
  }
  for (const name of ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight', 'clientTop', 'clientLeft']) {
    defineIfAbsent(ElementProto, name, constant(0));
  }
  defineIfAbsent(ElementProto, 'setPointerCapture', method(() => {}));
  defineIfAbsent(ElementProto, 'releasePointerCapture', method(() => {}));
  defineIfAbsent(ElementProto, 'hasPointerCapture', method(() => false));
  defineIfAbsent(ElementProto, 'animate', method(() => animation()));
  defineIfAbsent(ElementProto, 'getAnimations', method(() => []));
  defineIfAbsent(ElementProto, 'checkVisibility', method(() => true));
  defineIfAbsent(ElementProto, 'requestFullscreen', method(() => Promise.resolve()));
  defineIfAbsent(ElementProto, 'computedStyleMap', method(() => new Map()));
}

function installHTMLElementExtras(): void {
  defineIfAbsent(HTMLElementProto, 'focus', method(() => {}));
  defineIfAbsent(HTMLElementProto, 'blur', method(() => {}));
  defineIfAbsent(HTMLElementProto, 'click', method(() => {}));
  defineIfAbsent(HTMLElementProto, 'hidden', booleanAttribute('hidden'));
  defineIfAbsent(HTMLElementProto, 'inert', booleanAttribute('inert'));
  // Popover API, present in every browser SWC 1.12 supports. `overlay/src/Overlay.js` and `OverlayStack.js` pick
  // their strategy at import time from `"showPopover" in document.createElement("div")` and render
  // `popover=${this.popoverValue}` only when `"popover" in this`: without these the server would render the
  // no-popover variant, and hydration would keep that markup (no `popover` attribute on the overlay dialog).
  // The methods are no-ops: overlays stay closed on the server (see adapters/overlay.ts).
  defineIfAbsent(HTMLElementProto, 'popover', getter(
    function () {
      const value = this.getAttribute('popover');
      if (value === null) {
        return null;
      }
      return value === 'manual' || value === 'hint' ? value : 'auto';
    },
    function (value) {
      if (value === null || value === undefined) {
        this.removeAttribute('popover');
      } else {
        this.setAttribute('popover', String(value));
      }
    }
  ));
  for (const name of ['showPopover', 'hidePopover']) {
    defineIfAbsent(HTMLElementProto, name, method(() => {}));
  }
  defineIfAbsent(HTMLElementProto, 'togglePopover', method(() => false));
  defineIfAbsent(HTMLElementProto, 'title', stringAttribute('title'));
  defineIfAbsent(HTMLElementProto, 'lang', stringAttribute('lang'));
  defineIfAbsent(HTMLElementProto, 'dir', stringAttribute('dir'));
  defineIfAbsent(HTMLElementProto, 'accessKey', stringAttribute('accesskey'));
  defineIfAbsent(HTMLElementProto, 'tabIndex', getter(
    function () {
      const value = this.getAttribute('tabindex');
      if (value !== null && value !== '' && !Number.isNaN(Number(value))) {
        return Math.trunc(Number(value));
      }
      return ['a', 'button', 'input', 'select', 'textarea'].includes(this.localName) ? 0 : -1;
    },
    function (value) {
      this.setAttribute('tabindex', String(Math.trunc(Number(value) || 0)));
    }
  ));
  defineIfAbsent(HTMLElementProto, 'dataset', getter(function () {
    return datasetOf(this);
  }));
  defineIfAbsent(HTMLElementProto, 'style', getter(
    function () {
      return styleOf(this);
    },
    function (value) {
      this.setAttribute('style', String(value));
    }
  ));
  for (const name of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) {
    defineIfAbsent(HTMLElementProto, name, constant(0));
  }
  defineIfAbsent(HTMLElementProto, 'offsetParent', constant(null));
}

function installShadowRootExtras(): void {
  installParentNodeExtras(ShadowRootProto);
  defineIfAbsent(ShadowRootProto, 'nodeType', constant(DOCUMENT_FRAGMENT_NODE));
  defineIfAbsent(ShadowRootProto, 'nodeName', constant('#document-fragment'));
  defineIfAbsent(ShadowRootProto, 'getElementById', method(function (this: AnyNode, id: string) {
    return queryOne(this, `#${cssEscape(String(id))}`);
  }));
  defineIfAbsent(ShadowRootProto, 'activeElement', constant(null));
  defineIfAbsent(ShadowRootProto, 'elementFromPoint', method(() => null));
  defineIfAbsent(ShadowRootProto, 'elementsFromPoint', method(() => []));
  defineIfAbsent(ShadowRootProto, 'getSelection', method(() => null));
  const sheets = new WeakMap<object, unknown[]>();
  defineIfAbsent(ShadowRootProto, 'adoptedStyleSheets', getter(
    function () {
      return sheets.get(this) ?? [];
    },
    function (value) {
      sheets.set(this, Array.isArray(value) ? value : []);
    }
  ));
}

function installSlotExtras(): void {
  defineIfAbsent(SlotProto, 'assignedNodes', method(function (this: AnyNode, options?: {flatten?: boolean}) {
    return [...(getBacking(this)?.assignedNodes?.(!!options?.flatten) ?? [])];
  }));
  defineIfAbsent(SlotProto, 'assignedElements', method(function (this: AnyNode, options?: {flatten?: boolean}) {
    return (getBacking(this)?.assignedNodes?.(!!options?.flatten) ?? []).filter(
      (node: AnyNode) => node?.nodeType === ELEMENT_NODE
    );
  }));
  defineIfAbsent(SlotProto, 'assign', method(() => {}));
}

class ServerTreeWalker {
  currentNode: AnyNode;

  constructor(
    readonly root: AnyNode,
    readonly whatToShow: number = 0xffffffff,
    readonly filter: AnyNode = null
  ) {
    this.currentNode = root;
  }

  private accepts(node: AnyNode): boolean {
    const type = node?.nodeType ?? 0;
    if (!(this.whatToShow & (1 << (type - 1)))) {
      return false;
    }
    const filter = typeof this.filter === 'function' ? this.filter : this.filter?.acceptNode?.bind(this.filter);
    return filter ? filter(node) === 1 : true;
  }

  nextNode(): AnyNode | null {
    let node = this.currentNode;
    for (;;) {
      const first = childList(node)[0];
      if (first) {
        node = first;
      } else {
        while (node && node !== this.root && !node.nextSibling) {
          node = node.parentNode;
        }
        if (!node || node === this.root) {
          return null;
        }
        node = node.nextSibling;
      }
      if (this.accepts(node)) {
        this.currentNode = node;
        return node;
      }
    }
  }

  parentNode(): AnyNode | null {
    const parent = this.currentNode === this.root ? null : this.currentNode.parentNode;
    if (parent) {
      this.currentNode = parent;
    }
    return parent ?? null;
  }

  firstChild(): AnyNode | null {
    const child = childList(this.currentNode).find((node) => this.accepts(node)) ?? null;
    if (child) {
      this.currentNode = child;
    }
    return child;
  }

  nextSibling(): AnyNode | null {
    for (let node = this.currentNode.nextSibling; node; node = node.nextSibling) {
      if (this.accepts(node)) {
        this.currentNode = node;
        return node;
      }
    }
    return null;
  }
}

function installDocumentExtras(g: any): void {
  const doc: AnyNode = shimDocument;
  defineIfAbsent(DocumentProto, 'nodeType', constant(DOCUMENT_NODE));
  defineIfAbsent(DocumentProto, 'nodeName', constant('#document'));
  defineIfAbsent(DocumentProto, 'activeElement', constant(null));
  defineIfAbsent(DocumentProto, 'querySelector', method(() => null));
  defineIfAbsent(DocumentProto, 'querySelectorAll', method(() => nodeList([])));
  defineIfAbsent(DocumentProto, 'getElementById', method(() => null));
  defineIfAbsent(DocumentProto, 'getElementsByTagName', method(() => nodeList([])));
  defineIfAbsent(DocumentProto, 'getElementsByClassName', method(() => nodeList([])));
  defineIfAbsent(DocumentProto, 'elementFromPoint', method(() => null));
  defineIfAbsent(DocumentProto, 'elementsFromPoint', method(() => []));
  defineIfAbsent(DocumentProto, 'hasFocus', method(() => false));
  defineIfAbsent(DocumentProto, 'getSelection', method(() => null));
  defineIfAbsent(DocumentProto, 'visibilityState', constant('visible'));
  defineIfAbsent(DocumentProto, 'hidden', constant(false));
  defineIfAbsent(DocumentProto, 'dir', getter(() => doc.documentElement?.getAttribute('dir') ?? ''));

  if (!doc.documentElement) {
    const html = new ServerElement('html');
    const head = new ServerElement('head');
    const body = new ServerElement('body');
    html.appendChild(head);
    html.appendChild(body);
    Object.defineProperty(doc, 'documentElement', {value: html, configurable: true, writable: true});
    if (!doc.head) Object.defineProperty(doc, 'head', {value: head, configurable: true, writable: true});
    if (!doc.body) Object.defineProperty(doc, 'body', {value: body, configurable: true, writable: true});
  }

  // The shim's factories return `{}`; give the document instance real (detached) nodes instead.
  const factories: Record<string, (...args: any[]) => unknown> = {
    createElement: (tag: string) => createElementForTag(tag),
    createElementNS: (_ns: string, tag: string) => createElementForTag(String(tag).replace(/^.*:/, '')),
    createTextNode: (data: string) => new ServerText(data),
    createComment: (data: string) => new ServerComment(data),
    createDocumentFragment: () => new ServerFragment(),
    importNode: (node: AnyNode, deep?: boolean) => (node ? cloneNode(node, !!deep) : new ServerFragment()),
    adoptNode: (node: AnyNode) => node,
    createTreeWalker: (root: AnyNode, whatToShow?: number, filter?: AnyNode) =>
      new ServerTreeWalker(root, whatToShow, filter),
    createEvent: () => new g.Event(''),
    createRange: () => ({
      setStart() {},
      setEnd() {},
      selectNode() {},
      selectNodeContents() {},
      collapse() {},
      getBoundingClientRect: () => emptyRect(),
      getClientRects: () => [],
      createContextualFragment: (html: string) => {
        const fragment = new ServerFragment();
        for (const node of parseHTML(html)) fragment.appendChild(node);
        return fragment;
      },
    }),
  };
  for (const [name, fn] of Object.entries(factories)) {
    if (Object.prototype.hasOwnProperty.call(doc, name) && (doc[name] as AnyNode)?.[OURS]) {
      continue;
    }
    (fn as AnyNode)[OURS] = true;
    Object.defineProperty(doc, name, {value: fn, configurable: true, writable: true});
  }

  // Listeners added to the document singleton during a render are logged so the renderer can remove them.
  if (!(doc.addEventListener as AnyNode)?.[OURS]) {
    const add = doc.addEventListener;
    const logged = function (this: AnyNode, type: string, listener: unknown, options?: unknown) {
      logListener([doc, type, listener, options]);
      return add.call(this, type, listener, options);
    };
    (logged as AnyNode)[OURS] = true;
    Object.defineProperty(doc, 'addEventListener', {value: logged, configurable: true, writable: true});
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * crypto.getRandomValues: deterministic ids during renders, the real CSPRNG for everything else
 * ------------------------------------------------------------------------------------------------------------ */

/** Process-wide configuration of the `crypto.getRandomValues` wrapper (see `configureRandomSource`). */
export interface RandomSourceOptions {
  /**
   * Default `true`: while a render's deterministic source is active (the server renderer sets one per render pass,
   * only around the synchronous parts of a render, `server/context.ts` `runInContext`), requests shaped like
   * Spectrum's `randomID()` get bytes from it, so generated ids are the same in every pass of a render (and in every
   * render of the same page). `false`: every request goes to the real CSPRNG, also during renders.
   */
  deterministicIds?: boolean;
}

const randomSourceOptions: Required<RandomSourceOptions> = {deterministicIds: true};

/**
 * Configures the shim's `crypto.getRandomValues` wrapper for the whole process; returns the previous settings.
 * A per-render switch belongs in the renderer (`RenderSpectrumOptions.deterministicIds`: it simply does not activate
 * the deterministic source for that render); this is the process-wide default / kill switch.
 */
export function configureRandomSource(options: RandomSourceOptions): Required<RandomSourceOptions> {
  const previous = {...randomSourceOptions};
  if (options.deterministicIds !== undefined) {
    randomSourceOptions.deterministicIds = options.deterministicIds;
  }
  return previous;
}

/** Number of random bytes Spectrum's `randomID()` asks for (`shared/src/random-id.js`). */
const RANDOM_ID_BYTES = 4;

/**
 * True for the request `@spectrum-web-components/shared/src/random-id.js` makes (1.12.x, the only
 * `getRandomValues` caller in Spectrum): `crypto.getRandomValues(new Uint8Array(4))` - a plain `Uint8Array` (not a
 * subclass such as `Buffer`) of exactly 4 bytes, used for DOM ids (`${prefix}-${8 hex digits}`). Everything else -
 * nonces, tokens, UUID material, keys, which are longer and/or of other array types - must stay unpredictable.
 */
export function isRandomIdRequest(array: unknown): array is Uint8Array {
  return (
    array instanceof Uint8Array &&
    Object.getPrototypeOf(array) === Uint8Array.prototype &&
    array.length === RANDOM_ID_BYTES
  );
}

/**
 * Wraps `crypto.getRandomValues` (Node's global WebCrypto object; installed from `node:crypto` when missing).
 * Previously every caller got seeded bytes while a render ran (seed 0x5eed in pass 1, a hash of the pass-1 HTML in
 * pass 2), so nonces / tokens generated by unrelated code during SSR were predictable. Now only `randomID()`-shaped
 * requests use the render's deterministic source; all others - and all requests when `deterministicIds` is off or
 * no render is running - are answered by the original CSPRNG (which also keeps its argument validation:
 * `TypeError` for float arrays, `QuotaExceededError` above 65536 bytes).
 */
function installCrypto(g: any): void {
  if (typeof g.crypto === 'undefined') {
    Object.defineProperty(g, 'crypto', {value: webcrypto, configurable: true, writable: true});
  }
  const crypto = g.crypto;
  const original = crypto?.getRandomValues;
  if (typeof original !== 'function' || (original as AnyNode)[OURS]) {
    return;
  }
  const getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
    const source = randomSourceOptions.deterministicIds ? getRandomSource() : undefined;
    if (source && isRandomIdRequest(array)) {
      source(array);
      return array;
    }
    return original.call(crypto, array);
  };
  (getRandomValues as AnyNode)[OURS] = true;
  Object.defineProperty(crypto, 'getRandomValues', {value: getRandomValues, configurable: true, writable: true});
}

const isNoop = (fn: unknown): boolean =>
  typeof fn === 'function' && fn.length === 0 && /\{\s*\}\s*$/.test(Function.prototype.toString.call(fn));

/**
 * Browser globals on `globalThis`, installed once per process and never removed.
 *
 * PROCESS-WIDE, PERMANENT: `window` (= `globalThis`), `navigator`, `matchMedia`, `requestAnimationFrame` /
 * `cancelAnimationFrame` / `requestIdleCallback` (queued into the running render, dropped outside renders),
 * `getComputedStyle`, `CSS`, no-op `addEventListener` / `removeEventListener` / `dispatchEvent` on the global,
 * `innerWidth` & co., `screen`, `scrollTo`, the element / event classes. Every other module of the server process
 * sees them too: libraries that sniff `typeof window !== 'undefined'` (or `typeof document`, which
 * `@lit-labs/ssr-dom-shim` already defines) to detect a browser take their browser branch from now on. Import such
 * libraries before `installSpectrumSsr()` / `installSpectrumDomShim()` if they decide at import time, or keep them
 * in a separate process / worker. Lit itself is not affected (`isServer` comes from the `node` export condition).
 *
 * Why `window` cannot be scoped to "while the shim is active" (measured with .probe/window-scope.ts, which replaces
 * `window` by a counting accessor; full catalog, 2 renders): 128 reads happen while the registration modules are
 * imported (`base/src/define-element.js` writes `window.__swc` at module evaluation), and an application's import
 * phase has no detectable end; 6344 reads happen inside the synchronous parts of renders, but 12 happen outside them
 * during the render (`top-nav/src/TopNav.js` `manageItems` via the initial slotchange); and modules that components
 * import lazily from `render()` (`sp-number-field` from `sp-slider`, `sp-color-handle` / `sp-color-loupe` from
 * `sp-color-field`, chevron icons: 7 modules for those two components) are evaluated asynchronously, outside every
 * render section - with `window` undefined their `defineElement()` would throw and the module would stay failed for
 * the life of the process. Scoping it to the whole asynchronous duration of renders instead would make `window`
 * flip for unrelated code running during a render's awaits (other requests), i.e. sniffing results would depend on
 * timing, which is worse than a stable value. So `window` stays a plain global.
 */
function installGlobals(g: any): void {
  if (typeof g.Node === 'undefined') {
    g.Node = ShimNodeClass;
  }
  if (g.window === undefined) {
    // `@spectrum-web-components/base` (`src/define-element.js`) writes `window.__swc` at import time. Process-wide
    // and permanent, see the comment above.
    g.window = g;
  }
  g.navigator ??= {userAgent: 'node', platform: 'node', language: 'en-US', languages: ['en-US'], maxTouchPoints: 0};
  // Never matches: see `mediaQueryList`.
  g.matchMedia ??= (query: string) => mediaQueryList(query);
  if (typeof g.requestAnimationFrame !== 'function' || isNoop(g.requestAnimationFrame)) {
    g.requestAnimationFrame = requestFrame;
  }
  if (typeof g.cancelAnimationFrame !== 'function' || isNoop(g.cancelAnimationFrame)) {
    g.cancelAnimationFrame = cancelFrame;
  }
  g.requestIdleCallback ??= (callback: (deadline: unknown) => void) =>
    requestFrame(() => callback({didTimeout: false, timeRemaining: () => 0}));
  g.cancelIdleCallback ??= (id: number) => cancelFrame(id);
  g.getComputedStyle ??= (element: AnyNode) => computedStyle(element);
  g.CSS ??= {supports: () => false, escape: cssEscape};
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  g.dispatchEvent ??= () => true;
  g.innerWidth ??= 1024;
  g.innerHeight ??= 768;
  g.outerWidth ??= 1024;
  g.outerHeight ??= 768;
  g.devicePixelRatio ??= 1;
  g.scrollX ??= 0;
  g.scrollY ??= 0;
  g.pageXOffset ??= 0;
  g.pageYOffset ??= 0;
  g.screen ??= {width: 1024, height: 768, availWidth: 1024, availHeight: 768, colorDepth: 24, pixelDepth: 24};
  g.scrollTo ??= () => {};
  g.scrollBy ??= () => {};
  g.HTMLSlotElement ??= ShimHTMLSlotElementClass;
  g.Text ??= ServerText;
  g.Comment ??= ServerComment;
  g.DocumentFragment ??= ServerFragment;
  g.NodeFilter ??= {
    FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 0x1,
    SHOW_ATTRIBUTE: 0x2, SHOW_TEXT: 0x4, SHOW_CDATA_SECTION: 0x8, SHOW_PROCESSING_INSTRUCTION: 0x40,
    SHOW_COMMENT: 0x80, SHOW_DOCUMENT: 0x100, SHOW_DOCUMENT_TYPE: 0x200, SHOW_DOCUMENT_FRAGMENT: 0x400,
  };
  g.DOMRect ??= class DOMRect {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0
    ) {}
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return {x: this.x, y: this.y, width: this.width, height: this.height}; }
  };
  g.DOMRectReadOnly ??= g.DOMRect;

  // Element classes for `instanceof` checks (and for `document.createElement` of those tags).
  const elementClasses: Array<[string, string[]]> = [
    ['HTMLTemplateElement', ['template']],
    ['HTMLButtonElement', ['button']],
    ['HTMLInputElement', ['input']],
    ['HTMLTextAreaElement', ['textarea']],
    ['HTMLSelectElement', ['select']],
    ['HTMLOptionElement', ['option']],
    ['HTMLAnchorElement', ['a']],
    ['HTMLDivElement', ['div']],
    ['HTMLSpanElement', ['span']],
    ['HTMLLabelElement', ['label']],
    ['HTMLStyleElement', ['style']],
    ['HTMLImageElement', ['img']],
    ['HTMLFormElement', ['form']],
    ['HTMLDialogElement', ['dialog']],
    ['HTMLParagraphElement', ['p']],
    ['HTMLHeadingElement', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']],
    ['HTMLUListElement', ['ul']],
    ['HTMLLIElement', ['li']],
    ['HTMLTableElement', ['table']],
    ['HTMLIFrameElement', ['iframe']],
    ['HTMLVideoElement', ['video']],
    ['HTMLCanvasElement', ['canvas']],
    ['SVGElement', []],
  ];
  for (const [name, tags] of elementClasses) {
    if (typeof g[name] !== 'undefined') {
      continue;
    }
    const ctor = class extends ServerElement {
      constructor(localName: string = tags[0] ?? 'div') {
        super(localName);
      }
    };
    Object.defineProperty(ctor, 'name', {value: name});
    g[name] = ctor;
    for (const tag of tags) {
      registerElementClass(tag, ctor);
    }
    if (FORM_CONTROLS[name]) {
      installFormControl(ctor.prototype, FORM_CONTROLS[name]);
    }
  }
}

/** Default `type` per form control class (`''` = no type property). */
const FORM_CONTROLS: Record<string, string> = {
  HTMLInputElement: 'text',
  HTMLTextAreaElement: 'textarea',
  HTMLSelectElement: 'select-one',
  HTMLButtonElement: 'submit',
};

const formState = new WeakMap<object, {value?: string; checked?: boolean; indeterminate?: boolean; message: string}>();
const stateOf = (element: object) => {
  let state = formState.get(element);
  if (!state) {
    state = {message: ''};
    formState.set(element, state);
  }
  return state;
};

const TEXT_LIKE_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);
const BARRED_INPUT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image']);

/** HTML "barred from constraint validation": disabled, readonly (not select) or a button-like input type. */
function willValidate(element: AnyNode): boolean {
  const tag = String(element.localName ?? '');
  if (tag === 'button' || element.hasAttribute('disabled')) {
    return false;
  }
  if (tag !== 'select' && element.hasAttribute('readonly')) {
    return false;
  }
  return !(tag === 'input' && BARRED_INPUT_TYPES.has(String(element.getAttribute('type') ?? 'text').toLowerCase()));
}

function patternMatches(pattern: string, value: string): boolean {
  for (const flags of ['v', 'u']) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags).test(value);
    } catch {
      // try the next flag set; an invalid pattern is ignored, as in browsers
    }
  }
  return true;
}

/**
 * HTML constraint validation over the control's attributes and current value (`required`, `pattern`, `type`
 * email/url/number, `min`/`max`), so that components validating their native control on the server
 * (`textfield/src/Textfield.js` `checkValidity()`, number-field, search) get the result the browser computes.
 * `minlength`/`maxlength` only apply to user edits in browsers, so they are not checked here either.
 */
function computeValidity(element: AnyNode) {
  const state = stateOf(element);
  const flags = {
    valueMissing: false, typeMismatch: false, patternMismatch: false, tooLong: false, tooShort: false,
    rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false,
    customError: state.message !== '',
  };
  if (willValidate(element)) {
    const tag = String(element.localName ?? '');
    const type = tag === 'input' ? String(element.getAttribute('type') ?? 'text').toLowerCase() : tag;
    const value = String(element.value ?? '');
    if (element.hasAttribute('required')) {
      flags.valueMissing = type === 'checkbox' || type === 'radio' ? !element.checked : value === '';
    }
    if (tag === 'input' && value !== '') {
      const pattern = element.getAttribute('pattern');
      if (pattern !== null && TEXT_LIKE_TYPES.has(type)) {
        flags.patternMismatch = !patternMatches(pattern, value);
      }
      if (type === 'email') {
        flags.typeMismatch = !value.split(',').every((part) => /^[^\s@]+@[^\s@]+$/.test(part.trim()));
      } else if (type === 'url') {
        flags.typeMismatch = !(URL as unknown as {canParse?: (url: string) => boolean}).canParse?.(value);
      } else if (type === 'number' || type === 'range') {
        const number = Number(value);
        if (Number.isNaN(number)) {
          flags.badInput = true;
        } else {
          const min = element.getAttribute('min');
          const max = element.getAttribute('max');
          flags.rangeUnderflow = min !== null && min !== '' && number < Number(min);
          flags.rangeOverflow = max !== null && max !== '' && number > Number(max);
        }
      }
    }
  }
  const valid = !Object.values(flags).some(Boolean);
  return {...flags, valid};
}

/**
 * Form-control API for the server stand-ins of `<input>`, `<textarea>`, `<select>`, `<button>` (what components
 * call on the native controls in their shadow, e.g. `inputElement.checkValidity()` in
 * `textfield/src/Textfield.js`). Validity follows HTML constraint validation (see `computeValidity`).
 */
function installFormControl(proto: object, defaultType: string): void {
  defineIfAbsent(proto, 'value', getter(
    function () {
      const state = stateOf(this);
      if (state.value !== undefined) {
        return state.value;
      }
      // A textarea's default value is its text content (the server renders `.value` bindings into it).
      return this.localName === 'textarea' ? String(this.textContent ?? '') : (this.getAttribute('value') ?? '');
    },
    function (value) {
      stateOf(this).value = value == null ? '' : String(value);
    }
  ));
  defineIfAbsent(proto, 'defaultValue', stringAttribute('value'));
  defineIfAbsent(proto, 'checked', getter(
    function () {
      const state = stateOf(this);
      return state.checked ?? this.hasAttribute('checked');
    },
    function (value) {
      stateOf(this).checked = !!value;
    }
  ));
  defineIfAbsent(proto, 'indeterminate', getter(
    function () {
      return !!stateOf(this).indeterminate;
    },
    function (value) {
      stateOf(this).indeterminate = !!value;
    }
  ));
  defineIfAbsent(proto, 'type', getter(
    function () {
      return this.getAttribute('type') ?? defaultType;
    },
    function (value) {
      this.setAttribute('type', String(value));
    }
  ));
  for (const name of ['disabled', 'required', 'multiple', 'autofocus']) {
    defineIfAbsent(proto, name, booleanAttribute(name));
  }
  defineIfAbsent(proto, 'readOnly', booleanAttribute('readonly'));
  for (const name of ['name', 'placeholder', 'min', 'max', 'step', 'pattern', 'autocomplete']) {
    defineIfAbsent(proto, name, stringAttribute(name));
  }
  defineIfAbsent(proto, 'inputMode', stringAttribute('inputmode'));
  for (const [name, attribute] of [['maxLength', 'maxlength'], ['minLength', 'minlength']]) {
    defineIfAbsent(proto, name, getter(
      function () {
        const value = Number(this.getAttribute(attribute));
        return this.hasAttribute(attribute) && Number.isFinite(value) ? value : -1;
      },
      function (value) {
        this.setAttribute(attribute, String(value));
      }
    ));
  }
  defineIfAbsent(proto, 'valueAsNumber', getter(function () {
    return this.value === '' ? NaN : Number(this.value);
  }));
  defineIfAbsent(proto, 'validity', getter(function () {
    return computeValidity(this);
  }));
  defineIfAbsent(proto, 'validationMessage', getter(function () {
    return stateOf(this).message;
  }));
  defineIfAbsent(proto, 'willValidate', getter(function () {
    return willValidate(this);
  }));
  defineIfAbsent(proto, 'checkValidity', method(function (this: AnyNode) {
    return computeValidity(this).valid;
  }));
  defineIfAbsent(proto, 'reportValidity', method(function (this: AnyNode) {
    return computeValidity(this).valid;
  }));
  defineIfAbsent(proto, 'setCustomValidity', method(function (this: AnyNode, message: string) {
    stateOf(this).message = String(message ?? '');
  }));
  for (const name of ['select', 'setSelectionRange', 'setRangeText', 'stepUp', 'stepDown', 'showPicker']) {
    defineIfAbsent(proto, name, method(() => {}));
  }
  for (const name of ['selectionStart', 'selectionEnd']) {
    defineIfAbsent(proto, name, getter(() => 0));
  }
  defineIfAbsent(proto, 'selectionDirection', getter(() => 'none'));
  defineIfAbsent(proto, 'form', constant(null));
  defineIfAbsent(proto, 'labels', getter(() => nodeList([])));
  defineIfAbsent(proto, 'files', constant(null));
}

/**
 * DOM invokes function listeners with `this` = the current target; the shim's EventTarget calls them unbound,
 * which breaks e.g. `this.addEventListener('sp-system-context', this._handleSystemContext)` in
 * `theme/src/Theme.js`. Listeners are wrapped (one wrapper per target + listener, so de-duplication and
 * `removeEventListener` keep working) only if the shim actually calls them unbound.
 *
 * Retention path (fixed): the wrappers used to live in a `WeakMap<target, Map<callback, wrapper>>`. For a
 * long-lived target - the `document` singleton - the inner (strong) Map kept every callback ever added during any
 * render, and through the callback (`this.handleX` closures / bound methods) its element, the element's structure
 * backing, the realm and the whole render. The table is now keyed weakly on both sides
 * (`WeakMap<callback, WeakMap<target, wrapper>>`): an entry lives only while the callback and the target are both
 * alive, so a removed listener no longer pins anything. Entries are not deleted on `removeEventListener`: the same
 * callback may still be registered on the target for another type or capture flag, and its removal must find the
 * same wrapper.
 */
function installListenerThisBinding(): void {
  const EventTargetProto = Object.getPrototypeOf(NodeProto);
  if (!EventTargetProto || EventTargetProto[OURS]) {
    return;
  }
  const probe = new (ShimNodeClass as any)();
  let receiver: unknown;
  const listener = function (this: unknown) {
    receiver = this;
  };
  try {
    probe.addEventListener('swc-ssr-probe', listener);
    probe.dispatchEvent(new (globalThis as any).Event('swc-ssr-probe'));
    probe.removeEventListener('swc-ssr-probe', listener);
  } catch {
    return;
  }
  if (receiver === probe) {
    return;
  }
  const wrappers = new WeakMap<object, WeakMap<object, unknown>>();
  const wrapperFor = (target: object, callback: unknown, create: boolean): unknown => {
    if (typeof callback !== 'function') {
      return callback;
    }
    let byTarget = wrappers.get(callback);
    if (!byTarget) {
      if (!create) {
        return callback;
      }
      byTarget = new WeakMap();
      wrappers.set(callback, byTarget);
    }
    let wrapper = byTarget.get(target);
    if (!wrapper && create) {
      wrapper = function (this: unknown, event: Event) {
        return (callback as (this: unknown, event: Event) => unknown).call(target, event);
      };
      byTarget.set(target, wrapper);
    }
    return wrapper ?? callback;
  };
  const add = EventTargetProto.addEventListener;
  const remove = EventTargetProto.removeEventListener;
  EventTargetProto.addEventListener = function (this: object, type: string, callback: unknown, options?: unknown) {
    return add.call(this, type, wrapperFor(this, callback, true), options);
  };
  EventTargetProto.removeEventListener = function (this: object, type: string, callback: unknown, options?: unknown) {
    return remove.call(this, type, wrapperFor(this, callback, false), options);
  };
  EventTargetProto[OURS] = true;
}

let installed = false;

export function installExtras(): void {
  if (installed) {
    return;
  }
  installed = true;
  const g = globalThis as any;
  installGlobals(g);
  installEventClasses(g);
  installNodeExtras();
  installListenerThisBinding();
  installElementExtras();
  installHTMLElementExtras();
  installShadowRootExtras();
  installSlotExtras();
  installDocumentExtras(g);
  installCrypto(g);
}

export function extrasInstalled(): boolean {
  return installed;
}

export {TEXT_NODE};
