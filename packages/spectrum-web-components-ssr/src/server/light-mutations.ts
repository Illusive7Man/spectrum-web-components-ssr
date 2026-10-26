/**
 * Attribute changes that components make on plain (non-custom) elements, e.g. the `id` that
 * `alert-dialog/src/AlertDialog.js` / `dialog/src/Dialog.js` give a slotted heading so that their own
 * `aria-labelledby` can point at it, the header `id` of `menu/src/MenuGroup.js`, the id `split-view` gives its first
 * pane, or the `tabindex` `checkbox/src/Checkbox.js` moves onto its native input. In pass 2 such elements are
 * lightweight facades of the previous pass's tree; the output, though, comes from the templates, so without this
 * step the change would be lost: the server markup would reference ids that do not exist (and the browser would add
 * a second set of ids after hydration).
 *
 * The realm records `setAttribute` / `removeAttribute` calls on plain-element facades (see `TreeRealm`); after the
 * final pass they are applied to its HTML. Each changed element is located in its tree scope - the document-level
 * light DOM (the application's template), or the declarative shadow root of its host (found by its `data-swc-ssr`
 * marker of the final pass) - and its start tag is edited in place.
 *
 * Locating (review M4): the element-child path of the recorded node within its scope gives the candidate at the
 * same position. The final pass may render a scope differently from the pass the facades came from (a component
 * that renders extra elements once it knows its light DOM), so the candidate must also carry the recorded node's
 * signature: same tag and the same identity attributes (`id`, `name`, `slot`, `type`, `role`, `part`, `for`,
 * `href`, `src`), compared before any change was applied, and the same content: child elements (tag, `slot`) and
 * text (`lightSignature` / `fingerprintOf`). In order:
 *
 *  1. the element at the path, when it has the signature (including `class`) and the recorded content;
 *  2. otherwise the one element of the scope with the signature and the recorded content (the scope was rendered
 *     differently, e.g. a component rendered a same-signature element before the recorded one);
 *  3. otherwise the only element of the scope with the signature (its content changed);
 *  4. otherwise the element at the path, when it has the signature and the scope's structure along the path is
 *     unchanged (the same tags at every level): the same element, only its content changed - e.g. headings whose
 *     text a host renders from state it only knows from pass 2 on (third review: 0.1.1 dropped such changes when
 *     several same-signature elements had changed content, leaving dangling `aria-labelledby` references);
 *  5. otherwise the element at the path when only its `class` changed (no element has the full signature).
 *
 * Anything else (no element with the signature, or several of them in a scope whose structure changed and not
 * exactly one with the recorded content) is ambiguous: it is skipped and reported (`warn`). The output is searched
 * in a `ServerTree` of it (review M5: whole documents parsed with `parse()` like every tree, not `parseFragment()`,
 * which drops `<html>` / `<head>` / `<body>`), built with source locations - since 0.3.0 the one the renderer built
 * to verify the final pass's adoptions when there is one (render speed: one parse of the page less). The changes
 * become edits of the page applied in one copy (`applyEdits`; in `full` mode by `finalizeHtml` together with the
 * marker removal): applying them one at a time copied the whole page per change, quadratic in the page size.
 */
import {
  ServerTree,
  isDocumentNode,
  isElementNode,
  isTextNode,
  lightSignature,
  signatureOf,
  type TreeElementNode,
  type TreeNode,
} from './server-tree.js';

export type LightMutations = Map<TreeElementNode, Map<string, string | null>>;

/** Reports a change that could not be applied; `host` is the shadow host of its scope (null: document level). */
export type MutationWarning = (message: string, host: TreeElementNode | null) => void;

interface Location {
  /** The shadow host (previous pass's tree), or null for the document-level light DOM. */
  host: TreeElementNode | null;
  /** Element-child indexes from the scope root. */
  path: number[];
  /** The element children of every node along the path (scope root first, the node's parent last). */
  levels: TreeElementNode[][];
}

/**
 * Element children of tree nodes and each child's position among them, computed once per node and call (render
 * speed: looking them up again for every change made locating changes in a large scope quadratic).
 */
class ChildLists {
  private readonly lists = new Map<TreeNode, TreeElementNode[]>();
  private readonly positions = new Map<TreeNode, number>();

  constructor(private readonly select: (node: TreeNode) => TreeElementNode[]) {}

  of(node: TreeNode): TreeElementNode[] {
    let list = this.lists.get(node);
    if (!list) {
      list = this.select(node);
      this.lists.set(node, list);
      for (let index = 0; index < list.length; index++) {
        this.positions.set(list[index], index);
      }
    }
    return list;
  }

  /** Position of `child` among the element children of its parent `parent` (-1: not one of them). */
  position(parent: TreeNode, child: TreeNode): number {
    this.of(parent);
    return this.positions.get(child) ?? -1;
  }
}

/** Element children of a node of the facades' tree (its declarative shadow roots are detached). */
const treeElementChildren = (node: TreeNode): TreeElementNode[] =>
  ((node as {children?: TreeNode[]}).children ?? []).filter(isElementNode);

/** Where `node` is: its tree scope and element-child path in it, or undefined (detached / plain template content). */
function locate(node: TreeElementNode, tree: ServerTree, lists: ChildLists): Location | undefined {
  const path: number[] = [];
  const levels: TreeElementNode[][] = [];
  let current: TreeNode = node;
  for (;;) {
    const parent: TreeNode | null = current.parent;
    if (!parent) {
      return undefined;
    }
    const siblings = lists.of(parent);
    const index = lists.position(parent, current);
    if (index === -1) {
      return undefined;
    }
    path.unshift(index);
    levels.unshift(siblings);
    if (isDocumentNode(parent)) {
      // Shadow root content documents are detached from their template by the ServerTree.
      const host = tree.hostOf(parent);
      if (host) {
        return {host, path, levels};
      }
      return parent.parent ? undefined : {host: null, path, levels};
    }
    current = parent;
  }
}

/*
 * The final output is searched in a `ServerTree` of it built with source locations (the renderer passes the one it
 * parsed to verify the final pass's adoptions, when there is one: render speed, one parse of the output less).
 * Declarative shadow roots are detached from their hosts there (`shadowOf`); shadow templates it did not detach
 * (inside the content of a plain `<template>`) are skipped like attached ones.
 */

/**
 * Whether the final output has the recorded scope's structure along the recorded path: at every level the same
 * number of element children with the same tags. Then the element at the path is the recorded element even when
 * its content (or that of same-signature elements elsewhere in the scope) changed between the passes.
 */
function sameStructure(location: Location, scope: TreeNode, lists: ChildLists): boolean {
  let parent: TreeNode | undefined = scope;
  for (let level = 0; level < location.path.length; level++) {
    const recorded = location.levels[level];
    const current: TreeElementNode[] = parent ? lists.of(parent) : [];
    const changed =
      current.length !== recorded.length || recorded.some((element, index) => element.name !== current[index].name);
    if (changed) {
      return false;
    }
    parent = current[location.path[level]];
  }
  return true;
}

const isShadowTemplate = (node: TreeElementNode): boolean =>
  node.name === 'template' && node.attribs.shadowrootmode !== undefined;

/** Element children of a node of the output (shadow templates excluded). */
function elementChildren(node: TreeNode): TreeElementNode[] {
  const result: TreeElementNode[] = [];
  for (const child of (node as {children?: TreeNode[]}).children ?? []) {
    if (isElementNode(child) && !isShadowTemplate(child)) {
      result.push(child);
    }
  }
  return result;
}

/** The content of a plain `<template>`: a document node, its only child in the htmlparser2 tree. */
function templateContent(template: TreeElementNode): TreeNode | undefined {
  return template.children.find(isDocumentNode);
}

/** The elements of one tree scope (not descending into nested declarative shadow roots), in document order. */
function scopeElements(root: TreeNode): TreeElementNode[] {
  const result: TreeElementNode[] = [];
  const visit = (node: TreeNode): void => {
    for (const child of elementChildren(node)) {
      result.push(child);
      visit(child.name === 'template' ? (templateContent(child) ?? child) : child);
    }
  };
  visit(root);
  return result;
}

/** Attributes that identify an element within its scope (compared to find the recorded element). */
const IDENTITY_ATTRIBUTES = ['id', 'name', 'slot', 'type', 'role', 'part', 'for', 'href', 'src'];

/** Whether `candidate` (final output) has the tag and identity attributes of `node` (previous pass, unchanged). */
function matchesIdentity(node: TreeElementNode, candidate: TreeElementNode): boolean {
  if (candidate.name !== node.name) {
    return false;
  }
  return IDENTITY_ATTRIBUTES.every((name) => node.attribs[name] === candidate.attribs[name]);
}

function matchesClass(node: TreeElementNode, candidate: TreeElementNode): boolean {
  return (node.attribs.class ?? '') === (candidate.attribs.class ?? '');
}

/** Elements whose text is not content (see `lightSignature` in server-tree.ts). */
const NON_CONTENT = new Set(['template', 'style', 'script']);

function contentText(node: TreeNode, out: string[]): void {
  for (const child of (node as {children?: TreeNode[]}).children ?? []) {
    if (isTextNode(child)) {
      out.push(child.data);
    } else if (isElementNode(child) && !NON_CONTENT.has(child.name)) {
      contentText(child, out);
    }
  }
}

/**
 * Content fingerprint of an element of the final output: its child elements (tag and `slot`) and its text content,
 * in the format of `lightSignature` (the fingerprint of the recorded element of the previous pass's tree).
 */
function fingerprintOf(element: TreeElementNode): string {
  const tags = elementChildren(element)
    .map((child) => {
      const slot = child.attribs.slot;
      return slot !== undefined ? `${child.name}[${slot}]` : child.name;
    })
    .join(',');
  const text: string[] = [];
  contentText(element, text);
  return signatureOf(tags, text.join(''));
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export interface Edit {
  start: number;
  end: number;
  text: string;
}

type StartTagLocation = {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, {startOffset: number; endOffset: number}>;
};

/** Short description of a changed element for warnings, e.g. `<h2 slot="heading">` (id=... -> ...). */
function describe(node: TreeElementNode, changes: Map<string, string | null>): string {
  const identity = IDENTITY_ATTRIBUTES.filter((name) => node.attribs[name] !== undefined)
    .map((name) => ` ${name}="${node.attribs[name]}"`)
    .join('');
  const what = [...changes].map(([name, value]) => (value === null ? `-${name}` : `${name}="${value}"`)).join(', ');
  return `<${node.name}${identity}> (${what})`;
}

/**
 * Applies the recorded attribute changes to `html` (the output of the pass whose facades recorded them; markers
 * still present). `tree` is the tree the facades were built from; `hostId(host)` returns the final-pass marker id
 * of a shadow host of that tree. Changes that cannot be applied are reported through `warn`; `debug` gets notes
 * about changes applied by position only (see the file comment, 4.). `output`: a `ServerTree` of `html` built with
 * source locations, if the caller has one (otherwise one is built here).
 */
export function applyLightMutations(
  html: string,
  mutations: LightMutations,
  tree: ServerTree,
  hostId: (host: TreeElementNode) => number | undefined,
  warn: MutationWarning = () => {},
  debug: (message: string) => void = () => {},
  output?: ServerTree
): string {
  return applyEdits(html, lightMutationEdits(html, mutations, tree, hostId, warn, debug, output));
}

/**
 * The edits of `html` that `applyLightMutations` applies (same arguments; warnings and notes are reported here), for
 * callers that apply them together with other changes of the page (`finalizeHtml`: one copy of the page less).
 */
export function lightMutationEdits(
  html: string,
  mutations: LightMutations,
  tree: ServerTree,
  hostId: (host: TreeElementNode) => number | undefined,
  warn: MutationWarning = () => {},
  debug: (message: string) => void = () => {},
  output?: ServerTree
): Edit[] {
  if (mutations.size === 0) {
    return [];
  }
  const parsed = output?.hasLocations ? output : new ServerTree(html, {locations: true});
  const root: TreeNode = parsed.root;
  const scopes = new Map<TreeNode, TreeElementNode[]>();
  const edits: Edit[] = [];
  const claimed = new Set<TreeElementNode>();
  const treeLists = new ChildLists(treeElementChildren);
  const outputLists = new ChildLists(elementChildren);
  for (const [node, changes] of mutations) {
    const location = locate(node, tree, treeLists);
    if (!location) {
      // Not part of a rendered scope (e.g. a detached clone): nothing in the output corresponds to it.
      continue;
    }
    let scope: TreeNode | undefined = root;
    if (location.host) {
      const id = hostId(location.host);
      const host = id === undefined ? undefined : parsed.byId(id);
      scope = host ? parsed.shadowOf(host) : undefined;
      if (!scope) {
        warn(
          `light-DOM attribute change not applied: the shadow root of <${location.host.name}> is not in the final output: ${describe(node, changes)}`,
          location.host
        );
        continue;
      }
    }
    let target: TreeNode | undefined = scope;
    for (const index of location.path) {
      target = target ? outputLists.of(target)[index] : undefined;
    }
    let element = target && isElementNode(target) && !claimed.has(target) ? target : undefined;
    const matchesSignature = (candidate: TreeElementNode): boolean =>
      matchesIdentity(node, candidate) && matchesClass(node, candidate);
    const fingerprint = lightSignature(node);
    if (!element || !matchesSignature(element) || fingerprintOf(element) !== fingerprint) {
      // The final pass rendered the scope differently, or the element at the recorded position has other content
      // (see the file comment for the order).
      let elements = scopes.get(scope);
      if (!elements) {
        elements = scopeElements(scope);
        scopes.set(scope, elements);
      }
      const sameSignature = elements.filter((candidate) => !claimed.has(candidate) && matchesSignature(candidate));
      const exact = sameSignature.filter((candidate) => fingerprintOf(candidate) === fingerprint);
      if (exact.length === 1) {
        // Review finding (0.1.1): not the element at the recorded position with other content, e.g. one a component
        // rendered before the recorded one in the final pass.
        element = exact[0];
      } else if (sameSignature.length === 1 && exact.length === 0) {
        // The only element with the signature, its content changed between the passes: still the recorded element.
        element = sameSignature[0];
      } else if (element && matchesSignature(element) && sameStructure(location, scope, outputLists)) {
        // Third review (regression of 0.1.1): several same-signature elements whose content changed (e.g. headings
        // rendered from state the host only knows from pass 2 on) in an unchanged scope: the element at the recorded
        // position is the recorded element. 0.1.1 dropped the change (dangling `aria-labelledby` references).
        debug(
          `light-DOM attribute change applied at the recorded position (${sameSignature.length} same-signature ` +
            `elements, ${exact.length} with the recorded content, scope structure unchanged): ${describe(node, changes)}`
        );
      } else if (!(element && matchesIdentity(node, element) && sameSignature.length === 0)) {
        // (An element at the recorded position whose identity matches but whose class changed between the passes
        // is still the recorded element; anything else is ambiguous or missing.)
        warn(
          `light-DOM attribute change not applied: ${
            sameSignature.length > 1
              ? `${sameSignature.length} elements match${exact.length === 0 ? ' and none has the recorded content' : ''}`
              : 'no element matches'
          } ${describe(node, changes)} in the final output`,
          location.host
        );
        continue;
      }
    }
    claimed.add(element);
    const startTag = (element as {sourceCodeLocation?: {startTag?: StartTagLocation}}).sourceCodeLocation?.startTag;
    if (!startTag) {
      warn(
        `light-DOM attribute change not applied: <${element.name}> has no start tag in the output (implied element): ${describe(node, changes)}`,
        location.host
      );
      continue;
    }
    for (const [name, value] of changes) {
      const attribute = startTag.attrs?.[name];
      if (attribute) {
        const start = parsed.sourceOffset(attribute.startOffset);
        const end = parsed.sourceOffset(attribute.endOffset);
        if (value === null) {
          let from = start;
          while (from > 0 && /\s/.test(html[from - 1])) {
            from--;
          }
          edits.push({start: from, end, text: ''});
        } else {
          edits.push({start, end, text: `${name}="${escapeAttribute(value)}"`});
        }
      } else if (value !== null) {
        const tagEnd = parsed.sourceOffset(startTag.endOffset);
        const insertAt = html[tagEnd - 2] === '/' ? tagEnd - 2 : tagEnd - 1;
        edits.push({start: insertAt, end: insertAt, text: ` ${name}="${escapeAttribute(value)}"`});
      }
    }
  }
  return edits;
}

/**
 * `html` with `edits` applied, as if applied one at a time from the last start offset to the first (stable for equal
 * starts, so several insertions at one offset end up in reverse order of `edits`). Built in one pass: applying them
 * one at a time copied the whole document per edit (in `full` mode the catalog page is ~19 MB, mostly CSS, with
 * ~100 edits: about a quarter of the render time). Overlapping edits (never produced above) take the old path.
 */
export function applyEdits(html: string, edits: readonly Edit[]): string {
  if (edits.length === 0) {
    return html;
  }
  const order = orderedEdits(edits);
  if (order === undefined) {
    return applyEditsSequentially(html, edits);
  }
  const parts: string[] = [];
  let position = 0;
  for (const edit of order) {
    parts.push(html.slice(position, edit.start), edit.text);
    position = edit.end;
  }
  parts.push(html.slice(position));
  return parts.join('');
}

/**
 * `edits` in the order of the text they apply to (ascending start; equal starts in reverse order of `edits`, what
 * one-at-a-time application from the end gives), or undefined when two of them overlap (or one is inverted): then
 * only applying them one at a time defines the result.
 */
export function orderedEdits(edits: readonly Edit[]): Edit[] | undefined {
  const order = edits.map((edit, index) => ({edit, index}));
  order.sort((a, b) => a.edit.start - b.edit.start || b.index - a.index);
  let position = 0;
  for (const {edit} of order) {
    if (edit.start < position || edit.end < edit.start) {
      return undefined;
    }
    position = edit.end;
  }
  return order.map(({edit}) => edit);
}

function applyEditsSequentially(html: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = html;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}
