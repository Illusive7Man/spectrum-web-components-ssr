import {expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {awaitHydration, collectConsole, measureSection, sectionSelector, settleFrames, type Rect} from './helpers/browser.ts';
import {selectedEntries, smokeNames, type TestEntry} from './helpers/catalog.ts';
import {FIRST_FRAME_OBSERVER, linkedHrefs, preloadHrefs, readFirstFrames, serverStylesLeft, type FirstFrames} from './helpers/dedupe.ts';
import {settleTree} from './helpers/dom.ts';
import {step, type StepContext} from './helpers/results.ts';
import {
  applyStates,
  clearStates,
  collectShadowStyles,
  exactDiff,
  forceRepaint,
  newOracleContext,
  saveMismatch,
  SETTLE_MS,
  STATE_GROUPS,
} from './helpers/styles.ts';

/**
 * `renderSpectrum({styles: {dedupe: 'link'}})` (swc-ssr 0.3.0, docs/API.md "Styles"): every distinct stylesheet text is
 * served once (`/swc-css/<hash>.css`, immutable) and the declarative shadow roots link to it instead of carrying a
 * `<style>` copy; the page's `<head>` preloads the URLs. The demo serves it as `?dedupe=link` (with `?styles=full`,
 * `trimmed` or `minified`) and `?hints=preload|not-all|none` (what `<head>` announces). Per entry of the smoke set (or the
 * entries `SWC_SSR_COMPONENTS` names):
 *
 *   styles-dedupe        no client (`nohydrate=1`): `?styles=<mode>&dedupe=link` equals `?styles=full` (0 px) for full,
 *                        trimmed and minified, both repainted once before the capture (`forceRepaint`: a linked page
 *                        paints progressively, and Chromium then rasterizes a few anti-aliased corner pixels one colour
 *                        level differently until the next repaint - probed: action-button minified, 4 px in every load
 *                        without the repaint, 0 with it, 0 either way inline); after the load event every server link has
 *                        its sheet; the head preloads exactly the
 *                        linked URLs; every URL answers 200 `text/css` with `Cache-Control: public, max-age=31536000,
 *                        immutable` (an unknown hash 404); the HTML is smaller than the inline page
 *   styles-dedupe-post   JavaScript: the hydrated linked page (normal timing) equals the hydrated full page for full,
 *                        trimmed and minified, then again after each `STATE_GROUPS` group of attributes set on every sp-*
 *                        element (trimmed, minified); the held page (`?hydrateDelay=hold`: `<sp-theme>` upgraded, nothing
 *                        hydrated) and its release equal full; afterwards no `<link|style data-swc-styles>` is left in any
 *                        shadow root and every hydrated sp-* Lit element runs on adopted sheets
 *   styles-dedupe-paint  `SWC_SSR_DEDUPE_PAINT` entries (default button, picker, tabs): first frames over an emulated
 *                        150 ms round trip, cold cache and warm cache (a second load in the same context), with and
 *                        without head hints, without and with the client: no frame paints a host's content while one of
 *                        its server links has no sheet (`unstyled` = 0). Chromium waits in the parser at a pending
 *                        shadow-root `<link rel="stylesheet">` (as at an in-body one), so a cold load renders
 *                        progressively and its DOMContentLoaded comes later than the inline page's (recorded); Firefox
 *                        does not (measured with .probe/dedupe/first-frame.ts: unstyled frames even on a warm cache), which
 *                        is why the option is off by default (docs/DESIGN.md "Style de-duplication").
 *
 * Comparisons are pixel-exact like tests/styles.spec.ts: a stage that differs is captured again with fresh loads (up to
 * `ATTEMPTS` in all) and only fails when no capture of the one equals a capture of the other. `SWC_SSR_DEDUPE=0` skips the
 * spec. The demo server must support `?dedupe=` / `?hints=` and serve `/swc-css/` (demo/src/styles-routes.ts); every test
 * skips itself (with that reason) against a server that does not (`requireDedupeServer`).
 */

const ATTEMPTS = 3;
const ENTRY_TIMEOUT_MS = 300_000;
const PAINT_TIMEOUT_MS = 300_000;
const NAV_TIMEOUT_MS = 30_000;
/** Round trip added to every request in `styles-dedupe-paint` (Chromium network emulation; the cache still works). */
const PAINT_LATENCY_MS = 150;

const enabled = process.env.SWC_SSR_DEDUPE !== '0';
const narrowedToComponents = (process.env.SWC_SSR_COMPONENTS ?? '').trim() !== '';
const entries: TestEntry[] = narrowedToComponents ? selectedEntries : selectedEntries.filter((entry) => smokeNames.includes(entry.name));
const paintNames = (process.env.SWC_SSR_DEDUPE_PAINT ?? 'button,picker,tabs')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

type Mode = 'full' | 'trimmed' | 'minified';
const LINK_MODES: readonly Mode[] = ['full', 'trimmed', 'minified'];

const pathOf = (name: string): string => `/component/${encodeURIComponent(name)}`;
const query = (mode: Mode, dedupe: boolean, extra: string[] = []): string =>
  [`styles=${mode}`, ...(dedupe ? ['dedupe=link'] : []), ...extra].join('&');

/**
 * Skips the test when the demo server does not serve `?dedupe=` (demo/src/styles-routes.ts not mounted yet): a server
 * that does answers an unknown value with 400 (`parseDedupe`), one that does not ignores the parameter (200). A server
 * that accepts the parameter but stops linking still fails the checks.
 */
async function requireDedupeServer(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.get(`${pathOf(name)}?styles=full&dedupe=unknown-value&nohydrate=1`);
  test.skip(
    response.status() !== 400,
    `the demo server does not support ?dedupe= (GET ?dedupe=unknown-value answered ${response.status()}, not 400): mount demo/src/styles-routes.ts in demo/src/server.ts`,
  );
}

// ---------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------

type Kind = 'static' | 'hydrated' | 'held';

interface Capture {
  /** PNG per stage (`static`; `hydrated`, `states0`..; `interim`, `final`). */
  shots: Record<string, Buffer>;
  /** Clip per stage (document coordinates). */
  clips: Record<string, Rect>;
  left: ReturnType<typeof serverStylesLeft>;
  /** Hydrated sp-* Lit elements without adopted sheets, per tag. */
  litWithoutAdopted: Record<string, number>;
  errors: string[];
  hydrationErrors: string[];
  deferred: string[];
}

async function shot(page: Page, name: string, stage: string, capture: Capture, clips?: Record<string, Rect>): Promise<void> {
  const clip = clips?.[stage] ?? (await measureSection(page, sectionSelector(name))).clip;
  capture.clips[stage] = clip;
  capture.shots[stage] = await page.screenshot({clip, fullPage: true, animations: 'disabled', caret: 'hide'});
}

async function settle(page: Page, name: string): Promise<void> {
  await page.locator(sectionSelector(name)).evaluate(settleTree, {timeoutMs: 5000});
  await settleFrames(page, 2);
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * One load of `name` with `q`, captured at the stages of `kind` (`states`: also after each `STATE_GROUPS` group, on a
 * hydrated page); `clips` (the reference's) make both pages capture the same rectangles.
 */
async function capture(
  browser: Browser,
  baseURL: string | undefined,
  name: string,
  q: string,
  kind: Kind,
  clips?: Record<string, Rect>,
  states = false,
): Promise<Capture> {
  // JavaScript is on for Playwright's own evaluation (`forceRepaint`); a `static` page has no script (`nohydrate=1`).
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  const result: Capture = {shots: {}, clips: {}, left: {markedStyles: 0, links: 0, linksWithoutSheet: 0, tags: []}, litWithoutAdopted: {}, errors: [], hydrationErrors: [], deferred: []};
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = `${pathOf(name)}?${q}${kind === 'static' ? '&nohydrate=1' : kind === 'held' ? '&hydrateDelay=hold' : ''}`;
    const response = await page.goto(url, {timeout: NAV_TIMEOUT_MS});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    if (kind === 'static') {
      await page.waitForTimeout(SETTLE_MS);
      await forceRepaint(page);
      result.left = await page.evaluate(serverStylesLeft);
      await shot(page, name, 'static', result, clips);
      return result;
    }
    if (kind === 'held') {
      await page.waitForFunction(() => (window as unknown as {__swcSsrDefined?: boolean}).__swcSsrDefined === true, undefined, {timeout: NAV_TIMEOUT_MS});
      await settleFrames(page, 2);
      await page.waitForTimeout(SETTLE_MS);
      // Repainted like the other stages (tests/styles.spec.ts `heldStage`: the upgraded theme's subtree was repainted
      // and may carry an anti-aliased pixel one level off until the next repaint; theme page, minified: 1 px).
      await forceRepaint(page);
      await shot(page, name, 'interim', result, clips);
      await page.evaluate(() => (window as unknown as {__swcSsrRelease?: () => void}).__swcSsrRelease?.());
    }
    const report = await awaitHydration(page);
    result.hydrationErrors = report.errors;
    result.deferred = report.deferred;
    await settle(page, name);
    await forceRepaint(page);
    await shot(page, name, kind === 'held' ? 'final' : 'hydrated', result, clips);
    result.left = await page.evaluate(serverStylesLeft);
    result.litWithoutAdopted = (await page.evaluate(collectShadowStyles)).litWithoutAdopted;
    if (kind === 'hydrated' && states) {
      for (const [index, group] of STATE_GROUPS.entries()) {
        await applyStates(page, sectionSelector(name), group);
        await settle(page, name);
        await forceRepaint(page);
        await shot(page, name, `states${index}`, result, clips);
        await clearStates(page);
        await settle(page, name);
      }
    }
    result.errors = [...logs.errors];
    return result;
  } finally {
    await context.close();
  }
}

const identical = (a: Buffer | undefined, b: Buffer | undefined): boolean => {
  if (!a || !b) return false;
  const diff = exactDiff(a, b);
  return diff.diffPixels === 0 && diff.identical;
};

/**
 * Compares the stages of `other` with `reference`; stages that differ are captured again (both pages, fresh loads) up to
 * `ATTEMPTS` loads in all, and pass when some capture of the one equals some capture of the other. Returns the stages
 * that never matched with their pixel counts (first attempt) and writes their images.
 */
async function compareStages(
  label: string,
  references: Capture[],
  others: Capture[],
  recapture: () => Promise<{reference: Capture; other: Capture}>,
  ctx: StepContext,
): Promise<string[]> {
  const stages = Object.keys(references[0]!.shots);
  const matches = (stage: string): boolean =>
    references.some((reference) => others.some((other) => identical(reference.shots[stage], other.shots[stage])));
  let failing = stages.filter((stage) => !matches(stage));
  const firstFailing = [...failing];
  for (let attempt = 2; attempt <= ATTEMPTS && failing.length > 0; attempt++) {
    const again = await recapture();
    references.push(again.reference);
    others.push(again.other);
    failing = failing.filter((stage) => !matches(stage));
  }
  if (firstFailing.length > failing.length) {
    ctx.note(`${label}: ${firstFailing.length - failing.length} stage(s) matched only after a reload (raster noise)`);
  }
  const problems: string[] = [];
  for (const stage of failing) {
    const a = references[0]!.shots[stage];
    const b = others[0]!.shots[stage];
    if (!a || !b) {
      problems.push(`${stage}: not captured`);
      continue;
    }
    const diff = exactDiff(a, b);
    const files = saveMismatch(`${label}.${stage}`, 'link', {full: a, other: b, diff: diff.diffPng});
    problems.push(`${stage}: ${diff.diffPixels} px${diff.sizeChanged ? ' (size changed)' : ''} (${files[2]})`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// First frames
// ---------------------------------------------------------------------------------------------

interface PaintRun extends FirstFrames {
  /** /swc-css/ responses that came over the network (transferSize > 0). */
  cssFetched: number;
}

async function emulateLatency(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: PAINT_LATENCY_MS,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

async function paintLoad(context: BrowserContext, url: string, withClient: boolean): Promise<PaintRun> {
  const page = await context.newPage();
  try {
    await emulateLatency(context, page);
    const response = await page.goto(url, {timeout: NAV_TIMEOUT_MS * 2});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    if (withClient) await awaitHydration(page);
    await page.waitForTimeout(SETTLE_MS);
    const frames = await readFirstFrames(page);
    const cssFetched = await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter((entry) => entry.name.includes('/swc-css/') && (entry as PerformanceResourceTiming).transferSize > 0).length,
    );
    return {...frames, cssFetched};
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

test.describe('styles: dedupe link', () => {
  test.skip(!enabled, 'SWC_SSR_DEDUPE=0');
  test.describe.configure({timeout: ENTRY_TIMEOUT_MS});

  for (const entry of entries) {
    const name = entry.name;

    test(`dedupe:static ${name}`, async ({browser, baseURL, request}, testInfo) => {
      await requireDedupeServer(request, name);
      await step(testInfo, name, 'styles-dedupe', async (ctx) => {
        const problems: string[] = [];
        // Sizes, URLs, caching, head hints.
        for (const mode of LINK_MODES) {
          const inlineHtml = await (await request.get(`${pathOf(name)}?${query(mode, false, ['nohydrate=1'])}`)).text();
          const linkResponse = await request.get(`${pathOf(name)}?${query(mode, true, ['nohydrate=1'])}`);
          expect(linkResponse.status(), `${mode}: link page status`).toBe(200);
          const linkHtml = await linkResponse.text();
          const hrefs = linkedHrefs(linkHtml);
          const distinct = [...new Set(hrefs)];
          ctx.metrics[`html_${mode}`] = Buffer.byteLength(inlineHtml);
          ctx.metrics[`htmlLink_${mode}`] = Buffer.byteLength(linkHtml);
          ctx.metrics[`links_${mode}`] = hrefs.length;
          ctx.metrics[`sheets_${mode}`] = distinct.length;
          if (hrefs.length === 0) problems.push(`${mode}: no <link data-swc-styles> in the page (is ?dedupe=link wired?)`);
          if (Buffer.byteLength(linkHtml) >= Buffer.byteLength(inlineHtml)) {
            problems.push(`${mode}: link page ${Buffer.byteLength(linkHtml)} B is not smaller than the inline page ${Buffer.byteLength(inlineHtml)} B`);
          }
          const preloads = preloadHrefs(linkHtml);
          if (preloads.join('\n') !== distinct.join('\n')) {
            problems.push(`${mode}: head preloads ${preloads.length} URL(s), the shadow roots link ${distinct.length} (order of first use)`);
          }
          let cssBytes = 0;
          for (const href of distinct) {
            const css = await request.get(href);
            const headers = css.headers();
            if (css.status() !== 200) problems.push(`${href}: status ${css.status()}`);
            if (!/^text\/css\b/.test(headers['content-type'] ?? '')) problems.push(`${href}: content-type ${headers['content-type']}`);
            const cacheControl = headers['cache-control'] ?? '';
            if (!/\bimmutable\b/.test(cacheControl) || !/\bmax-age=31536000\b/.test(cacheControl)) {
              problems.push(`${href}: cache-control "${cacheControl}"`);
            }
            cssBytes += (await css.body()).length;
          }
          ctx.metrics[`linkedCss_${mode}`] = cssBytes;
        }
        const unknown = await request.get('/swc-css/AAAAAAAAAAAAAAAA.css');
        if (unknown.status() !== 404) problems.push(`unknown hash: status ${unknown.status()} (expected 404)`);

        // Pixels, no JavaScript.
        const reference = await capture(browser, baseURL, name, query('full', false), 'static');
        for (const mode of LINK_MODES) {
          const other = await capture(browser, baseURL, name, query(mode, true), 'static', reference.clips);
          if (other.left.links === 0) problems.push(`${mode}: no server link in the shadow roots`);
          if (other.left.linksWithoutSheet > 0) {
            problems.push(`${mode}: ${other.left.linksWithoutSheet} link(s) without a sheet after the load event (${other.left.tags.join(', ')})`);
          }
          const failed = await compareStages(`dedupe.${name}.${mode}`, [reference], [other], async () => ({
            reference: await capture(browser, baseURL, name, query('full', false), 'static', reference.clips),
            other: await capture(browser, baseURL, name, query(mode, true), 'static', reference.clips),
          }), ctx);
          ctx.metrics[`diff_${mode}`] = failed.length;
          problems.push(...failed.map((text) => `${mode} vs full, no JS: ${text}`));
        }
        expect(problems, problems.join('; ')).toEqual([]);
      });
    });

    test(`dedupe:post ${name}`, async ({browser, baseURL, request}, testInfo) => {
      await requireDedupeServer(request, name);
      await step(testInfo, name, 'styles-dedupe-post', async (ctx) => {
        const problems: string[] = [];
        const checkLeft = (mode: string, c: Capture) => {
          if (c.left.links > 0 || c.left.markedStyles > 0) {
            problems.push(`${mode}: ${c.left.links} server link(s) / ${c.left.markedStyles} marked style(s) left after hydration (${c.left.tags.join(', ')})`);
          }
          const missing = Object.entries(c.litWithoutAdopted);
          if (missing.length > 0) problems.push(`${mode}: hydrated Lit elements without adopted sheets: ${missing.map(([tag, n]) => `${tag} x${n}`).join(', ')}`);
          if (c.hydrationErrors.length > 0) problems.push(`${mode}: hydration errors: ${c.hydrationErrors.slice(0, 2).join(' | ')}`);
          if (c.deferred.length > 0) problems.push(`${mode}: deferred after hydration: ${c.deferred.slice(0, 4).join(', ')}`);
          if (c.errors.length > 0) problems.push(`${mode}: console errors: ${c.errors.slice(0, 2).join(' | ')}`);
        };
        // Normal timing, then the state groups (trimmed / minified); full + link: hydrated only.
        const referenceStates = await capture(browser, baseURL, name, query('full', false), 'hydrated', undefined, true);
        const referenceHydrated: Capture = {...referenceStates, shots: {hydrated: referenceStates.shots.hydrated!}};
        for (const mode of LINK_MODES) {
          const reference = mode === 'full' ? referenceHydrated : referenceStates;
          const other = await capture(browser, baseURL, name, query(mode, true), 'hydrated', reference.clips, mode !== 'full');
          checkLeft(`${mode} hydrated`, other);
          const failed = await compareStages(`dedupe-post.${name}.${mode}`, [reference], [other], async () => {
            const again = await capture(browser, baseURL, name, query('full', false), 'hydrated', reference.clips, mode !== 'full');
            return {
              reference: again,
              other: await capture(browser, baseURL, name, query(mode, true), 'hydrated', reference.clips, mode !== 'full'),
            };
          }, ctx);
          ctx.metrics[`diffHydrated_${mode}`] = failed.length;
          problems.push(...failed.map((text) => `${mode} hydrated vs full: ${text}`));
        }
        // Held: every element defined, <sp-theme> upgraded, nothing hydrated; then released.
        const heldReference = await capture(browser, baseURL, name, query('full', false), 'held');
        for (const mode of ['trimmed', 'minified'] as const) {
          const other = await capture(browser, baseURL, name, query(mode, true), 'held', heldReference.clips);
          checkLeft(`${mode} held`, other);
          const failed = await compareStages(`dedupe-held.${name}.${mode}`, [heldReference], [other], async () => ({
            reference: await capture(browser, baseURL, name, query('full', false), 'held', heldReference.clips),
            other: await capture(browser, baseURL, name, query(mode, true), 'held', heldReference.clips),
          }), ctx);
          ctx.metrics[`diffHeld_${mode}`] = failed.length;
          problems.push(...failed.map((text) => `${mode} held vs full: ${text}`));
        }
        expect(problems, problems.join('; ')).toEqual([]);
      });
    });
  }

  for (const entry of entries.filter((candidate) => paintNames.includes(candidate.name))) {
    const name = entry.name;
    test(`dedupe:paint ${name}`, async ({browser, baseURL, browserName, request}, testInfo) => {
      test.skip(browserName !== 'chromium', 'network emulation and the measured parser behaviour are Chromium\'s');
      test.setTimeout(PAINT_TIMEOUT_MS);
      await requireDedupeServer(request, name);
      await step(testInfo, name, 'styles-dedupe-paint', async (ctx) => {
        const problems: string[] = [];
        const newContext = async (): Promise<BrowserContext> => {
          const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
          await context.addInitScript(FIRST_FRAME_OBSERVER);
          return context;
        };
        const absolute = (q: string): string => new URL(`${pathOf(name)}?${q}`, baseURL).toString();
        for (const mode of ['trimmed', 'minified'] as const) {
          // The inline page at the same latency (no server links: unstyled is 0 by construction; its timings are the baseline).
          {
            const context = await newContext();
            try {
              const inline = await paintLoad(context, absolute(query(mode, false, ['nohydrate=1'])), false);
              ctx.metrics[`${mode}_inline_fcp`] = inline.fcp;
              ctx.metrics[`${mode}_inline_dcl`] = inline.dcl;
            } finally {
              await context.close();
            }
          }
          for (const hints of ['preload', 'none'] as const) {
            for (const withClient of [false, true]) {
              const context = await newContext();
              try {
                const url = absolute(query(mode, true, [`hints=${hints}`, ...(withClient ? [] : ['nohydrate=1'])]));
                for (const cache of ['cold', 'warm'] as const) {
                  const run = await paintLoad(context, url, withClient);
                  const key = `${mode}_${hints}_${withClient ? 'js' : 'nojs'}_${cache}`;
                  ctx.metrics[`${key}_unstyled`] = run.unstyledFrames;
                  ctx.metrics[`${key}_partial`] = run.partialFrames;
                  ctx.metrics[`${key}_fcp`] = run.fcp;
                  ctx.metrics[`${key}_dcl`] = run.dcl;
                  ctx.metrics[`${key}_cssFetched`] = run.cssFetched;
                  if (run.unstyledFrames > 0) {
                    problems.push(`${key}: ${run.unstyledFrames} frame(s) painted content without its sheet (${run.unstyledTags.join(', ')})`);
                  }
                  if (cache === 'warm' && run.cssFetched > 0) problems.push(`${key}: ${run.cssFetched} stylesheet(s) fetched again on a warm cache`);
                  if (cache === 'cold' && run.cssFetched === 0) problems.push(`${key}: no stylesheet fetched on a cold cache`);
                }
              } finally {
                await context.close();
              }
            }
          }
        }
        expect(problems, problems.join('; ')).toEqual([]);
      });
    });
  }
});
