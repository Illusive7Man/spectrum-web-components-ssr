import type {Page} from '@playwright/test';
import {HYDRATION_TIMEOUT_MS} from './thresholds.ts';

/** Shape of `HydrationReport` from `swc-ssr/client` (docs/API.md); duplicated here to keep the tests decoupled. */
export interface HydrationReportLike {
  errors: string[];
  warnings: string[];
  deferred: string[];
  hydratedCount: number;
  durationMs: number;
}

export const sectionSelector = (name: string): string => `section[data-component="${name}"]`;

/**
 * Waits until the demo client has published `window.__swcSsrHydration` and that promise has settled.
 * Throws a readable error if the global never appears, the promise rejects, or it does not settle in time.
 */
export async function awaitHydration(page: Page, timeoutMs: number = HYDRATION_TIMEOUT_MS): Promise<HydrationReportLike> {
  try {
    await page.waitForFunction(
      () => (window as unknown as {__swcSsrHydration?: unknown}).__swcSsrHydration !== undefined,
      undefined,
      {timeout: timeoutMs},
    );
  } catch {
    throw new Error(`window.__swcSsrHydration was never set on ${page.url()} (client bundle missing or crashed?)`);
  }
  const report = await page.evaluate(async (ms) => {
    const w = window as unknown as {__swcSsrHydration?: Promise<unknown> | unknown};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`window.__swcSsrHydration did not settle within ${ms} ms`)), ms);
    });
    try {
      return (await Promise.race([Promise.resolve(w.__swcSsrHydration), timeout])) as unknown;
    } catch (error) {
      throw new Error(`hydration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, timeoutMs);
  const r = (report ?? {}) as Partial<HydrationReportLike>;
  return {
    errors: Array.isArray(r.errors) ? r.errors : [],
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    deferred: Array.isArray(r.deferred) ? r.deferred : [],
    hydratedCount: typeof r.hydratedCount === 'number' ? r.hydratedCount : 0,
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
  };
}

/** Resolves after `count` animation frames (and web fonts being ready). */
export async function settleFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (n) => {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
    for (let i = 0; i < n; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

export interface ConsoleCollector {
  /** console.error messages + uncaught page errors (favicon noise excluded). */
  errors: string[];
  /** console.warn messages. */
  warnings: string[];
  /** Forget everything collected so far (e.g. after hydration, before an interaction). */
  clear(): void;
}

export function collectConsole(page: Page): ConsoleCollector {
  const collector: ConsoleCollector = {
    errors: [],
    warnings: [],
    clear() {
      collector.errors.length = 0;
      collector.warnings.length = 0;
    },
  };
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const url = msg.location().url ?? '';
    if (/favicon\.ico(\?|$)/.test(url) || /favicon/i.test(msg.text())) return;
    (type === 'error' ? collector.errors : collector.warnings).push(msg.text());
  });
  page.on('pageerror', (error) => {
    collector.errors.push(`uncaught: ${error.message}`);
  });
  return collector;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Document-relative bounding box of the section (fractional) plus an integer pixel-aligned clip enclosing it. */
export async function measureSection(page: Page, selector: string): Promise<{exact: Rect; clip: Rect}> {
  const exact = await page.locator(selector).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return {x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height};
  });
  const x = Math.floor(exact.x);
  const y = Math.floor(exact.y);
  return {
    exact,
    clip: {x, y, width: Math.ceil(exact.x + exact.width) - x, height: Math.ceil(exact.y + exact.height) - y},
  };
}
