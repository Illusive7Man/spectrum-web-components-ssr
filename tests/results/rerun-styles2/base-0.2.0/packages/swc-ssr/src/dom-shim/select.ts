/**
 * CSS selector matching for the server DOM, using `css-select` with an adapter over *live* node objects
 * (custom element instances, tree-backed wrappers and detached clones alike). Attribute values are always read
 * through `getAttribute`, so selectors see the current state of an element (e.g. `[role="tab"]` set by a
 * component in its `connectedCallback`), not the state of the HTML it was parsed from.
 */
import {selectAll, selectOne, is, type Options} from 'css-select';

type Adapter<N, E extends N> = NonNullable<Options<N, E>['adapter']>;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;

const ELEMENT_NODE = 1;

const childrenOf = (node: AnyNode): AnyNode[] => {
  const list = node?.childNodes;
  return list ? Array.from(list as ArrayLike<AnyNode>) : [];
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
  };
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
    return selectAll(String(selector), root, options(root));
  } catch (error) {
    reportSelectorError(selector, error);
    return [];
  }
}

/** First descendant of `root` (not `root` itself) matching `selector`. */
export function queryOne(root: AnyNode, selector: string): AnyNode | null {
  try {
    return selectOne(String(selector), root, options(root));
  } catch (error) {
    reportSelectorError(selector, error);
    return null;
  }
}

/** `Element.prototype.matches` semantics. */
export function matches(element: AnyNode, selector: string): boolean {
  try {
    return is(element, String(selector), options(element));
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
