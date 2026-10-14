/**
 * Layout helpers shared by the catalog entries. This module is NOT an entry and must stay free of
 * Spectrum imports (entries register their custom elements only inside `load()`).
 *
 * The styles are plain inline strings so the demo does not depend on any page-level stylesheet and
 * the SSR output / CSR output stay identical.
 */

/** Horizontal, wrapping row of demo items. */
export const ROW =
  'display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-block-end:16px';

/** Vertical stack of demo items. */
export const COL =
  'display:flex;flex-direction:column;gap:12px;align-items:flex-start;margin-block-end:16px';

/** Responsive grid for card-like demo items. */
export const GRID =
  'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;align-items:start;margin-block-end:16px';

/** Bordered box used to give components that expect a surface (menus, dialogs) some context. */
export const FRAME =
  'padding:16px;border:1px solid var(--spectrum-gray-300);border-radius:8px;background:var(--spectrum-gray-50);margin-block-end:16px';

/** Dark backdrop for `static-color="white"` variants. */
export const ON_DARK =
  'display:inline-flex;flex-wrap:wrap;gap:16px;align-items:center;padding:16px;border-radius:8px;background:#2f4f6f;color:#fff;margin-block-end:16px';

/** Light backdrop for `static-color="black"` variants. */
export const ON_LIGHT =
  'display:inline-flex;flex-wrap:wrap;gap:16px;align-items:center;padding:16px;border-radius:8px;background:#f5d76e;color:#000;margin-block-end:16px';

/** Small caption above a variant. */
export const CAP =
  'margin:0 0 4px;font-size:12px;line-height:1.4;color:var(--spectrum-gray-700)';

/**
 * Deterministic placeholder picture as a `data:` URI (no network access, identical on server and
 * client). `btoa` exists in Node >= 16 and in every browser.
 */
export function sampleImage(width: number, height: number, hue = 210): string {
  const r = Math.round(Math.min(width, height) * 0.12);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},70%,62%)'/>` +
    `<stop offset='1' stop-color='hsl(${(hue + 50) % 360},70%,38%)'/>` +
    `</linearGradient></defs>` +
    `<rect width='${width}' height='${height}' fill='url(#g)'/>` +
    `<circle cx='${Math.round(width * 0.3)}' cy='${Math.round(height * 0.35)}' r='${r}' fill='rgba(255,255,255,0.75)'/>` +
    `<path d='M0 ${height} L${Math.round(width * 0.4)} ${Math.round(height * 0.55)} L${Math.round(width * 0.65)} ${Math.round(height * 0.8)} L${Math.round(width * 0.8)} ${Math.round(height * 0.62)} L${width} ${height} Z' fill='rgba(0,0,0,0.28)'/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
