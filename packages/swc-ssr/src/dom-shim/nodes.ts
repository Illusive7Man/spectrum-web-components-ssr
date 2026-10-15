/**
 * Minimal server DOM node classes and helpers built on top of `@lit-labs/ssr-dom-shim`:
 *  - `ServerElement` / `ServerText` / `ServerComment` / `ServerFragment`: detached nodes (what
 *    `document.createElement`, `cloneNode`, `innerHTML` produce on the server). They extend the shim's classes so
 *    `instanceof HTMLElement` / `instanceof Node` keep working.
 *  - `classList` / `dataset` / `style` facades over attributes.
 *  - HTML serialization of live nodes (used for `innerHTML` / `outerHTML` and by the renderer).
 *
 * Nothing in here is Spectrum-specific.
 */
import {
  Node as ShimNodeClass,
  HTMLElement as ShimHTMLElementClass,
  HTMLSlotElement as ShimHTMLSlotElementClass,
} from '@lit-labs/ssr-dom-shim';
import {parseFragment, type DefaultTreeAdapterMap} from 'parse5';
import {BACKING, getBacking, reportDroppedMutation, setBacking, type StructureBacking} from './hooks.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

export const ShimNode = ShimNodeClass as unknown as new () => any;
export const ShimHTMLElement = ShimHTMLElementClass as unknown as new () => any;
export const ShimHTMLSlotElement = ShimHTMLSlotElementClass as unknown as new () => any;

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_FRAGMENT_NODE = 11;

/** Arrays double as NodeList / HTMLCollection (index access, `length`, iteration, `forEach`, `item()`). */
export function nodeList<T>(items: T[]): T[] & {item(index: number): T | null} {
  Object.defineProperty(items, 'item', {
    value: (index: number) => items[index] ?? null,
    enumerable: false,
    configurable: true,
  });
  return items as T[] & {item(index: number): T | null};
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Detached structure
 * ------------------------------------------------------------------------------------------------------------ */

/** Mutable structure backing of a detached node. */
export class DetachedBacking implements StructureBacking {
  parent: AnyNode | null = null;
  readonly children: AnyNode[] = [];

  constructor(private readonly owner: AnyNode) {}

  childNodes(): AnyNode[] {
    return this.children;
  }

  parentNode(): AnyNode | null {
    return this.parent;
  }

  isConnected(): boolean {
    return false;
  }

  setParent(parent: AnyNode | null): void {
    this.parent = parent;
  }

  insertBefore(node: AnyNode, ref: AnyNode | null): void {
    if (node == null || node === this.owner) {
      return;
    }
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      for (const child of [...(node.childNodes as AnyNode[])]) {
        this.insertBefore(child, ref);
      }
      return;
    }
    const previousParent = node.parentNode;
    if (previousParent) {
      const previousBacking = getBacking(previousParent);
      if (typeof previousBacking?.removeChild === 'function') {
        previousBacking.removeChild(node);
      } else if (previousBacking) {
        // Moving a rendered node out of its (server tree) parent: it stays where it is in the output.
        reportDroppedMutation(previousParent, 'removeChild', node);
      }
    }
    const index = ref == null ? -1 : this.children.indexOf(ref);
    if (index === -1) {
      this.children.push(node);
    } else {
      this.children.splice(index, 0, node);
    }
    getBacking(node)?.setParent?.(this.owner);
  }

  removeChild(node: AnyNode): void {
    const index = this.children.indexOf(node);
    if (index !== -1) {
      this.children.splice(index, 1);
      getBacking(node)?.setParent?.(null);
    }
  }
}

export class ServerText extends ShimNode {
  data: string;

  constructor(data: unknown = '') {
    super();
    this.data = String(data);
    setBacking(this, new DetachedBacking(this));
  }

  get nodeType(): number {
    return TEXT_NODE;
  }

  get nodeName(): string {
    return '#text';
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = String(value ?? '');
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = String(value ?? '');
  }

  get wholeText(): string {
    return this.data;
  }

  get length(): number {
    return this.data.length;
  }

  cloneNode(): ServerText {
    return new ServerText(this.data);
  }

  toString(): string {
    return this.data;
  }
}

export class ServerComment extends ShimNode {
  data: string;

  constructor(data: unknown = '') {
    super();
    this.data = String(data);
    setBacking(this, new DetachedBacking(this));
  }

  get nodeType(): number {
    return COMMENT_NODE;
  }

  get nodeName(): string {
    return '#comment';
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = String(value ?? '');
  }

  cloneNode(): ServerComment {
    return new ServerComment(this.data);
  }
}

export class ServerFragment extends ShimNode {
  constructor() {
    super();
    setBacking(this, new DetachedBacking(this));
  }

  get nodeType(): number {
    return DOCUMENT_FRAGMENT_NODE;
  }

  get nodeName(): string {
    return '#document-fragment';
  }

  cloneNode(deep?: boolean): ServerFragment {
    const clone = new ServerFragment();
    if (deep) {
      for (const child of childNodesOf(this)) {
        clone.appendChild(cloneNode(child, true));
      }
    }
    return clone;
  }
}

const templateContents = new WeakMap<object, ServerFragment>();

/** A detached HTML element (anything `document.createElement` returns for a non-custom tag). */
export class ServerElement extends ShimHTMLElement {
  declare __swcLocalName: string;

  constructor(localName = 'div', attributes?: Iterable<[string, string]>) {
    super();
    Object.defineProperty(this, '__swcLocalName', {value: String(localName).toLowerCase(), enumerable: false});
    if (attributes) {
      for (const [name, value] of attributes) {
        this.setAttribute(name, value);
      }
    }
    setBacking(this, new DetachedBacking(this));
  }

  get localName(): string {
    return this.__swcLocalName;
  }

  /** `<template>` support: `content` is a detached fragment. */
  get content(): ServerFragment | undefined {
    if (this.localName !== 'template') {
      return undefined;
    }
    let content = templateContents.get(this);
    if (!content) {
      content = new ServerFragment();
      templateContents.set(this, content);
    }
    return content;
  }
}

export class ServerSlotElement extends ShimHTMLSlotElement {
  constructor() {
    super();
    setBacking(this, new DetachedBacking(this));
  }

  get name(): string {
    return this.getAttribute('name') ?? '';
  }

  set name(value: string) {
    this.setAttribute('name', String(value));
  }
}

const elementClasses = new Map<string, new (localName: string) => AnyNode>();

/** Registers the class `document.createElement(tag)` uses for a non-custom tag. */
export function registerElementClass(tag: string, ctor: new (localName: string) => AnyNode): void {
  elementClasses.set(tag, ctor);
}

/** Creates an inert detached element for `tag` (never constructs custom elements). */
export function createPlainElement(tag: string): AnyNode {
  const localName = String(tag).toLowerCase();
  if (localName === 'slot') {
    return new ServerSlotElement();
  }
  const ctor = elementClasses.get(localName) ?? ServerElement;
  return new ctor(localName);
}

/** Creates a detached element for `tag`; registered custom elements are constructed like a browser would. */
export function createElementForTag(tag: string): AnyNode {
  const localName = String(tag).toLowerCase();
  if (localName === 'slot') {
    return new ServerSlotElement();
  }
  if (localName.includes('-')) {
    const ctor = (globalThis as any).customElements?.get(localName);
    if (ctor) {
      try {
        return new ctor();
      } catch {
        // fall through to an inert element
      }
    }
  }
  const ctor = elementClasses.get(localName) ?? ServerElement;
  return new ctor(localName);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Structure helpers (work for every kind of node: custom element instances, tree wrappers, detached nodes)
 * ------------------------------------------------------------------------------------------------------------ */

export function childNodesOf(node: AnyNode): AnyNode[] {
  if (node == null || typeof node !== 'object') {
    return [];
  }
  return getBacking(node)?.childNodes() ?? [];
}

export function textContentOf(node: AnyNode): string {
  if (node == null) {
    return '';
  }
  const type = node.nodeType;
  if (type === TEXT_NODE) {
    return String(node.data ?? '');
  }
  if (type === COMMENT_NODE) {
    return '';
  }
  let text = '';
  const stack: AnyNode[] = [...childNodesOf(node)].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current?.nodeType === TEXT_NODE) {
      text += String(current.data ?? '');
    } else if (current?.nodeType === ELEMENT_NODE) {
      const children = childNodesOf(current);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  }
  return text;
}

export function cloneNode(node: AnyNode, deep: boolean): AnyNode {
  if (node == null) {
    return node;
  }
  switch (node.nodeType) {
    case TEXT_NODE:
      return new ServerText(node.data);
    case COMMENT_NODE:
      return new ServerComment(node.data);
    case DOCUMENT_FRAGMENT_NODE: {
      const fragment = new ServerFragment();
      if (deep) {
        for (const child of childNodesOf(node)) {
          fragment.appendChild(cloneNode(child, true));
        }
      }
      return fragment;
    }
    case ELEMENT_NODE: {
      const localName = String(node.localName ?? 'div');
      const ctor = localName === 'slot' ? undefined : elementClasses.get(localName);
      const clone: AnyNode = localName === 'slot' ? new ServerSlotElement() : new (ctor ?? ServerElement)(localName);
      for (const {name, value} of (node.attributes ?? []) as {name: string; value: string}[]) {
        clone.setAttribute(name, value);
      }
      if (deep) {
        for (const child of childNodesOf(node)) {
          clone.appendChild(cloneNode(child, true));
        }
        if (localName === 'template' && node.content) {
          for (const child of childNodesOf(node.content)) {
            clone.content.appendChild(cloneNode(child, true));
          }
        }
      }
      return clone;
    }
    default:
      return new ServerFragment();
  }
}

export function insertBefore(parent: AnyNode, node: AnyNode, ref: AnyNode | null): AnyNode {
  const backing = getBacking(parent);
  if (typeof backing?.insertBefore === 'function') {
    backing.insertBefore(node, ref ?? null);
  } else if (backing && node != null && !isInPlace(parent, node, ref ?? null)) {
    // A node with a server-tree (or empty rendered) structure: the insertion has no effect, report it.
    reportDroppedMutation(parent, 'insertBefore', node);
  }
  return node;
}

/** Whether inserting `node` before `ref` in `parent` would leave the structure as it is. */
function isInPlace(parent: AnyNode, node: AnyNode, ref: AnyNode | null): boolean {
  if (node?.parentNode !== parent) {
    return false;
  }
  const children = childNodesOf(parent);
  const index = children.indexOf(node);
  return ref === null ? index === children.length - 1 : children[index + 1] === ref || ref === node;
}

export function removeChild(parent: AnyNode, node: AnyNode): AnyNode {
  const backing = getBacking(parent);
  if (typeof backing?.removeChild === 'function') {
    backing.removeChild(node);
  } else if (backing && node != null) {
    reportDroppedMutation(parent, 'removeChild', node);
  }
  return node;
}

/** `textContent` / `innerText` set on a node that cannot be mutated: reported unless the text is the same. */
export function dropTextContent(node: AnyNode, value: unknown): void {
  if (getBacking(node) && textContentOf(node) !== (value == null ? '' : String(value))) {
    reportDroppedMutation(node, 'textContent');
  }
}

/** `replaceChildren(...nodes)` on a node that cannot be mutated: reported unless the children stay the same. */
export function dropReplaceChildren(node: AnyNode, nodes: unknown[]): void {
  const current = childNodesOf(node);
  const same = current.length === nodes.length && current.every((child, index) => child === nodes[index]);
  if (getBacking(node) && !same) {
    reportDroppedMutation(node, 'replaceChildren');
  }
}

/** `innerHTML` set on a node that cannot be mutated: reported unless the markup is the same. */
export function dropInnerHTML(node: AnyNode, html: unknown): void {
  if (getBacking(node) && serializeChildren(node) !== String(html ?? '')) {
    reportDroppedMutation(node, 'innerHTML');
  }
}

/** Converts values passed to `append()` & co. (strings become text nodes). */
export function toNode(value: unknown): AnyNode {
  return typeof value === 'object' && value !== null ? value : new ServerText(String(value));
}

/** `true` if the node has a backing that supports mutation (detached nodes). */
export function isMutable(node: AnyNode): boolean {
  return typeof getBacking(node)?.insertBefore === 'function';
}

export function hasBacking(node: AnyNode): boolean {
  return node != null && typeof node === 'object' && (node as {[BACKING]?: unknown})[BACKING] !== undefined;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Serialization / parsing
 * ------------------------------------------------------------------------------------------------------------ */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

export const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');

export const escapeAttribute = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');

export function serializeAttributes(node: AnyNode): string {
  let out = '';
  for (const {name, value} of (node.attributes ?? []) as {name: string; value: string}[]) {
    out += value === '' || value == null ? ` ${name}` : ` ${name}="${escapeAttribute(String(value))}"`;
  }
  return out;
}

export function serializeChildren(node: AnyNode): string {
  const raw = node?.nodeType === ELEMENT_NODE && RAW_TEXT_ELEMENTS.has(String(node.localName));
  const source = node?.nodeType === ELEMENT_NODE && node.localName === 'template' && node.content ? node.content : node;
  let out = '';
  for (const child of childNodesOf(source)) {
    out += raw && child.nodeType === TEXT_NODE ? String(child.data ?? '') : serializeNode(child);
  }
  return out;
}

export function serializeNode(node: AnyNode): string {
  if (node == null) {
    return '';
  }
  switch (node.nodeType) {
    case TEXT_NODE:
      return escapeText(String(node.data ?? ''));
    case COMMENT_NODE:
      return `<!--${String(node.data ?? '')}-->`;
    case DOCUMENT_FRAGMENT_NODE:
    case DOCUMENT_NODE:
      return serializeChildren(node);
    case ELEMENT_NODE: {
      const tag = String(node.localName ?? 'div');
      const open = `<${tag}${serializeAttributes(node)}>`;
      return VOID_ELEMENTS.has(tag) ? open : `${open}${serializeChildren(node)}</${tag}>`;
    }
    default:
      return '';
  }
}

type P5Node = DefaultTreeAdapterMap['node'];

function fromParse5(p5: P5Node): AnyNode | undefined {
  if (p5.nodeName === '#text') {
    return new ServerText((p5 as DefaultTreeAdapterMap['textNode']).value);
  }
  if (p5.nodeName === '#comment') {
    return new ServerComment((p5 as DefaultTreeAdapterMap['commentNode']).data);
  }
  if ('tagName' in p5) {
    const element = p5 as DefaultTreeAdapterMap['element'];
    const created = createElementForTag(element.tagName);
    for (const attr of element.attrs) {
      created.setAttribute(attr.name, attr.value);
    }
    const childSource =
      element.tagName === 'template'
        ? (element as DefaultTreeAdapterMap['template']).content.childNodes
        : element.childNodes;
    const target = element.tagName === 'template' && created.content ? created.content : created;
    for (const child of childSource) {
      const converted = fromParse5(child);
      if (converted) {
        target.appendChild(converted);
      }
    }
    return created;
  }
  return undefined;
}

/** Parses an HTML fragment into detached server nodes. */
export function parseHTML(html: string): AnyNode[] {
  const fragment = parseFragment(String(html ?? ''));
  const nodes: AnyNode[] = [];
  for (const child of fragment.childNodes) {
    const converted = fromParse5(child);
    if (converted) {
      nodes.push(converted);
    }
  }
  return nodes;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Attribute facades
 * ------------------------------------------------------------------------------------------------------------ */

const classLists = new WeakMap<object, object>();
const datasets = new WeakMap<object, object>();
const styles = new WeakMap<object, object>();

/** DOMTokenList over an attribute (`class` for `classList`, `part` for `part`). */
export class TokenList {
  constructor(
    private readonly element: AnyNode,
    private readonly attribute: string
  ) {}

  private read(): string[] {
    const value = this.element.getAttribute(this.attribute);
    return value ? String(value).split(/\s+/).filter(Boolean) : [];
  }

  private write(tokens: string[]): void {
    this.element.setAttribute(this.attribute, [...new Set(tokens)].join(' '));
  }

  get length(): number {
    return this.read().length;
  }

  get value(): string {
    return this.element.getAttribute(this.attribute) ?? '';
  }

  set value(value: string) {
    this.element.setAttribute(this.attribute, String(value));
  }

  item(index: number): string | null {
    return this.read()[index] ?? null;
  }

  contains(token: string): boolean {
    return this.read().includes(token);
  }

  add(...tokens: string[]): void {
    this.write([...this.read(), ...tokens.map(String)]);
  }

  remove(...tokens: string[]): void {
    const remove = new Set(tokens.map(String));
    this.write(this.read().filter((token) => !remove.has(token)));
  }

  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    const add = force === undefined ? !has : force;
    if (add && !has) {
      this.add(token);
    } else if (!add && has) {
      this.remove(token);
    }
    return add;
  }

  replace(oldToken: string, newToken: string): boolean {
    const tokens = this.read();
    const index = tokens.indexOf(oldToken);
    if (index === -1) {
      return false;
    }
    tokens[index] = newToken;
    this.write(tokens);
    return true;
  }

  supports(): boolean {
    return true;
  }

  forEach(callback: (token: string, index: number, list: TokenList) => void, thisArg?: unknown): void {
    this.read().forEach((token, index) => callback.call(thisArg, token, index, this));
  }

  entries(): IterableIterator<[number, string]> {
    return this.read().entries();
  }

  keys(): IterableIterator<number> {
    return this.read().keys();
  }

  values(): IterableIterator<string> {
    return this.read().values();
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.read()[Symbol.iterator]();
  }

  toString(): string {
    return this.value;
  }
}

export function classListOf(element: AnyNode): TokenList {
  let list = classLists.get(element) as TokenList | undefined;
  if (!list) {
    list = new TokenList(element, 'class');
    classLists.set(element, list);
  }
  return list;
}

const toDataAttribute = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const fromDataAttribute = (name: string) => name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export function datasetOf(element: AnyNode): Record<string, string> {
  let dataset = datasets.get(element) as Record<string, string> | undefined;
  if (!dataset) {
    const keys = () =>
      ((element.attributes ?? []) as {name: string}[])
        .map(({name}) => name)
        .filter((name) => name.startsWith('data-'))
        .map(fromDataAttribute);
    dataset = new Proxy({} as Record<string, string>, {
      get: (_target, key) =>
        typeof key === 'string' ? (element.getAttribute(toDataAttribute(key)) ?? undefined) : undefined,
      set: (_target, key, value) => {
        if (typeof key === 'string') {
          element.setAttribute(toDataAttribute(key), String(value));
        }
        return true;
      },
      deleteProperty: (_target, key) => {
        if (typeof key === 'string') {
          element.removeAttribute(toDataAttribute(key));
        }
        return true;
      },
      has: (_target, key) => typeof key === 'string' && element.hasAttribute(toDataAttribute(key)),
      ownKeys: () => keys(),
      getOwnPropertyDescriptor: (_target, key) =>
        typeof key === 'string' && element.hasAttribute(toDataAttribute(key))
          ? {value: element.getAttribute(toDataAttribute(key)), enumerable: true, configurable: true, writable: true}
          : undefined,
    });
    datasets.set(element, dataset);
  }
  return dataset;
}

const cssPropertyName = (name: string): string => {
  if (name.startsWith('--')) {
    return name;
  }
  if (name === 'cssFloat') {
    return 'float';
  }
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
};

interface StyleEntry {
  value: string;
  important: boolean;
}

function parseStyleAttribute(text: string): Map<string, StyleEntry> {
  const map = new Map<string, StyleEntry>();
  for (const declaration of String(text).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const name = declaration.slice(0, colon).trim();
    let value = declaration.slice(colon + 1).trim();
    if (!name) {
      continue;
    }
    const important = /!\s*important$/i.test(value);
    if (important) {
      value = value.replace(/!\s*important$/i, '').trim();
    }
    map.set(name.startsWith('--') ? name : name.toLowerCase(), {value, important});
  }
  return map;
}

/** CSSStyleDeclaration facade: reads and writes the element's `style` attribute. */
export function styleOf(element: AnyNode): CSSStyleDeclaration {
  let style = styles.get(element) as CSSStyleDeclaration | undefined;
  if (!style) {
    const read = () => parseStyleAttribute(element.getAttribute('style') ?? '');
    const write = (map: Map<string, StyleEntry>) => {
      const text = [...map]
        .map(([name, {value, important}]) => `${name}: ${value}${important ? ' !important' : ''};`)
        .join(' ');
      if (text) {
        element.setAttribute('style', text);
      } else if (element.hasAttribute('style')) {
        element.removeAttribute('style');
      }
    };
    const declaration = {
      setProperty(name: string, value: unknown, priority?: string) {
        const map = read();
        const property = cssPropertyName(String(name));
        if (value === null || value === undefined || value === '') {
          map.delete(property);
        } else {
          map.set(property, {value: String(value), important: priority === 'important'});
        }
        write(map);
      },
      getPropertyValue(name: string) {
        return read().get(cssPropertyName(String(name)))?.value ?? '';
      },
      getPropertyPriority(name: string) {
        return read().get(cssPropertyName(String(name)))?.important ? 'important' : '';
      },
      removeProperty(name: string) {
        const map = read();
        const property = cssPropertyName(String(name));
        const previous = map.get(property)?.value ?? '';
        map.delete(property);
        write(map);
        return previous;
      },
      item(index: number) {
        return [...read().keys()][index] ?? '';
      },
      get length() {
        return read().size;
      },
      get cssText() {
        return element.getAttribute('style') ?? '';
      },
      set cssText(value: string) {
        if (value) {
          element.setAttribute('style', String(value));
        } else {
          element.removeAttribute('style');
        }
      },
    };
    style = new Proxy(declaration, {
      get(target, key, receiver) {
        if (typeof key !== 'string' || key in target) {
          return Reflect.get(target, key, receiver);
        }
        return target.getPropertyValue(key);
      },
      set(target, key, value, receiver) {
        if (typeof key !== 'string' || key in target) {
          return Reflect.set(target, key, value, receiver);
        }
        target.setProperty(key, value);
        return true;
      },
    }) as unknown as CSSStyleDeclaration;
    styles.set(element, style);
  }
  return style;
}

/** A zero-sized DOMRect-like value. */
export function emptyRect(): DOMRect {
  const rect = {x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0};
  return {...rect, toJSON: () => ({...rect})} as DOMRect;
}
