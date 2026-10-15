import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type Page, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, sectionSelector} from './helpers/browser.ts';
import {allEntries} from './helpers/catalog.ts';
import {expectNone, fetchRenderReport, truncateList} from './helpers/checks.ts';
import {unifiedDiff} from './helpers/diff.ts';
import {collectDeferredHydration, serializeTree, settleTree} from './helpers/dom.ts';
import {distinctSpTags, extractSection, hasDeclarativeShadowRoot, SHADOWLESS_TAGS} from './helpers/html.ts';
import {errorMessage, FIDELITY_DIR, recordResult, step, wasRecorded, type CheckName} from './helpers/results.ts';
import {ALL_COMPONENTS_ROW} from './helpers/summary.ts';

/**
 * The all-components page: `GET /` server-renders the whole catalog in one `renderSpectrum()` call, `GET /csr` is its
 * client-rendered counterpart. Components that render fine on their own pages can still fail together (the render of
 * the whole page may take a third pass, see packages/swc-ssr/test/third-pass.test.ts), so the page is checked as a
 * whole: SSR markup and render report, hydration, and the client-rendered reference. Results are recorded as the
 * `all-components` row of the "Pages" table in tests/results/summary.md (not counted as a component).
 * A soft check compares the hydrated slider section of `/` with the hydrated `/component/slider` section (the same
 * template rendered alone; attribute values verbatim, see `rawAttributeValues`): it is recorded in the Pages table
 * and never fails the run.
 *
 * Always covers the full catalog: the SWC_SSR_COMPONENTS / SWC_SSR_SMOKE filters select per-component tests only.
 */

const ROW = ALL_COMPONENTS_ROW;
const names = allEntries.map((entry) => entry.name);

/** The page is large (every shadow root carries its styles): generous bounds for loading and hydrating it. */
const PAGE_TEST_TIMEOUT_MS = 240_000;
const PAGE_HYDRATION_TIMEOUT_MS = 180_000;
const PAGE_SETTLE_TIMEOUT_MS = 20_000;

const HYDRATION_WARNING = /hydrat/i;

/** The section compared between `/` and its own component page (soft check). */
const FIDELITY_SECTION = 'slider';

const CHECK_BY_TITLE: Record<string, CheckName> = {
  'GET / ssr markup': 'ssr',
  'GET / hydration': 'hydration',
  'GET /csr client-side rendering': 'csr',
};

/** Catalog sections that are not in the live DOM of `page`, plus the total number of sections. */
async function sectionsInDom(page: Page): Promise<{missing: string[]; count: number}> {
  const present = await page.$$eval('#app section.demo[data-component]', (sections) =>
    sections.map((section) => section.getAttribute('data-component') ?? ''),
  );
  return {missing: names.filter((name) => !present.includes(name)), count: present.length};
}

test.describe(ROW, () => {
  test.describe.configure({timeout: PAGE_TEST_TIMEOUT_MS});

  test.afterEach(async ({}, testInfo: TestInfo) => {
    const check = CHECK_BY_TITLE[testInfo.title];
    if (!check || wasRecorded(ROW, check)) return;
    if (testInfo.status === 'passed' || testInfo.status === 'skipped') return;
    recordResult({
      component: ROW,
      check,
      status: 'fail',
      note: testInfo.status === 'timedOut' ? 'test timed out' : errorMessage(testInfo.error?.message ?? 'failed'),
    });
  });

  test('GET / ssr markup', async ({request}, testInfo) => {
    expect(names.length, 'the demo catalog is empty').toBeGreaterThan(0);
    let stepError: unknown;
    let rendered = false;
    try {
      await step(testInfo, ROW, 'ssr', async (ctx) => {
        const res = await request.get('/?nohydrate=1', {timeout: PAGE_TEST_TIMEOUT_MS});
        const html = await res.text();
        rendered = res.status() === 200;
        ctx.metrics.httpStatus = res.status();
        ctx.metrics.htmlBytes = html.length;
        ctx.metrics.sections = names.length;

        // The demo server answers a render that threw with a 500 "Server-side rendering failed:\n\n<stack>".
        const failure = /Server-side rendering failed:\s*([^\n]*\n?[^\n]*)/.exec(html);
        expect(failure, `GET / answered "Server-side rendering failed": ${failure?.[1]?.trim() ?? ''}`).toBeNull();
        expect(res.status(), 'GET /?nohydrate=1 status').toBe(200);
        expect(html.includes('data-swc-ssr'), 'leftover data-swc-ssr debug markers in the SSR output').toBe(false);

        const missingSections: string[] = [];
        const withoutShadowRoot: string[] = [];
        for (const name of names) {
          const sectionHtml = extractSection(html, name);
          if (sectionHtml === null) {
            missingSections.push(name);
            continue;
          }
          for (const tag of distinctSpTags(sectionHtml)) {
            if (!SHADOWLESS_TAGS.has(tag) && !hasDeclarativeShadowRoot(sectionHtml, tag)) {
              withoutShadowRoot.push(`${name}: <${tag}>`);
            }
          }
        }
        ctx.metrics.missingSections = missingSections.length;
        expectNone(missingSections, `catalog sections missing from GET / (${names.length} expected)`, {soft: false});
        expectNone(withoutShadowRoot, 'sp-* tags without a declarative shadow root (<template shadowrootmode>)', {
          soft: false,
        });
      });
    } catch (error) {
      stepError = error;
    }

    // The RenderReport of the whole-catalog render (`?component=*`): element-level errors and skipped entries.
    if (rendered) {
      const outcome = await fetchRenderReport(request, '*');
      recordResult({
        component: ROW,
        check: 'ssr-errors',
        status: outcome.problems.length > 0 ? 'fail' : 'pass',
        metrics: outcome.metrics,
        note: outcome.problems.length > 0 ? truncateList(outcome.problems) : undefined,
      });
      expectNone(outcome.problems, 'elements with SSR errors / entries left out according to /report.json?component=*');
    } else {
      recordResult({component: ROW, check: 'ssr-errors', status: 'skip', note: 'no successful SSR render to report on'});
    }

    if (stepError !== undefined) throw stepError;
  });

  test('GET / hydration', async ({page}, testInfo) => {
    const logs = collectConsole(page);
    await step(testInfo, ROW, 'hydration', async (ctx) => {
      const response = await page.goto('/', {timeout: PAGE_TEST_TIMEOUT_MS});
      expect(response?.status(), 'GET / status').toBe(200);
      expect(await page.evaluate(() => (window as unknown as {__swcSsrMode?: string}).__swcSsrMode), 'client mode').toBe('ssr');
      const report = await awaitHydration(page, PAGE_HYDRATION_TIMEOUT_MS);
      const settled = await page.locator('#app').evaluate(settleTree, {timeoutMs: PAGE_SETTLE_TIMEOUT_MS});
      ctx.metrics.hydratedCount = report.hydratedCount;
      ctx.metrics.durationMs = Math.round(report.durationMs);
      ctx.metrics.reportWarnings = report.warnings.length;
      ctx.metrics.settleTimedOut = settled.timedOut;

      const {missing, count} = await sectionsInDom(page);
      ctx.metrics.sections = count;
      const deferredInDom = await page.evaluate(collectDeferredHydration);
      const hydrationWarnings = [...report.warnings, ...logs.warnings].filter((w) => HYDRATION_WARNING.test(w));
      ctx.metrics.consoleWarnings = logs.warnings.length;
      ctx.metrics.consoleErrors = logs.errors.length;

      expectNone(missing, 'catalog sections missing from the hydrated page');
      expect.soft(report.hydratedCount, 'number of hydrated custom elements (sp-* and others)').toBeGreaterThan(0);
      expectNone(report.errors, 'HydrationReport.errors');
      expectNone(report.deferred, 'HydrationReport.deferred (elements still carrying defer-hydration)');
      expectNone(deferredInDom, 'elements still carrying defer-hydration in the DOM');
      expectNone(logs.errors, 'console errors / uncaught exceptions during load');
      expectNone(hydrationWarnings, 'console warnings mentioning hydration');
    });
  });

  // Soft check: never fails the run, the outcome (and the diff) is recorded in the Pages table / tests/results/fidelity.
  test(`GET / ${FIDELITY_SECTION} section fidelity (soft)`, async ({page}, testInfo) => {
    const files = [`all-components-${FIDELITY_SECTION}.page.txt`, `all-components-${FIDELITY_SECTION}.component.txt`];
    const metrics: Record<string, string | number> = {section: FIDELITY_SECTION};
    let status: 'pass' | 'fail' = 'pass';
    let note: string | undefined;
    try {
      if (!names.includes(FIDELITY_SECTION)) throw new Error(`catalog entry "${FIDELITY_SECTION}" not found`);
      const selector = sectionSelector(FIDELITY_SECTION);
      await page.goto('/', {timeout: PAGE_TEST_TIMEOUT_MS});
      await awaitHydration(page, PAGE_HYDRATION_TIMEOUT_MS);
      await page.locator('#app').evaluate(settleTree, {timeoutMs: PAGE_SETTLE_TIMEOUT_MS});
      const onPage = await page.locator(selector).evaluate(serializeTree, {rawAttributeValues: true});

      await page.goto(`/component/${FIDELITY_SECTION}`);
      await awaitHydration(page);
      await page.locator(selector).evaluate(settleTree, {timeoutMs: 5000});
      const alone = await page.locator(selector).evaluate(serializeTree, {rawAttributeValues: true});

      if (onPage === alone) {
        for (const file of files) fs.rmSync(path.join(FIDELITY_DIR, file), {force: true});
      } else {
        fs.mkdirSync(FIDELITY_DIR, {recursive: true});
        fs.writeFileSync(path.join(FIDELITY_DIR, files[0]!), `${onPage}\n`);
        fs.writeFileSync(path.join(FIDELITY_DIR, files[1]!), `${alone}\n`);
        const diff = unifiedDiff(onPage, alone, {
          labelA: `${FIDELITY_SECTION} section of / (hydrated)`,
          labelB: `/component/${FIDELITY_SECTION} (hydrated)`,
          maxChangedLines: 30,
        });
        status = 'fail';
        metrics.diffRemoved = diff.removed;
        metrics.diffAdded = diff.added;
        note =
          `the ${FIDELITY_SECTION} section of / differs from /component/${FIDELITY_SECTION} ` +
          `(-${diff.removed}/+${diff.added} lines; tests/results/fidelity/${files[0]} vs ${files[1]})`;
        testInfo.annotations.push({type: 'soft-check', description: `${note}\n${diff.text}`});
      }
    } catch (error) {
      status = 'fail';
      note = `could not compare: ${errorMessage(error)}`;
      testInfo.annotations.push({type: 'soft-check', description: note});
    }
    recordResult({component: ROW, check: 'fidelity', status, metrics, note});
  });

  test('GET /csr client-side rendering', async ({page}, testInfo) => {
    const logs = collectConsole(page);
    await step(testInfo, ROW, 'csr', async (ctx) => {
      const response = await page.goto('/csr', {timeout: PAGE_TEST_TIMEOUT_MS});
      expect(response?.status(), 'GET /csr status').toBe(200);
      expect(await page.evaluate(() => (window as unknown as {__swcSsrMode?: string}).__swcSsrMode), 'client mode').toBe('csr');
      const report = await awaitHydration(page, PAGE_HYDRATION_TIMEOUT_MS);
      const settled = await page.locator('#app').evaluate(settleTree, {timeoutMs: PAGE_SETTLE_TIMEOUT_MS});
      ctx.metrics.renderedCount = report.hydratedCount;
      ctx.metrics.durationMs = Math.round(report.durationMs);
      ctx.metrics.settleTimedOut = settled.timedOut;

      const {missing, count} = await sectionsInDom(page);
      ctx.metrics.sections = count;
      const deferredInDom = await page.evaluate(collectDeferredHydration);
      ctx.metrics.consoleWarnings = logs.warnings.length;
      ctx.metrics.consoleErrors = logs.errors.length;

      expectNone(missing, 'catalog sections missing from the client-rendered page');
      expect.soft(await page.locator(sectionSelector(names[0]!)).count(), 'first catalog section rendered').toBe(1);
      expectNone(report.errors, 'HydrationReport.errors (client-side rendering)');
      expectNone(report.deferred, 'HydrationReport.deferred');
      expectNone(deferredInDom, 'elements carrying defer-hydration in the DOM');
      expectNone(logs.errors, 'console errors / uncaught exceptions during load');
    });
  });
});
