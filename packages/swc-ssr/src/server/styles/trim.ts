/**
 * `StyleOptions.mode: 'trimmed'`: resolves the stylesheet placeholders of a render's final HTML (collector.ts).
 *
 *  1. The final HTML (CSS replaced by short placeholder tokens, so parsing it is cheap) is parsed into a
 *     `ServerTree`. Every `<style>` with tokens is attributed to the host of its declarative shadow root; a token
 *     whose host cannot be determined (e.g. markup inside a plain `<template>`) keeps that stylesheet complete.
 *  2. Per stylesheet (tag + stylesheet object), a style rule is kept when any of its selectors may match in any of
 *     its instances (selector-match.ts) or matches `StyleOptions.keep`; `@media` / `@supports` / `@container` /
 *     `@starting-style` blocks are kept when a rule inside is kept (named `@layer` blocks always, for the layer
 *     order); `@keyframes` when a kept rule (or a `style` attribute) names them; other at-rules always.
 *  3. `undefinedPrefixes`: `var(--prefix-x, V)` becomes `V` in kept rules unless the page defines `--prefix-x`.
 *  4. `trimTheme`: theme custom properties are kept only when used - transitively through the theme's own
 *     definitions - by a kept rule of a component stylesheet, a non-custom-property declaration or nested rule of
 *     the theme, a `style` attribute, another `<style>` of the output, or `references`.
 *  5. `minifyCustomProperties`: see `minify()` (only names the client can switch at once, judged on the trimmed texts
 *     and on the complete stylesheets of the page's element classes; never Spectrum's public `--mod-*` /
 *     `--highcontrast-*` / `--system-*`).
 *  6. Every token is replaced by its stylesheet's text: all instances of a stylesheet get the same text. A `<style>`
 *     whose text changed gets `data-swc-styles="trimmed"` / `"minified"` (`STYLE_MARKER_ATTRIBUTE`, collector.ts).
 *     With `dedupe: 'link'` (0.3.0, dedupe.ts) a token becomes a `<link data-swc-styles>` to its text in the
 *     `styleSheetStore` instead (unless the text stays inline, `linkable()`); `full` mode with `dedupe: 'link'` skips
 *     steps 1-5 (every text is the complete one).
 *
 * Parsed stylesheets (structure, declaration blocks, compiled selectors) are cached process-wide per stylesheet
 * object (`WeakMap`); everything else lives only for one call.
 */
import type {Document, Element, AnyNode} from 'domhandler';
import {isElementNode, ServerTree} from '../server-tree.js';
import type {StylesReport} from '../types.js';
import {
  addDefinitions,
  addVarReferences,
  collapseVars,
  parseRules,
  splitBlock,
  type BlockItem,
  type CssNode,
  type StyleRuleNode,
} from './css-text.js';
import {
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_RE,
  PLACEHOLDER_STYLE_RE,
  STYLE_MARKER_ATTRIBUTE,
  type NormalizedStyleOptions,
  type SheetEntry,
  type StyleCollector,
  type StyleMarker,
} from './collector.js';
import {compileSelectorList, Instance, listMayMatch, type ComplexMatcher} from './selector-match.js';
import {hasRelativeUrl, INLINE_BELOW_BYTES, Linker} from './dedupe.js';

interface ParsedSheet {
  text: string;
  nodes: CssNode[];
  selectors: Map<StyleRuleNode, ComplexMatcher[] | undefined>;
  bodies: Map<StyleRuleNode, BlockItem[]>;
  /** Custom-property names of the complete text (`minify()`), computed once. */
  names?: SheetNames;
}

/** Every custom-property name a stylesheet text mentions, and the ones it defines. */
interface SheetNames {
  mentions: Set<string>;
  definitions: Set<string>;
}

const parsedByStyle = new WeakMap<object, ParsedSheet>();
/** Stylesheets that are not objects (no identity to key a WeakMap): a small bounded cache by text. */
const parsedByText = new Map<string, ParsedSheet>();
const MAX_TEXT_CACHE = 32;

function parseSheet(text: string): ParsedSheet {
  return {text, nodes: parseRules(text), selectors: new Map(), bodies: new Map()};
}

function parsedSheetOf(entry: SheetEntry): ParsedSheet {
  const style = entry.style;
  if (style !== null && (typeof style === 'object' || typeof style === 'function')) {
    let parsed = parsedByStyle.get(style);
    if (!parsed || parsed.text !== entry.cssText) {
      parsed = parseSheet(entry.cssText);
      parsedByStyle.set(style, parsed);
    }
    return parsed;
  }
  let parsed = parsedByText.get(entry.cssText);
  if (!parsed) {
    parsed = parseSheet(entry.cssText);
    if (parsedByText.size >= MAX_TEXT_CACHE) {
      parsedByText.delete(parsedByText.keys().next().value!);
    }
    parsedByText.set(entry.cssText, parsed);
  }
  return parsed;
}

function selectorsOf(parsed: ParsedSheet, rule: StyleRuleNode): ComplexMatcher[] | undefined {
  if (parsed.selectors.has(rule)) {
    return parsed.selectors.get(rule);
  }
  const list = compileSelectorList(rule.prelude);
  parsed.selectors.set(rule, list);
  return list;
}

function bodyOf(parsed: ParsedSheet, rule: StyleRuleNode): BlockItem[] {
  let items = parsed.bodies.get(rule);
  if (!items) {
    items = splitBlock(parsed.text, rule.bodyStart, rule.bodyEnd);
    parsed.bodies.set(rule, items);
  }
  return items;
}

interface SheetState {
  entry: SheetEntry;
  parsed: ParsedSheet;
  instances: Instance[];
  instanceSet: Set<Instance>;
  /** Placeholder occurrences in the output (shadow roots carrying the stylesheet). */
  occurrences: number;
  /** An occurrence whose host is unknown: the stylesheet stays complete. */
  untrimmable: boolean;
  kept: Set<StyleRuleNode>;
  /** Collapsed declaration values per kept rule (index-aligned with its items; undefined = unchanged). */
  values: Map<StyleRuleNode, Array<string | undefined>>;
  text: string;
  /** `minifyCustomProperties` renamed custom properties in `text`. */
  renamed: boolean;
}

export interface ResolvedStyles {
  html: string;
  report: StylesReport;
  /** Problems that did not stop the resolution (a `dedupeUrl` that threw), for the render's report. */
  warnings: string[];
}

function keepMatches(prelude: string, keep: Array<string | RegExp>): boolean {
  for (const entry of keep) {
    if (typeof entry === 'string') {
      if (entry && prelude.includes(entry)) {
        return true;
      }
    } else if (entry instanceof RegExp) {
      entry.lastIndex = 0;
      if (entry.test(prelude)) {
        return true;
      }
    }
  }
  return false;
}

function rootOf(node: AnyNode): AnyNode {
  let current = node;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function selectRules(state: SheetState, keep: Array<string | RegExp>): void {
  const {parsed, kept} = state;
  // Instances the matcher cannot tell apart give the same answers (`:host-context()` also sees the ancestors,
  // `:has()` in `:host()` / `::slotted()` the light DOM's descendants; see `Instance.fingerprint`).
  let instances = state.instances;
  if (instances.length > 1 && !parsed.text.includes(':host-context') && !parsed.text.includes(':has(')) {
    const seen = new Set<string>();
    instances = instances.filter((instance) => {
      const fingerprint = instance.fingerprint;
      if (fingerprint === undefined) {
        return true;
      }
      if (seen.has(fingerprint)) {
        return false;
      }
      seen.add(fingerprint);
      return true;
    });
  }
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        visit(node.children);
        continue;
      }
      if (node.kind !== 'style') {
        continue;
      }
      if (keep.length > 0 && keepMatches(node.prelude, keep)) {
        kept.add(node);
        continue;
      }
      const list = selectorsOf(parsed, node);
      for (const instance of instances) {
        if (listMayMatch(list, instance)) {
          kept.add(node);
          break;
        }
      }
    }
  };
  visit(parsed.nodes);
}

function isReferenceOption(name: string, options: NormalizedStyleOptions): boolean {
  return options.referenceNames.has(name) || options.referencePrefixes.some((prefix) => name.startsWith(prefix));
}

const NAME_TOKEN_RE = /(?<![\w\u0080-￿\\-])--[\w\u0080-￿-]+/g;

function addNames(text: string, into: Set<string>): void {
  if (!text.includes('--')) {
    return;
  }
  NAME_TOKEN_RE.lastIndex = 0;
  for (let match = NAME_TOKEN_RE.exec(text); match !== null; match = NAME_TOKEN_RE.exec(text)) {
    into.add(match[0]);
  }
}

/** Names of a stylesheet's complete text (cached with its parse, so once per stylesheet object and process). */
function completeNamesOf(parsed: ParsedSheet): SheetNames {
  if (!parsed.names) {
    const mentions = new Set<string>();
    const definitions = new Set<string>();
    addNames(parsed.text, mentions);
    addDefinitions(parsed.text, definitions);
    parsed.names = {mentions, definitions};
  }
  return parsed.names;
}

function shortName(index: number): string {
  let name = '';
  let n = index;
  for (;;) {
    const r = n % 52;
    name = String.fromCharCode(r < 26 ? 97 + r : 65 + r - 26) + name;
    n = Math.floor(n / 52) - 1;
    if (n < 0) {
      return `--${name}`;
    }
  }
}

const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8');

/** Replaces the stylesheet placeholders of `html` with the trimmed stylesheets (see the file comment). */
export function resolveStyles(html: string, collector: StyleCollector): ResolvedStyles {
  const started = performance.now();
  const options = collector.options;
  const states = new Map<number, SheetState>();
  const styleAttributes: string[] = [];
  /** CSS of the output the trimmer does not control (other `<style>` elements, complete stylesheets). */
  const otherCss: string[] = [];

  if (html.includes(PLACEHOLDER_PREFIX) && options.mode !== 'trimmed') {
    // `full` mode with `dedupe: 'link'`: nothing is trimmed (no parse); only the occurrences are counted.
    for (const match of html.matchAll(PLACEHOLDER_RE)) {
      const entry = collector.entries[Number(match[1])];
      if (!entry) {
        continue;
      }
      let state = states.get(entry.id);
      if (!state) {
        state = {
          entry,
          parsed: UNPARSED,
          instances: [],
          instanceSet: new Set(),
          occurrences: 0,
          untrimmable: true,
          kept: new Set(),
          values: new Map(),
          text: entry.cssText,
          renamed: false,
        };
        states.set(entry.id, state);
      }
      state.occurrences++;
    }
  } else if (html.includes(PLACEHOLDER_PREFIX)) {
    const tree = new ServerTree(html);
    const instances = new Map<Element, Instance>();
    const stateOf = (entry: SheetEntry): SheetState => {
      let state = states.get(entry.id);
      if (!state) {
        state = {
          entry,
          parsed: parsedSheetOf(entry),
          instances: [],
          instanceSet: new Set(),
          occurrences: 0,
          untrimmable: false,
          kept: new Set(),
          values: new Map(),
          text: entry.cssText,
          renamed: false,
        };
        states.set(entry.id, state);
      }
      return state;
    };
    const onStyle = (element: Element) => {
      const text = tree.styleText(element);
      if (!text.includes(PLACEHOLDER_PREFIX)) {
        if (text.trim()) {
          otherCss.push(text);
        }
        return;
      }
      const rest = text.replace(PLACEHOLDER_RE, '');
      if (rest.trim()) {
        otherCss.push(rest);
      }
      const root = rootOf(element);
      const host = tree.isShadowRoot(root) ? tree.hostOf(root as Document) : undefined;
      let instance: Instance | undefined;
      if (host) {
        instance = instances.get(host);
        if (!instance) {
          instance = new Instance(host, root as Document, tree);
          instances.set(host, instance);
        }
      }
      PLACEHOLDER_RE.lastIndex = 0;
      for (let match = PLACEHOLDER_RE.exec(text); match !== null; match = PLACEHOLDER_RE.exec(text)) {
        const entry = collector.entries[Number(match[1])];
        if (!entry) {
          continue;
        }
        const state = stateOf(entry);
        state.occurrences++;
        if (!instance) {
          state.untrimmable = true;
        } else if (!state.instanceSet.has(instance)) {
          state.instanceSet.add(instance);
          state.instances.push(instance);
        }
      }
    };
    const visit = (node: {children?: AnyNode[]}) => {
      for (const child of node.children ?? []) {
        if (child.type === 'root') {
          // Content of a plain <template>.
          visit(child as Document);
          continue;
        }
        if (!isElementNode(child)) {
          continue;
        }
        const style = child.attribs.style;
        if (style) {
          styleAttributes.push(style);
        }
        if (child.name === 'style') {
          onStyle(child);
          continue;
        }
        const shadow = tree.shadowOf(child);
        if (shadow) {
          visit(shadow);
        }
        visit(child);
      }
    };
    visit(tree.root);

    const trimmed: SheetState[] = [];
    for (const state of states.values()) {
      if (state.untrimmable || state.instances.length === 0) {
        otherCss.push(state.entry.cssText);
      } else {
        trimmed.push(state);
        selectRules(state, options.keep);
      }
    }
    if (trimmed.length > 0) {
      transform(trimmed, [...states.values()], styleAttributes, otherCss, options);
    }
  }

  const linker = options.dedupe === 'link' ? new Linker(options.dedupeUrl) : undefined;
  const output = html.includes(PLACEHOLDER_PREFIX) ? substitute(html, states, collector, linker) : html;
  const sheets: StylesReport['sheets'] = [];
  let fullBytes = 0;
  let trimmedBytes = 0;
  for (const state of [...states.values()].sort((a, b) => a.entry.id - b.entry.id)) {
    const full = utf8Length(state.entry.cssText);
    const kept = state.text === state.entry.cssText ? full : utf8Length(state.text);
    const sheet: StylesReport['sheets'][number] = {
      id: state.entry.label,
      tag: state.entry.tag,
      instances: state.occurrences,
      fullBytes: full,
      trimmedBytes: kept,
    };
    const linked = linker?.sheetOf(state.text);
    if (linked !== undefined) {
      sheet.hash = linked.hash;
    }
    sheets.push(sheet);
    fullBytes += full * state.occurrences;
    trimmedBytes += kept * state.occurrences;
  }
  const report: StylesReport = {
    mode: options.mode,
    sheets,
    fullBytes,
    trimmedBytes,
    durationMs: 0,
  };
  if (linker) {
    report.dedupe = linker.report();
  }
  report.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return {html: output, report, warnings: linker ? [...linker.warnings] : []};
}

/** `SheetState.parsed` of `full` mode with `dedupe: 'link'`: never read (nothing is trimmed). */
const UNPARSED: ParsedSheet = {text: '', nodes: [], selectors: new Map(), bodies: new Map()};

/**
 * `dedupe: 'link'`: whether a stylesheet's text is linked rather than inlined (see the file comment of dedupe.ts):
 * not a minified theme fragment (the client's theme bridge moves the `<style>` back after `<sp-theme>` upgraded), at
 * least `INLINE_BELOW_BYTES` long, and without relative `url()` / `@import` references.
 */
function linkable(state: SheetState): boolean {
  if (state.entry.theme && state.renamed) {
    return false;
  }
  return utf8Length(state.text) >= INLINE_BELOW_BYTES && !hasRelativeUrl(state.text);
}

/**
 * Step 6: replaces every placeholder token with its stylesheet's text and marks the `<style>` elements whose text
 * changed (`'minified'` wins over `'trimmed'` when a `<style>` holds several stylesheets). With `dedupe: 'link'`
 * (`linker`) a linkable stylesheet becomes a `<link data-swc-styles="minified|trimmed|complete">` instead, in its
 * place: `<style>A B C</style>` with B linked becomes `<style>A</style><link B><style>C</style>` (the cascade order of
 * the shadow root is the document order of its `<style>` / `<link>` elements).
 */
function substitute(
  html: string,
  states: Map<number, SheetState>,
  collector: StyleCollector,
  linker: Linker | undefined,
): string {
  const textOf = (id: number): string => {
    const state = states.get(id);
    return state ? state.text : (collector.entries[id]?.cssText ?? '');
  };
  const markerOf = (id: number): StyleMarker | undefined => {
    const state = states.get(id);
    if (!state) {
      return undefined;
    }
    if (state.renamed) {
      return 'minified';
    }
    return state.text === state.entry.cssText ? undefined : 'trimmed';
  };
  const linkDecisions = new Map<number, boolean>();
  const linked = (id: number): boolean => {
    if (!linker) {
      return false;
    }
    let decision = linkDecisions.get(id);
    if (decision === undefined) {
      const state = states.get(id);
      decision = state !== undefined && linkable(state);
      linkDecisions.set(id, decision);
    }
    return decision;
  };
  const styleElement = (text: string, marker: StyleMarker | undefined): string =>
    marker ? `<style ${STYLE_MARKER_ATTRIBUTE}="${marker}">${text}</style>` : `<style>${text}</style>`;
  let output = html.replace(PLACEHOLDER_STYLE_RE, (_match, tokens: string) => {
    let out = '';
    let text = '';
    let marker: StyleMarker | undefined;
    let open = false;
    for (const token of tokens.matchAll(PLACEHOLDER_RE)) {
      const id = Number(token[1]);
      // (`link()` is undefined when the application's `dedupeUrl` threw for the text: it stays inline.)
      const link = linked(id) ? linker!.link(textOf(id), markerOf(id) ?? 'complete') : undefined;
      if (link !== undefined) {
        if (open) {
          out += styleElement(text, marker);
          open = false;
          text = '';
          marker = undefined;
        }
        out += link;
        continue;
      }
      open = true;
      const sheetText = textOf(id);
      text += sheetText;
      if (linker) {
        linker.inlineBytes += utf8Length(sheetText);
      }
      const sheetMarker = markerOf(id);
      if (sheetMarker === 'minified' || (sheetMarker && !marker)) {
        marker = sheetMarker;
      }
    }
    return open ? out + styleElement(text, marker) : out;
  });
  if (output.includes(PLACEHOLDER_PREFIX)) {
    // Tokens outside a `<style>` of their own (not emitted by the renderers; defensive): text only.
    output = output.replace(PLACEHOLDER_RE, (_match, id: string) => textOf(Number(id)));
  }
  return output;
}

/** Steps 3-5 of the file comment over the stylesheets whose rules were selected; sets `state.text`. */
function transform(
  trimmed: SheetState[],
  page: SheetState[],
  styleAttributes: string[],
  otherCss: string[],
  options: NormalizedStyleOptions
): void {
  // Custom properties the page defines (kept rules, style attributes, other CSS): never collapsed.
  const prefixes = options.undefinedPrefixes;
  if (prefixes.length > 0) {
    const defined = new Set<string>();
    for (const css of otherCss) {
      addDefinitions(css, defined);
    }
    for (const style of styleAttributes) {
      addDefinitions(style, defined);
    }
    for (const state of trimmed) {
      const {text} = state.parsed;
      for (const rule of state.kept) {
        for (const item of bodyOf(state.parsed, rule)) {
          if (item.kind === 'decl') {
            if (item.name.startsWith('--')) {
              defined.add(item.name);
            }
          } else {
            addDefinitions(text.slice(item.start, item.end), defined);
          }
        }
      }
    }
    const collapse = (name: string) => !defined.has(name) && prefixes.some((prefix) => name.startsWith(prefix));
    for (const state of trimmed) {
      const {text} = state.parsed;
      for (const rule of state.kept) {
        const items = bodyOf(state.parsed, rule);
        let values: Array<string | undefined> | undefined;
        items.forEach((item, index) => {
          if (item.kind !== 'decl') {
            return;
          }
          const value = text.slice(item.valueStart, item.end);
          const collapsed = collapseVars(value, collapse);
          if (collapsed !== value) {
            (values ??= new Array(items.length))[index] = collapsed;
          }
        });
        if (values) {
          state.values.set(rule, values);
        }
      }
    }
  }

  // Theme custom properties in use (transitively).
  const pruneTheme = options.trimTheme && trimmed.some((state) => state.entry.theme);
  let used: Set<string> | undefined;
  if (pruneTheme) {
    const seeds = new Set<string>();
    const themeDefinitions = new Map<string, string[]>();
    for (const css of otherCss) {
      addVarReferences(css, seeds);
    }
    for (const style of styleAttributes) {
      addVarReferences(style, seeds);
    }
    for (const state of trimmed) {
      const {text} = state.parsed;
      for (const rule of state.kept) {
        const values = state.values.get(rule);
        bodyOf(state.parsed, rule).forEach((item, index) => {
          if (item.kind !== 'decl') {
            addVarReferences(text.slice(item.start, item.end), seeds);
            return;
          }
          const value = values?.[index] ?? text.slice(item.valueStart, item.end);
          if (state.entry.theme && item.name.startsWith('--')) {
            const list = themeDefinitions.get(item.name);
            if (list) {
              list.push(value);
            } else {
              themeDefinitions.set(item.name, [value]);
            }
          } else {
            addVarReferences(value, seeds);
          }
        });
      }
    }
    // `@keyframes` bodies and other at-rules (`@font-face`, `@property`, ...) may use theme properties too; whether a
    // `@keyframes` is kept is only decided later, so all of them count.
    for (const state of trimmed) {
      const {text} = state.parsed;
      const visit = (nodes: CssNode[]) => {
        for (const node of nodes) {
          if (node.kind === 'group') {
            visit(node.children);
          } else if (node.kind !== 'style') {
            addVarReferences(text.slice(node.start, node.end), seeds);
          }
        }
      };
      visit(state.parsed.nodes);
    }
    for (const name of options.referenceNames) {
      seeds.add(name);
    }
    if (options.referencePrefixes.length > 0) {
      for (const name of themeDefinitions.keys()) {
        if (isReferenceOption(name, options)) {
          seeds.add(name);
        }
      }
    }
    used = new Set<string>();
    const queue = [...seeds];
    for (const name of queue) {
      if (used.has(name)) {
        continue;
      }
      used.add(name);
      const definitions = themeDefinitions.get(name);
      if (!definitions) {
        continue;
      }
      const next = new Set<string>();
      for (const value of definitions) {
        addVarReferences(value, next);
      }
      for (const dependency of next) {
        if (!used.has(dependency)) {
          queue.push(dependency);
        }
      }
    }
  }

  // Rule texts.
  const ruleTexts = new Map<SheetState, Map<StyleRuleNode, string>>();
  const corpus: string[] = [...styleAttributes, ...otherCss];
  for (const state of trimmed) {
    const texts = new Map<StyleRuleNode, string>();
    const prune = used !== undefined && state.entry.theme ? used : undefined;
    for (const rule of state.kept) {
      const text = ruleText(state, rule, prune);
      texts.set(rule, text);
      corpus.push(text);
    }
    ruleTexts.set(state, texts);
  }

  // Assemble (with the @keyframes decisions).
  let joined: string | undefined;
  const keyframesUsed = new Map<string, boolean>();
  const isKeyframesUsed = (name: string): boolean => {
    let result = keyframesUsed.get(name);
    if (result === undefined) {
      joined ??= corpus.join('\n');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = new RegExp(`(?:^|[^\\w-])${escaped}(?![\\w-])`).test(joined);
      keyframesUsed.set(name, result);
    }
    return result;
  };
  for (const state of trimmed) {
    const texts = ruleTexts.get(state)!;
    const {text} = state.parsed;
    // `complete`: every node of the list came out unchanged. A complete list is emitted as its original slice
    // (whitespace and comments between rules included), so a stylesheet nothing was taken from stays byte-identical
    // (and its `<style>` unmarked).
    const assemble = (nodes: CssNode[]): {out: string; complete: boolean} => {
      let out = '';
      let complete = true;
      for (const node of nodes) {
        switch (node.kind) {
          case 'style': {
            const kept = texts.get(node);
            if (kept === undefined) {
              complete = false;
            } else {
              complete &&= kept === text.slice(node.start, node.end);
              out += kept;
            }
            break;
          }
          case 'group': {
            const inner = assemble(node.children);
            if (inner.complete) {
              out += text.slice(node.start, node.end);
              break;
            }
            complete = false;
            if (inner.out || (node.name === 'layer' && text.slice(node.start + 6, node.bodyStart - 1).trim() !== '')) {
              out += text.slice(node.start, node.bodyStart) + inner.out + '}';
            }
            break;
          }
          case 'keyframes':
            if (isKeyframesUsed(node.name)) {
              out += text.slice(node.start, node.end);
            } else {
              complete = false;
            }
            break;
          default:
            out += text.slice(node.start, node.end);
        }
      }
      return {out, complete};
    };
    const assembled = assemble(state.parsed.nodes);
    state.text = assembled.complete ? text : assembled.out;
  }

  if (options.minifyCustomProperties) {
    minify(trimmed, page, styleAttributes, otherCss, options);
  }
}

/** Text of a kept rule: verbatim, unless declarations were collapsed or (theme) pruned; '' when nothing is left. */
function ruleText(state: SheetState, rule: StyleRuleNode, used: Set<string> | undefined): string {
  const {text} = state.parsed;
  const values = state.values.get(rule);
  if (!values && !used) {
    return text.slice(rule.start, rule.end);
  }
  const items = bodyOf(state.parsed, rule);
  const parts: string[] = [];
  let changed = false;
  items.forEach((item, index) => {
    if (item.kind !== 'decl') {
      parts.push(text.slice(item.start, item.end));
      return;
    }
    if (used && item.name.startsWith('--') && !used.has(item.name)) {
      changed = true;
      return;
    }
    const value = values?.[index];
    if (value !== undefined) {
      parts.push(text.slice(item.start, item.valueStart) + value);
      changed = true;
    } else {
      parts.push(text.slice(item.start, item.end));
    }
  });
  if (!changed) {
    return text.slice(rule.start, rule.end);
  }
  if (parts.length === 0) {
    return '';
  }
  return `${text.slice(rule.start, rule.bodyStart)}${parts.join(';')}}`;
}

/**
 * Spectrum's public customisation API: `--mod-*` (per-component overrides an application sets on an element or a
 * container), `--highcontrast-*` (forced-colors overrides) and `--system-*` (the system layer between the theme and
 * the components). Application CSS sets and reads them, so `minifyCustomProperties` never renames them, whatever
 * the options say (a kept component rule may define one, e.g. a parent's `--mod-*` for its children: renaming that
 * name in the component's reads would cut the application's override off until hydration, or for good without JS).
 */
export const PUBLIC_CUSTOM_PROPERTY_PREFIXES: readonly string[] = ['--mod-', '--highcontrast-', '--system-'];

const isPublicName = (name: string): boolean => PUBLIC_CUSTOM_PROPERTY_PREFIXES.some((prefix) => name.startsWith(prefix));

/** Owners of a stylesheet for `minify()`: the theme (every fragment, bridged as one), or its element class and its stylesheet object. */
const THEME_GROUP = '#theme'; // never an element tag
const classGroupOf = (entry: SheetEntry): string => (entry.theme ? THEME_GROUP : entry.tag);

/** Identity of a stylesheet across element classes (one `CSSResult` in the `elementStyles` of several classes). */
function sheetGroupOf(entry: SheetEntry, ids: Map<unknown, string>): string {
  if (entry.theme) {
    return THEME_GROUP;
  }
  const style = entry.style;
  const key = style !== null && (typeof style === 'object' || typeof style === 'function') ? style : `text:${entry.cssText}`;
  let id = ids.get(key);
  if (id === undefined) {
    id = `#sheet${ids.size}`;
    ids.set(key, id);
  }
  return id;
}

/**
 * `minifyCustomProperties`: renames custom properties of the trimmed stylesheets to short names, most used first,
 * consistently across all of them.
 *
 * A name is renamed only when the client can switch every use of it at once (`swc-ssr/client` restores an element's
 * complete stylesheets - original names - in its hydrating update, element by element, and bridges the theme's
 * server `<style>` until no minified element is left):
 *  - every definition is in the theme (any reference): the bridged theme keeps the short name defined for elements
 *    that still run on their minified CSS, the upgraded theme defines the original one for restored elements; or
 *  - every definition and every reference is in the stylesheets of ONE element class (its sheets are restored
 *    together), or inside ONE stylesheet object that several classes share (each instance defines and reads the name
 *    in its own shadow root, and switches both at once).
 * A name one element class defines and another reads (`sp-tabs` -> `sp-tab`, `sp-table` -> its rows and cells,
 * `sp-menu-group` -> `sp-menu-item`, `sp-picker` -> `sp-popover`, ...) is never renamed: a child defined or
 * hydrated after its parent was restored would read a short name nothing defines any more. (The client also keeps a
 * restored element's minified `<style>` until no element runs on minified CSS: the two together cover inheritance
 * between nested instances.)
 *
 * Owners are judged from the trimmed texts AND from the complete stylesheets of every element class on the page
 * (0.2.2): the client restores complete sheets, so a name only the parent's trimmed text mentions may still be read
 * by a rule the trimmer dropped from the child's sheet (`sp-menu` -> `sp-menu-item`'s disabled icon colour,
 * `sp-breadcrumbs` -> `sp-breadcrumb-item`, `sp-table` -> its head cells and rows, `sp-search` -> the textfield
 * family): with the parent defined late, the restored child would read the original name while the parent's
 * minified CSS defines only the short one. A name an element class's complete sheet defines is not "defined by the
 * theme only" either (the restored class would override it for its children under the original name, while minified
 * children read the short name from the theme). The classes are those with a shadow root in the output, also when
 * their sheets stayed complete; not the server registry (output must not depend on what other renders defined).
 *
 * Never renamed either: `PUBLIC_CUSTOM_PROPERTY_PREFIXES`, names in `references`, names that occur in `style`
 * attributes or in CSS the trimmer does not control (other `<style>` elements, complete stylesheets), and names only
 * referenced (`var(--x)` without a definition on the page: the application may define them). Short names skip every
 * name that occurs anywhere on the page and every `references` name or prefix (custom properties of the
 * application's own stylesheets, which the server cannot see otherwise).
 */
function minify(
  trimmed: SheetState[],
  page: SheetState[],
  styleAttributes: string[],
  otherCss: string[],
  options: NormalizedStyleOptions,
): void {
  const excluded = new Set<string>();
  for (const text of styleAttributes) {
    addNames(text, excluded);
  }
  for (const text of otherCss) {
    addNames(text, excluded);
  }
  const taken = new Set<string>([...excluded, ...options.referenceNames]);
  const counts = new Map<string, number>();
  /** Owners whose stylesheets define a name, and owners whose stylesheets mention it at all (definitions, references). */
  const definedBy = new Map<string, Set<string>>();
  const classesUsing = new Map<string, Set<string>>();
  const sheetsUsing = new Map<string, Set<string>>();
  const sheetIds = new Map<unknown, string>();
  const note = (map: Map<string, Set<string>>, name: string, group: string) => {
    const groups = map.get(name);
    if (groups) {
      groups.add(group);
    } else {
      map.set(name, new Set([group]));
    }
  };
  for (const state of trimmed) {
    const classGroup = classGroupOf(state.entry);
    const sheetGroup = sheetGroupOf(state.entry, sheetIds);
    const definitions = new Set<string>();
    addDefinitions(state.text, definitions);
    for (const name of definitions) {
      note(definedBy, name, classGroup);
    }
    NAME_TOKEN_RE.lastIndex = 0;
    for (let match = NAME_TOKEN_RE.exec(state.text); match !== null; match = NAME_TOKEN_RE.exec(state.text)) {
      taken.add(match[0]);
      counts.set(match[0], (counts.get(match[0]) ?? 0) + state.occurrences);
      note(classesUsing, match[0], classGroup);
      note(sheetsUsing, match[0], sheetGroup);
    }
  }
  // What the client restores: the complete stylesheets of every element class on the page (see above). Their names
  // also stay off the short names (a restored sheet must not define a short name minified elements read). Their
  // definitions only veto theme ownership: a name the trimmed texts only read stays "only read" (never renamed).
  const classDefined = new Set<string>();
  for (const state of page) {
    if (state.entry.theme) {
      continue;
    }
    const classGroup = classGroupOf(state.entry);
    const sheetGroup = sheetGroupOf(state.entry, sheetIds);
    const {mentions, definitions} = completeNamesOf(state.parsed);
    for (const name of mentions) {
      taken.add(name);
      note(classesUsing, name, classGroup);
      note(sheetsUsing, name, sheetGroup);
    }
    for (const name of definitions) {
      classDefined.add(name);
    }
  }
  const owned = (name: string): boolean => {
    const definers = definedBy.get(name)!;
    if (definers.has(THEME_GROUP)) {
      return definers.size === 1 && !classDefined.has(name);
    }
    return classesUsing.get(name)?.size === 1 || sheetsUsing.get(name)?.size === 1;
  };
  const candidates = [...definedBy.keys()]
    .filter(
      (name) =>
        counts.has(name) && !excluded.has(name) && !isPublicName(name) && !isReferenceOption(name, options) && owned(name),
    )
    .sort((a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  if (candidates.length === 0) {
    return;
  }
  const renames = new Map<string, string>();
  let index = 0;
  for (const name of candidates) {
    let short = shortName(index++);
    // Never a name of the page or of `references` (names and prefixes: the application's own CSS may use them).
    while (taken.has(short) || isReferenceOption(short, options)) {
      short = shortName(index++);
    }
    if (short.length >= name.length) {
      continue;
    }
    renames.set(name, short);
  }
  for (const state of trimmed) {
    let renamed = false;
    state.text = state.text.replace(NAME_TOKEN_RE, (name) => {
      const short = renames.get(name);
      if (short === undefined) {
        return name;
      }
      renamed = true;
      return short;
    });
    state.renamed ||= renamed;
  }
}
