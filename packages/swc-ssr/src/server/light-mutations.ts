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
 * text (`lightSignature` / `fingerprintOf`). When the element at the path does not match (or does not exist), the
 * one element of the scope with the signature (including `class`) and the content is used - or the only element
 * with the signature, whose content changed; when several elements have the signature and not exactly one of them
 * has the recorded content, the change is ambiguous: it is skipped and reported (`warn`), never applied to the
 * element that happens to be at the recorded position. Whole documents are parsed like the `ServerTree` parses them
 * (review M5: `parse()` instead of `parseFragment()`, which drops `<html>` / `<head>` / `<body>`).
 */
import {parse, parseFragment, type DefaultTreeAdapterMap} from 'parse5';
import {
  MARKER_ATTRIBUTE,
  isDocumentHtml,
  isDocumentNode,
  isElementNode,
  lightSignature,
  signatureOf,
  type ServerTree,
  type TreeElementNode,
  type TreeNode,
} from './server-tree.js';

export type LightMutations = Map<TreeElementNode, Map<string, string | null>>;

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];

/** Reports a change that could not be applied; `host` is the shadow host of its scope (null: document level). */
export type MutationWarning = (message: string, host: TreeElementNode | null) => void;

interface Location {
  /** The shadow host (previous pass's tree), or null for the document-level light DOM. */
  host: TreeElementNode | null;
  /** Element-child indexes from the scope root. */
  path: number[];
}

/** Where `node` is: its tree scope and element-child path in it, or undefined (detached / plain template content). */
function locate(node: TreeElementNode, tree: ServerTree): Location | undefined {
  const path: number[] = [];
  let current: TreeNode = node;
  for (;;) {
    const parent: TreeNode | null = current.parent;
    if (!parent) {
      return undefined;
    }
    const siblings: TreeNode[] = (parent as {children: TreeNode[]}).children.filter((child) => isElementNode(child));
    const index = siblings.indexOf(current);
    if (index === -1) {
      return undefined;
    }
    path.unshift(index);
    if (isDocumentNode(parent)) {
      // Shadow root content documents are detached from their template by the ServerTree.
      const host = tree.hostOf(parent);
      if (host) {
        return {host, path};
      }
      return parent.parent ? undefined : {host: null, path};
    }
    current = parent;
  }
}

const isP5Element = (node: P5Node): node is P5Element => 'tagName' in node;
const isShadowTemplate = (node: P5Element): boolean =>
  node.tagName === 'template' && node.attrs.some((attr) => attr.name === 'shadowrootmode');

function elementChildren(node: P5Node): P5Element[] {
  const children = (node as {childNodes?: P5Node[]}).childNodes ?? [];
  return children.filter((child): child is P5Element => isP5Element(child) && !isShadowTemplate(child));
}

/** Content of a host's declarative shadow root template. */
function shadowContent(host: P5Element): P5Node | undefined {
  const template = host.childNodes.find((child) => isP5Element(child) && isShadowTemplate(child)) as
    | (P5Element & {content?: P5Node})
    | undefined;
  return template?.content;
}

/** Index of the marked (`data-swc-ssr`) elements of the parsed output, including declarative shadow root content. */
function indexMarkers(root: P5Node): Map<string, P5Element> {
  const index = new Map<string, P5Element>();
  const stack: P5Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isP5Element(node)) {
      const marker = node.attrs.find((attr) => attr.name === MARKER_ATTRIBUTE);
      if (marker) {
        index.set(marker.value, node);
      }
      const content = (node as {content?: P5Node}).content;
      if (content) {
        stack.push(content);
      }
    }
    for (const child of (node as {childNodes?: P5Node[]}).childNodes ?? []) {
      stack.push(child);
    }
  }
  return index;
}

/** The elements of one tree scope (not descending into nested declarative shadow roots), in document order. */
function scopeElements(root: P5Node): P5Element[] {
  const result: P5Element[] = [];
  const visit = (node: P5Node): void => {
    for (const child of elementChildren(node)) {
      result.push(child);
      visit(child.tagName === 'template' ? ((child as {content?: P5Node}).content ?? child) : child);
    }
  };
  visit(root);
  return result;
}

/** Attributes that identify an element within its scope (compared to find the recorded element). */
const IDENTITY_ATTRIBUTES = ['id', 'name', 'slot', 'type', 'role', 'part', 'for', 'href', 'src'];

function attributeOf(element: P5Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

/** Whether `candidate` (final output) has the tag and identity attributes of `node` (previous pass, unchanged). */
function matchesIdentity(node: TreeElementNode, candidate: P5Element): boolean {
  if (candidate.tagName !== node.name) {
    return false;
  }
  return IDENTITY_ATTRIBUTES.every((name) => node.attribs[name] === attributeOf(candidate, name));
}

function matchesClass(node: TreeElementNode, candidate: P5Element): boolean {
  return (node.attribs.class ?? '') === (attributeOf(candidate, 'class') ?? '');
}

/** Elements whose text is not content (see `lightSignature` in server-tree.ts). */
const NON_CONTENT = new Set(['template', 'style', 'script']);

function contentText(node: P5Node, out: string[]): void {
  for (const child of (node as {childNodes?: P5Node[]}).childNodes ?? []) {
    if (child.nodeName === '#text') {
      out.push((child as {value: string}).value);
    } else if (isP5Element(child) && !NON_CONTENT.has(child.tagName)) {
      contentText(child, out);
    }
  }
}

/**
 * Content fingerprint of an element of the final output: its child elements (tag and `slot`) and its text content,
 * in the format of `lightSignature` (the fingerprint of the recorded element of the previous pass's tree).
 */
function fingerprintOf(element: P5Element): string {
  const tags = elementChildren(element)
    .map((child) => {
      const slot = attributeOf(child, 'slot');
      return slot !== undefined ? `${child.tagName}[${slot}]` : child.tagName;
    })
    .join(',');
  const text: string[] = [];
  contentText(element, text);
  return signatureOf(tags, text.join(''));
}

const STYLE_BODY_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

/**
 * The HTML without `<style>` bodies (parse5 is much faster without the inlined CSS), plus a function mapping an
 * offset in it back to the original HTML.
 */
function withoutStyles(html: string): {text: string; original: (offset: number) => number} {
  const cuts: Array<{at: number; shift: number}> = [];
  let removed = 0;
  const text = html.replace(STYLE_BODY_RE, (_match, open: string, body: string, close: string, offset: number) => {
    const at = offset - removed + open.length;
    removed += body.length;
    cuts.push({at, shift: removed});
    return open + close;
  });
  const original = (offset: number): number => {
    let low = 0;
    let high = cuts.length - 1;
    let shift = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (cuts[middle].at <= offset) {
        shift = cuts[middle].shift;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return offset + shift;
  };
  return {text, original};
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

interface Edit {
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
 * of a shadow host of that tree. Changes that cannot be applied are reported through `warn`.
 */
export function applyLightMutations(
  html: string,
  mutations: LightMutations,
  tree: ServerTree,
  hostId: (host: TreeElementNode) => number | undefined,
  warn: MutationWarning = () => {}
): string {
  if (mutations.size === 0) {
    return html;
  }
  const {text, original} = withoutStyles(html);
  const options = {sourceCodeLocationInfo: true};
  const root = (isDocumentHtml(text) ? parse(text, options) : parseFragment(text, options)) as unknown as P5Node;
  let markers: Map<string, P5Element> | undefined;
  const scopes = new Map<P5Node, P5Element[]>();
  const edits: Edit[] = [];
  const claimed = new Set<P5Element>();
  for (const [node, changes] of mutations) {
    const location = locate(node, tree);
    if (!location) {
      // Not part of a rendered scope (e.g. a detached clone): nothing in the output corresponds to it.
      continue;
    }
    let scope: P5Node | undefined = root;
    if (location.host) {
      const id = hostId(location.host);
      markers ??= indexMarkers(root);
      const host = id === undefined ? undefined : markers.get(String(id));
      scope = host ? shadowContent(host) : undefined;
      if (!scope) {
        warn(
          `light-DOM attribute change not applied: the shadow root of <${location.host.name}> is not in the final output: ${describe(node, changes)}`,
          location.host
        );
        continue;
      }
    }
    let target: P5Node | undefined = scope;
    for (const index of location.path) {
      target = target ? elementChildren(target)[index] : undefined;
    }
    let element = target && isP5Element(target) && !claimed.has(target) ? target : undefined;
    const matchesSignature = (candidate: P5Element): boolean =>
      matchesIdentity(node, candidate) && matchesClass(node, candidate);
    const fingerprint = lightSignature(node);
    if (!element || !matchesSignature(element) || fingerprintOf(element) !== fingerprint) {
      // The final pass rendered the scope differently, or the element at the recorded position has other content:
      // look for the one element with the recorded signature (and content, when several have the signature).
      let elements = scopes.get(scope);
      if (!elements) {
        elements = scopeElements(scope);
        scopes.set(scope, elements);
      }
      const sameSignature = elements.filter((candidate) => !claimed.has(candidate) && matchesSignature(candidate));
      const exact = sameSignature.filter((candidate) => fingerprintOf(candidate) === fingerprint);
      if (exact.length === 1) {
        element = exact[0];
      } else if (sameSignature.length === 1 && exact.length === 0) {
        // The only element with the signature, its content changed between the passes: still the recorded element.
        element = sameSignature[0];
      } else if (!(element && matchesIdentity(node, element) && sameSignature.length === 0)) {
        // (An element at the recorded position whose identity matches but whose class changed between the passes
        // is still the recorded element; anything else is ambiguous or missing. Review finding (fixed): with several
        // same-signature elements the change used to land on the one at the recorded position, whatever its content
        // - e.g. on an element a component rendered before the recorded one in the final pass.)
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
    const startTag = element.sourceCodeLocation?.startTag as StartTagLocation | undefined;
    if (!startTag) {
      warn(
        `light-DOM attribute change not applied: <${element.tagName}> has no start tag in the output (implied element): ${describe(node, changes)}`,
        location.host
      );
      continue;
    }
    for (const [name, value] of changes) {
      const attribute = startTag.attrs?.[name];
      if (attribute) {
        const start = original(attribute.startOffset);
        const end = original(attribute.endOffset);
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
        const tagEnd = original(startTag.endOffset);
        const insertAt = html[tagEnd - 2] === '/' ? tagEnd - 2 : tagEnd - 1;
        edits.push({start: insertAt, end: insertAt, text: ` ${name}="${escapeAttribute(value)}"`});
      }
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}
