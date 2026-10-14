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
 * final pass they are applied to its HTML. Each changed element is located by its element-child path within its
 * tree scope - from the root for the document-level light DOM (the application's template, identical in every
 * pass), from the declarative shadow root of its host otherwise (the host is found by its `data-swc-ssr` marker of
 * the final pass) - and its start tag is edited in place. A target whose tag (or `id`) does not match the recorded
 * element is left alone (the scope rendered different content in the final pass).
 */
import {parseFragment, type DefaultTreeAdapterMap} from 'parse5';
import {MARKER_ATTRIBUTE, isDocumentNode, isElementNode, type ServerTree, type TreeElementNode, type TreeNode} from './server-tree.js';

export type LightMutations = Map<TreeElementNode, Map<string, string | null>>;

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];

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

/**
 * Applies the recorded attribute changes to `html` (the output of the pass whose facades recorded them; markers
 * still present). `tree` is the tree the facades were built from; `hostId(host)` returns the final-pass marker id
 * of a shadow host of that tree.
 */
export function applyLightMutations(
  html: string,
  mutations: LightMutations,
  tree: ServerTree,
  hostId: (host: TreeElementNode) => number | undefined
): string {
  if (mutations.size === 0) {
    return html;
  }
  const {text, original} = withoutStyles(html);
  const fragment = parseFragment(text, {sourceCodeLocationInfo: true}) as unknown as P5Node;
  let markers: Map<string, P5Element> | undefined;
  const edits: Edit[] = [];
  for (const [node, changes] of mutations) {
    const location = locate(node, tree);
    if (!location) {
      continue;
    }
    let target: P5Node | undefined = fragment;
    if (location.host) {
      const id = hostId(location.host);
      markers ??= indexMarkers(fragment);
      const host = id === undefined ? undefined : markers.get(String(id));
      target = host ? shadowContent(host) : undefined;
    }
    for (const index of location.path) {
      target = target ? elementChildren(target)[index] : undefined;
    }
    if (!target || !isP5Element(target) || target.tagName !== node.name) {
      continue;
    }
    const originalId = node.attribs.id;
    const targetId = target.attrs.find((attr) => attr.name === 'id')?.value;
    if (originalId !== undefined && !changes.has('id') && targetId !== originalId) {
      continue;
    }
    const startTag = target.sourceCodeLocation?.startTag as StartTagLocation | undefined;
    if (!startTag) {
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
