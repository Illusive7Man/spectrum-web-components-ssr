/** Stylesheet trimming of the server output (`RenderSpectrumOptions.styles`). */
export {scanCustomPropertyReferences} from './css-text.js';
export {styleCollectorOf, normalizeStyleOptions, PLACEHOLDER_PREFIX, STYLE_MARKER_ATTRIBUTE} from './collector.js';
export type {StyleCollector, SheetEntry, NormalizedStyleOptions, StyleMarker} from './collector.js';
export {resolveStyles} from './trim.js';
export type {ResolvedStyles} from './trim.js';
export {
  styleSheetStore,
  getStyleSheet,
  styleSheetHash,
  styleHeadOf,
  hasRelativeUrl,
  StyleSheetStore,
  Linker,
  DEFAULT_STYLE_SHEET_PATH,
  STYLE_SHEET_HASH_RE,
  INLINE_BELOW_BYTES,
} from './dedupe.js';
export type {StyleHeadHint, LinkedSheet} from './dedupe.js';
