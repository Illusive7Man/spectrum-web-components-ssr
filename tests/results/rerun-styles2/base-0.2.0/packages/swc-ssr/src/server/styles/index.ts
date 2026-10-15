/** Stylesheet trimming of the server output (`RenderSpectrumOptions.styles`). */
export {scanCustomPropertyReferences} from './css-text.js';
export {styleCollectorOf, normalizeStyleOptions, PLACEHOLDER_PREFIX, STYLE_MARKER_ATTRIBUTE} from './collector.js';
export type {StyleCollector, SheetEntry, NormalizedStyleOptions, StyleMarker} from './collector.js';
export {resolveStyles} from './trim.js';
export type {ResolvedStyles} from './trim.js';
