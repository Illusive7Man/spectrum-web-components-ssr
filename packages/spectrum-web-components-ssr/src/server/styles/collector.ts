/**
 * Per-render registry of the stylesheets emitted into declarative shadow roots in `StyleOptions.mode: 'trimmed'`.
 *
 * Instead of a stylesheet's `cssText`, the renderers emit a short placeholder token (`\u0001swc-css:<n>\u0001`)
 * inside the `<style>` of every shadow root (`SpectrumElementRenderer.renderShadow`, `ThemeRenderer.renderShadow`).
 * The token identifies the stylesheet - the element's tag plus the stylesheet object (an entry of the class's
 * `elementStyles`, or a theme fragment of `<sp-theme>`) - so all instances of one element class share one trimmed
 * text. After the final pass `resolveStyles()` (trim.ts) replaces every token with the trimmed text.
 *
 * The registry belongs to the render's session (across its passes: the previous pass's markup, which may be reused
 * as fallback shadow content, carries the same tokens) and is dropped with it.
 */
import type {RenderSpectrumOptions, StyleOptions} from '../types.js';

/** Placeholder delimiters: control characters never appear in stylesheets or in the markup Lit renders. */
export const PLACEHOLDER_MARK = '\u0001';
export const PLACEHOLDER_PREFIX = `${PLACEHOLDER_MARK}swc-css:`;
export const PLACEHOLDER_RE = /\u0001swc-css:(\d+)\u0001/g;
/** A `<style>` element as the renderers emit it in trimmed mode: nothing but placeholder tokens. */
export const PLACEHOLDER_STYLE_RE = /<style>((?:\u0001swc-css:\d+\u0001)+)<\/style>/g;

/**
 * Attribute of every `<style>` whose text the trimmer changed: `data-swc-styles="trimmed"` (rules or theme custom
 * properties left out, `undefinedPrefixes` collapsed) or `data-swc-styles="minified"` (custom properties renamed by
 * `minifyCustomProperties`, possibly trimmed as well). `full` mode, and stylesheets that came out complete, carry no
 * attribute.
 *
 * Why the client needs it: Lit's hydration support keeps a hydrated element's server `<style>` as its only CSS (it
 * does not adopt `elementStyles` for a declarative shadow root), so a trimmed text would lack the rules of states
 * entered after hydration; and `<sp-theme>` replaces its declarative shadow root on upgrade with its complete theme
 * fragments (original names), so elements whose CSS uses minified names lose the theme's values until they get their
 * complete stylesheets back. `spectrum-web-components-ssr/client` restores marked elements' complete `elementStyles` and bridges minified
 * theme names until every marked element is restored.
 */
export const STYLE_MARKER_ATTRIBUTE = 'data-swc-styles';
/**
 * `'complete'` (0.3.0) only occurs on a `<link>` of `StyleOptions.dedupe: 'link'`: a stylesheet nothing was taken from,
 * linked instead of inlined. Every server `<link>` carries a marker, so that the client restores the element's complete
 * sheets and removes the `<link>` like a marked `<style>`.
 */
export type StyleMarker = 'trimmed' | 'minified' | 'complete';

export interface SheetEntry {
  /** Number in the placeholder token. */
  id: number;
  /** Readable id for the report: `<tag>:<index in elementStyles>` or `<tag>:<kind>/<name>` for theme fragments. */
  label: string;
  tag: string;
  /** The stylesheet object (a Lit `CSSResult`): the key of the process-wide parse cache. */
  style: unknown;
  cssText: string;
  /** A theme fragment of `<sp-theme>`: its custom properties are pruned by reference (`trimTheme`). */
  theme: boolean;
}

export interface NormalizedStyleOptions {
  mode: 'full' | 'trimmed';
  /** `StyleOptions.dedupe` (0.3.0): `'link'` links every distinct stylesheet text (styles/dedupe.ts). */
  dedupe: 'none' | 'link';
  /** `StyleOptions.dedupeUrl`; undefined: `/swc-css/<hash>.css`. */
  dedupeUrl: ((hash: string, css: string) => string) | undefined;
  trimTheme: boolean;
  referenceNames: Set<string>;
  referencePrefixes: string[];
  undefinedPrefixes: string[];
  minifyCustomProperties: boolean;
  keep: Array<string | RegExp>;
}

/**
 * The entries of a list option. A single value (a bare string, or a RegExp for `keep`) is ONE entry: `Iterable<string>`
 * also accepts a string, and iterating it gives its characters: `references: '--spectrum-*'` became 12 one-character
 * entries, among them `'*'`, an empty prefix that matches every name and so disabled the theme pruning. Anything
 * else that is not iterable is ignored.
 */
function listOption(value: unknown, isSingle: (value: unknown) => boolean): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (isSingle(value)) {
    return [value];
  }
  if (typeof (value as {[Symbol.iterator]?: unknown})[Symbol.iterator] === 'function') {
    return Array.from(value as Iterable<unknown>);
  }
  return [];
}

const isString = (value: unknown): boolean => typeof value === 'string' || value instanceof String;

export function normalizeStyleOptions(options: StyleOptions | undefined): NormalizedStyleOptions {
  const mode = options?.mode === 'trimmed' ? 'trimmed' : 'full';
  const referenceNames = new Set<string>();
  const referencePrefixes: string[] = [];
  for (const entry of listOption(options?.references, isString)) {
    const name = String(entry).trim();
    if (!name) {
      continue;
    }
    if (name.endsWith('*')) {
      referencePrefixes.push(name.slice(0, -1));
    } else {
      referenceNames.add(name);
    }
  }
  const dedupeUrl = options?.dedupeUrl;
  return {
    mode,
    dedupe: options?.dedupe === 'link' ? 'link' : 'none',
    dedupeUrl: typeof dedupeUrl === 'function' ? dedupeUrl : undefined,
    trimTheme: options?.trimTheme ?? true,
    referenceNames,
    referencePrefixes,
    undefinedPrefixes: listOption(options?.undefinedPrefixes, isString)
      .map((prefix) => String(prefix))
      .filter(Boolean),
    minifyCustomProperties: options?.minifyCustomProperties === true,
    keep: listOption(options?.keep, (value) => isString(value) || value instanceof RegExp).map((entry) =>
      entry instanceof RegExp ? entry : String(entry),
    ),
  };
}

export class StyleCollector {
  readonly options: NormalizedStyleOptions;
  readonly entries: SheetEntry[] = [];
  private readonly byTag = new Map<string, Map<unknown, SheetEntry>>();
  private readonly labels = new Set<string>();

  constructor(options: NormalizedStyleOptions) {
    this.options = options;
  }

  /** The placeholder token of a stylesheet of an element with this tag (registered at first use). */
  placeholder(tag: string, style: unknown, label: () => string, theme = false): string {
    let sheets = this.byTag.get(tag);
    if (!sheets) {
      sheets = new Map();
      this.byTag.set(tag, sheets);
    }
    let entry = sheets.get(style);
    if (!entry) {
      const cssText = (style as {cssText?: unknown} | null | undefined)?.cssText;
      const id = this.entries.length;
      let readable = label();
      if (this.labels.has(readable)) {
        readable = `${readable}#${id}`;
      }
      this.labels.add(readable);
      entry = {
        id,
        label: readable,
        tag,
        style,
        cssText: typeof cssText === 'string' ? cssText : '',
        theme,
      };
      sheets.set(style, entry);
      this.entries.push(entry);
    }
    return `${PLACEHOLDER_PREFIX}${entry.id}${PLACEHOLDER_MARK}`;
  }
}

const collectors = new WeakMap<object, StyleCollector | null>();

/**
 * The style collector of a render session; undefined in `full` mode without `dedupe: 'link'` (the renderers then emit
 * the `cssText` as before, byte for byte). `full` mode with `dedupe: 'link'` collects too: the placeholders become
 * `<link>`s to the complete stylesheets (`resolveStyles` in trim.ts, without trimming).
 */
export function styleCollectorOf(session: {options: RenderSpectrumOptions} | undefined): StyleCollector | undefined {
  if (!session) {
    return undefined;
  }
  let collector = collectors.get(session);
  if (collector === undefined) {
    const options = normalizeStyleOptions(session.options.styles);
    collector = options.mode === 'trimmed' || options.dedupe === 'link' ? new StyleCollector(options) : null;
    collectors.set(session, collector);
  }
  return collector ?? undefined;
}
