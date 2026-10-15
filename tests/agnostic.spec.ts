import {expect, test, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, sectionSelector, settleFrames} from './helpers/browser.ts';
import {selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {collectDeferredHydration, settleTree} from './helpers/dom.ts';
import {errorMessage, recordResult, step, wasRecorded, type CheckName} from './helpers/results.ts';
import {AGNOSTIC_ROW} from './helpers/summary.ts';

/**
 * The framework-agnostic hydration path (`hydrateSpectrum(root)` without a template, what an Angular / plain-HTML
 * page uses; the demo's `?agnostic=1`) on `<overlay-trigger>` (`overlay/overlay-trigger.js`), a Spectrum custom
 * element without the `sp-` prefix. The server renders it with `defer-hydration` like every other element; the
 * client must enable it, count it in `hydratedCount` and not list it in `deferred`. Recorded as the
 * `agnostic: overlay-trigger` row of the "Pages" table. Runs when `overlay-trigger` is selected (always without filters).
 */

const NAME = 'overlay-trigger';
const ROW = AGNOSTIC_ROW;
const URL = `/component/${NAME}?agnostic=1`;
const section = sectionSelector(NAME);

const CHECK_BY_TITLE: Record<string, CheckName> = {
  'agnostic hydration of overlay-trigger': 'hydration',
  'agnostic overlay-trigger opens on click': 'interaction',
};

/** In-page census of the custom elements below `#app` (light DOM and open shadow roots), by hydration state. */
function census(app: Element): {hydrated: number; hydratedNonSp: number; triggers: number; triggersHydrated: number} {
  const RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri',
    'font-face-format', 'font-face-name', 'missing-glyph']);
  const all: Element[] = [];
  const visit = (el: Element): void => {
    all.push(el);
    if (el.shadowRoot) for (const child of Array.from(el.shadowRoot.children)) visit(child);
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(app);
  const isHydrated = (el: Element): boolean => {
    const name = el.localName;
    if (!name.includes('-') || RESERVED.has(name)) return false;
    const ctor = customElements.get(name);
    return ctor !== undefined && el instanceof ctor && el.shadowRoot !== null && !el.hasAttribute('defer-hydration');
  };
  const hydrated = all.filter(isHydrated);
  const triggers = all.filter((el) => el.localName === 'overlay-trigger');
  return {
    hydrated: hydrated.length,
    hydratedNonSp: hydrated.filter((el) => !el.localName.startsWith('sp-')).length,
    triggers: triggers.length,
    triggersHydrated: triggers.filter(isHydrated).length,
  };
}

const selected = selectedEntries.some((entry) => entry.name === NAME);

test.describe(ROW, () => {
  test.skip(!selected, `${NAME} is not selected (SWC_SSR_COMPONENTS / SWC_SSR_SMOKE)`);

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

  test('agnostic hydration of overlay-trigger', async ({page}, testInfo) => {
    const logs = collectConsole(page);
    await step(testInfo, ROW, 'hydration', async (ctx) => {
      const response = await page.goto(URL);
      expect(response?.status(), `GET ${URL} status`).toBe(200);
      const report = await awaitHydration(page);
      await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
      const counts = await page.locator('#app').evaluate(census);
      const deferredInDom = await page.evaluate(collectDeferredHydration);
      ctx.metrics.hydratedCount = report.hydratedCount;
      ctx.metrics.overlayTriggers = counts.triggers;
      ctx.metrics.hydratedNonSp = counts.hydratedNonSp;

      expect(counts.triggers, 'overlay-trigger elements on the page').toBeGreaterThan(0);
      expectNone(report.deferred, 'HydrationReport.deferred (elements still carrying defer-hydration)');
      expectNone(deferredInDom, 'elements still carrying defer-hydration in the DOM');
      expect.soft(counts.triggersHydrated, 'overlay-trigger elements upgraded, enabled, with a shadow root').toBe(
        counts.triggers,
      );
      // hydratedCount counts every hydrated custom element, not only sp-* ones: equal to the in-page census.
      expect.soft(report.hydratedCount, 'HydrationReport.hydratedCount equals the hydrated custom elements on the page').toBe(
        counts.hydrated,
      );
      expectNone(report.errors, 'HydrationReport.errors');
      expectNone(logs.errors, 'console errors / uncaught exceptions during load');
    });
  });

  test('agnostic overlay-trigger opens on click', async ({page}, testInfo) => {
    const logs = collectConsole(page);
    await step(testInfo, ROW, 'interaction', async (ctx) => {
      await page.goto(URL);
      const report = await awaitHydration(page);
      await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
      await settleFrames(page, 2);
      expectNone(report.errors, 'HydrationReport.errors', {soft: false});
      logs.clear();

      // An overlay-trigger that was never enabled would not react: its slotchange listeners and click overlay only
      // exist once it has hydrated.
      const trigger = page.locator(section).locator('overlay-trigger[triggered-by="click"]').first();
      await trigger.locator('[slot="trigger"]').click({timeout: 5000});
      await expect(trigger, 'overlay-trigger reflects open="click" after clicking its trigger').toHaveAttribute(
        'open',
        'click',
        {timeout: 5000},
      );
      ctx.metrics.open = (await trigger.getAttribute('open')) ?? '';
      expectNone(logs.errors, 'console errors / uncaught exceptions after the click');
    });
  });
});
