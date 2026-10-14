import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type Page, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, measureSection, sectionSelector, settleFrames} from './helpers/browser.ts';
import {selectedEntries, type TestEntry} from './helpers/catalog.ts';
import {expectNone, fetchRenderReport, truncateList} from './helpers/checks.ts';
import {unifiedDiff} from './helpers/diff.ts';
import {collectDeferredHydration, collectSpTags, serializeTree, settleTree} from './helpers/dom.ts';
import {diffPngs, installClsCollector, readCls} from './helpers/flicker.ts';
import {
  countDeclarativeShadowRoots,
  distinctSpTags,
  extractSection,
  hasDeclarativeShadowRoot,
  SHADOWLESS_TAGS,
} from './helpers/html.ts';
import {
  errorMessage,
  FIDELITY_DIR,
  recordResult,
  SCREENSHOT_DIR,
  step,
  wasRecorded,
  type CheckName,
} from './helpers/results.ts';
import {CLS_MAX, FLICKER_MAX, LAYOUT_TOLERANCE_PX, PIXEL_THRESHOLD} from './helpers/thresholds.ts';

/**
 * Per catalog component: SSR output, hydration health, flicker, DOM fidelity against client-side rendering and an
 * interaction smoke test (docs/DESIGN.md "Tests"). Every check records its outcome through `step()` so that
 * tests/results/summary.md can be written even if assertions fail.
 */

const CHECK_BY_TITLE: Record<string, CheckName> = {
  'ssr markup': 'ssr',
  'no-js render': 'nojs',
  hydration: 'hydration',
  flicker: 'flicker',
  fidelity: 'fidelity',
  interaction: 'interaction',
};

const CLICK_TARGETS =
  'button, [role=button], input, sp-tab, sp-checkbox, sp-switch, sp-radio, [role=radio], sp-menu-item, a[href]';

/** Hydration-related console warnings fail the hydration check; other warnings are only counted. */
const HYDRATION_WARNING = /hydrat/i;

/** Attributes (lowercase, comma separated in the env) excluded from the fidelity comparison, e.g. generated ids. */
const FIDELITY_IGNORE_ATTRS = (process.env.SWC_SSR_FIDELITY_IGNORE_ATTRS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function writeFileIn(dir: string, file: string, data: Buffer | string): string {
  fs.mkdirSync(dir, {recursive: true});
  const target = path.join(dir, file);
  fs.writeFileSync(target, data);
  return target;
}

async function gotoAndHydrate(page: Page, url: string) {
  await page.goto(url);
  const report = await awaitHydration(page);
  await page.locator('body').evaluate(settleTree, {timeoutMs: 5000});
  return report;
}

function registerComponentTests(entry: TestEntry): void {
  const name = entry.name;
  const section = sectionSelector(name);

  test.describe(name, () => {
    // Fallback so that a timeout/crash that skipped the in-test recording still shows up in the summary.
    test.afterEach(async ({}, testInfo: TestInfo) => {
      const check = CHECK_BY_TITLE[testInfo.title];
      if (!check || wasRecorded(name, check)) return;
      if (testInfo.status === 'passed' || testInfo.status === 'skipped') return;
      recordResult({
        component: name,
        check,
        status: 'fail',
        note: testInfo.status === 'timedOut' ? 'test timed out' : errorMessage(testInfo.error?.message ?? 'failed'),
      });
    });

    // ---------------------------------------------------------------------------------------------
    // 1. SSR markup
    // ---------------------------------------------------------------------------------------------
    test('ssr markup', async ({request}, testInfo) => {
      let stepError: unknown;
      let failedStep = false;
      let rendered = false; // true once the server answered 200, i.e. /report.json describes this render
      try {
        await step(testInfo, name, 'ssr', async (ctx) => {
          const res = await request.get(`/component/${encodeURIComponent(name)}?nohydrate=1`);
          rendered = res.status() === 200;
          ctx.metrics.httpStatus = res.status();
          expect(res.status(), `GET /component/${name}?nohydrate=1 status`).toBe(200);
          const html = await res.text();
          ctx.metrics.htmlBytes = html.length;
          if (entry.notes) ctx.metrics.catalogNotes = entry.notes;

          expect(html.includes('data-swc-ssr'), 'leftover data-swc-ssr debug markers in the SSR output').toBe(false);
          expect(html.includes('Internal error'), "'Internal error' found in the SSR output").toBe(false);

          const sectionHtml = extractSection(html, name);
          expect(sectionHtml, `<section data-component="${name}"> not found in the SSR output`).not.toBeNull();
          const tags = distinctSpTags(sectionHtml!);
          ctx.metrics.spTags = tags.length;
          ctx.metrics.shadowRoots = countDeclarativeShadowRoots(sectionHtml!);
          expect(tags.length, 'no sp-* elements found in the section').toBeGreaterThan(0);

          const missing = tags.filter((tag) => !SHADOWLESS_TAGS.has(tag) && !hasDeclarativeShadowRoot(sectionHtml!, tag));
          expectNone(missing, 'sp-* tags without a declarative shadow root (<template shadowrootmode>)', {soft: false});
        });
      } catch (error) {
        failedStep = true;
        stepError = error;
      }

      // Report of the render we just triggered (the server keeps "the last SSR render"). Soft: element-level errors.
      if (rendered) {
        const outcome = await fetchRenderReport(request, name);
        recordResult({
          component: name,
          check: 'ssr-errors',
          status: outcome.problems.length > 0 ? 'fail' : 'pass',
          metrics: outcome.metrics,
          note: outcome.problems.length > 0 ? truncateList(outcome.problems) : undefined,
        });
        expectNone(outcome.problems, 'elements with SSR errors according to /report.json');
      } else {
        recordResult({component: name, check: 'ssr-errors', status: 'skip', note: 'no successful SSR render to report on'});
      }

      if (failedStep) throw stepError;
    });

    // ---------------------------------------------------------------------------------------------
    // 2. No-JS render
    // ---------------------------------------------------------------------------------------------
    test('no-js render', async ({browser}, testInfo) => {
      await step(testInfo, name, 'nojs', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const context = await browser.newContext({
          baseURL,
          javaScriptEnabled: false,
          viewport: {width: 1280, height: 800},
          deviceScaleFactor: 1,
        });
        try {
          const page = await context.newPage();
          const response = await page.goto(`/component/${encodeURIComponent(name)}?nohydrate=1`);
          expect(response?.status(), 'HTTP status').toBe(200);
          const sectionLocator = page.locator(section);
          await expect(sectionLocator, `section[data-component="${name}"] must be visible without JavaScript`).toBeVisible();
          const file = writeFileIn(SCREENSHOT_DIR, `${name}-nojs.png`, await sectionLocator.screenshot({animations: 'disabled'}));
          ctx.metrics.screenshot = path.relative(process.cwd(), file).replace(/\\/g, '/');
        } finally {
          await context.close();
        }
      });
    });

    // ---------------------------------------------------------------------------------------------
    // 3. Hydration
    // ---------------------------------------------------------------------------------------------
    test('hydration', async ({page}, testInfo) => {
      const logs = collectConsole(page);
      await step(testInfo, name, 'hydration', async (ctx) => {
        await page.goto(`/component/${encodeURIComponent(name)}`);
        const report = await awaitHydration(page);
        await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
        ctx.metrics.hydratedCount = report.hydratedCount;
        ctx.metrics.durationMs = Math.round(report.durationMs);
        ctx.metrics.reportWarnings = report.warnings.length;

        const deferredInDom = await page.evaluate(collectDeferredHydration);
        const hydrationWarnings = [...report.warnings, ...logs.warnings].filter((w) => HYDRATION_WARNING.test(w));
        ctx.metrics.consoleWarnings = logs.warnings.length;
        ctx.metrics.consoleErrors = logs.errors.length;

        expectNone(report.errors, 'HydrationReport.errors');
        expectNone(report.deferred, 'HydrationReport.deferred (elements still carrying defer-hydration)');
        expectNone(deferredInDom, 'elements still carrying defer-hydration in the DOM');
        expectNone(logs.errors, 'console errors / uncaught exceptions during load');
        expectNone(hydrationWarnings, 'console warnings mentioning hydration');
      });
    });

    // ---------------------------------------------------------------------------------------------
    // 4. Flicker: pure SSR paint (client bundle blocked) vs. hydrated paint
    // ---------------------------------------------------------------------------------------------
    test('flicker', async ({page}, testInfo) => {
      await step(testInfo, name, 'flicker', async (ctx) => {
        const bundle = '**/dist/client.js';
        await installClsCollector(page);
        await page.route(bundle, (route) => route.abort('blockedbyclient'));

        await page.goto(`/component/${encodeURIComponent(name)}`);
        await page.waitForLoadState('networkidle');
        await settleFrames(page, 1);
        await expect(page.locator(section), 'section visible in the pure SSR paint').toBeVisible();

        const hydratedBeforeUnblock = await page.evaluate(
          () => (window as unknown as {__swcSsrHydration?: unknown}).__swcSsrHydration !== undefined,
        );
        expect(hydratedBeforeUnblock, 'client bundle must not have run while it is blocked').toBe(false);

        const before = await measureSection(page, section);
        expect(before.clip.width * before.clip.height, 'section has no area in the pure SSR paint').toBeGreaterThan(0);
        const beforePng = await page.screenshot({clip: before.clip, fullPage: true, animations: 'disabled', caret: 'hide'});

        // Let the client run now. A cache-busting query is required because a module URL that failed once stays
        // failed in the document's module map; the route above only matches the bare URL.
        await page.unroute(bundle);
        await page.addScriptTag({url: '/dist/client.js?late=1', type: 'module'});
        const report = await awaitHydration(page);
        await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
        await settleFrames(page, 2);

        const after = await measureSection(page, section);
        const afterPng = await page.screenshot({clip: after.clip, fullPage: true, animations: 'disabled', caret: 'hide'});
        const cls = await readCls(page);

        const diff = diffPngs(beforePng, afterPng, {threshold: PIXEL_THRESHOLD});
        writeFileIn(SCREENSHOT_DIR, `${name}-before.png`, beforePng);
        writeFileIn(SCREENSHOT_DIR, `${name}-after.png`, afterPng);
        writeFileIn(SCREENSHOT_DIR, `${name}-diff.png`, diff.diffPng);

        const dw = after.exact.width - before.exact.width;
        const dh = after.exact.height - before.exact.height;
        const layoutChange = Math.abs(dw) > LAYOUT_TOLERANCE_PX || Math.abs(dh) > LAYOUT_TOLERANCE_PX;
        ctx.metrics.diffPixels = diff.diffPixels;
        ctx.metrics.totalPixels = diff.totalPixels;
        ctx.metrics.ratio = diff.ratio;
        ctx.metrics.cls = cls;
        ctx.metrics.layoutChange = layoutChange;
        ctx.metrics.sizeBefore = `${Math.round(before.exact.width)}x${Math.round(before.exact.height)}`;
        ctx.metrics.sizeAfter = `${Math.round(after.exact.width)}x${Math.round(after.exact.height)}`;
        ctx.metrics.hydratedCount = report.hydratedCount;

        expect.soft(
          diff.ratio,
          `${diff.diffPixels}/${diff.totalPixels} px differ between SSR and hydrated paint (max ${(FLICKER_MAX * 100).toFixed(3)} %)`,
        ).toBeLessThan(FLICKER_MAX);
        expect.soft(cls, 'cumulative layout shift (window.__cls)').toBeLessThan(CLS_MAX);
        expect.soft(
          layoutChange,
          `section size changed on hydration: ${ctx.metrics.sizeBefore} -> ${ctx.metrics.sizeAfter} (tolerance ${LAYOUT_TOLERANCE_PX}px)`,
        ).toBe(false);
      });
    });

    // ---------------------------------------------------------------------------------------------
    // 5. Fidelity: hydrated SSR DOM vs. client-rendered DOM
    // ---------------------------------------------------------------------------------------------
    test('fidelity', async ({page}, testInfo) => {
      await step(testInfo, name, 'fidelity', async (ctx) => {
        const ssrFile = `${name}.ssr.txt`;
        const csrFile = `${name}.csr.txt`;

        await gotoAndHydrate(page, `/component/${encodeURIComponent(name)}`);
        const ssrSection = page.locator(section);
        await expect(ssrSection, 'section present on the SSR page').toHaveCount(1);
        const ssrTree = await ssrSection.evaluate(serializeTree, {ignoreAttributes: FIDELITY_IGNORE_ATTRS});
        const ssrTags = await ssrSection.evaluate(collectSpTags);

        await gotoAndHydrate(page, `/csr/${encodeURIComponent(name)}`);
        const csrSection = page.locator(section);
        await expect(csrSection, 'section present on the CSR page').toHaveCount(1);
        const csrTree = await csrSection.evaluate(serializeTree, {ignoreAttributes: FIDELITY_IGNORE_ATTRS});
        const csrTags = await csrSection.evaluate(collectSpTags);

        ctx.metrics.lines = ssrTree.split('\n').length;
        ctx.metrics.spElements = ssrTags.length;
        ctx.metrics.spElementsCsr = csrTags.length;

        if (ssrTree === csrTree) {
          fs.rmSync(path.join(FIDELITY_DIR, ssrFile), {force: true});
          fs.rmSync(path.join(FIDELITY_DIR, csrFile), {force: true});
          return;
        }

        writeFileIn(FIDELITY_DIR, ssrFile, ssrTree + '\n');
        writeFileIn(FIDELITY_DIR, csrFile, csrTree + '\n');
        const diff = unifiedDiff(ssrTree, csrTree, {
          labelA: `ssr (/component/${name}, hydrated)`,
          labelB: `csr (/csr/${name})`,
          maxChangedLines: 40,
        });
        ctx.metrics.diffRemoved = diff.removed;
        ctx.metrics.diffAdded = diff.added;
        throw new Error(
          `post-hydration DOM differs from the client-rendered DOM (-${diff.removed}/+${diff.added} lines; ` +
            `full trees in tests/results/fidelity/${ssrFile} and ${csrFile})\n${diff.text}`,
        );
      });
    });

    // ---------------------------------------------------------------------------------------------
    // 6. Interaction smoke test (only for entries flagged `interactive`)
    // ---------------------------------------------------------------------------------------------
    if (entry.interactive) {
      test('interaction', async ({page}, testInfo) => {
        const logs = collectConsole(page);
        await step(testInfo, name, 'interaction', async (ctx) => {
          await gotoAndHydrate(page, `/component/${encodeURIComponent(name)}`);
          await settleFrames(page, 2);
          logs.clear(); // only count what the interaction itself causes

          // First visible + enabled candidate (Playwright selectors pierce open shadow roots).
          const candidates = page.locator(section).locator(CLICK_TARGETS);
          const total = await candidates.count();
          ctx.metrics.candidates = total;
          let target;
          let label = '';
          for (let i = 0; i < Math.min(total, 25); i++) {
            const candidate = candidates.nth(i);
            if (!(await candidate.isVisible())) continue;
            if (!(await candidate.isEnabled())) continue;
            const disabled = await candidate.evaluate(
              (el) => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
            );
            if (disabled) continue;
            // Skip controls a user cannot click directly, e.g. sp-slider's native range input, which sits under the
            // handle (Playwright's trial click runs the actionability checks, including "receives events").
            const clickable = await candidate.click({trial: true, timeout: 1500}).then(
              () => true,
              () => false,
            );
            if (!clickable) continue;
            target = candidate;
            label = await candidate.evaluate((el) => `${el.localName}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`);
            break;
          }
          expect(target, `no visible, enabled clickable control (${CLICK_TARGETS}) in the section (${total} candidates)`).toBeDefined();
          ctx.metrics.clicked = label;

          await target!.click({timeout: 5000});
          await page.waitForTimeout(250);
          await settleFrames(page, 2);
          // The page must still be alive and scriptable after the click.
          expect(await page.evaluate(() => document.readyState), 'page alive after click').toBeTruthy();

          expectNone(logs.errors, `console errors / uncaught exceptions after clicking <${label}>`, {soft: false});
        });
      });
    }
  });
}

for (const entry of selectedEntries) registerComponentTests(entry);
