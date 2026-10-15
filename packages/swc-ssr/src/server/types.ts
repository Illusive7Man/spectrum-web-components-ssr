import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ServerTree} from './server-tree.js';

/**
 * - `none`      : Lit default (willUpdate + attribute reflection only)
 * - `connected` : + element.connectedCallback() with enableUpdating no-op'd
 * - `full`      : + update()/firstUpdated()/updated() + rAF flush + bounded re-render (default for managed classes)
 */
export type LifecycleMode = 'none' | 'connected' | 'full';

export interface RenderSpectrumOptions {
  /** Forwarded to @lit-labs/ssr render(); default false. */
  deferHydration?: boolean;
  /** Keep data-swc-ssr markers and log details; default false. */
  debug?: boolean;
  /**
   * Lifecycle of managed classes (see `isManagedClass`); default 'full'. Other Lit elements keep the upstream
   * semantics ('none', or 'connected' when `LitElementRenderer.renderOptions` asks for `connectedCallback`) unless
   * `lifecycleByTag` names them.
   */
  lifecycle?: LifecycleMode;
  /** Per-tag override (also opts non-managed classes in), e.g. {'sp-overlay': 'none', 'my-element': 'full'}. */
  lifecycleByTag?: Record<string, LifecycleMode>;
  /** Extra renderers tried BEFORE the Spectrum ones. */
  elementRenderers?: ElementRendererConstructor[];
  /**
   * Which custom element classes get the swc-ssr lifecycle (`lifecycle`, default 'full') by default. Default:
   * Spectrum Web Components classes (`SpectrumMixin` / `SpectrumElement` in the prototype chain).
   */
  isManagedClass?: (ctor: CustomElementConstructor, tagName: string) => boolean;
  /**
   * Deadline of one render in milliseconds; default 10000, 0 / Infinity disables it. When a render does not
   * settle in time (e.g. a template awaits a promise that never settles), the output of the last completed pass
   * is returned with a `#render` warning; when not even the first pass completed, the returned promise rejects.
   * Either way the next queued render starts.
   */
  timeoutMs?: number;
  /**
   * How long a render waits (once per tag and process) for definitions of custom elements that components
   * rendered while undefined (lazy `import()` in `render()`, e.g. `sp-slider` -> `sp-number-field`); default 250,
   * 0 disables the wait. Never beyond the render's deadline (`timeoutMs`). `Infinity` (or >= 2^31 ms): up to the
   * deadline - when it passes, the render returns its pass-1 output with a warning; a render without a deadline
   * waits the default 250 ms instead. Tags still undefined when the wait ends are never waited for again.
   */
  lazyDefinitionWaitMs?: number;
  /**
   * Document language for the render (`document.documentElement.lang` while it runs, restored afterwards). Spectrum
   * components resolve their locale (number formatting, labels) from `<sp-theme lang>`, then the document
   * language, then `navigator.language` ('en-US' on the server).
   */
  lang?: string;
  /**
   * Default true: ids Spectrum generates with `randomID()` (`shared/src/random-id.js`, a 4-byte
   * `crypto.getRandomValues` request) come from a per-pass deterministic source, so the same page renders the same
   * ids in every pass and every render. `false`: this render's `randomID()` calls use the real CSPRNG too. Every
   * other `getRandomValues` request always uses the CSPRNG. Process-wide switch: `configureRandomSource()` from
   * `swc-ssr/dom-shim`.
   */
  deterministicIds?: boolean;
  /**
   * The CSS the declarative shadow roots carry (see `StyleOptions`). Default `{mode: 'full'}`: every shadow root gets
   * its element's complete stylesheets, byte-identical to earlier versions.
   */
  styles?: StyleOptions;
}

/**
 * Size of the CSS in the server output. In `full` mode (the default) every declarative shadow root carries the
 * complete stylesheets of its element (`elementStyles`, the theme fragments of `<sp-theme>`): about 95% of the HTML
 * of a typical Spectrum page. `trimmed` keeps, per stylesheet, the rules that can match what the page rendered.
 *
 * Every `<style>` whose text was trimmed or minified carries `data-swc-styles="trimmed"` / `"minified"`
 * (`STYLE_MARKER_ATTRIBUTE`). Lit's hydration support keeps a hydrated element's server `<style>` as its only CSS (it
 * adopts no `elementStyles` for a declarative shadow root), while `<sp-theme>` replaces its declarative shadow root on
 * upgrade with its complete theme fragments: `swc-ssr/client` uses the marker to give marked elements their complete
 * stylesheets back after hydration and to keep minified theme names defined until then. The trimmed CSS itself only
 * has to be right for the server-rendered state (first paint, no-JS views).
 */
export interface StyleOptions {
  /**
   * `'full'` (default): every shadow root carries the complete stylesheets. `'trimmed'`: only the rules whose
   * selectors can match the rendered DOM of that stylesheet's instances on this page (state pseudo-classes such as
   * `:hover` / `:focus-visible` and unknown pseudo-classes count as matching), plus the `@keyframes` they reference
   * and every `@font-face` / `@property` / `@import` / `@layer` statement. All instances of one element class share
   * one trimmed text (browsers still share identical `<style>` elements). Other values count as `'full'`.
   */
  mode?: 'full' | 'trimmed';
  /**
   * Default true (trimmed mode): drop the custom-property declarations of the theme (`<sp-theme>` fragments) that no
   * kept rule, no `style` attribute or other `<style>` of the output and no `references` entry uses, transitively
   * through `var()` chains (fallbacks included). Custom properties the components' own stylesheets declare are kept.
   */
  trimTheme?: boolean;
  /**
   * Custom-property names (`--name`), or prefixes ending in `*` (`--spectrum-global-*`), used by CSS the server
   * cannot see (the application's own stylesheets): kept with their dependencies, never renamed. See
   * `scanCustomPropertyReferences()`. A single string is one entry (`'--spectrum-*'` = `['--spectrum-*']`); values
   * that are not iterable are ignored.
   */
  references?: readonly string[] | Iterable<string>;
  /**
   * Prefixes of custom properties the application never defines (e.g. `['--mod-']`): `var(--mod-x, V)` becomes `V`
   * in kept rules. Names a kept rule, a `style` attribute or another `<style>` of the output defines are left alone.
   * Default `[]`. A single string is one prefix.
   */
  undefinedPrefixes?: readonly string[];
  /**
   * Default false. Renames the custom properties that the page's own stylesheets (theme and components) define to
   * short names (`--a`, `--b`, ...), consistently across all of them. Only names defined by the theme alone, or
   * defined and used only inside the stylesheets of one element class, are renamed. Never renamed: names in
   * `references`, names that a `style` attribute or another `<style>` of the output defines or uses, names one
   * element's stylesheets define and another's read, and Spectrum's public customisation names (`--mod-*`,
   * `--highcontrast-*`, `--system-*`: application overrides keep working before hydration). Unsafe when the
   * application sets or reads `--spectrum-*` itself without listing them in `references`. The changed `<style>`
   * elements carry `data-swc-styles="minified"`: an element that has not got its complete stylesheets back yet
   * depends on the renamed theme properties, which `<sp-theme>` drops when it upgrades on the client (it replaces its
   * declarative shadow root); `swc-ssr/client` keeps them defined until every marked element is restored.
   */
  minifyCustomProperties?: boolean;
  /** Selectors (substring of, or RegExp tested against, a rule's selector text) whose rules are always kept. */
  keep?: ReadonlyArray<string | RegExp>;
}

/** `RenderReport.styles` (trimmed mode only). */
export interface StylesReport {
  /** The `StyleOptions.mode` that ran: `'trimmed'` (also with `minifyCustomProperties`). */
  mode: string;
  /**
   * One entry per stylesheet of the output: `id` is `<tag>:<index in elementStyles>`, or `<tag>:<kind>/<name>` for
   * theme fragments; `instances`: the shadow roots carrying it; `fullBytes` / `trimmedBytes`: UTF-8 size of ONE copy.
   */
  sheets: Array<{id: string; tag: string; instances: number; fullBytes: number; trimmedBytes: number}>;
  /** UTF-8 size of all copies (size x instances, summed): the CSS the page carries in `full` mode. */
  fullBytes: number;
  /** UTF-8 size of all trimmed copies: the CSS the page carries now. */
  trimmedBytes: number;
  /** Milliseconds spent trimming (part of the render's `durationMs`). */
  durationMs: number;
}

export interface ElementReport {
  id: number;
  tagName: string;
  /** Messages of exceptions caught for this element (pass 1 or 2). */
  errors: string[];
  warnings: string[];
  /** True if pass-2 failed and pass-1 output was used for this element. */
  fallback: boolean;
}

export interface RenderReport {
  elements: ElementReport[];
  /** 2 normally. */
  passes: number;
  durationMs: number;
  /** `StyleOptions.mode: 'trimmed'` only: the stylesheets and their sizes. */
  styles?: StylesReport;
}

export interface RenderSpectrumResult {
  html: string;
  report: RenderReport;
}

export interface AdapterContext {
  /** The element's `data-swc-ssr` id in this pass; -1 while it is not rendered yet (pre-instantiated element). */
  id: number;
  /** The pass number (1, 2, or 3 when a third pass is made). */
  pass: number;
  /** Structural key of the element (stable across passes). */
  key: string;
  /** The element's id in the previous pass (undefined in pass 1 and for elements new in this pass). */
  previousId: number | undefined;
  tree: ServerTree | undefined;
  report: ElementReport;
}

/** Spectrum-specific behaviour lives ONLY in adapters (see `adapters/`). */
export interface ElementAdapter {
  tag: string | RegExp;
  lifecycle?: LifecycleMode;
  /**
   * Every pass, right after the element instance is created and before attributes, properties or any lifecycle
   * hook are applied: per-instance overrides that keep server-unsafe behaviour from running (extension of the
   * documented contract; optional).
   */
  prepare?(element: HTMLElement, ctx: AdapterContext): void;
  /** Pass >= 2, after the lifecycle, before render(). */
  beforeRender?(element: HTMLElement, ctx: AdapterContext): void;
  afterRender?(element: HTMLElement, ctx: AdapterContext): void;
}
