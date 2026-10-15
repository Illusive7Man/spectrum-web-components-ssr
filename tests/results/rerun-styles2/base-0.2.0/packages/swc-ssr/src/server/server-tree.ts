/**
 * The server tree: the pass-1 HTML parsed with parse5 + the htmlparser2 tree adapter (domhandler nodes), so
 * `css-select` can run real selectors over it.
 *
 * With the htmlparser2 adapter a `<template>`'s content is a `Document` node that is the template's only child.
 * Declarative shadow roots (`<template shadowrootmode>`) are detached from their host while indexing: the host's
 * `children` then contain only its light DOM, and the shadow content is reachable through `shadowRoot(id)` /
 * `shadowOf(node)`. Light-DOM queries therefore never see shadow content and vice versa, like in a browser.
 */
import {parse, parseFragment} from 'parse5';
import {adapter as htmlparser2Adapter} from 'parse5-htmlparser2-tree-adapter';
import {selectAll, selectOne} from 'css-select';
import type {AnyNode, ChildNode, Document, Element, ParentNode, Text} from 'domhandler';

export const MARKER_ATTRIBUTE = 'data-swc-ssr';

const isElementNode = (node: AnyNode | null | undefined): node is Element =>
  !!node && (node.type === 'tag' || node.type === 'script' || node.type === 'style');
const isTextNode = (node: AnyNode | null | undefined): node is Text => !!node && node.type === 'text';
const isDocumentNode = (node: AnyNode | null | undefined): node is Document => !!node && node.type === 'root';

/**
 * True if the HTML is a whole document (a doctype or `<html>` after leading whitespace / comments): such HTML is
 * parsed with parse5's `parse()`, anything else with `parseFragment()` (shared with light-mutations.ts, which must
 * see the same structure).
 */
export function isDocumentHtml(html: string): boolean {
  let index = 0;
  for (;;) {
    while (index < html.length && /\s/.test(html[index])) {
      index++;
    }
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      if (end === -1) {
        return false;
      }
      index = end + 3;
      continue;
    }
    return /^<(?:!doctype|html[\s>])/i.test(html.slice(index, index + 10));
  }
}

const STYLE_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_PLACEHOLDER = 'swc-ssr-style:';
const STYLE_PLACEHOLDER_RE = /\/\*swc-ssr-style:(\d+)\*\//g;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export interface SerializeOptions {
  /** Leave out `data-swc-ssr` markers. */
  stripMarkers?: boolean;
}

export class ServerTree {
  readonly root: Document;
  /** Whether the HTML was a whole document (parsed with `parse()`, see `isDocumentHtml`). */
  readonly isDocument: boolean;
  private readonly nodesById = new Map<number, Element>();
  private readonly idsByNode = new Map<Element, number>();
  private readonly shadows = new Map<Element, Document>();
  private readonly hosts = new Map<Document, Element>();
  private readonly shadowTemplateAttributes = new Map<Document, Record<string, string>>();
  /** Marked elements in construction order (element, its shadow content, then its light children). */
  private readonly ordered: Element[] = [];

  /** CSS of `<style>` elements, replaced by short placeholders before parsing (see constructor). */
  private readonly styles: string[] = [];

  constructor(html: string) {
    // Most of the pass-1 HTML is CSS (every shadow root carries its styles). It is irrelevant for the tree, so
    // it is swapped for placeholders before parsing (much less tokenizing and garbage) and restored when the
    // tree is serialized.
    const compact = html.replace(STYLE_RE, (match, open: string, css: string, close: string) => {
      if (css.length < 64) {
        return match;
      }
      this.styles.push(css);
      return `${open}/*${STYLE_PLACEHOLDER}${this.styles.length - 1}*/${close}`;
    });
    this.isDocument = isDocumentHtml(compact);
    const parseHtml = this.isDocument ? parse : parseFragment;
    this.root = parseHtml(compact, {treeAdapter: htmlparser2Adapter}) as unknown as Document;
    this.index(this.root);
  }

  /** Whole documents: the `lang` of their `<html>` element (undefined when absent or empty, and for fragments). */
  documentLanguage(): string | undefined {
    if (!this.isDocument) {
      return undefined;
    }
    const html = this.root.children.find((node): node is Element => isElementNode(node) && node.name === 'html');
    return html?.attribs.lang?.trim() || undefined;
  }

  /** Text content of a `<style>` element of this tree (CSS that was swapped for a placeholder while parsing restored). */
  styleText(element: Element): string {
    let text = '';
    for (const child of element.children) {
      if (isTextNode(child)) {
        text += child.data;
      }
    }
    return this.restoreStyles(text);
  }

  private restoreStyles(text: string): string {
    return text.includes(STYLE_PLACEHOLDER)
      ? text.replace(STYLE_PLACEHOLDER_RE, (match, index: string) => this.styles[Number(index)] ?? match)
      : text;
  }

  private index(parent: ParentNode): void {
    for (const child of [...parent.children]) {
      if (!isElementNode(child)) {
        continue;
      }
      const marker = child.attribs[MARKER_ATTRIBUTE];
      if (marker !== undefined) {
        const id = Number(marker);
        if (Number.isInteger(id)) {
          this.nodesById.set(id, child);
          this.idsByNode.set(child, id);
          this.ordered.push(child);
        }
      }
      const template = child.children.find(
        (node): node is Element =>
          isElementNode(node) &&
          node.name === 'template' &&
          (node.attribs.shadowrootmode !== undefined || node.attribs.shadowroot !== undefined)
      );
      if (template && !this.shadows.has(child)) {
        const content = template.children.find(isDocumentNode);
        detach(template);
        if (content) {
          // The content fragment is the template's child: make it a root of its own.
          detach(content as unknown as ChildNode);
          this.shadows.set(child, content);
          this.hosts.set(content, child);
          this.shadowTemplateAttributes.set(content, {...template.attribs});
          this.index(content);
        }
      }
      if (child.name !== 'template') {
        this.index(child);
      }
    }
  }

  /** Marked element of the pass-1 element with this id. */
  byId(id: number): Element | undefined {
    return this.nodesById.get(id);
  }

  /** Pass-1 id of a marked element. */
  idOf(node: AnyNode): number | undefined {
    return isElementNode(node) ? this.idsByNode.get(node) : undefined;
  }

  /** Marked elements in construction (document) order. */
  markedNodes(): readonly Element[] {
    return this.ordered;
  }

  /** Light-DOM child nodes (elements and text, no comments) of the element with this id. */
  lightChildren(id: number): ChildNode[] {
    const node = this.nodesById.get(id);
    return node ? childNodes(node) : [];
  }

  /** Shadow root content (a `Document` node) of the element with this id. */
  shadowRoot(id: number): Document | undefined {
    const node = this.nodesById.get(id);
    return node ? this.shadows.get(node) : undefined;
  }

  shadowOf(node: Element): Document | undefined {
    return this.shadows.get(node);
  }

  /** Host element of a shadow root content node. */
  hostOf(shadow: Document): Element | undefined {
    return this.hosts.get(shadow);
  }

  isShadowRoot(node: AnyNode): node is Document {
    return isDocumentNode(node) && this.hosts.has(node);
  }

  /** First descendant of `node` (light DOM / shadow content only) matching `selector` (static attributes). */
  query(node: ParentNode, selector: string): Element | null {
    return selectOne(selector, node.children as AnyNode[]) as Element | null;
  }

  /** All descendants of `node` matching `selector` (static attributes). */
  queryAll(node: ParentNode, selector: string): Element[] {
    return selectAll(selector, node.children as AnyNode[]) as Element[];
  }

  /**
   * Serializes the shadow content of the element with this id, re-attaching nested declarative shadow roots.
   * `stripMarkers` leaves out the `data-swc-ssr` markers (ids of this tree's pass, meaningless in another pass).
   */
  serializeShadow(id: number, options: SerializeOptions = {}): string | undefined {
    const shadow = this.shadowRoot(id);
    return shadow ? this.serializeChildren(shadow, options) : undefined;
  }

  serializeChildren(parent: ParentNode, options: SerializeOptions = {}): string {
    let out = '';
    const raw = isElementNode(parent as AnyNode) && RAW_TEXT_ELEMENTS.has((parent as Element).name);
    for (const child of parent.children) {
      out += this.serialize(child as AnyNode, raw, options);
    }
    return out;
  }

  private serialize(node: AnyNode, raw: boolean, options: SerializeOptions): string {
    if (isTextNode(node)) {
      return raw ? this.restoreStyles(node.data) : escapeText(node.data);
    }
    if (node.type === 'comment') {
      return `<!--${node.data}-->`;
    }
    if (isDocumentNode(node)) {
      return this.serializeChildren(node, options);
    }
    if (!isElementNode(node)) {
      return '';
    }
    let out = `<${node.name}`;
    for (const [name, value] of Object.entries(node.attribs)) {
      if (options.stripMarkers && name === MARKER_ATTRIBUTE) {
        continue;
      }
      out += value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
    }
    out += '>';
    if (VOID_ELEMENTS.has(node.name)) {
      return out;
    }
    const shadow = this.shadows.get(node);
    if (shadow) {
      const attributes = this.shadowTemplateAttributes.get(shadow) ?? {shadowrootmode: 'open'};
      let template = '<template';
      for (const [name, value] of Object.entries(attributes)) {
        template += value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
      }
      out += `${template}>${this.serializeChildren(shadow, options)}</template>`;
    }
    return `${out}${this.serializeChildren(node, options)}</${node.name}>`;
  }
}

/** Child nodes the DOM would expose (elements and text; comments such as Lit markers are skipped). */
export function childNodes(parent: ParentNode): ChildNode[] {
  return parent.children.filter((node) => isElementNode(node) || isTextNode(node));
}

/** FNV-1a hash of a string, base 36. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Elements whose text is not content (CSS is also replaced by placeholders in the tree). */
const NON_CONTENT = new Set(['template', 'style', 'script']);

/** Text content of a light-DOM subtree (comments, shadow roots and `NON_CONTENT` elements excluded). */
function lightText(node: AnyNode, out: string[]): void {
  for (const child of (node as ParentNode).children ?? []) {
    if (isTextNode(child)) {
      out.push(child.data);
    } else if (isElementNode(child) && !NON_CONTENT.has(child.name)) {
      lightText(child, out);
    }
  }
}

/**
 * Signature of an element's light DOM: its child elements (tag and `slot`) and a hash of its text content with
 * whitespace collapsed. Declarative shadow roots are detached by the tree, so only light DOM counts. The same format
 * is computed for parse5 elements of a pass output in light-mutations.ts (`fingerprintOf`, via `signatureOf`).
 */
export function lightSignature(node: Element): string {
  const tags = node.children
    .filter(isElementNode)
    .map((child) => (child.attribs.slot !== undefined ? `${child.name}[${child.attribs.slot}]` : child.name))
    .join(',');
  const text: string[] = [];
  lightText(node, text);
  return signatureOf(tags, text.join(''));
}

/** `tags|hash of the text` (see `lightSignature`). */
export function signatureOf(tags: string, text: string): string {
  return `${tags}|${shortHash(text.replace(/\s+/g, ' ').trim())}`;
}

function detach(node: ChildNode): void {
  const parent = node.parent;
  if (!parent) {
    return;
  }
  const index = parent.children.indexOf(node);
  if (index !== -1) {
    parent.children.splice(index, 1);
  }
  if (node.prev) {
    node.prev.next = node.next;
  }
  if (node.next) {
    node.next.prev = node.prev;
  }
  node.parent = null;
  node.prev = null;
  node.next = null;
}

export {isElementNode, isTextNode, isDocumentNode};
export type {Element as TreeElementNode, Document as TreeDocumentNode, AnyNode as TreeNode, Text as TreeTextNode};
