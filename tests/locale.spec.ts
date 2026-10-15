import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type Page, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, sectionSelector} from './helpers/browser.ts';
import {selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {unifiedDiff} from './helpers/diff.ts';
import {collectDeferredHydration, serializeTree, settleTree} from './helpers/dom.ts';
import {extractSection} from './helpers/html.ts';
import {errorMessage, FIDELITY_DIR, recordResult, step, wasRecorded, type CheckName} from './helpers/results.ts';
import {LOCALE_ROW} from './helpers/summary.ts';

/**
 * Locale: `/component/number-field` server-rendered with `renderSpectrum({lang})` (RenderSpectrumOptions.lang). The
 * demo server takes the language from `?lang=` or the request's `Accept-Language` and writes it to `<html lang>` too,
 * where the client's components resolve their locale from (`reactive-controllers/src/LanguageResolution.js` via
 * `<sp-theme>`), so server markup and hydrated page format numbers alike:
 *  - ssr: German number formatting in the server markup (`?lang=de`, and `Accept-Language: de-DE,...`);
 *  - hydration: no errors / mismatch recoveries / deferred elements, German values after hydration;
 *  - fidelity: the hydrated SSR section equals the client-rendered one (`/csr/number-field?lang=de`).
 * Recorded as the `locale: number-field` row of the "Pages" table. Runs when `number-field` is selected.
 */

const NAME = 'number-field';
const ROW = LOCALE_ROW;
const LANG = 'de';
const SSR_URL = `/component/${NAME}?lang=${LANG}`;
const CSR_URL = `/csr/${NAME}?lang=${LANG}`;
const section = sectionSelector(NAME);

/**
 * Values of the catalog entry (demo/src/catalog/number-field.ts) as `Intl.NumberFormat` formats them, de vs en.
 * Computed here rather than hard-coded, so ICU data differences between Node and Chromium do not matter for the
 * en-vs-de distinction (the server runs in Node, the client in Chromium; both use full ICU).
 */
const fmt = (lang: string, value: number, options: Intl.NumberFormatOptions = {}): string =>
  new Intl.NumberFormat(lang, options).format(value);
const EXPECTED_DE = [fmt(LANG, 1024), fmt(LANG, 0.5, {signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 2})];
const UNEXPECTED_EN = [fmt('en', 1024), fmt('en', 0.5, {signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 2})];

const CHECK_BY_TITLE: Record<string, CheckName> = {
  'locale ssr markup': 'ssr',
  'locale hydration': 'hydration',
  'locale fidelity': 'fidelity',
};

/** `value` attributes of the number fields' inputs in raw server HTML (declarative shadow roots included). */
function inputValues(html: string): string[] {
  return [...html.matchAll(/<input\b[^>]*\bvalue="([^"]*)"/g)].map((match) => match[1]!.replace(/&nbsp;| /g, ' '));
}

/** Live `.value` of every number field's input on the page. */
async function liveValues(page: Page): Promise<string[]> {
  return page.locator(section).evaluate((root) =>
    Array.from(root.querySelectorAll('sp-number-field')).map(
      (field) => (field.shadowRoot?.querySelector('input') as HTMLInputElement | null)?.value ?? '<no input>',
    ),
  );
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

  test('locale ssr markup', async ({request}, testInfo) => {
    await step(testInfo, ROW, 'ssr', async (ctx) => {
      // ?lang=
      const res = await request.get(`${SSR_URL}&nohydrate=1`);
      expect(res.status(), `GET ${SSR_URL}&nohydrate=1 status`).toBe(200);
      const html = await res.text();
      expect(html, 'the page language is written to <html lang>').toContain(`<html lang="${LANG}">`);
      const values = inputValues(extractSection(html, NAME) ?? '');
      ctx.metrics.values = values.join(' | ');
      for (const expected of EXPECTED_DE) {
        expect.soft(values, `server markup formats ${expected} for lang=${LANG}`).toContain(expected);
      }
      for (const unexpected of UNEXPECTED_EN) {
        expect.soft(values, `server markup must not format ${unexpected} (en) for lang=${LANG}`).not.toContain(unexpected);
      }

      // Accept-Language (the most preferred language)
      const viaHeader = await request.get(`/component/${NAME}?nohydrate=1`, {
        headers: {'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'},
      });
      const headerHtml = await viaHeader.text();
      expect.soft(headerHtml, 'Accept-Language: de-DE,... -> <html lang="de-DE">').toContain('<html lang="de-DE">');
      const headerValues = inputValues(extractSection(headerHtml, NAME) ?? '');
      ctx.metrics.acceptLanguageValues = headerValues.join(' | ');
      expect.soft(headerValues, 'Accept-Language: de-DE formats like de').toContain(EXPECTED_DE[0]!);
    });
  });

  test('locale hydration', async ({page}, testInfo) => {
    const logs = collectConsole(page);
    await step(testInfo, ROW, 'hydration', async (ctx) => {
      await page.goto(SSR_URL);
      const report = await awaitHydration(page);
      await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
      const values = await liveValues(page);
      ctx.metrics.hydratedCount = report.hydratedCount;
      ctx.metrics.values = values.join(' | ');
      expectNone(report.errors, 'HydrationReport.errors');
      expectNone(report.deferred, 'HydrationReport.deferred (elements still carrying defer-hydration)');
      expectNone(await page.evaluate(collectDeferredHydration), 'elements still carrying defer-hydration in the DOM');
      expectNone(logs.errors, 'console errors / uncaught exceptions during load (incl. hydration mismatch recoveries)');
      for (const expected of EXPECTED_DE) {
        expect.soft(values, `hydrated page shows ${expected}`).toContain(expected);
      }
    });
  });

  test('locale fidelity', async ({page}, testInfo) => {
    await step(testInfo, ROW, 'fidelity', async (ctx) => {
      await page.goto(SSR_URL);
      await awaitHydration(page);
      await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
      const ssrTree = await page.locator(section).evaluate(serializeTree, {});

      await page.goto(CSR_URL);
      await awaitHydration(page);
      await page.locator(section).evaluate(settleTree, {timeoutMs: 5000});
      const csrTree = await page.locator(section).evaluate(serializeTree, {});

      const files = [`${NAME}-lang-${LANG}.ssr.txt`, `${NAME}-lang-${LANG}.csr.txt`];
      if (ssrTree === csrTree) {
        for (const file of files) fs.rmSync(path.join(FIDELITY_DIR, file), {force: true});
        return;
      }
      fs.mkdirSync(FIDELITY_DIR, {recursive: true});
      fs.writeFileSync(path.join(FIDELITY_DIR, files[0]!), ssrTree + '\n');
      fs.writeFileSync(path.join(FIDELITY_DIR, files[1]!), csrTree + '\n');
      const diff = unifiedDiff(ssrTree, csrTree, {labelA: `ssr (${SSR_URL})`, labelB: `csr (${CSR_URL})`, maxChangedLines: 40});
      ctx.metrics.diffRemoved = diff.removed;
      ctx.metrics.diffAdded = diff.added;
      throw new Error(
        `hydrated DOM (lang=${LANG}) differs from the client-rendered DOM (-${diff.removed}/+${diff.added} lines; ` +
          `full trees in tests/results/fidelity/${files[0]} and ${files[1]})\n${diff.text}`,
      );
    });
  });
});
