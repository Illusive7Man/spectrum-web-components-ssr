/**
 * Server-side preparation of a component's `render()` result before upstream renders it. Two concerns:
 *
 * 1. DOM node values in *child* positions. Lit renders DOM nodes passed as child values (e.g.
 *    `${this.selectedItemContent.content}` in `picker/src/Picker.js`, which holds clones of the selected menu
 *    item's children) by inserting them. Lit SSR has no DOM and would print `[object Object]`. Node values found in
 *    child positions are converted: text nodes to strings, elements to `unsafeHTML` of their HTML (so nested custom
 *    elements are still server-rendered with their own declarative shadow roots).
 *    On the client such a value is a DOM node, which `hydrate()` treats as an opaque leaf: it must not find any
 *    hydration marker inside it (a `<!--lit-node-->` under a leaf throws "Hydration value mismatch"). The element
 *    markup is therefore wrapped in `<!--swc-raw-->` ... `<!--/swc-raw-->`, and `finalizeHtml()` removes the
 *    template-level markers (and `defer-hydration`, which nobody would remove) inside those regions after the
 *    render. Markers inside nested declarative shadow roots stay: those elements hydrate their own shadow roots.
 *
 * 2. Boolean property bindings on plain elements. `@lit-labs/ssr` reflects a property binding such as
 *    `.checked=${false}` on `<input>` (`checkbox/src/Checkbox.js`, `switch/src/Switch.js`) to an attribute with the
 *    stringified value, `checked="false"` - which HTML reads as *checked*. For boolean reflected properties
 *    (`checked`, `disabled`, `required`, ...) a falsy value is replaced by `noChange` (nothing is emitted) and a
 *    truthy one by `''` (a bare `name=""` attribute, which is also what the browser reflects for e.g. `.disabled`).
 *
 * 3. `.value` bindings on `<textarea>` (`textfield/src/Textfield.js` multiline). A textarea's value is not an
 *    attribute, so `@lit-labs/ssr` emits nothing and the no-JS page shows an empty field. The binding is wrapped in
 *    a directive that hands the value to `collect()` (render-spectrum.ts), which writes it as the textarea's text
 *    content (its default value) right after the start tag.
 *
 * 4. Templates containing custom elements that were defined only after the template was first rendered get a fresh
 *    strings array (see `currentStrings`).
 *
 * Values of other attribute / property / event bindings (e.g. `.triggerElement=${this}`) are left untouched.
 */
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {Directive, directive} from 'lit/directive.js';
import {noChange, nothing} from 'lit';
import {reflectedAttributeName} from '@lit-labs/ssr/lib/reflected-attributes.js';
import {ShimNode, serializeNode} from '../dom-shim/nodes.js';
import {getCurrentRenderContext, timerDelay} from './context.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/** Start / end of server-rendered DOM-node content (see `finalizeHtml`). */
export const RAW_OPEN = '<!--swc-raw-->';
export const RAW_CLOSE = '<!--/swc-raw-->';

/** Boolean IDL properties that `@lit-labs/ssr/lib/reflected-attributes.js` reflects to attributes. */
const BOOLEAN_PROPERTIES = new Set([
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formNoValidate',
  'hidden',
  'isMap',
  'loop',
  'multiple',
  'muted',
  'noValidate',
  'open',
  'readOnly',
  'required',
  'reversed',
  'selected',
]);

function isNodeLike(value: any): boolean {
  return value instanceof ShimNode || (typeof value?.nodeType === 'number' && 'textContent' in value);
}

function nodeToRenderable(node: any): unknown {
  switch (node.nodeType) {
    case TEXT_NODE:
      return String(node.data ?? node.textContent ?? '');
    case COMMENT_NODE:
      return nothing;
    default: {
      const markup = serializeNode(node);
      // unsafeHTML (not static-html, whose strings cache grows with every distinct markup) of serialized
      // nodes: SSR still parses it as a template, so nested custom elements get their own shadow roots.
      return markup ? unsafeHTML(RAW_OPEN + markup + RAW_CLOSE) : nothing;
    }
  }
}

/** How a template value is bound. */
interface Binding {
  /** Text content position. */
  child: boolean;
  /** Lowercase tag name of the element an attribute-position binding sits on. */
  tag?: string;
  /** Attribute / property name (case preserved, without the `.`/`?`/`@` prefix). */
  name?: string;
  prefix?: string;
}

const bindingCache = new WeakMap<object, Binding[]>();

/**
 * For each value of a template, whether it is bound in a child position (text content) rather than inside a
 * tag (attribute, property, boolean, event or element binding), and for attribute positions the tag and name.
 */
function bindings(strings: ArrayLike<string>): Binding[] {
  const cached = bindingCache.get(strings as object);
  if (cached) {
    return cached;
  }
  const result: Binding[] = [];
  let inTag = false;
  let tag = '';
  let quote: string | null = null;
  for (let i = 0; i < strings.length - 1; i++) {
    const text = strings[i];
    for (let j = 0; j < text.length; j++) {
      const char = text[j];
      if (!inTag) {
        if (char === '<' && /[a-zA-Z/!?]/.test(text[j + 1] ?? '')) {
          inTag = true;
          const match = /^[a-zA-Z][^\s/>]*/.exec(text.slice(j + 1));
          tag = match ? match[0].toLowerCase() : '';
        }
      } else if (quote) {
        if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        inTag = false;
      }
    }
    if (!inTag) {
      result.push({child: true});
      continue;
    }
    const name = /([.?@]?)([^\s"'>/=.?@][^\s"'>/=]*)\s*=\s*["']?$/.exec(text);
    result.push({child: false, tag, name: name?.[2], prefix: name?.[1]});
  }
  bindingCache.set(strings as object, result);
  return result;
}

function isDirectiveResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '_$litDirective$' in value;
}

/** `.checked=${false}` on a plain element -> nothing; `.checked=${true}` -> `checked=""` (see file comment). */
function booleanProperty(binding: Binding, value: unknown): unknown {
  const {tag, name} = binding;
  if (binding.prefix !== '.' || !tag || !name || tag.includes('-') || !BOOLEAN_PROPERTIES.has(name)) {
    return value;
  }
  if (value === noChange || isDirectiveResult(value)) {
    return value;
  }
  if (reflectedAttributeName(tag.toUpperCase(), name) === undefined) {
    return value;
  }
  return value && value !== nothing ? '' : noChange;
}

let pendingTextareaText: string | undefined;

/** Records the value of a textarea `.value` binding while upstream renders it (see the file comment, 3.). */
class TextareaValueDirective extends Directive {
  render(value: unknown): unknown {
    pendingTextareaText = value === undefined || value === null || value === nothing ? '' : String(value);
    return value;
  }
}
const textareaValue = directive(TextareaValueDirective);

/**
 * The text content for the `<textarea>` whose `.value` binding was just rendered (escaped for the RCDATA content),
 * or undefined. Consumes the value.
 */
export function takeTextareaContent(): string | undefined {
  const text = pendingTextareaText;
  pendingTextareaText = undefined;
  if (text === undefined) {
    return undefined;
  }
  // The HTML parser drops one leading newline of a textarea's content.
  return (text.startsWith('\n') ? '\n' : '') + text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function attributeValue(binding: Binding, value: unknown): unknown {
  if (binding.prefix === '.' && binding.tag === 'textarea' && binding.name === 'value' && !isDirectiveResult(value)) {
    return textareaValue(value);
  }
  return booleanProperty(binding, value);
}

function materializeChild(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object' || depth > 64) {
    return value;
  }
  if (isNodeLike(value)) {
    return nodeToRenderable(value);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const result = materializeChild(item, depth + 1);
      changed ||= result !== item;
      return result;
    });
    return changed ? mapped : value;
  }
  return materialize(value, depth + 1);
}

const CUSTOM_TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*-[a-zA-Z0-9._-]*)/g;

interface StringsState {
  /** Custom element tags of the template that were not defined yet. */
  pending: Set<string>;
  /** The strings array to render with (a copy once one of the pending tags got defined). */
  current: ArrayLike<string>;
}
const stringsStates = new WeakMap<object, StringsState>();

/**
 * Custom element tags that templates rendered (in the current render's thunks) while they were not defined, per
 * render session (see `awaitLazyDefinitions`); outside of a render they are not tracked.
 */
const undefinedTagsBySession = new WeakMap<object, Set<string>>();
/** Tags that were waited for once without being defined in time; never waited for again. */
const abandonedTags = new Set<string>();

function noteUndefinedTag(tag: string): void {
  const session = getCurrentRenderContext()?.session;
  if (!session) {
    return;
  }
  let tags = undefinedTagsBySession.get(session);
  if (!tags) {
    tags = new Set();
    undefinedTagsBySession.set(session, tags);
  }
  tags.add(tag);
}

/** How long `awaitLazyDefinitions` may wait. */
export interface LazyDefinitionWait {
  /**
   * The longest wait in ms; 0 (or less, NaN) disables it; `Infinity` (or more than the longest timer delay): no
   * timer, only `signal` ends the wait (see `lazyDefinitionWait` in render-spectrum.ts).
   */
  waitMs: number;
  /** Ends the wait (the render's deadline passed). */
  signal?: AbortSignal;
  /** Called with the tags about to be waited for (before waiting). */
  onWait?(tags: readonly string[]): void;
}

/**
 * After a pass of `session`: whether templates of that pass rendered custom element tags that were undefined then
 * and are defined now - then the pass must be rendered again. Tags still undefined (a component imports what it
 * renders lazily, e.g. `slider/src/Slider.js` -> `sp-number-field`) are waited for up to `waitMs`, each at most
 * once per process: whenever the wait ends - the definitions arrived, `waitMs` passed, or `signal` (the render's
 * deadline) ended it - the tags still undefined are never waited for again. Nothing is waited for when every
 * rendered tag was defined (review M6: the wait used to be on the critical path of renders that did not need it)
 * or `waitMs` is 0. Resets the session's list.
 *
 * Third review (fixed): with `lazyDefinitionWaitMs: Infinity` 0.1.1 raced the definitions against nothing, so a tag
 * that is never defined on the server (a client-only element) kept every render waiting until its deadline (which
 * then rejected: pass 1 had not been recorded yet), was never given up, and the pending wait kept the render alive.
 */
export async function awaitLazyDefinitions(session: object, wait: LazyDefinitionWait): Promise<boolean> {
  const seen = undefinedTagsBySession.get(session);
  undefinedTagsBySession.delete(session);
  if (!seen || seen.size === 0) {
    return false;
  }
  const registry = (globalThis as any).customElements;
  // Defined while the pass was still running (e.g. a lazy import that resolved during an await of the pass).
  const definedMeanwhile = [...seen].some((tag) => !!registry?.get(tag));
  const waiting = [...seen].filter((tag) => !registry?.get(tag) && !abandonedTags.has(tag));
  if (waiting.length === 0 || !(wait.waitMs > 0) || typeof registry?.whenDefined !== 'function') {
    return definedMeanwhile;
  }
  wait.onWait?.(waiting);
  // No timer for `Infinity` (see `timerDelay`): the render's deadline (`signal`) ends the wait.
  const delay = timerDelay(wait.waitMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (!wait.signal?.aborted) {
      await Promise.race([
        Promise.all(waiting.map((tag) => registry.whenDefined(tag))),
        new Promise<void>((resolve) => {
          if (delay !== undefined) {
            timer = setTimeout(resolve, delay);
          }
          if (wait.signal) {
            onAbort = resolve;
            wait.signal.addEventListener('abort', onAbort, {once: true});
          }
        }),
      ]);
    }
  } finally {
    clearTimeout(timer);
    if (onAbort) {
      wait.signal!.removeEventListener('abort', onAbort);
    }
  }
  let defined = definedMeanwhile;
  for (const tag of waiting) {
    if (registry.get(tag)) {
      defined = true;
    } else {
      abandonedTags.add(tag);
    }
  }
  return defined;
}

/**
 * 4. Lazily defined elements. `@lit-labs/ssr` decides once per template (its opcode cache is keyed by the strings
 *    array) whether a tag is a custom element - `customElements.get()` at the time the template is first rendered.
 *    Components often import what they render lazily (`slider/src/Slider.js` imports `sp-number-field` in
 *    `render()`, `color-field` imports `sp-color-handle`): rendered before that import finished, the template would
 *    render those elements as plain tags (no shadow root) for the rest of the process. When a tag of a template was
 *    undefined at first sight and is defined now, the template is rendered with a copy of its strings array (same
 *    text, so the same hydration digest), which upstream compiles anew.
 */
function currentStrings(strings: ArrayLike<string>): ArrayLike<string> {
  let state = stringsStates.get(strings as object);
  const registry = (globalThis as any).customElements;
  if (!state) {
    const pending = new Set<string>();
    for (let i = 0; i < strings.length; i++) {
      for (const match of strings[i].matchAll(CUSTOM_TAG_RE)) {
        const tag = match[1].toLowerCase();
        if (!registry?.get(tag)) {
          pending.add(tag);
          noteUndefinedTag(tag);
        }
      }
    }
    state = {pending, current: strings};
    stringsStates.set(strings as object, state);
    return strings;
  }
  if (state.pending.size === 0) {
    return state.current;
  }
  let defined = false;
  for (const tag of [...state.pending]) {
    if (registry?.get(tag)) {
      state.pending.delete(tag);
      defined = true;
    } else {
      // Rendered (again) while undefined: this render may want to wait for it.
      noteUndefinedTag(tag);
    }
  }
  if (defined) {
    const raw = (strings as {raw?: ArrayLike<string>}).raw ?? strings;
    state.current = Object.assign(Array.from(strings), {raw: Array.from(raw)});
  }
  return state.current;
}

/** Prepares a template result for the server render (recursively, see the file comment). */
export function materialize(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 64) {
    return value;
  }
  const candidate = value as {_$litType$?: unknown; strings?: ArrayLike<string>; values?: unknown[]};
  if (candidate._$litType$ === undefined || !Array.isArray(candidate.values) || !candidate.strings) {
    return Array.isArray(value) || isNodeLike(value) ? materializeChild(value, depth) : value;
  }
  const strings = typeof candidate._$litType$ === 'number' ? currentStrings(candidate.strings) : candidate.strings;
  const positions = bindings(candidate.strings);
  let changed = strings !== candidate.strings;
  const values = candidate.values.map((item, index) => {
    const binding = positions[index];
    const result = binding?.child === false ? attributeValue(binding, item) : materializeChild(item, depth + 1);
    changed ||= result !== item;
    return result;
  });
  return changed ? {...candidate, strings, values} : value;
}

const RAW_REGION = /<!--swc-raw-->([\s\S]*?)<!--\/swc-raw-->/g;
const TEMPLATE_TOKEN = /<template\b[^>]*>|<\/template>/gi;

/** Removes template-level hydration markers and `defer-hydration` from one raw region (outside nested templates). */
function stripRegion(region: string): string {
  let out = '';
  let depth = 0;
  let last = 0;
  const clean = (chunk: string): string =>
    chunk
      .replace(/<!--\/?lit-part[^>]*?-->|<!--lit-node \d+-->/g, '')
      .replace(/(<[a-zA-Z][^\s>]*-[^\s>]*\b[^>]*?) defer-hydration(?=[\s/>])/g, '$1');
  TEMPLATE_TOKEN.lastIndex = 0;
  for (let match = TEMPLATE_TOKEN.exec(region); match !== null; match = TEMPLATE_TOKEN.exec(region)) {
    const chunk = region.slice(last, match.index);
    out += depth === 0 ? clean(chunk) : chunk;
    if (match[0][1] === '/') {
      depth = Math.max(0, depth - 1);
      out += match[0];
    } else {
      // The opening tag of a declarative shadow root belongs to the element outside it: clean it at depth 0.
      out += depth === 0 ? clean(match[0]) : match[0];
      depth++;
    }
    last = match.index + match[0].length;
  }
  const rest = region.slice(last);
  return out + (depth === 0 ? clean(rest) : rest);
}

/**
 * Post-processes the final HTML of a render: raw DOM-node regions (see `materialize`) lose their template-level
 * hydration markers and their delimiting comments.
 */
export function finalizeHtml(html: string): string {
  if (!html.includes(RAW_OPEN)) {
    return html;
  }
  return html.replace(RAW_REGION, (_match, region: string) => stripRegion(region));
}
