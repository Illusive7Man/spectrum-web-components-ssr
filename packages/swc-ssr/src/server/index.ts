/**
 * `swc-ssr/server`: server-side rendering of Spectrum Web Components (1st-gen) on top of `@lit-labs/ssr`.
 *
 * Importing this module installs the Lit SSR global DOM shim (it must be evaluated before `lit`); call
 * `installSpectrumSsr()` before importing any `@spectrum-web-components/*` module.
 */
import {installSpectrumDomShim} from '../dom-shim/index.js';
import {renderSpectrum as renderSpectrumCore} from './render-spectrum.js';
import {styleHeadOf} from './styles/dedupe.js';
import type {RenderSpectrumOptions, RenderSpectrumResult} from './types.js';

installSpectrumDomShim();

export function installSpectrumSsr(): void {
  installSpectrumDomShim();
}

/**
 * Renders `value` (a Lit template, usually) to HTML with declarative shadow roots; see docs/API.md. The result's `head`
 * (0.3.0) is the markup the page must put into its `<head>` ('' unless `styles.dedupe` is `'link'`).
 */
export async function renderSpectrum(
  value: unknown,
  options: RenderSpectrumOptions = {},
): Promise<RenderSpectrumResult & {head: string}> {
  const result = await renderSpectrumCore(value, options);
  return {...result, head: result.head ?? styleHeadOf(result.report.styles)};
}

export {spectrumElementRenderers} from './render-spectrum.js';
export {SpectrumElementRenderer} from './spectrum-element-renderer.js';
export {ThemeRenderer} from './theme-renderer.js';
export {registerAdapter} from './adapters/index.js';
export {getCurrentRenderContext} from './context.js';
export {ServerTree} from './server-tree.js';
export {scanCustomPropertyReferences} from './styles/css-text.js';
export {STYLE_MARKER_ATTRIBUTE} from './styles/collector.js';
export type {StyleMarker} from './styles/collector.js';
export {
  styleSheetStore,
  getStyleSheet,
  styleSheetHash,
  styleHeadOf,
  StyleSheetStore,
  DEFAULT_STYLE_SHEET_PATH,
  DEFAULT_STORE_MIN_LIFETIME_MS,
  STYLE_SHEET_HASH_RE,
} from './styles/dedupe.js';
export type {StyleHeadHint, StyleSheetStoreOptions} from './styles/dedupe.js';
export type {
  LifecycleMode,
  RenderSpectrumOptions,
  StyleOptions,
  StylesReport,
  StylesDedupeReport,
  ElementReport,
  RenderReport,
  RenderSpectrumResult,
  ElementAdapter,
  AdapterContext,
} from './types.js';
