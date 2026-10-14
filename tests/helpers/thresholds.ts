/** Tunable thresholds shared by the specs and the summary writer. */

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Max fraction (0..1) of pixels that may differ between the pure-SSR paint and the hydrated paint. Default 0.2 %. */
export const FLICKER_MAX = envNumber('SWC_SSR_FLICKER_MAX', 0.002);

/** Max cumulative layout shift (sum of `layout-shift` values) over load + hydration. */
export const CLS_MAX = envNumber('SWC_SSR_CLS_MAX', 0.01);

/** Max tolerated change (px) of the section's width/height between the pure-SSR paint and the hydrated paint. */
export const LAYOUT_TOLERANCE_PX = envNumber('SWC_SSR_LAYOUT_TOLERANCE_PX', 1);

/** pixelmatch per-pixel colour threshold (0..1, smaller is more sensitive). */
export const PIXEL_THRESHOLD = 0.1;

/** How long (ms) to wait for `window.__swcSsrHydration` to settle. */
export const HYDRATION_TIMEOUT_MS = envNumber('SWC_SSR_HYDRATION_TIMEOUT_MS', 30_000);
