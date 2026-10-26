import {expect, test, type Browser, type Page, type TestInfo} from '@playwright/test';
import {awaitHydration, collectConsole, measureSection, sectionSelector, settleFrames, type HydrationReportLike, type Rect} from './helpers/browser.ts';
import {selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {settleTree} from './helpers/dom.ts';
import {errorMessage, recordResult, step, wasRecorded, type CheckName, type StepContext} from './helpers/results.ts';
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
 *                       - 0.2.2, the parent late: sp-menu (menu), sp-breadcrumbs (breadcrumbs), sp-table (table). The
 *                         children hydrate and restore their COMPLETE sheets while the parent runs on its minified CSS;
 *                         a third view, `state`, captures them after a state change the server did not render (an icon
 *                         and `disabled` / `focused` on menu items, `disabled` on a breadcrumb item, `active` /
 *                         `drop-target` on table head cells / rows), whose rules read names only the parent defines (the
 *                         minifier judged ownership from the trimmed texts and renamed them: the disabled menu-item icon
 *                         was black).
 *                       - sp-theme (table): `hydrateSpectrum()` must report the theme-pending warning (trimmed and
 *                         minified; not on the full page, nor for any other late tag). The selection checkbox cells are
 *                         part of the server output, so their required theme values are retained before hydration too.
 *                     All cases of one entry run in one test (one `styles-late` record per entry).
 *   app --mod- override  an application stylesheet customises sp-action-button through Spectrum's public `--mod-*` hooks.
 *                     Without the client (`?nohydrate=1`) and hydrated, the trimmed and the minified page equal the full page
 *                     (the minifier renamed every `--mod-*` a kept rule defines, so the app's override was ignored).
 *   no constructable stylesheets  spectrum-web-components-ssr/client's own feature test (`'replaceSync' in CSSStyleSheet.prototype`) is made
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

/** The `HydrationReport.warnings` entry of spectrum-web-components-ssr/client for a theme that has not upgraded (prefix). */
const THEME_PENDING_WARNING = 'theme pending: sp-theme not defined; trimmed/minified theme values incomplete';

interface ChildState {
  /** What `apply` changes (for the messages). */
  label: string;
  /**
   * Runs in the page while the late element is still undefined: changes state on its (defined, hydrated) children and
   * resolves with the number of elements it changed once they updated. Self-contained: Playwright serializes it.
   */
  apply: () => Promise<number>;
}

interface LateCase {
  entry: string;
  tag: string;
  /** State the children of the late (parent) element enter while it is missing: the `state` view (kept when it arrives). */
  childState?: ChildState;
  /** Views that must equal the full-CSS page (default: all). The others are measured and reported in the metrics. */
  compare?: readonly LateView[];
}

/**
 * Late `sp-menu` (0.2.2): a direct item gets an icon and `disabled`, another one `focused` - states no server item had,
 * so their rules are only in the item's complete sheet, which reads `--spectrum-menu-item-label-icon-color-disabled` and
 * the focus-indicator names only `sp-menu` / `sp-menu-group` define (0.2.1 renamed them: the disabled icon turned black).
 */
const MENU_CHILD_STATE: ChildState = {
  label: 'icon + disabled on the first direct sp-menu-item, focused on the third',
  apply: async () => {
    const items = Array.from(document.querySelectorAll('sp-menu > sp-menu-item')) as Array<HTMLElement & {updateComplete?: Promise<unknown>}>;
    const first = items[0];
    const third = items[2];
    if (!first || !third) return 0;
    const icon = document.createElement('sp-icon-edit') as HTMLElement & {updateComplete?: Promise<unknown>};
    icon.setAttribute('slot', 'icon');
    first.prepend(icon);
    first.setAttribute('disabled', '');
    third.setAttribute('focused', '');
    await Promise.all([first.updateComplete, third.updateComplete, icon.updateComplete]);
    return 2;
  },
};

/** Late `sp-breadcrumbs`: `disabled` on an item reads `--spectrum-breadcrumbs-text-color-disabled` (defined by the parent). */
const BREADCRUMBS_CHILD_STATE: ChildState = {
  label: 'disabled on the first sp-breadcrumb-item',
  apply: async () => {
    const item = document.querySelector('sp-breadcrumbs > sp-breadcrumb-item') as (HTMLElement & {updateComplete?: Promise<unknown>}) | null;
    if (!item) return 0;
    item.setAttribute('disabled', '');
    await item.updateComplete;
    return 1;
  },
};

/**
 * Late `sp-table`: its children have no `disabled`; `active` on a sortable head cell reads
 * `--spectrum-table-icon-color-active`, `drop-target` on a row `--spectrum-table-drop-zone-*` - names only `sp-table`
 * defines, read only by rules the trimmer dropped from the children's sheets.
 */
const TABLE_CHILD_STATE: ChildState = {
  label: 'active on the first sortable sp-table-head-cell, drop-target on the first sp-table-row',
  apply: async () => {
    const cell = document.querySelector('sp-table-head-cell[sortable]') as (HTMLElement & {updateComplete?: Promise<unknown>}) | null;
    const row = document.querySelector('sp-table-body > sp-table-row') as (HTMLElement & {updateComplete?: Promise<unknown>}) | null;
    if (!cell || !row) return 0;
    cell.setAttribute('active', '');
    row.setAttribute('drop-target', '');
    await Promise.all([cell.updateComplete, row.updateComplete]);
    return 2;
  },
};

const LATE_CASES: LateCase[] = [
  {entry: 'button', tag: 'sp-theme'},
  {entry: 'theme', tag: 'sp-theme'},
  {entry: 'tabs', tag: 'sp-tab'},
  {entry: 'menu', tag: 'sp-menu-item'},
  {entry: 'menu', tag: 'sp-menu', childState: MENU_CHILD_STATE},
  {entry: 'breadcrumbs', tag: 'sp-breadcrumbs', childState: BREADCRUMBS_CHILD_STATE},
  {entry: 'table', tag: 'sp-table-cell'},
  {entry: 'table', tag: 'sp-table', childState: TABLE_CHILD_STATE},
  {entry: 'table', tag: 'sp-theme'},
];

const LATE_VIEWS = ['missing', 'state', 'defined'] as const;
type LateView = (typeof LATE_VIEWS)[number];

const viewsOf = (c: LateCase): LateView[] => LATE_VIEWS.filter((view) => view !== 'state' || c.childState !== undefined);
const comparedViewsOf = (c: LateCase): LateView[] => viewsOf(c).filter((view) => !c.compare || c.compare.includes(view));

interface LateLoad {
  shots: Partial<Record<LateView, Buffer>>;
  clips: Partial<Record<LateView, Rect>>;
  report: HydrationReportLike;
  errors: string[];
  /** `customElements.get(tag)` was undefined after hydration, defined after `__swcSsrDefineLate()`. */
  heldBack: boolean;
  definedLate: boolean;
  /** Elements `childState.apply` changed (0: it found nothing to change). */
  changed: number;
  /** Shadow-root styles once the definition arrived and settled. */
  styles: ShadowStyles;
}

/**
 * One load of the case's entry page in `mode`, captured while the tag is missing, after the child state (if any), and
 * after it was defined.
 */
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
    const clips: Partial<Record<LateView, Rect>> = {};
    const shots: Partial<Record<LateView, Buffer>> = {};
    const capture = async (view: LateView): Promise<void> => {
      const clip = reference?.clips[view] ?? (await measureSection(page, root)).clip;
      clips[view] = clip;
      shots[view] = await page.screenshot({clip, ...options});
    };
    await capture('missing');
    let changed = 0;
    if (c.childState) {
      changed = await page.evaluate(c.childState.apply);
      await settled(page, root);
      await capture('state');
    }

    await page.evaluate(() => (window as unknown as {__swcSsrDefineLate?: () => Promise<number>}).__swcSsrDefineLate?.());
    await settled(page, root);
    const definedLate = await page.evaluate((tag) => customElements.get(tag) !== undefined, c.tag);
    await capture('defined');
    const styles = await page.evaluate(collectShadowStyles);
    return {shots, clips, report, errors: [...logs.errors], heldBack, definedLate, changed, styles};
  } finally {
    await context.close();
  }
}

/**
 * One late case: full, trimmed and minified loads, repeated (fresh loads, up to `ATTEMPTS` in all) while a compared
 * view differs. Preconditions and leftovers are asserted here; returns the pixel problems (empty when the case passes).
 */
async function runLateCase(browser: Browser, baseURL: string | undefined, c: LateCase, ctx: StepContext): Promise<string[]> {
  const key = c.tag;
  const views = viewsOf(c);
  const compared = comparedViewsOf(c);
  const fulls: LateLoad[] = [await lateLoad(browser, baseURL, c, 'full')];
  const others: Record<Mode, LateLoad[]> = {trimmed: [], minified: []};
  for (const mode of MODES) others[mode].push(await lateLoad(browser, baseURL, c, mode, fulls[0]));

  const shot = (load: LateLoad, view: LateView): Buffer => load.shots[view]!;
  const failing = (): Array<{mode: Mode; view: LateView}> =>
    MODES.flatMap((mode) =>
      compared
        .filter((view) => !matchesAnywhere(fulls.map((load) => shot(load, view)), others[mode].map((load) => shot(load, view))))
        .map((view) => ({mode, view})),
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
  ctx.metrics[`attempts_${key}`] = fulls.length;
  let firstPixels = 0;
  for (const {mode, view} of firstFailing) firstPixels += exactDiff(shot(fulls[0]!, view), shot(others[mode][0]!, view)).diffPixels;
  ctx.metrics[`diffPixelsFirstAttempt_${key}`] = firstPixels;
  if (firstFailing.length > 0 && pending.length === 0) {
    ctx.note(
      `late ${c.tag}: ${firstFailing.map(({mode, view}) => `${mode} ${view}`).join(', ')} differed (${firstPixels} px) on the first ` +
        'attempt and matched later: load-to-load variation',
    );
  }
  // Views measured but not required to match (a known limitation): reported, not failed.
  for (const view of views.filter((candidate) => !compared.includes(candidate))) {
    for (const mode of MODES) {
      ctx.metrics[`uncomparedPixels_${key}_${view}_${mode}`] = exactDiff(shot(fulls[0]!, view), shot(others[mode][0]!, view)).diffPixels;
    }
  }

  // The case is only meaningful when the definition really was missing after hydration and arrived later.
  for (const [label, loads] of [['full', fulls], ...MODES.map((mode) => [mode, others[mode]] as const)] as const) {
    const load = loads[0]!;
    expect(load.heldBack, `${label}: <${c.tag}> is still undefined after hydrateSpectrum() (?late=${c.tag})`).toBe(true);
    expect(load.definedLate, `${label}: <${c.tag}> is defined after __swcSsrDefineLate()`).toBe(true);
    if (c.childState) expect(load.changed, `${label}: ${c.childState.label} found its elements`).toBeGreaterThan(0);
    expectNone(load.report.errors, `HydrationReport.errors (${label}, late ${c.tag})`);
    expectNone(load.errors, `console errors / uncaught exceptions (${label}, late ${c.tag})`);
    // 0.2.2: hydrateSpectrum() reports a theme still on its trimmed / minified server CSS - and only then.
    const themeWarnings = load.report.warnings.filter((warning) => warning.startsWith(THEME_PENDING_WARNING));
    const expectWarning = c.tag === 'sp-theme' && label !== 'full';
    if (expectWarning) ctx.metrics[`themeWarning_${key}_${label}`] = themeWarnings.length;
    expect(
      themeWarnings.length,
      `${label}, late ${c.tag}: HydrationReport.warnings ${expectWarning ? 'reports' : 'does not report'} "${THEME_PENDING_WARNING}" ` +
        `(warnings: ${JSON.stringify(load.report.warnings)})`,
    ).toBe(expectWarning ? 1 : 0);
  }
  for (const mode of MODES) {
    const styles = others[mode][0]!.styles;
    ctx.metrics[`markedLeft_${key}_${mode}`] = styles.marked;
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
    const diff = exactDiff(shot(fulls[0]!, view), shot(others[mode][0]!, view));
    const control = fulls[1] ? exactDiff(shot(fulls[0]!, view), shot(fulls[1], view)).diffPixels : 0;
    failingPixels += diff.diffPixels;
    const files = saveMismatch(`${c.entry}.late-${c.tag}.${view}`, mode, {full: shot(fulls[0]!, view), other: shot(others[mode][0]!, view), diff: diff.diffPng});
    const what = view === 'missing' ? 'not defined yet' : view === 'state' ? `not defined yet, ${c.childState!.label}` : 'defined late';
    problems.push(
      `${mode}, <${c.tag}> ${what}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s)` +
        `${diff.sizeChanged ? ` (size ${diff.a.width}x${diff.a.height} full / ${diff.b.width}x${diff.b.height} ${mode})` : ''} ` +
        `(control, full CSS loaded twice: ${control} px; ${files.join(', ')})`,
    );
  }
  ctx.metrics[`diffPixels_${key}`] = failingPixels;
  return problems;
}

// One test per catalog entry, its cases in a row: one `styles-late` record per entry (the summary keeps one result per
// entry and check, so a later passing case must not hide an earlier failing one).
const lateEntries = [...new Set(LATE_CASES.map((c) => c.entry))].filter(selected);
for (const entry of lateEntries) {
  const cases = LATE_CASES.filter((c) => c.entry === entry);
  test.describe(`styles: ${entry}`, () => {
    test.describe.configure({timeout: TEST_TIMEOUT_MS * cases.length});
    test.afterEach(async ({}, testInfo) => recordFallback(entry, 'styles-late', testInfo));

    test(`late definition: ${cases.map((c) => c.tag).join(', ')}`, async ({browser}, testInfo) => {
      await step(testInfo, entry, 'styles-late', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        ctx.metrics.lateTags = cases.map((c) => c.tag).join(',');
        const problems: string[] = [];
        let diffPixels = 0;
        for (const c of cases) {
          problems.push(...(await runLateCase(browser, baseURL, c, ctx)));
          diffPixels += Number(ctx.metrics[`diffPixels_${c.tag}`] ?? 0);
        }
        ctx.metrics.diffPixels = diffPixels;
        expect(problems, 'with a definition held back until after hydration, the trimmed / minified page differs from the full-CSS page').toEqual([]);
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
// Without constructable stylesheets (as far as spectrum-web-components-ssr/client can tell)
// ---------------------------------------------------------------------------------------------

/**
 * Hides `CSSStyleSheet.prototype.replaceSync` from `in` (spectrum-web-components-ssr/client's feature test) while every sheet Lit creates
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
  /** spectrum-web-components-ssr/client's feature test failed in the page (the case is meaningful). */
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
    // Repainted like the final capture (tests/styles.spec.ts `heldStage`: raster noise after the theme upgraded).
    await forceRepaint(page);
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
