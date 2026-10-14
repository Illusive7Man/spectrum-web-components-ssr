/**
 * `swc-ssr/dom-shim`: the Lit SSR global DOM shim plus the extras Spectrum Web Components (1st-gen) need.
 *
 * The Lit shim is installed by the side-effect import below, i.e. as soon as this module is evaluated (it has to
 * happen before `lit` is evaluated, otherwise Lit and the shim end up with different `customElements`
 * registries). `installSpectrumDomShim()` then adds the extras; call it before importing any
 * `@spectrum-web-components/*` module.
 */
import '@lit-labs/ssr/lib/install-global-dom-shim.js';
import {extrasInstalled, installExtras} from './install.js';

export function installSpectrumDomShim(): void {
  installExtras();
}

export const isSpectrumDomShimInstalled = (): boolean => extrasInstalled();

export {
  BACKING,
  getBacking,
  setBacking,
  setConstructionHook,
  setRafSink,
  setRandomSource,
  setListenerLog,
  requestFrame,
  cancelFrame,
} from './hooks.js';
export type {StructureBacking, RafEntry, RafSink, ListenerRecord} from './hooks.js';
export {
  ServerElement,
  ServerText,
  ServerComment,
  ServerFragment,
  ServerSlotElement,
  serializeNode,
  serializeChildren,
  textContentOf,
  childNodesOf,
  cloneNode,
  nodeList,
  ShimHTMLElement,
  ShimHTMLSlotElement,
  ShimNode,
} from './nodes.js';
export {queryAll, queryOne, matches, closest, setSelectorErrorHandler} from './select.js';
