import {expect, test, type Browser, type Page, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, measureSection, sectionSelector, settleFrames, type HydrationReportLike, type Rect} from './helpers/browser.ts';
import {selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {settleTree} from './helpers/dom.ts';
import {errorMessage, recordResult, step, wasRecorded, type CheckName} from './helpers/results.ts';
import {
  collectShadowStyles,
  exactDiff,
  forceRepaint,
  newOracleContext,
  saveMismatch,
  SETTLE_MS,
  type ShadowStyles,
  type StylesMode,
} from './helpers/styles.ts';

/**
 * Regression tests of the 0.2.1 fixes of the optional style trimming (docs/API.md "Styles", docs/DESIGN.md "Style
 * trimming"). Every comparison is pixel-exact against the full-CSS page in the same state (pixelmatch threshold 0,
 * anti-aliased pixels counted, byte-identical decoded images), repeated with fresh loads like tests/styles.spec.ts.
 *
 *   late definition   `?late=<tag>` (demo/src/client.ts) holds the definition of <tag> back until after
 *                     `hydrateSpectrum()` finished. The trimmed and the minified page are captured (a) `missing`: hydrated,
 *                     <tag> still undefined - the state of an application that never defines it - and (b) `defined`: the
 *                     definition arrived and its elements hydrated on their own. Both must equal the full-CSS page in the
 *                     same state (0 px); afterwards no marked server `<style>` is left and every hydrated sp-* Lit element
 *                     runs on adopted sheets.
 *                       - sp-theme (button, theme): the server `<style>` of a theme that has not upgraded must stay (it was
 *                         removed with the bridges: the page lost its theme), and minified elements must keep their
 *                         minified CSS while that theme defines only the renamed names.
 *                       - sp-tab (tabs), sp-menu-item (menu), sp-table-cell (table): a parent's restoration must not take
 *                         away the custom properties its not-yet-defined children read (the minifier renamed names one
 *                         element class defines and another reads; the client removed the parent's minified `<style>`).
 *   app --mod- override  an application stylesheet customises sp-action-button through Spectrum's public `--mod-*` hooks.
 *                     Without the client (`?nohydrate=1`) and hydrated, the trimmed and the minified page equal the full page
 *                     (the minifier renamed every `--mod-*` a kept rule defines, so the app's override was ignored).
 *   no constructable stylesheets  swc-ssr/client's own feature test (`'replaceSync' in CSSStyleSheet.prototype`) is made
 *                     to fail while Lit and Spectrum keep working (`NO_CSSOM_INIT`), so the client takes its path for
 *                     browsers without constructable stylesheets (the server `<style>` gets the complete text). Held
 *                     before `hydrateSpectrum()` (`<sp-theme>` upgraded, nothing hydrated) and hydrated, the trimmed and
 *                     the minified page equal the full page: the theme bridge is a plain `<style>` and must not depend on
 *                     that feature test (it did: the minified page lost its theme while held).
 *
 * Narrowed like the other specs (SWC_SSR_COMPONENTS / SWC_SSR_SMOKE): a case runs when its catalog entry is selected.
 */

/** How often a capture that differs is repeated in all (page reloads included); see styles.spec.ts `matchesAnywhere`. */
const ATTEMPTS = 3;
const TEST_TIMEOUT_MS = 240_000;
const MODES = ['trimmed', 'minified'] as const;
type Mode = (typeof MODES)[number];

const selected = (name: string): boolean => selectedEntries.some((entry) => entry.name === name);

const identical = (a: Buffer, b: Buffer): boolean => {
  const diff = exactDiff(a, b);
  return diff.diffPixels === 0 && diff.identical;
};

/** Some capture of the one list is pixel-identical to some capture of the other (see styles.spec.ts `matchesAnywhere`). */
const matchesAnywhere = (as: readonly Buffer[], bs: readonly Buffer[]): boolean => as.some((a) => bs.some((b) => identical(a, b)));

/** Records a failure of a test whose step did not record (timeout, crash), so that it shows in the summary. */
function recordFallback(row: string, check: CheckName, testInfo: TestInfo): void {
  if (wasRecorded(row, check) || testInfo.status === 'passed' || testInfo.status === 'skipped') return;
  recordResult({
    component: row,
    check,
    status: 'fail',
    note: testInfo.status === 'timedOut' ? 'test timed out' : errorMessage(testInfo.error?.message ?? 'failed'),
  });
}

async function settled(page: Page, root: string): Promise<void> {
  await page.locator(root).evaluate(settleTree, {timeoutMs: 5000});
  await settleFrames(page, 2);
  await page.waitForTimeout(SETTLE_MS);
  await forceRepaint(page);
}

// ---------------------------------------------------------------------------------------------
// Late definitions
// ---------------------------------------------------------------------------------------------

interface LateCase {
  entry: string;
  tag: string;
}

const LATE_CASES: LateCase[] = [
  {entry: 'button', tag: 'sp-theme'},
  {entry: 'theme', tag: 'sp-theme'},
  {entry: 'tabs', tag: 'sp-tab'},
  {entry: 'menu', tag: 'sp-menu-item'},
  {entry: 'table', tag: 'sp-table-cell'},
];

const LATE_VIEWS = ['missing', 'defined'] as const;
type LateView = (typeof LATE_VIEWS)[number];

interface LateLoad {
  shots: Record<LateView, Buffer>;
  clips: Record<LateView, Rect>;
  report: HydrationReportLike;
  errors: string[];
  /** `customElements.get(tag)` was undefined after hydration, defined after `__swcSsrDefineLate()`. */
  heldBack: boolean;
  definedLate: boolean;
  /** Shadow-root styles once the definition arrived and settled. */
  styles: ShadowStyles;
}

/** One load of the case's entry page in `mode`, captured while the tag is missing and after it was defined. */
async function lateLoad(browser: Browser, baseURL: string | undefined, c: LateCase, mode: StylesMode, reference?: LateLoad): Promise<LateLoad> {
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = `/component/${c.entry}?late=${c.tag}&styles=${mode}`;
    const response = await page.goto(url, {timeout: 30_000});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    const root = sectionSelector(c.entry);
    // hydrateSpectrum() waits for the missing definition (its timeout, then a warning) and hydrates the rest.
    const report = await awaitHydration(page, 60_000);
    await settled(page, root);
    const heldBack = await page.evaluate((tag) => customElements.get(tag) === undefined, c.tag);
    const options = {fullPage: true, animations: 'disabled', caret: 'hide'} as const;
    const clips = {} as Record<LateView, Rect>;
    const shots = {} as Record<LateView, Buffer>;
    clips.missing = reference?.clips.missing ?? (await measureSection(page, root)).clip;
    shots.missing = await page.screenshot({clip: clips.missing, ...options});

    await page.evaluate(() => (window as unknown as {__swcSsrDefineLate?: () => Promise<number>}).__swcSsrDefineLate?.());
    await settled(page, root);
    const definedLate = await page.evaluate((tag) => customElements.get(tag) !== undefined, c.tag);
    clips.defined = reference?.clips.defined ?? (await measureSection(page, root)).clip;
    shots.defined = await page.screenshot({clip: clips.defined, ...options});
    const styles = await page.evaluate(collectShadowStyles);
    return {shots, clips, report, errors: [...logs.errors], heldBack, definedLate, styles};
  } finally {
    await context.close();
  }
}

for (const c of LATE_CASES.filter((candidate) => selected(candidate.entry))) {
  test.describe(`styles: ${c.entry}`, () => {
    test.describe.configure({timeout: TEST_TIMEOUT_MS});
    test.afterEach(async ({}, testInfo) => recordFallback(c.entry, 'styles-late', testInfo));

    test(`late definition: ${c.tag}`, async ({browser}, testInfo) => {
      await step(testInfo, c.entry, 'styles-late', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        ctx.metrics.lateTag = c.tag;
        const fulls: LateLoad[] = [await lateLoad(browser, baseURL, c, 'full')];
        const others: Record<Mode, LateLoad[]> = {trimmed: [], minified: []};
        for (const mode of MODES) others[mode].push(await lateLoad(browser, baseURL, c, mode, fulls[0]));

        const failing = (): Array<{mode: Mode; view: LateView}> =>
          MODES.flatMap((mode) =>
            LATE_VIEWS.filter(
              (view) => !matchesAnywhere(fulls.map((load) => load.shots[view]), others[mode].map((load) => load.shots[view])),
            ).map((view) => ({mode, view})),
          );
        const firstFailing = failing();
        let pending = firstFailing;
        for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
          fulls.push(await lateLoad(browser, baseURL, c, 'full', fulls[0]));
          for (const mode of MODES) {
            if (pending.some((pair) => pair.mode === mode)) others[mode].push(await lateLoad(browser, baseURL, c, mode, fulls[0]));
          }
          pending = failing();
        }
        ctx.metrics.attempts = fulls.length;
        let firstPixels = 0;
        for (const {mode, view} of firstFailing) firstPixels += exactDiff(fulls[0]!.shots[view], others[mode][0]!.shots[view]).diffPixels;
        ctx.metrics.diffPixelsFirstAttempt = firstPixels;
        if (firstFailing.length > 0 && pending.length === 0) {
          ctx.note(`${firstFailing.map(({mode, view}) => `${mode} ${view}`).join(', ')} differed (${firstPixels} px) on the first attempt and matched later: load-to-load variation`);
        }

        // The case is only meaningful when the definition really was missing after hydration and arrived later.
        for (const [label, loads] of [['full', fulls], ...MODES.map((mode) => [mode, others[mode]] as const)] as const) {
          const load = loads[0]!;
          expect(load.heldBack, `${label}: <${c.tag}> is still undefined after hydrateSpectrum() (?late=${c.tag})`).toBe(true);
          expect(load.definedLate, `${label}: <${c.tag}> is defined after __swcSsrDefineLate()`).toBe(true);
          expectNone(load.report.errors, `HydrationReport.errors (${label})`);
          expectNone(load.errors, `console errors / uncaught exceptions (${label})`);
        }
        for (const mode of MODES) {
          const styles = others[mode][0]!.styles;
          ctx.metrics[`markedLeft_${mode}`] = styles.marked;
          expectNone(
            Object.entries(styles.markedByTag).map(([tag, count]) => `${tag} x${count}`),
            `${mode}: shadow roots that still hold a trimmed / minified server <style> after <${c.tag}> was defined`,
          );
          expectNone(
            Object.entries(styles.litWithoutAdopted).map(([tag, count]) => `${tag} x${count}`),
            `${mode}: hydrated sp-* Lit elements without adopted style sheets after <${c.tag}> was defined`,
          );
        }

        const problems: string[] = [];
        let failingPixels = 0;
        for (const {mode, view} of pending) {
          const diff = exactDiff(fulls[0]!.shots[view], others[mode][0]!.shots[view]);
          const control = fulls[1] ? exactDiff(fulls[0]!.shots[view], fulls[1].shots[view]).diffPixels : 0;
          failingPixels += diff.diffPixels;
          const files = saveMismatch(`${c.entry}.late-${c.tag}.${view}`, mode, {full: fulls[0]!.shots[view], other: others[mode][0]!.shots[view], diff: diff.diffPng});
          problems.push(
            `${mode}, <${c.tag}> ${view === 'missing' ? 'not defined yet' : 'defined late'}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s)` +
              `${diff.sizeChanged ? ` (size ${diff.a.width}x${diff.a.height} full / ${diff.b.width}x${diff.b.height} ${mode})` : ''} ` +
              `(control, full CSS loaded twice: ${control} px; ${files.join(', ')})`,
          );
        }
        ctx.metrics.diffPixels = failingPixels;
        expect(problems, `with <${c.tag}> defined after hydration, the trimmed / minified page differs from the full-CSS page`).toEqual([]);
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Application overrides through --mod-*
// ---------------------------------------------------------------------------------------------

const MOD_ENTRY = 'action-button';
/** What an application stylesheet does to customise Spectrum: set the component's public `--mod-*` hooks. */
const APP_CSS =
  'sp-action-button { --mod-actionbutton-background-color-default: rgb(255, 0, 0); --mod-actionbutton-content-color-default: rgb(0, 128, 0); }';
const MOD_VIEWS = ['static', 'hydrated'] as const;
type ModView = (typeof MOD_VIEWS)[number];

interface ModLoad {
  shot: Buffer;
  clip: Rect;
  /** Computed background of the first plain sp-action-button (proves that the override applies). */
  background: string;
  report?: HydrationReportLike;
  errors: string[];
}

async function modLoad(browser: Browser, baseURL: string | undefined, mode: StylesMode, view: ModView, reference?: ModLoad): Promise<ModLoad> {
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = `/component/${MOD_ENTRY}?${view === 'static' ? 'nohydrate=1&' : ''}styles=${mode}`;
    const response = await page.goto(url, {timeout: 30_000});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    await page.addStyleTag({content: APP_CSS});
    const root = sectionSelector(MOD_ENTRY);
    const report = view === 'hydrated' ? await awaitHydration(page) : undefined;
    await settled(page, root);
    const background = await page.evaluate(() => {
      const button = document.querySelector('sp-action-button:not([quiet]):not([selected]):not([emphasized]):not([disabled])');
      return button ? getComputedStyle(button).backgroundColor : 'no plain sp-action-button';
    });
    const clip = reference?.clip ?? (await measureSection(page, root)).clip;
    const shot = await page.screenshot({clip, fullPage: true, animations: 'disabled', caret: 'hide'});
    return {shot, clip, background, report, errors: [...logs.errors]};
  } finally {
    await context.close();
  }
}

if (selected(MOD_ENTRY)) {
  test.describe(`styles: ${MOD_ENTRY}`, () => {
    test.describe.configure({timeout: TEST_TIMEOUT_MS});
    test.afterEach(async ({}, testInfo) => recordFallback(MOD_ENTRY, 'styles-app-mod', testInfo));

    test('app --mod-* override', async ({browser}, testInfo) => {
      await step(testInfo, MOD_ENTRY, 'styles-app-mod', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const problems: string[] = [];
        let failingPixels = 0;
        for (const view of MOD_VIEWS) {
          const fulls: ModLoad[] = [await modLoad(browser, baseURL, 'full', view)];
          const others: Record<Mode, ModLoad[]> = {trimmed: [], minified: []};
          for (const mode of MODES) others[mode].push(await modLoad(browser, baseURL, mode, view, fulls[0]));
          const failing = (): Mode[] =>
            MODES.filter((mode) => !matchesAnywhere(fulls.map((load) => load.shot), others[mode].map((load) => load.shot)));
          let pending = failing();
          for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
            fulls.push(await modLoad(browser, baseURL, 'full', view, fulls[0]));
            for (const mode of pending) others[mode].push(await modLoad(browser, baseURL, mode, view, fulls[0]));
            pending = failing();
          }
          ctx.metrics[`attempts_${view}`] = fulls.length;
          // The override reaches the component on the full page (else the comparison proves nothing).
          expect(fulls[0]!.background, `${view}: the app's --mod-* override applies with the full CSS`).toBe('rgb(255, 0, 0)');
          for (const mode of MODES) {
            const load = others[mode][0]!;
            ctx.metrics[`background_${mode}_${view}`] = load.background;
            expectNone(load.errors, `console errors / uncaught exceptions (${mode}, ${view})`);
            if (load.report) expectNone(load.report.errors, `HydrationReport.errors (${mode}, ${view})`);
          }
          for (const mode of pending) {
            const diff = exactDiff(fulls[0]!.shot, others[mode][0]!.shot);
            failingPixels += diff.diffPixels;
            const files = saveMismatch(`${MOD_ENTRY}.app-mod.${view}`, mode, {full: fulls[0]!.shot, other: others[mode][0]!.shot, diff: diff.diffPng});
            problems.push(
              `${mode} ${view === 'static' ? 'without the client' : 'hydrated'}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s) ` +
                `(background of a plain sp-action-button: ${others[mode][0]!.background}, full: ${fulls[0]!.background}; ${files.join(', ')})`,
            );
          }
        }
        ctx.metrics.diffPixels = failingPixels;
        expect(problems, 'an application stylesheet that sets --mod-* hooks renders differently on the trimmed / minified page').toEqual([]);
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Without constructable stylesheets (as far as swc-ssr/client can tell)
// ---------------------------------------------------------------------------------------------

/**
 * Hides `CSSStyleSheet.prototype.replaceSync` from `in` (swc-ssr/client's feature test) while every sheet Lit creates
 * still has it (an own property): Lit's own test (`'replace' in CSSStyleSheet.prototype`) still passes, so Lit and
 * Spectrum's `<sp-theme>` (which has no fallback) keep adopting their sheets.
 */
const NO_CSSOM_INIT = `(() => {
  const Native = CSSStyleSheet;
  const replaceSync = Native.prototype.replaceSync;
  delete Native.prototype.replaceSync;
  function Sheet(...args) {
    const sheet = Reflect.construct(Native, args, new.target ?? Sheet);
    Object.defineProperty(sheet, 'replaceSync', {value: replaceSync, configurable: true, writable: true});
    return sheet;
  }
  Sheet.prototype = Native.prototype;
  Object.defineProperty(globalThis, 'CSSStyleSheet', {value: Sheet, configurable: true, writable: true});
})();`;

const NO_CSSOM_ENTRIES = ['button', 'tabs'];
const NO_CSSOM_VIEWS = ['interim', 'final'] as const;
type NoCssomView = (typeof NO_CSSOM_VIEWS)[number];

interface NoCssomLoad {
  shots: Record<NoCssomView, Buffer>;
  clips: Record<NoCssomView, Rect>;
  report: HydrationReportLike;
  errors: string[];
  /** swc-ssr/client's feature test failed in the page (the case is meaningful). */
  hidden: boolean;
  styles: ShadowStyles;
}

async function noCssomLoad(browser: Browser, baseURL: string | undefined, entry: string, mode: StylesMode, reference?: NoCssomLoad): Promise<NoCssomLoad> {
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  try {
    await context.addInitScript({content: NO_CSSOM_INIT});
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = `/component/${entry}?hydrateDelay=hold&styles=${mode}`;
    const response = await page.goto(url, {timeout: 30_000});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    await page.waitForFunction(() => (window as unknown as {__swcSsrDefined?: boolean}).__swcSsrDefined === true, undefined, {timeout: 30_000});
    const root = sectionSelector(entry);
    await settleFrames(page, 2);
    await page.waitForTimeout(SETTLE_MS);
    const hidden = await page.evaluate(() => !('replaceSync' in CSSStyleSheet.prototype) && typeof new CSSStyleSheet().replaceSync === 'function');
    const options = {fullPage: true, animations: 'disabled', caret: 'hide'} as const;
    const clips = {} as Record<NoCssomView, Rect>;
    const shots = {} as Record<NoCssomView, Buffer>;
    clips.interim = reference?.clips.interim ?? (await measureSection(page, root)).clip;
    shots.interim = await page.screenshot({clip: clips.interim, ...options});
    await page.evaluate(() => (window as unknown as {__swcSsrRelease?: () => void}).__swcSsrRelease?.());
    const report = await awaitHydration(page);
    await settled(page, root);
    clips.final = reference?.clips.final ?? (await measureSection(page, root)).clip;
    shots.final = await page.screenshot({clip: clips.final, ...options});
    const styles = await page.evaluate(collectShadowStyles);
    return {shots, clips, report, errors: [...logs.errors], hidden, styles};
  } finally {
    await context.close();
  }
}

for (const entry of NO_CSSOM_ENTRIES.filter(selected)) {
  test.describe(`styles: ${entry}`, () => {
    test.describe.configure({timeout: TEST_TIMEOUT_MS});
    test.afterEach(async ({}, testInfo) => recordFallback(entry, 'styles-no-cssom', testInfo));

    test('without constructable stylesheets', async ({browser}, testInfo) => {
      await step(testInfo, entry, 'styles-no-cssom', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const fulls: NoCssomLoad[] = [await noCssomLoad(browser, baseURL, entry, 'full')];
        const others: Record<Mode, NoCssomLoad[]> = {trimmed: [], minified: []};
        for (const mode of MODES) others[mode].push(await noCssomLoad(browser, baseURL, entry, mode, fulls[0]));
        const failing = (): Array<{mode: Mode; view: NoCssomView}> =>
          MODES.flatMap((mode) =>
            NO_CSSOM_VIEWS.filter(
              (view) => !matchesAnywhere(fulls.map((load) => load.shots[view]), others[mode].map((load) => load.shots[view])),
            ).map((view) => ({mode, view})),
          );
        let pending = failing();
        for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
          fulls.push(await noCssomLoad(browser, baseURL, entry, 'full', fulls[0]));
          for (const mode of MODES) {
            if (pending.some((pair) => pair.mode === mode)) others[mode].push(await noCssomLoad(browser, baseURL, entry, mode, fulls[0]));
          }
          pending = failing();
        }
        ctx.metrics.attempts = fulls.length;
        for (const [label, loads] of [['full', fulls], ...MODES.map((mode) => [mode, others[mode]] as const)] as const) {
          const load = loads[0]!;
          expect(load.hidden, `${label}: the client's constructable-stylesheet test fails in the page`).toBe(true);
          expectNone(load.report.errors, `HydrationReport.errors (${label})`);
          expectNone(load.errors, `console errors / uncaught exceptions (${label})`);
        }
        for (const mode of MODES) {
          const styles = others[mode][0]!.styles;
          ctx.metrics[`markedLeft_${mode}`] = styles.marked;
          expectNone(
            Object.entries(styles.markedByTag).map(([tag, count]) => `${tag} x${count}`),
            `${mode}: shadow roots that still hold a trimmed / minified server <style> after hydration`,
          );
        }
        const problems: string[] = [];
        let failingPixels = 0;
        for (const {mode, view} of pending) {
          const diff = exactDiff(fulls[0]!.shots[view], others[mode][0]!.shots[view]);
          failingPixels += diff.diffPixels;
          const files = saveMismatch(`${entry}.no-cssom.${view}`, mode, {full: fulls[0]!.shots[view], other: others[mode][0]!.shots[view], diff: diff.diffPng});
          problems.push(`${mode} ${view === 'interim' ? 'held (theme upgraded, nothing hydrated)' : 'hydrated'}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s) (${files.join(', ')})`);
        }
        ctx.metrics.diffPixels = failingPixels;
        expect(problems, 'without constructable stylesheets the trimmed / minified page differs from the full-CSS page').toEqual([]);
      });
    });
  });
}
