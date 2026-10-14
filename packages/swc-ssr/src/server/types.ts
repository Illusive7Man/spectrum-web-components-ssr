import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ServerTree} from './server-tree.js';

/**
 * - `none`      : Lit default (willUpdate + attribute reflection only)
 * - `connected` : + element.connectedCallback() with enableUpdating no-op'd
 * - `full`      : + update()/firstUpdated()/updated() + rAF flush + bounded re-render (default)
 */
export type LifecycleMode = 'none' | 'connected' | 'full';

export interface RenderSpectrumOptions {
  /** Forwarded to @lit-labs/ssr render(); default false. */
  deferHydration?: boolean;
  /** Keep data-swc-ssr markers and log details; default false. */
  debug?: boolean;
  /** Default 'full'. */
  lifecycle?: LifecycleMode;
  /** Per-tag override, e.g. {'sp-overlay': 'none'}. */
  lifecycleByTag?: Record<string, LifecycleMode>;
  /** Extra renderers tried BEFORE the Spectrum ones. */
  elementRenderers?: ElementRendererConstructor[];
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
  id: number;
  pass: 1 | 2;
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
  /** Pass 2, after the lifecycle, before render(). */
  beforeRender?(element: HTMLElement, ctx: AdapterContext): void;
  afterRender?(element: HTMLElement, ctx: AdapterContext): void;
}
