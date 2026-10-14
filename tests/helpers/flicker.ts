import type {Page} from '@playwright/test';
import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';
import {PIXEL_THRESHOLD} from './thresholds.ts';

export interface PixelDiff {
  diffPixels: number;
  totalPixels: number;
  /** diffPixels / totalPixels (0..1), computed over the overlapping area. */
  ratio: number;
  /** Size of the compared (overlapping) area. */
  width: number;
  height: number;
  /** The two input sizes; they differ when the section changed size ("layout change"). */
  before: {width: number; height: number};
  after: {width: number; height: number};
  sizeChanged: boolean;
  /** Diff image (PNG) for the overlapping area. */
  diffPng: Buffer;
}

function crop(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) return png.data;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = y * png.width * 4;
    png.data.copy(out, y * width * 4, from, from + width * 4);
  }
  return out;
}

/**
 * pixelmatch-based comparison of two PNG buffers. When the images differ in size, only the overlapping top-left
 * area is compared (and `sizeChanged` is set) - the callers screenshot the section at its own origin both times.
 */
export function diffPngs(beforePng: Buffer, afterPng: Buffer, options: {threshold?: number} = {}): PixelDiff {
  const a = PNG.sync.read(beforePng);
  const b = PNG.sync.read(afterPng);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const totalPixels = width * height;
  if (totalPixels === 0) {
    throw new Error(`cannot compare empty screenshots (before ${a.width}x${a.height}, after ${b.width}x${b.height})`);
  }
  const diff = new PNG({width, height});
  const diffPixels = pixelmatch(crop(a, width, height), crop(b, width, height), diff.data, width, height, {
    threshold: options.threshold ?? PIXEL_THRESHOLD,
  });
  return {
    diffPixels,
    totalPixels,
    ratio: diffPixels / totalPixels,
    width,
    height,
    before: {width: a.width, height: a.height},
    after: {width: b.width, height: b.height},
    sizeChanged: a.width !== b.width || a.height !== b.height,
    diffPng: PNG.sync.write(diff),
  };
}

// ---------------------------------------------------------------------------------------------
// Cumulative layout shift
// ---------------------------------------------------------------------------------------------

/** Init script: accumulates `layout-shift` values into `window.__cls`; `window.__clsFlush()` drains pending entries. */
export const CLS_INIT_SCRIPT = `(() => {
  const w = window;
  if (w.__clsInstalled) return;
  w.__clsInstalled = true;
  w.__cls = 0;
  w.__clsFlush = () => w.__cls;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) w.__cls += e.value;
    });
    po.observe({type: 'layout-shift', buffered: true});
    w.__clsFlush = () => {
      for (const e of po.takeRecords()) if (!e.hadRecentInput) w.__cls += e.value;
      return w.__cls;
    };
  } catch (e) {
    /* layout-shift not supported: __cls stays 0 */
  }
})();`;

/** Installs the CLS collector for every document the page loads from now on. Call before `page.goto`. */
export async function installClsCollector(page: Page): Promise<void> {
  await page.addInitScript({content: CLS_INIT_SCRIPT});
}

/** Current cumulative layout shift of the page (drains the observer's queue first). */
export async function readCls(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as {__clsFlush?: () => number; __cls?: number};
    return typeof w.__clsFlush === 'function' ? w.__clsFlush() : (w.__cls ?? 0);
  });
}
