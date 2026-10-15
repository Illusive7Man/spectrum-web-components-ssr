import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, measureSection, sectionSelector, settleFrames} from './helpers/browser.ts';
import {selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {settleTree} from './helpers/dom.ts';
import {diffPngs, installClsCollector, readCls} from './helpers/flicker.ts';
import {errorMessage, recordResult, SCREENSHOT_DIR, step, wasRecorded, type CheckName} from './helpers/results.ts';
import {mobileRow} from './helpers/summary.ts';
import {CLS_MAX, FLICKER_MAX, PIXEL_THRESHOLD} from './helpers/thresholds.ts';

/**
 * Phones. The server's `matchMedia()` never matches, so components with a `MatchMediaController`
 * (`reactive-controllers/src/MatchMedia.js`: `sp-picker`, `sp-action-menu`, `sp-contextual-help`) are rendered in
 * their desktop state. On a touch phone `IS_MOBILE` matches from the first client render on, so without the client
 * adapters (swc-ssr/client `hooks.ts`, "MatchMediaController") the hydrating render differs from the server markup.
 * This spec loads those components with a phone emulation and checks:
 *  - the emulation really matches Spectrum's `IS_MOBILE` query (otherwise the test proves nothing);
 *  - hydration: no HydrationReport errors, no console errors (the client logs every mismatch recovery with
 *    console.error: "[swc-ssr] <tag> hydration mismatch ..."), nothing left deferred;
 *  - flicker: screenshots before (client bundle blocked) and after hydration, pixel diff + CLS;
 *  - after hydration the components are in their mobile state (`isMobile.matches` restored, `mobile-view` on the
 *    action menu's sp-menu, `type="modal"` / `aria-haspopup="dialog"` in sp-contextual-help), and tapping a picker
 *    opens it in an `sp-tray` - what a client-rendered picker does.
 * The picker showcase includes the deprecated `<sp-picker><sp-menu>` markup, which renders the (closed) overlay right
 * away: the server renders `sp-popover`, a phone's first client render `sp-tray` - a structural mismatch that, without
 * the adapters, makes hydrate() throw and the picker re-render from scratch ("hydration mismatch" console.error).
 * Results go to the "Mobile" table of tests/results/summary.md. The SWC_SSR_COMPONENTS / SWC_SSR_SMOKE filters apply.
 */

const VIEWPORT = {width: 390, height: 844};
test.use({
  viewport: VIEWPORT,
  screen: VIEWPORT,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
});

/** `IS_MOBILE` from `reactive-controllers/src/MatchMedia.js`. */
const IS_MOBILE = '(max-width: 743px) and (hover: none) and (pointer: coarse)';

/** Components whose render depends on a MatchMediaController (see the client adapters). */
const MOBILE_COMPONENTS: Record<string, {hosts: string; tapOpensTray?: string}> = {
  picker: {hosts: 'sp-picker', tapOpensTray: 'sp-picker:not([disabled]):not([readonly])'},
  'action-menu': {hosts: 'sp-action-menu', tapOpensTray: 'sp-action-menu:not([disabled])'},
  'contextual-help': {hosts: 'sp-contextual-help'},
};

const CHECK_BY_TITLE: Record<string, CheckName> = {
  'mobile hydration and flicker': 'hydration',
  'mobile tap opens a tray': 'interaction',
};

function writeScreenshot(file: string, data: Buffer): string {
  fs.mkdirSync(SCREENSHOT_DIR, {recursive: true});
  const target = path.join(SCREENSHOT_DIR, file);
  fs.writeFileSync(target, data);
  return path.relative(process.cwd(), target).replace(/\\/g, '/');
}

const names = selectedEntries.map((entry) => entry.name).filter((name) => name in MOBILE_COMPONENTS);

for (const name of names) {
  const {hosts, tapOpensTray} = MOBILE_COMPONENTS[name]!;
  const row = mobileRow(name);
  const section = sectionSelector(name);
  const url = `/component/${encodeURIComponent(name)}`;

  test.describe(row, () => {
    test.afterEach(async ({}, testInfo: TestInfo) => {
      const check = CHECK_BY_TITLE[testInfo.title];
      if (!check || wasRecorded(row, check)) return;
      if (testInfo.status === 'passed' || testInfo.status === 'skipped') return;
      recordResult({
        component: row,
        check,
        status: 'fail',
        note: testInfo.status === 'timedOut' ? 'test timed out' : errorMessage(testInfo.error?.message ?? 'failed'),
      });
    });

    test('mobile hydration and flicker', async ({page}, testInfo) => {
      const logs = collectConsole(page);
      await step(testInfo, row, 'hydration', async (ctx) => {
        const bundle = '**/dist/client.js';
        await installClsCollector(page);
        await page.route(bundle, (route) => route.abort('blockedbyclient'));
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await settleFrames(page, 1);

        const isMobile = await page.evaluate((query) => matchMedia(query).matches, IS_MOBILE);
        expect(isMobile, `the phone emulation must match Spectrum's IS_MOBILE query ${IS_MOBILE}`).toBe(true);

        const before = await measureSection(page, section);
        const beforePng = await page.screenshot({clip: before.clip, fullPage: true, animations: 'disabled', caret: 'hide'});

        // Same as the desktop flicker check: a cache-busting query, because a module URL that failed once stays failed.
        await page.unroute(bundle);
        await page.addScriptTag({url: '/dist/client.js?late=1', type: 'module'});
        const report = await awaitHydration(page);
        await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
        await settleFrames(page, 2);

        const after = await measureSection(page, section);
        const afterPng = await page.screenshot({clip: after.clip, fullPage: true, animations: 'disabled', caret: 'hide'});
        const diff = diffPngs(beforePng, afterPng, {threshold: PIXEL_THRESHOLD});
        ctx.metrics.screenshotBefore = writeScreenshot(`${name}-mobile-before.png`, beforePng);
        ctx.metrics.screenshotAfter = writeScreenshot(`${name}-mobile-after.png`, afterPng);
        writeScreenshot(`${name}-mobile-diff.png`, diff.diffPng);
        const cls = await readCls(page);

        // The components must be in their mobile state once hydration is over.
        const state = await page.locator(section).evaluate((root, selector) => {
          const elements = Array.from(root.querySelectorAll(selector)) as Array<HTMLElement & {isMobile?: {matches?: boolean}}>;
          return {
            count: elements.length,
            notMobile: elements.filter((el) => el.isMobile?.matches !== true).map((el) => el.localName),
            pinned: elements
              .filter((el) => el.isMobile && Object.getOwnPropertyDescriptor(el.isMobile, 'matches')?.get !== undefined)
              .map((el) => el.localName),
            menusWithoutMobileView: elements
              .filter((el) => el.localName === 'sp-action-menu')
              .filter((el) => !el.shadowRoot?.querySelector('sp-menu')?.hasAttribute('mobile-view'))
              .map((el) => el.localName),
            // contextual-help/src/ContextualHelp.js renders these attributes from isMobile; hydration never writes
            // attributes, so without the adapter the server's desktop values would stay.
            helpWithoutMobileAttributes: elements
              .filter((el) => el.localName === 'sp-contextual-help')
              .filter(
                (el) =>
                  el.shadowRoot?.querySelector('sp-overlay')?.getAttribute('type') !== 'modal' ||
                  el.shadowRoot?.querySelector('#trigger')?.getAttribute('aria-haspopup') !== 'dialog',
              )
              .map((el) => el.localName),
          };
        }, hosts);

        ctx.metrics.hydratedCount = report.hydratedCount;
        ctx.metrics.ratio = diff.ratio;
        ctx.metrics.diffPixels = diff.diffPixels;
        ctx.metrics.cls = cls;
        ctx.metrics.hosts = state.count;
        // The blocked bundle request itself is logged as "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT".
        const consoleErrors = logs.errors.filter((message) => !/ERR_BLOCKED_BY_CLIENT/.test(message));
        ctx.metrics.consoleErrors = consoleErrors.length;

        expect(state.count, `no <${hosts}> in the section`).toBeGreaterThan(0);
        expectNone(report.errors, 'HydrationReport.errors');
        expectNone(report.deferred, 'HydrationReport.deferred (elements still carrying defer-hydration)');
        expectNone(
          consoleErrors.filter((message) => /hydration mismatch/i.test(message)),
          'hydration mismatch recoveries (console.error)',
        );
        expectNone(consoleErrors, 'console errors / uncaught exceptions during load');
        expectNone(state.notMobile, 'components not in their mobile state after hydration (isMobile.matches !== true)');
        expectNone(state.pinned, 'components whose isMobile.matches is still pinned after hydration');
        expectNone(state.menusWithoutMobileView, 'sp-action-menu without mobile-view on its sp-menu after hydration');
        expectNone(
          state.helpWithoutMobileAttributes,
          'sp-contextual-help without type="modal" overlay / aria-haspopup="dialog" trigger after hydration',
        );
        expect.soft(
          diff.ratio,
          `${diff.diffPixels}/${diff.totalPixels} px differ between SSR and hydrated paint (max ${(FLICKER_MAX * 100).toFixed(3)} %)`,
        ).toBeLessThan(FLICKER_MAX);
        expect.soft(cls, 'cumulative layout shift (window.__cls)').toBeLessThan(CLS_MAX);
      });
    });

    if (tapOpensTray) {
      test('mobile tap opens a tray', async ({page}, testInfo) => {
        const logs = collectConsole(page);
        await step(testInfo, row, 'interaction', async (ctx) => {
          await page.goto(url);
          const report = await awaitHydration(page);
          await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
          await settleFrames(page, 2);
          expectNone(report.errors, 'HydrationReport.errors', {soft: false});
          logs.clear();

          const host = page.locator(section).locator(tapOpensTray).first();
          await host.locator('#button').tap({timeout: 5000});
          // The picker renders its overlay (sp-tray on phones, sp-popover otherwise) once it is opened.
          const tray = host.locator('sp-tray');
          await expect(tray, `tapping <${hosts}> opens its menu in an sp-tray`).toHaveCount(1, {timeout: 5000});
          ctx.metrics.popovers = await host.locator('sp-popover').count();
          ctx.metrics.screenshot = writeScreenshot(`${name}-mobile-open.png`, await page.screenshot({animations: 'disabled'}));
          expectNone(logs.errors, 'console errors / uncaught exceptions after tapping');
        });
      });
    }
  });
}
