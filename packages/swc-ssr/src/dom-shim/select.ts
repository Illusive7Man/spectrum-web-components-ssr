/**
 * CSS selector matching for the server DOM, using `css-select` with an adapter over *live* node objects
 * (custom element instances, tree-backed wrappers and detached clones alike). Attribute values are always read
 * through `getAttribute`, so selectors see the current state of an element (e.g. `[role="tab"]` set by a
 * component in its `connectedCallback`), not the state of the HTML it was parsed from.
 */
import {selectAll, selectOne, is, compile, _compileUnsafe, type Options} from 'css-select';
import {BACKING, type StructureBacking} from './hooks.js';

type Adapter<N, E extends N> = NonNullable<Options<N, E>['adapter']>;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

const ELEMENT_NODE = 1;

/** The `childNodes` getter of the shim extras (install.ts), when they installed it. */
let shimChildNodes: unknown;

/** Called by install.ts once its `childNodes` getter (a copy of the node's backing's child nodes) is in place. */
export function setShimChildNodesGetter(getter: unknown): void {
  shimChildNodes = getter;
}

/** Per prototype: whether `childNodes` resolves to the shim's getter (computed once per prototype). */
const shimAnswersChildNodes = new WeakMap<object, boolean>();

function answeredByShim(prototype: object | null): boolean {
  if (prototype === null || shimChildNodes === undefined) {
    return false;
  }
  let answered = shimAnswersChildNodes.get(prototype);
  if (answered === undefined) {
    answered = false;
    for (let current: object | null = prototype; current !== null; current = Object.getPrototypeOf(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, 'childNodes');
      if (descriptor) {
        answered = descriptor.get === shimChildNodes;
        break;
      }
    }
    shimAnswersChildNodes.set(prototype, answered);
  }
  return answered;
}

const hasOwn = (node: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(node, key);

/**
 * Child nodes for the selector engine (read only: css-select and `findAll` / `findOne` never change the array).
 * Where `childNodes` is the shim's getter and the node has a backing, the backing's array is used as it is (render
 * speed: the getter copies it and decorates the copy as a NodeList on every read, ~40k times per full-catalog
 * render); otherwise `childNodes` is read (a new array every time, not copied again).
 */
const childrenOf = (node: AnyNode): AnyNode[] => {
  if (node !== null && typeof node === 'object') {
    const backing = (node as {[BACKING]?: StructureBacking})[BACKING];
    if (backing !== undefined && !hasOwn(node, 'childNodes') && answeredByShim(Object.getPrototypeOf(node))) {
      return backing.childNodes() as AnyNode[];
    }
  }
  const list = node?.childNodes;
  return list ? (Array.isArray(list) ? list : Array.from(list as ArrayLike<AnyNode>)) : [];
};

const isTag = (node: AnyNode): boolean => node != null && node.nodeType === ELEMENT_NODE;

function findAll(test: (e: AnyNode) => boolean, nodes: AnyNode[]): AnyNode[] {
  const result: AnyNode[] = [];
  const stack: AnyNode[] = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isTag(node)) {
      continue;
    }
    if (test(node)) {
      result.push(node);
    }
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]);
    }
  }
  return result;
}

function findOne(test: (e: AnyNode) => boolean, nodes: AnyNode[]): AnyNode | null {
  const stack: AnyNode[] = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isTag(node)) {
      continue;
    }
    if (test(node)) {
      return node;
    }
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]);
    }
  }
  return null;
}

function parentElementOf(node: AnyNode): AnyNode | null {
  const parent = node?.parentNode;
  return isTag(parent) ? parent : null;
}

export const liveAdapter: Adapter<AnyNode, AnyNode> = {
  isTag: isTag as Adapter<AnyNode, AnyNode>['isTag'],
  existsOne: (test, elems) => findOne(test, elems) !== null,
  getAttributeValue: (elem, name) => {
    const value = elem.getAttribute?.(name);
    return value === null || value === undefined ? undefined : String(value);
  },
  getChildren: childrenOf,
  getName: (elem) => String(elem.localName ?? '').toLowerCase(),
  getParent: parentElementOf,
  getSiblings: (node) => {
    const parent = node?.parentNode;
    return parent ? childrenOf(parent) : [node];
  },
  prevElementSibling: (node) => node?.previousElementSibling ?? null,
  getText: (node) => String(node?.textContent ?? ''),
  hasAttrib: (elem, name) => !!elem.hasAttribute?.(name),
  removeSubsets: (nodes) => {
    const unique = [...new Set(nodes)];
    return unique.filter((node) => {
      for (let p = parentElementOf(node); p; p = parentElementOf(p)) {
        if (unique.includes(p)) {
          return false;
        }
      }
      return true;
    });
  },
  findAll,
  findOne,
};

const never = () => false;

/**
 * Interactive / UA-state pseudo classes have no meaning on the server: nothing is focused, hovered or open.
 * `:defined` is true for every element (all custom elements that are rendered are registered).
 */
const serverPseudos: Options<AnyNode, AnyNode>['pseudos'] = {
  focus: never,
  'focus-visible': never,
  'focus-within': never,
  hover: never,
  active: never,
  'popover-open': never,
  modal: never,
  fullscreen: never,
  'user-invalid': never,
  'user-valid': never,
  'placeholder-shown': never,
  autofill: never,
  defined: () => true,
  host: never,
};

function options(context?: AnyNode): Options<AnyNode, AnyNode> {
  return {
    adapter: liveAdapter,
    xmlMode: false,
    // DOM semantics: the selector is evaluated against the whole tree, `:scope` is the queried node.
    relativeSelector: false,
    context: context === undefined ? undefined : [context],
    pseudos: serverPseudos,
    // No result caches inside compiled selectors: compiled selectors are cached process-wide (below), and
    // css-select's default `cacheResults: true` keeps a `WeakSet` of ancestors that did not match inside every
    // descendant combinator (and a `WeakMap` per `:has` / `:contains`). Those entries outlive the query, so a later
    // query would miss an ancestor whose attributes changed in between (`.on span` after `p.setAttribute('class',
    // 'on')`): components query and mutate the tree during a pass.
    cacheResults: false,
  };
}

/**
 * Compiled selectors (render speed: css-select parses and compiles a selector string on every call, ~25k queries
 * with a few hundred distinct selectors per full-catalog render). A compiled selector depends on the queried node
 * only through `:scope` (css-select passes the context to the `scope` pseudo-class alone, and relative selectors are
 * disabled), so selectors that mention `scope` are compiled per call as before. Selectors that do not compile are not
 * cached: they throw again, and are reported, on every call. Bounded: cleared when full. A compiled selector holds no
 * state about the nodes it saw (`cacheResults: false` in `options()`), so a cached one sees the current tree.
 */
type CompiledQuery<N> = ReturnType<typeof _compileUnsafe<N, N>>;
const MAX_COMPILED = 2048;
const compiledQueries = new Map<string, CompiledQuery<AnyNode>>();
const compiledMatchers = new Map<string, CompiledQuery<AnyNode>>();
/** The options of every compiled selector (`options()` without a context). */
const compileOptions = options();

function compiled(
  cache: Map<string, CompiledQuery<AnyNode>>,
  selector: string,
  compileSelector: (selector: string, options: Options<AnyNode, AnyNode>) => CompiledQuery<AnyNode>
): CompiledQuery<AnyNode> | string {
  if (/scope/i.test(selector)) {
    return selector;
  }
  let query = cache.get(selector);
  if (query === undefined) {
    query = compileSelector(selector, compileOptions);
    if (cache.size >= MAX_COMPILED) {
      cache.clear();
    }
    cache.set(selector, query);
  }
  return query;
}

export type SelectorErrorHandler = (selector: string, error: unknown) => void;
let selectorErrorHandler: SelectorErrorHandler | undefined;

/**
 * Unsupported selectors return "no match" instead of throwing; the server renderer can log them. Returns the
 * handler that was set before (so callers can restore it).
 */
export function setSelectorErrorHandler(handler: SelectorErrorHandler | undefined): SelectorErrorHandler | undefined {
  const previous = selectorErrorHandler;
  selectorErrorHandler = handler;
  return previous;
}

function reportSelectorError(selector: string, error: unknown): void {
  selectorErrorHandler?.(selector, error);
}

/** All descendants of `root` (not `root` itself) matching `selector`, in tree order. */
export function queryAll(root: AnyNode, selector: string): AnyNode[] {
  try {
    return selectAll(compiled(compiledQueries, String(selector), _compileUnsafe), root, options(root));
  } catch (error) {
    reportSelectorError(selector, error);
    return [];
  }
}

/** First descendant of `root` (not `root` itself) matching `selector`. */
export function queryOne(root: AnyNode, selector: string): AnyNode | null {
  try {
    return selectOne(compiled(compiledQueries, String(selector), _compileUnsafe), root, options(root));
  } catch (error) {
    reportSelectorError(selector, error);
    return null;
  }
}

/** `Element.prototype.matches` semantics. */
export function matches(element: AnyNode, selector: string): boolean {
  try {
    return is(element, compiled(compiledMatchers, String(selector), compile), options(element));
  } catch (error) {
    reportSelectorError(selector, error);
    return false;
  }
}

/** `Element.prototype.closest` semantics (does not cross shadow boundaries). */
export function closest(element: AnyNode, selector: string): AnyNode | null {
  for (let node: AnyNode = element; isTag(node); node = parentElementOf(node)) {
    if (matches(node, selector)) {
      return node;
    }
  }
  return null;
}
