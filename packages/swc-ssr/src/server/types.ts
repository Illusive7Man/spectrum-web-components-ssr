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
   * 0 disables the wait.
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
