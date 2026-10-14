import {expect, type APIRequestContext} from '@playwright/test';
import {errorMessage} from './results.ts';

/** Assertion and report helpers shared by the specs (tests/ssr.spec.ts, tests/all-components.spec.ts). */

export function truncateList(items: string[], max = 3, itemMax = 140): string {
  const clip = (s: string): string => (s.length > itemMax ? s.slice(0, itemMax - 3) + '...' : s);
  const shown = items.slice(0, max).map(clip).join(' | ');
  return items.length > max ? `${shown} | (+${items.length - max} more)` : shown;
}

/** Asserts that `items` is empty; the failure headline lists the first few items so the summary is self-explanatory. */
export function expectNone(items: string[], label: string, options: {soft?: boolean} = {}): void {
  const assertion = options.soft === false ? expect : expect.soft;
  assertion(items.length, `${label}: ${truncateList(items)}`).toBe(0);
}

export interface RenderReportOutcome {
  /** One line per element error / load error / unreadable report. Empty when the render was clean. */
  problems: string[];
  metrics: Record<string, number>;
}

/**
 * Fetches the RenderReport of the render that was just triggered. `?component=name` is understood by the demo server
 * (it avoids races with other renders; `*` is the whole-catalog page `/`); any server that ignores it returns "the
 * last render", which is the same thing for this serial suite.
 */
export async function fetchRenderReport(request: APIRequestContext, name: string): Promise<RenderReportOutcome> {
  try {
    const res = await request.get(`/report.json?component=${encodeURIComponent(name)}`);
    if (res.status() !== 200) return {problems: [`report unavailable: GET /report.json -> ${res.status()}`], metrics: {}};
    const body = (await res.json()) as {
      elements?: unknown;
      loadErrors?: unknown;
      passes?: unknown;
      report?: {elements?: unknown};
    };
    type El = {id?: number; tagName?: string; errors?: string[]; fallback?: boolean};
    const raw = body.elements ?? body.report?.elements;
    const elements = (Array.isArray(raw) ? raw : []) as El[];
    const withErrors = elements.filter((e) => Array.isArray(e.errors) && e.errors.length > 0);
    const loadErrors = (Array.isArray(body.loadErrors) ? body.loadErrors : []) as Array<{name?: string; message?: string}>;
    return {
      problems: [
        ...withErrors.map((e) => `${e.tagName ?? '?'}#${e.id ?? '?'}: ${(e.errors ?? [])[0]}`),
        ...loadErrors.map((e) => `load() of ${e.name ?? '?'} failed: ${e.message ?? ''}`),
      ],
      metrics: {
        elements: elements.length,
        erroredElements: withErrors.length + loadErrors.length,
        fallbackElements: elements.filter((e) => e.fallback === true).length,
        ...(typeof body.passes === 'number' ? {passes: body.passes} : {}),
      },
    };
  } catch (error) {
    return {problems: [`report unavailable: ${errorMessage(error)}`], metrics: {}};
  }
}
