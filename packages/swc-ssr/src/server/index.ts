/**
 * `swc-ssr/server`: server-side rendering of Spectrum Web Components (1st-gen) on top of `@lit-labs/ssr`.
 *
 * Importing this module installs the Lit SSR global DOM shim (it must be evaluated before `lit`); call
 * `installSpectrumSsr()` before importing any `@spectrum-web-components/*` module.
 */
import {installSpectrumDomShim} from '../dom-shim/index.js';

installSpectrumDomShim();

export function installSpectrumSsr(): void {
  installSpectrumDomShim();
}

export {renderSpectrum, spectrumElementRenderers} from './render-spectrum.js';
export {SpectrumElementRenderer} from './spectrum-element-renderer.js';
export {ThemeRenderer} from './theme-renderer.js';
export {registerAdapter} from './adapters/index.js';
export {getCurrentRenderContext} from './context.js';
export {ServerTree} from './server-tree.js';
export {scanCustomPropertyReferences} from './styles/css-text.js';
export {STYLE_MARKER_ATTRIBUTE} from './styles/collector.js';
export type {StyleMarker} from './styles/collector.js';
export type {
  LifecycleMode,
  RenderSpectrumOptions,
  StyleOptions,
  StylesReport,
  ElementReport,
  RenderReport,
  RenderSpectrumResult,
  ElementAdapter,
  AdapterContext,
} from './types.js';
