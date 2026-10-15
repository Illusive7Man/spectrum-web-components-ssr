/**
 * Can a shadow-root stylesheet's selector match anything in one rendered instance of its element?
 *
 * Selectors are parsed with `css-what` (the parser `css-select` uses) and compiled into a small right-to-left
 * matcher over the server tree (`ServerTree`: parse5 + htmlparser2 adapter, declarative shadow roots detached from
 * their hosts). Compound selectors are evaluated with `css-select`; the shadow-DOM parts are evaluated here:
 *
 *  - `:host` / `:host(<compound>)`: the instance's host, the argument evaluated against the host's attributes. The
 *    host is featureless in its shadow tree: plain compounds never match it, other simple selectors next to
 *    `:host` are ignored (kept, never used to drop).
 *  - `:host-context(<compound>)`: the host or a shadow-including ancestor matches; when the render is a fragment
 *    (ancestors outside it are unknown) and nothing matched, it may still match.
 *  - `<slot compound>::slotted(<compound>)`: a `<slot>` of the shadow content that has at least one assigned
 *    element (light-DOM child of the host with that slot name, after flattening forwarded slots) matching the
 *    argument.
 *  - combinators climb from the shadow content to the host (the parent of the shadow root's top-level elements);
 *    the host has no parent or siblings in that context.
 *  - pseudo-elements (other than `::slotted`) are ignored; structural pseudo-classes (`:first-child`, `:nth-*`)
 *    are evaluated; every other pseudo-class (states such as `:hover`, `:focus-visible`, `:checked`, `:disabled`,
 *    `:dir()`, `:lang()`, `:empty`, `:defined`, and anything unknown) counts as "may match". Inside `:not()` an
 *    argument that is not fully evaluable drops the whole `:not()` ("may match"); `:is()` / `:where()` / `:has()`
 *    are weakened the same way.
 *
 * Whenever something cannot be evaluated, the answer is "may match": a rule is only dropped when none of its
 * selectors can match.
 */
import {parse, type Selector} from 'css-what';
import {compile, type Options} from 'css-select';
import type {AnyNode, Document, Element} from 'domhandler';
import {isElementNode, MARKER_ATTRIBUTE, type ServerTree} from '../server-tree.js';

type Test = (element: Element) => boolean;

type Combinator = 'descendant' | 'child' | 'adjacent' | 'sibling';

interface CompoundMatcher {
  /** Contains `:host`, `:host()` or `:host-context()`: matches the host only. */
  host: boolean;
  hostTests: Test[];
  hostContexts: Test[];
  /** `::slotted()`: the compound's element must be a `<slot>` with an assigned element passing this test. */
  slotted: Test | 'any' | undefined;
  /** The remaining (evaluable) simple selectors; undefined: no condition. */
  test: Test | undefined;
  /** Candidate index key of a subject compound (`#id`, `.class` or tag), see `Instance.candidates`. */
  key: string | undefined;
  /**
   * `:host` / `::slotted()` inside another pseudo-class (`:is(:host([x])) #a`): the compound may match any element,
   * the host included.
   */
  unknown: boolean;
}

export interface ComplexMatcher {
  /** Cannot be evaluated (unsupported combinator, parse failure): may match. */
  always: boolean;
  compounds: CompoundMatcher[];
  /** combinators[i] joins compounds[i] and compounds[i + 1]. */
  combinators: Combinator[];
}

const ALWAYS: ComplexMatcher = {always: true, compounds: [], combinators: []};

const STRUCTURAL = new Set([
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
]);
/** `:is()` and its aliases (`:any()` variants are evaluated as `:is()`). */
const IS_ALIASES = new Set(['is', 'where', 'matches', 'any', '-webkit-any', '-moz-any']);
const HOST_PSEUDOS = new Set(['host', 'host-context']);

const UNIVERSAL: Selector = {type: 'universal', namespace: null} as Selector;

function isTraversal(token: Selector): boolean {
  switch (token.type) {
    case 'descendant':
    case 'child':
    case 'adjacent':
    case 'sibling':
    case 'parent':
    case 'column-combinator':
      return true;
    default:
      return false;
  }
}

interface Cleaned {
  tokens: Selector[];
  /** Nothing was dropped. */
  exact: boolean;
  /** Contains `:host`-family pseudo-classes or `::slotted()` (not evaluable inside other pseudo-classes). */
  scoped: boolean;
  /** Every compound lost all its simple selectors (the selector matches every element). */
  universal: boolean;
}

interface CleanedToken {
  token: Selector | undefined;
  exact: boolean;
  scoped: boolean;
}

/** Removes what cannot be evaluated from a (nested) selector, weakening it (see the file comment). */
function cleanSelector(tokens: Selector[]): Cleaned {
  const out: Selector[] = [];
  let exact = true;
  let scoped = false;
  let hadTokens = false;
  let kept = false;
  let anyKept = false;
  const closeCompound = () => {
    if (hadTokens && !kept) {
      out.push(UNIVERSAL);
    }
    hadTokens = false;
    kept = false;
  };
  for (const token of tokens) {
    if (isTraversal(token)) {
      closeCompound();
      out.push(token);
      continue;
    }
    hadTokens = true;
    const cleaned = cleanToken(token);
    exact &&= cleaned.exact;
    scoped ||= cleaned.scoped;
    if (cleaned.token) {
      out.push(cleaned.token);
      kept = true;
      anyKept = true;
    }
  }
  closeCompound();
  return {tokens: out, exact, scoped, universal: !anyKept};
}

function cleanList(list: Selector[][]): Cleaned[] {
  return list.map((selector) => cleanSelector(selector));
}

function cleanToken(token: Selector): CleanedToken {
  switch (token.type) {
    case 'attribute':
    case 'tag':
    case 'universal':
      return {token, exact: true, scoped: false};
    case 'pseudo-element':
      return {token: undefined, exact: false, scoped: token.name === 'slotted'};
    case 'pseudo': {
      const name = token.name;
      if (HOST_PSEUDOS.has(name)) {
        return {token: undefined, exact: false, scoped: true};
      }
      if (STRUCTURAL.has(name)) {
        return {token, exact: true, scoped: false};
      }
      if (!Array.isArray(token.data)) {
        // States, user actions, `:dir()`, `:lang()`, legacy pseudo-elements, unknown pseudo-classes: may match.
        return {token: undefined, exact: false, scoped: false};
      }
      const args = cleanList(token.data);
      const scoped = args.some((arg) => arg.scoped);
      if (name === 'not' || name === 'has') {
        // `:not()`: a weakened argument would make the negation stronger - only fully evaluable arguments stay.
        // `:has()`: kept only when exact (relative selectors are not weakened).
        if (!scoped && args.every((arg) => arg.exact)) {
          return {token: {...token, data: args.map((arg) => arg.tokens)} as Selector, exact: true, scoped: false};
        }
        return {token: undefined, exact: false, scoped};
      }
      if (IS_ALIASES.has(name)) {
        if (scoped || args.some((arg) => arg.universal)) {
          return {token: undefined, exact: false, scoped};
        }
        return {
          token: {...token, name: name === 'where' ? 'where' : 'is', data: args.map((arg) => arg.tokens)} as Selector,
          exact: args.every((arg) => arg.exact),
          scoped: false,
        };
      }
      return {token: undefined, exact: false, scoped};
    }
    default:
      return {token: undefined, exact: false, scoped: false};
  }
}

const childrenOf = (node: AnyNode): AnyNode[] => (node as {children?: AnyNode[]}).children ?? [];

function textOf(node: AnyNode): string {
  if (node.type === 'text') {
    return (node as {data: string}).data;
  }
  return childrenOf(node).map(textOf).join('');
}

function findAll(test: (element: Element) => boolean, nodes: AnyNode[], out: Element[] = []): Element[] {
  for (const node of nodes) {
    if (isElementNode(node) && test(node)) {
      out.push(node);
    }
    findAll(test, childrenOf(node), out);
  }
  return out;
}

function findOne(test: (element: Element) => boolean, nodes: AnyNode[]): Element | null {
  for (const node of nodes) {
    if (isElementNode(node) && test(node)) {
      return node;
    }
    const found = findOne(test, childrenOf(node));
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * The css-select adapter: domutils semantics, except that tag and attribute names compare case-insensitively.
 * parse5 keeps SVG names camelCased (`viewBox`, `linearGradient`) while css-select lowercases the selector's names in
 * HTML mode, so `::slotted(svg[viewBox])` (`illustrated-message`) would never match; browsers match it. Matching
 * more than a browser only keeps more rules.
 */
const adapter: NonNullable<Options<AnyNode, Element>['adapter']> = {
  isTag: (node): node is Element => isElementNode(node),
  existsOne: (test, nodes) => findOne(test, nodes) !== null,
  getAttributeValue(element, name) {
    const value = element.attribs[name];
    if (value !== undefined) {
      return value;
    }
    for (const key in element.attribs) {
      if (key.toLowerCase() === name) {
        return element.attribs[key];
      }
    }
    return undefined;
  },
  getChildren: childrenOf,
  getName: (element) => element.name.toLowerCase(),
  getParent: (node) => node.parent ?? null,
  getSiblings: (node) => (node.parent ? childrenOf(node.parent) : [node]),
  prevElementSibling(node) {
    for (let previous = node.prev; previous; previous = previous.prev) {
      if (isElementNode(previous)) {
        return previous;
      }
    }
    return null;
  },
  getText: textOf,
  hasAttrib: (element, name) => adapter.getAttributeValue(element, name) !== undefined,
  removeSubsets(nodes) {
    return nodes.filter((node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (nodes.includes(parent)) {
          return false;
        }
      }
      return true;
    });
  },
  findAll: (test, nodes) => findAll(test, nodes),
  findOne,
};

/** Compiles tokens with css-select; undefined (no condition) when that fails. */
function compileTokens(list: Selector[][]): Test | undefined {
  try {
    const query = compile<AnyNode, Element>(list, {xmlMode: false, adapter});
    return (element) => query(element);
  } catch {
    return undefined;
  }
}

/** A selector list argument (`:host(...)`, `:host-context(...)`, `::slotted(...)`): weakened and compiled. */
function compileArgument(list: Selector[][]): Test | undefined {
  const cleaned = cleanList(list);
  if (cleaned.length === 0 || cleaned.some((arg) => arg.scoped || arg.universal)) {
    return undefined;
  }
  return compileTokens(cleaned.map((arg) => arg.tokens));
}

function keyOf(tokens: Selector[]): string | undefined {
  let classKey: string | undefined;
  let tagKey: string | undefined;
  for (const token of tokens) {
    if (token.type === 'attribute' && token.ignoreCase !== true && token.namespace === null) {
      if (token.name === 'id' && token.action === 'equals') {
        return `#${token.value}`;
      }
      if (token.name === 'class' && token.action === 'element' && classKey === undefined) {
        classKey = `.${token.value}`;
      }
    } else if (token.type === 'tag' && token.namespace === null) {
      tagKey = `<${token.name.toLowerCase()}`;
    }
  }
  return classKey ?? tagKey;
}

function compileCompound(tokens: Selector[]): CompoundMatcher {
  const compound: CompoundMatcher = {
    host: false,
    hostTests: [],
    hostContexts: [],
    slotted: undefined,
    test: undefined,
    key: undefined,
    unknown: false,
  };
  const rest: Selector[] = [];
  for (const token of tokens) {
    if (token.type === 'pseudo' && HOST_PSEUDOS.has(token.name)) {
      compound.host = true;
      if (Array.isArray(token.data)) {
        const test = compileArgument(token.data);
        if (test) {
          (token.name === 'host' ? compound.hostTests : compound.hostContexts).push(test);
        }
      }
      continue;
    }
    if (token.type === 'pseudo-element' && token.name === 'slotted') {
      let test: Test | undefined;
      try {
        test = token.data ? compileArgument(parse(token.data)) : undefined;
      } catch {
        test = undefined;
      }
      compound.slotted = test ?? 'any';
      continue;
    }
    const cleaned = cleanToken(token);
    if (cleaned.token) {
      rest.push(cleaned.token);
    } else if (cleaned.scoped) {
      compound.unknown = true;
    }
  }
  if (rest.length > 0) {
    compound.test = compileTokens([rest]);
    compound.key = compound.test ? keyOf(rest) : undefined;
  }
  return compound;
}

function compileComplex(tokens: Selector[]): ComplexMatcher {
  const compounds: CompoundMatcher[] = [];
  const combinators: Combinator[] = [];
  let current: Selector[] = [];
  for (const token of tokens) {
    if (!isTraversal(token)) {
      current.push(token);
      continue;
    }
    if (current.length === 0 || token.type === 'parent' || token.type === 'column-combinator') {
      return ALWAYS;
    }
    compounds.push(compileCompound(current));
    combinators.push(token.type as Combinator);
    current = [];
  }
  if (current.length === 0) {
    return ALWAYS;
  }
  compounds.push(compileCompound(current));
  // `::slotted()` on a host compound (`:host::slotted()`), or not on the subject: nothing sensible to evaluate.
  if (compounds.some((compound, index) => compound.slotted && (compound.host || index < compounds.length - 1))) {
    return ALWAYS;
  }
  return {always: false, compounds, combinators};
}

/**
 * Compiles a selector list (a style rule's prelude). Undefined when it cannot be parsed (the rule is kept).
 */
export function compileSelectorList(prelude: string): ComplexMatcher[] | undefined {
  let list: Selector[][];
  try {
    list = parse(prelude);
  } catch {
    return undefined;
  }
  return list.map((selector) => {
    try {
      return compileComplex(selector);
    } catch {
      return ALWAYS;
    }
  });
}

/** True if any selector of the list may match in the instance. */
export function listMayMatch(list: ComplexMatcher[] | undefined, instance: Instance): boolean {
  if (list === undefined) {
    return true;
  }
  for (const matcher of list) {
    if (mayMatch(matcher, instance)) {
      return true;
    }
  }
  return false;
}

/** One rendered element with a declarative shadow root, as the trimmer sees it. */
export class Instance {
  private all: Element[] | undefined;
  private slotList: Element[] | undefined;
  private index: Map<string, Element[]> | undefined;

  constructor(
    readonly host: Element,
    readonly shadow: Document,
    readonly tree: ServerTree
  ) {}

  /** Every element of the shadow content (nested shadow roots excluded), in document order. */
  get elements(): Element[] {
    if (!this.all) {
      const all: Element[] = [];
      const walk = (node: {children?: AnyNode[]}) => {
        for (const child of node.children ?? []) {
          if (isElementNode(child)) {
            all.push(child);
            walk(child);
          }
        }
      };
      walk(this.shadow);
      this.all = all;
    }
    return this.all;
  }

  /**
   * Everything the matcher can see of this instance except its ancestors (`:host-context()`) and light-DOM
   * grandchildren (`:has()` in `:host()` / `::slotted()`): the host's attributes and its siblings' tags, the shadow
   * content's elements and attributes, the host's light-DOM child elements and attributes (`::slotted()`).
   * Instances with equal fingerprints give the same answers for stylesheets without `:host-context()` and `:has()`.
   * Undefined (never equal) when a light child is a forwarded `<slot>` (its assigned content depends on another
   * host).
   */
  get fingerprint(): string | undefined {
    if (this.print === null) {
      return undefined;
    }
    if (this.print !== undefined) {
      return this.print;
    }
    let out = signatureOfElement(this.host, false);
    // Structural pseudo-classes in `:host()` (`:host(:first-child)`) see the host's element siblings.
    for (const sibling of this.host.parent ? childrenOf(this.host.parent) : []) {
      if (isElementNode(sibling)) {
        out += sibling === this.host ? '*' : `${sibling.name},`;
      }
    }
    const walk = (node: {children?: AnyNode[]}) => {
      for (const child of node.children ?? []) {
        if (isElementNode(child)) {
          out += signatureOfElement(child, true);
          walk(child);
          out += '>';
        }
      }
    };
    out += '\u0002';
    walk(this.shadow);
    out += '\u0002';
    for (const child of this.host.children) {
      if (isElementNode(child)) {
        if (child.name === 'slot') {
          this.print = null;
          return undefined;
        }
        out += signatureOfElement(child, true);
      }
    }
    this.print = out;
    return out;
  }

  private print: string | null | undefined;

  get slots(): Element[] {
    return (this.slotList ??= this.elements.filter((element) => element.name === 'slot'));
  }

  /** Elements of the shadow content that can match a compound with this key (all elements without a key). */
  candidates(key: string | undefined): Element[] {
    if (key === undefined) {
      return this.elements;
    }
    if (!this.index) {
      const index = new Map<string, Element[]>();
      const add = (k: string, element: Element) => {
        const list = index.get(k);
        if (list) {
          list.push(element);
        } else {
          index.set(k, [element]);
        }
      };
      for (const element of this.elements) {
        add(`<${element.name.toLowerCase()}`, element);
        const id = element.attribs.id;
        if (id) {
          add(`#${id}`, element);
        }
        const classes = element.attribs.class;
        if (classes) {
          for (const name of new Set(classes.split(/[ \t\n\f\r]+/))) {
            if (name) {
              add(`.${name}`, element);
            }
          }
        }
      }
      this.index = index;
    }
    return this.index.get(key) ?? [];
  }
}

function signatureOfElement(element: Element, open: boolean): string {
  let out = `<${element.name}`;
  for (const name in element.attribs) {
    if (name !== MARKER_ATTRIBUTE) {
      out += ` ${name}="${element.attribs[name].replace(/[&"]/g, (c) => (c === '&' ? '&amp;' : '&quot;'))}"`;
    }
  }
  return open ? out : `${out}>`;
}

function mayMatch(matcher: ComplexMatcher, instance: Instance): boolean {
  if (matcher.always) {
    return true;
  }
  const last = matcher.compounds.length - 1;
  const subject = matcher.compounds[last];
  if (subject.host || subject.unknown) {
    if (matchAt(matcher, last, instance.host, instance)) {
      return true;
    }
    if (subject.host) {
      return false;
    }
  }
  const candidates = subject.slotted ? instance.slots : instance.candidates(subject.unknown ? undefined : subject.key);
  for (const element of candidates) {
    if (matchAt(matcher, last, element, instance)) {
      return true;
    }
  }
  return false;
}

/** The parent in the shadow tree's selector context: top-level elements have the host as parent. */
function parentOf(element: Element, instance: Instance): Element | null {
  if (element === instance.host) {
    return null;
  }
  const parent = element.parent;
  if (parent && isElementNode(parent)) {
    return parent;
  }
  return parent === instance.shadow ? instance.host : null;
}

function previousElementOf(element: Element, instance: Instance): Element | null {
  if (element === instance.host) {
    return null;
  }
  for (let node = element.prev; node; node = node.prev) {
    if (isElementNode(node)) {
      return node;
    }
  }
  return null;
}

function matchAt(matcher: ComplexMatcher, index: number, element: Element, instance: Instance): boolean {
  if (!compoundMatches(matcher.compounds[index], element, instance)) {
    return false;
  }
  if (index === 0) {
    return true;
  }
  switch (matcher.combinators[index - 1]) {
    case 'child': {
      const parent = parentOf(element, instance);
      return parent !== null && matchAt(matcher, index - 1, parent, instance);
    }
    case 'descendant': {
      for (let parent = parentOf(element, instance); parent; parent = parentOf(parent, instance)) {
        if (matchAt(matcher, index - 1, parent, instance)) {
          return true;
        }
      }
      return false;
    }
    case 'adjacent': {
      const previous = previousElementOf(element, instance);
      return previous !== null && matchAt(matcher, index - 1, previous, instance);
    }
    case 'sibling': {
      for (let previous = previousElementOf(element, instance); previous; previous = previousElementOf(previous, instance)) {
        if (matchAt(matcher, index - 1, previous, instance)) {
          return true;
        }
      }
      return false;
    }
    default:
      return true;
  }
}

function compoundMatches(compound: CompoundMatcher, element: Element, instance: Instance): boolean {
  if (compound.unknown) {
    return true;
  }
  if (compound.host) {
    if (element !== instance.host) {
      return false;
    }
    for (const test of compound.hostTests) {
      if (!test(element)) {
        return false;
      }
    }
    for (const test of compound.hostContexts) {
      if (!hostContextMatches(test, instance)) {
        return false;
      }
    }
    return true;
  }
  if (element === instance.host) {
    // The host is featureless in its own shadow tree.
    return false;
  }
  if (compound.test && !compound.test(element)) {
    return false;
  }
  if (compound.slotted) {
    if (element.name !== 'slot') {
      return false;
    }
    const assigned = flattenedAssigned(element, instance.host, instance.tree, 0);
    if (assigned === undefined) {
      return true;
    }
    const test = compound.slotted;
    return assigned.some((node) => test === 'any' || test(node));
  }
  return true;
}

/** The shadow-including parent: the host for a shadow root's top-level nodes. */
function shadowIncludingParent(node: Element, tree: ServerTree): Element | null {
  const parent = node.parent;
  if (!parent) {
    return null;
  }
  if (isElementNode(parent)) {
    return parent;
  }
  return tree.isShadowRoot(parent) ? (tree.hostOf(parent as Document) ?? null) : null;
}

function hostContextMatches(test: Test, instance: Instance): boolean {
  for (let node: Element | null = instance.host; node; node = shadowIncludingParent(node, instance.tree)) {
    if (test(node)) {
      return true;
    }
  }
  // Ancestors outside a rendered fragment are unknown.
  return !instance.tree.isDocument;
}

function rootOf(node: AnyNode): AnyNode {
  let current = node;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

/**
 * The elements assigned to `slot` (a `<slot>` in the shadow root of `host`), flattened: a light-DOM child that is
 * itself a `<slot>` of an enclosing shadow root contributes what is assigned to it (or its fallback content).
 * Undefined when that cannot be determined.
 */
function flattenedAssigned(slot: Element, host: Element, tree: ServerTree, depth: number): Element[] | undefined {
  if (depth > 8) {
    return undefined;
  }
  const name = slot.attribs.name ?? '';
  const assigned: Element[] = [];
  for (const child of host.children) {
    if (!isElementNode(child) || (child.attribs.slot ?? '') !== name) {
      continue;
    }
    if (child.name === 'slot') {
      const root = rootOf(child);
      if (tree.isShadowRoot(root)) {
        const outerHost = tree.hostOf(root as Document);
        if (!outerHost) {
          return undefined;
        }
        const nested = flattenedAssigned(child, outerHost, tree, depth + 1);
        if (nested === undefined) {
          return undefined;
        }
        assigned.push(...(nested.length > 0 ? nested : child.children.filter(isElementNode)));
        continue;
      }
    }
    assigned.push(child);
  }
  return assigned;
}
