/**
 * `StyleOptions.dedupe: 'link'` (0.3.0): one copy of every distinct stylesheet text per page instead of one per shadow
 * root.
 *
 * Without it every declarative shadow root carries its own `<style>` copy of its class's (trimmed) stylesheets: the
 * button page is 21 copies of one 36 KB `sp-button` sheet, the catalog 1346 copies (5.7-8.4 MB) of about 0.5 MB of
 * distinct CSS. Declarative shadow DOM has no standard way to share a sheet between shadow roots without JavaScript,
 * except through the HTTP cache: with `'link'` every distinct text (after trimming / minification) is registered under
 * a content hash in `styleSheetStore` and every shadow root gets `<link rel="stylesheet" href="<url>"
 * data-swc-styles="...">` instead of the text. The browser fetches each URL once and shares the parsed sheet between
 * the roots. The application serves the store (`getStyleSheet(hash)`) with long-lived immutable caching and puts
 * `RenderSpectrumResult.head` (preload hints for every linked URL) into its `<head>`.
 *
 * What stays inline (`linkable()` in trim.ts): the theme's stylesheets when they were minified (the client's theme
 * bridge keeps them alive after `<sp-theme>` upgraded, by moving the `<style>` element back synchronously; a re-inserted
 * `<link>` would be processed again), sheets shorter than `INLINE_BELOW_BYTES` (a `<link>` would not be smaller), and
 * sheets with a relative `url()` / `@import` (a linked sheet resolves them against its own URL, an inline one against
 * the document). Fragment-only references (`url(#id)`) are local references to the document in every stylesheet (CSS
 * Values 4) and do not keep a sheet inline: the theme's `--spectrum-colorloupe-checkerboard-fill: url(#checkerboard-primary)`
 * renders the same linked (measured: an open `sp-color-loupe`, Chromium and Firefox, 0 px; .probe/dedupe/loupe.ts).
 *
 * The trade-off (measured with .probe/dedupe/first-frame.ts, docs/DESIGN.md "Style de-duplication"): Chromium's parser
 * waits at a shadow-root `<link rel="stylesheet">` whose sheet is not loaded (as at an in-body one), so nothing is
 * painted without its CSS; a cold load renders progressively and finishes later (DOMContentLoaded of the trimmed button
 * page over a 150 ms round trip: 177 ms inline, 517 ms linked cold, 181 ms warm). Firefox (157) does not wait: content
 * is painted without its sheet until the sheet arrives - on a cold load for the whole download, and for 2-9 frames even
 * from a warm cache - and CSS transitions then run from the unstyled values. Hence opt-in, off by default.
 */
import {createHash} from 'node:crypto';
import type {StylesReport} from '../types.js';
import {STYLE_MARKER_ATTRIBUTE, type StyleMarker} from './collector.js';

/** Default URL path prefix of linked stylesheets: `/swc-css/<hash>.css` (`StyleOptions.dedupeUrl` overrides it). */
export const DEFAULT_STYLE_SHEET_PATH = '/swc-css/';

/** Shape of the hashes `styleSheetStore` uses: 16 characters of base64url (96 bits of SHA-256). */
export const STYLE_SHEET_HASH_RE = /^[A-Za-z0-9_-]{16}$/;

/** Sheets below this many UTF-8 bytes stay inline: the `<link>` markup alone is about 90 bytes. */
export const INLINE_BELOW_BYTES = 160;

/** Default byte budget of `styleSheetStore` (UTF-8 bytes of the stored texts). */
export const DEFAULT_STORE_MAX_BYTES = 32 * 1024 * 1024;

const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8');

/** Content hash of a stylesheet text (the key of `styleSheetStore` and the default URL's file name). */
export function styleSheetHash(css: string): string {
  return createHash('sha256').update(css, 'utf8').digest('base64url').slice(0, 16);
}

/** Default `StyleSheetStore.minLifetimeMs`: a text a render linked is not evicted for this long. */
export const DEFAULT_STORE_MIN_LIFETIME_MS = 60_000;

/** Options of a `StyleSheetStore` (all optional). */
export interface StyleSheetStoreOptions {
  /** Byte budget (UTF-8 bytes of the texts), default 32 MiB. */
  maxBytes?: number;
  /** How long after its last `put` a text is protected from eviction (ms), default 60 s. */
  minLifetimeMs?: number;
  /** Clock in ms (tests), default `performance.now()`. */
  now?: () => number;
}

/**
 * Process-wide store of the stylesheet texts that `dedupe: 'link'` renders linked to: hash -> text, least recently
 * used first out when the byte budget (`maxBytes`, default 32 MiB) is exceeded. Every render puts the texts it links
 * (a put also counts as a use), the application's CSS route reads them (`getStyleSheet`). One per process: behind a
 * load balancer without sticky sessions a CSS request may reach a process that never rendered the page; serve such
 * URLs from shared storage instead (`StyleOptions.dedupeUrl` receives every text).
 *
 * Fresh texts are protected: a text is not evicted for `minLifetimeMs` (default 60 s) after a render last put it, so
 * the pages that were just served can still fetch their sheets (a 404 leaves those elements unstyled until they
 * hydrate). Review finding (0.3.0): with a pure LRU, renders of many distinct pages could push out the texts of a page
 * whose browser had not fetched them yet. While fresh texts hold it above the budget the store stays above it (later
 * puts trim it once they age); beyond twice the budget the least recently used texts go even when fresh. `evictions`
 * counts the evicted texts, `freshEvictions` those evicted within their protection (each one a possible 404).
 */
export class StyleSheetStore {
  private readonly entries = new Map<string, {css: string; bytes: number; stored: number}>();
  private total = 0;
  private budget = DEFAULT_STORE_MAX_BYTES;
  private lifetime = DEFAULT_STORE_MIN_LIFETIME_MS;
  private readonly now: () => number;
  /** Texts evicted so far (over the budget, or `maxBytes` lowered; not `delete` / `clear`). */
  evictions = 0;
  /** Of those, the texts evicted less than `minLifetimeMs` after their last put (only beyond twice the budget). */
  freshEvictions = 0;

  constructor(options: StyleSheetStoreOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    if (options.minLifetimeMs !== undefined) {
      this.minLifetimeMs = options.minLifetimeMs;
    }
    if (options.maxBytes !== undefined) {
      this.maxBytes = options.maxBytes;
    }
  }

  /** Byte budget; lowering it evicts at once. Values that are not positive finite numbers are ignored. */
  get maxBytes(): number {
    return this.budget;
  }

  set maxBytes(value: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      this.budget = value;
      this.evict(undefined);
    }
  }

  /** Protection of a text after its last put, in ms (0: a pure LRU). Values that are not finite and >= 0 are ignored. */
  get minLifetimeMs(): number {
    return this.lifetime;
  }

  set minLifetimeMs(value: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      this.lifetime = value;
    }
  }

  /** Number of stored texts. */
  get size(): number {
    return this.entries.size;
  }

  /** UTF-8 bytes of the stored texts. */
  get bytes(): number {
    return this.total;
  }

  has(hash: string): boolean {
    return this.entries.has(hash);
  }

  /** The text stored under `hash` (counts as a use), or undefined. */
  get(hash: string): string | undefined {
    const entry = this.entries.get(hash);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(hash);
    this.entries.set(hash, entry);
    return entry.css;
  }

  /** Stores `css` under its content hash and returns the hash (a use, and a new protection period). */
  put(css: string): string {
    const hash = styleSheetHash(css);
    const existing = this.entries.get(hash);
    if (existing !== undefined) {
      existing.stored = this.now();
      this.entries.delete(hash);
      this.entries.set(hash, existing);
      return hash;
    }
    const bytes = utf8Length(css);
    this.entries.set(hash, {css, bytes, stored: this.now()});
    this.total += bytes;
    this.evict(hash);
    return hash;
  }

  delete(hash: string): boolean {
    const entry = this.entries.get(hash);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(hash);
    this.total -= entry.bytes;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  /**
   * Least recently used first, never `keep` (the text just put: a single text larger than the budget stays alone):
   * texts past their protection down to the budget, then, above twice the budget, fresh ones too.
   */
  private evict(keep: string | undefined): void {
    if (this.total <= this.budget) {
      return;
    }
    const protectedAfter = this.now() - this.lifetime;
    for (const [hash, entry] of this.entries) {
      if (this.total <= this.budget) {
        return;
      }
      if (hash !== keep && (this.lifetime === 0 || entry.stored <= protectedAfter)) {
        this.remove(hash, entry, false);
      }
    }
    for (const [hash, entry] of this.entries) {
      if (this.total <= 2 * this.budget) {
        return;
      }
      if (hash !== keep) {
        this.remove(hash, entry, true);
      }
    }
  }

  private remove(hash: string, entry: {bytes: number}, fresh: boolean): void {
    this.entries.delete(hash);
    this.total -= entry.bytes;
    this.evictions++;
    if (fresh) {
      this.freshEvictions++;
    }
  }
}

/** The store `dedupe: 'link'` renders put their linked stylesheets into. */
export const styleSheetStore = new StyleSheetStore();

/**
 * The stylesheet text a `dedupe: 'link'` render linked as `hash` (the file name of the default URL without `.css`), or
 * undefined when it is unknown (never rendered by this process, or evicted). Serve it as `text/css` with
 * `Cache-Control: public, max-age=31536000, immutable`: the text of a hash never changes.
 */
export function getStyleSheet(hash: string): string | undefined {
  return typeof hash === 'string' && STYLE_SHEET_HASH_RE.test(hash) ? styleSheetStore.get(hash) : undefined;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A relative URL reference in a stylesheet text: `url()` / `@import`, or a quoted argument of `image-set()` /
 * `-webkit-image-set()` / `src()`, with something other than a `data:` URI, an absolute URL (`scheme:` or `//host`)
 * or a fragment-only reference (`url(#id)`, local to the document wherever the sheet comes from). Such a sheet stays
 * inline: linked it would resolve them against its own URL. Conservative: also hits these functions inside strings and
 * comments.
 */
const ABSOLUTE_URL = String.raw`(?:[a-z][a-z0-9+.-]*:|\/\/|#)`;
/** The target after `url(` / `@import`: a quote (always consumed when present) or none, then not an absolute URL. */
const RELATIVE_TARGET = String.raw`(?:["']\s*(?!${ABSOLUTE_URL})|(?!["'\s]|${ABSOLUTE_URL}))`;
const RELATIVE_URL_RE = new RegExp(
  String.raw`url\(\s*${RELATIVE_TARGET}|@import\s+(?:url\(\s*${RELATIVE_TARGET}|(?!url\()${RELATIVE_TARGET})`,
  'i',
);

/**
 * Functions that take a URL as a plain string: `image-set()` / `-webkit-image-set()` (`image-set("a.png" 1x)`) and
 * `src()` (CSS Values 5). Review finding (0.3.0): only `url()` / `@import` were checked.
 */
const STRING_URL_FUNCTION_RE = /(?<![\w-])(?:-webkit-)?image-set\(|(?<![\w-])src\(/gi;
const ABSOLUTE_STRING_RE = new RegExp(`^\\s*${ABSOLUTE_URL}`, 'i');

/**
 * Whether the string-URL function whose arguments start at `open` (just after its `(`) has a quoted argument that is
 * not an absolute URL or a fragment. Only strings at the function's own level count: `type("image/avif")` inside
 * `image-set()` is a MIME type, and `url()` arguments are `RELATIVE_URL_RE`'s. An unterminated function or string
 * counts as relative (conservative).
 */
function hasRelativeStringArgument(css: string, open: number): boolean {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const char = css[i];
    if (char === '"' || char === "'") {
      let end = i + 1;
      while (end < css.length && css[end] !== char) {
        end += css[end] === '\\' ? 2 : 1;
      }
      if (end >= css.length) {
        return true;
      }
      if (depth === 0 && !ABSOLUTE_STRING_RE.test(css.slice(i + 1, end))) {
        return true;
      }
      i = end;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      if (depth === 0) {
        return false;
      }
      depth--;
    }
  }
  return true;
}

export function hasRelativeUrl(css: string): boolean {
  // Function names and at-keywords are ASCII case-insensitive (`URL(...)`, `@IMPORT`): no case-sensitive pre-check.
  if (RELATIVE_URL_RE.test(css)) {
    return true;
  }
  STRING_URL_FUNCTION_RE.lastIndex = 0;
  for (let match = STRING_URL_FUNCTION_RE.exec(css); match !== null; match = STRING_URL_FUNCTION_RE.exec(css)) {
    if (hasRelativeStringArgument(css, match.index + match[0].length)) {
      return true;
    }
  }
  return false;
}

/** One distinct linked text of a render (`StylesReport.dedupe.sheets`). */
export interface LinkedSheet {
  hash: string;
  url: string;
  /** UTF-8 bytes of the text (served once per page). */
  bytes: number;
  /** `<link>` elements of the output that point to it. */
  links: number;
}

/** Per render: the URL and `<link>` markup of every distinct linked text, in document order of first use. */
export class Linker {
  readonly sheets: LinkedSheet[] = [];
  /** `<link>` elements written. */
  links = 0;
  /** UTF-8 bytes of the CSS that stayed inline (every copy). */
  inlineBytes = 0;
  /** For the render's report (`#render` warnings): one per text whose `dedupeUrl` call threw. */
  readonly warnings: string[] = [];
  private readonly byText = new Map<string, LinkedSheet>();
  /** Texts whose `dedupeUrl` call threw: they stay inline. */
  private readonly failed = new Set<string>();
  private readonly url: (hash: string, css: string) => string;

  constructor(
    url: ((hash: string, css: string) => string) | undefined,
    private readonly store: StyleSheetStore = styleSheetStore,
  ) {
    this.url = url ?? ((hash) => `${DEFAULT_STYLE_SHEET_PATH}${hash}.css`);
  }

  /**
   * The `<link>` that replaces one copy of `css` in a shadow root, or undefined: the text stays inline because the
   * application's `dedupeUrl` threw for it (reported once per text). Review finding (0.3.0): the exception aborted the
   * whole style resolution, and the page fell back to the complete, untrimmed stylesheets (11.5 MB on the catalog).
   */
  link(css: string, marker: StyleMarker): string | undefined {
    let sheet = this.byText.get(css);
    if (sheet === undefined) {
      if (this.failed.has(css)) {
        return undefined;
      }
      const hash = this.store.put(css);
      let url: string;
      try {
        url = String(this.url(hash, css));
      } catch (error) {
        this.failed.add(css);
        let message: string;
        try {
          message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        } catch {
          message = '(the error cannot be printed)';
        }
        this.warnings.push(`StyleOptions.dedupeUrl threw for stylesheet ${hash} (${utf8Length(css)} bytes), kept inline: ${message}`);
        return undefined;
      }
      sheet = {hash, url, bytes: utf8Length(css), links: 0};
      this.byText.set(css, sheet);
      this.sheets.push(sheet);
    }
    sheet.links++;
    this.links++;
    return `<link rel="stylesheet" href="${escapeAttribute(sheet.url)}" ${STYLE_MARKER_ATTRIBUTE}="${marker}">`;
  }

  /** The linked sheet of a text (after `link()`), for the per-sheet report. */
  sheetOf(css: string): LinkedSheet | undefined {
    return this.byText.get(css);
  }

  report(): NonNullable<StylesReport['dedupe']> {
    return {
      mode: 'link',
      sheets: this.sheets.map((sheet) => ({...sheet})),
      links: this.links,
      linkedBytes: this.sheets.reduce((sum, sheet) => sum + sheet.bytes, 0),
      inlineBytes: this.inlineBytes,
    };
  }
}

/**
 * How `RenderSpectrumResult.head` announces the linked stylesheets, per URL in order of first use:
 *  - `'preload'` (what `renderSpectrum` uses): `<link rel="preload" href="..." as="style">`. Starts every download at
 *    high priority before the parser reaches the shadow roots; applies nothing to the document, blocks nothing.
 *  - `'stylesheet-not-all'`: `<link rel="stylesheet" href="..." media="not all">`. Downloads without applying anything
 *    (the media never matches) and without blocking, at the lowest priority. Evaluated, not used (docs/DESIGN.md
 *    "Style de-duplication").
 * The sheets cannot be announced as render-blocking document stylesheets instead: their rules (`#input`, `.icon`,
 * `input`, ...) would match the light DOM.
 */
export type StyleHeadHint = 'preload' | 'stylesheet-not-all';

/** The `<head>` markup for the linked stylesheets of a render's `report.styles`; '' when nothing was linked. */
export function styleHeadOf(styles: StylesReport | undefined, hint: StyleHeadHint = 'preload'): string {
  const sheets = styles?.dedupe?.sheets;
  if (!sheets || sheets.length === 0) {
    return '';
  }
  let head = '';
  for (const sheet of sheets) {
    const href = escapeAttribute(sheet.url);
    head +=
      hint === 'stylesheet-not-all'
        ? `<link rel="stylesheet" href="${href}" media="not all">`
        : `<link rel="preload" href="${href}" as="style">`;
  }
  return head;
}
