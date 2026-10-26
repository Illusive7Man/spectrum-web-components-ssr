import {expect, test, type Browser, type Page, type TestInfo} from '@playwright/test';
import {PNG} from 'pngjs';
import {
  awaitHydration,
  collectConsole,
  measureSection,
  sectionSelector,
  settleFrames,
  type HydrationReportLike,
  type Rect,
} from './helpers/browser.ts';
import {allEntries, selectedEntries} from './helpers/catalog.ts';
import {expectNone} from './helpers/checks.ts';
import {collectDeferredHydration, settleTree} from './helpers/dom.ts';
import {diffPngs, installClsCollector, readCls} from './helpers/flicker.ts';
import {errorMessage, recordResult, step, wasRecorded, type CheckName, type Metrics, type StepContext} from './helpers/results.ts';
import {
  applyDomStep,
  applyStates,
  clearStates,
  collectShadowStyles,
  exactDiff,
  fetchStylesInfo,
  forceRepaint,
  installNavigationGuard,
  kib,
  newOracleContext,
  ORACLE_VIEWPORT,
  pageUrl,
  POST_STEPS,
  saveMismatch,
  SETTLE_MS,
  STATE_GROUPS,
  type PostStep,
  type ShadowStyles,
  type StylesMode,
  type StylesTarget,
} from './helpers/styles.ts';
import {STYLES_PAGE_ROW} from './helpers/summary.ts';
import {CLS_MAX, FLICKER_MAX, LAYOUT_TOLERANCE_PX, PIXEL_THRESHOLD} from './helpers/thresholds.ts';

/**
 * The oracle for `renderSpectrum({styles: {mode: 'trimmed'}})` (docs/API.md "Styles"): the trimmed CSS must render
 * exactly like the full CSS, so every check compares pixels, with nothing forgiven (pixelmatch threshold 0, anti-aliased
 * pixels counted, byte-identical decoded images). Per catalog entry and for the whole-catalog page `/`:
 *
 *   oracle            no JavaScript: `?styles=trimmed` vs `?styles=full`, same viewport, same clip, 0 differing pixels
 *   oracle:minified   the same for `?styles=minified` (trimmed + minifyCustomProperties)
 *   oracle:states     no JavaScript, interactive entries: hover, then focus, the first visible control, full vs trimmed
 *   hydration:trimmed `?styles=trimmed` and `?styles=minified` hydrate without errors / deferred elements, and their flicker
 *                     (pure-SSR paint vs hydrated paint) stays under the normal threshold (or the full CSS's own flicker)
 *   hydration:restore the hydrated trimmed / minified page is pixel-identical to the hydrated full-CSS page, at three
 *                     moments: every element defined but none hydrated (`<sp-theme>` has replaced its server styles,
 *                     the elements still run on their trimmed ones), after hydration, and after states the server did
 *                     not render were set on every sp-* element (selected, quiet, invalid, checked, disabled, ...);
 *                     afterwards no `<style data-swc-styles>` is left in an sp-* shadow root. This is what broke in
 *                     minified mode: Lit's hydration support adopts no stylesheets, so a hydrated element kept its
 *                     trimmed server CSS (no rules for new states; renamed theme properties that `<sp-theme>` drops
 *                     when it upgrades) - spectrum-web-components-ssr/client now gives marked elements their complete stylesheets back
 *   post-hydration    the same at normal timing (`hydrateSpectrum()` right after the definitions, what the demo does):
 *                     after `window.__swcSsrHydration` the trimmed and the minified page each equal the hydrated full-CSS
 *                     page (0 px); no `<style data-swc-styles>` is left in any shadow root and every hydrated sp-* Lit
 *                     element runs on adopted sheets (`adoptedStyleSheets.length > 0`)
 *   post-hydration:states  interactive entries, after hydration: hover, focus and click the first control, then set
 *                     `disabled` on it, `size="xl"` on the first sp-button / sp-action-button, toggle `quiet`, select the
 *                     first sp-menu-item / sp-tab, set `invalid` on the first text field (each awaited through
 *                     `updateComplete`): every step of the trimmed and the minified page equals the full-CSS page (0 px)
 *   removeServerStyles `removeStyles=1` (`hydrateSpectrum({removeServerStyles: true})`) on a full-CSS and on a trimmed
 *                     page: no `<style>` left in any sp-* shadow root after hydration, the paint equals the full-CSS page
 *   size              CSS bytes (full / trimmed / minified) through GET /styles.json; trimmed must be smaller
 *
 * A comparison that differs is repeated (pages reloaded, up to `ATTEMPTS` times) and only fails when no capture of the
 * one equals a capture of the other: see `matchesAnywhere` for why (raster noise, the server's first render).
 *
 * Every check records into the results store; tests/results/summary.md gets a "Styles" section and a CSS column.
 * Mismatching images are written to tests/results/styles/. `/` is skipped under SWC_SSR_COMPONENTS / SWC_SSR_SMOKE
 * unless SWC_SSR_STYLES_PAGE=1 (SWC_SSR_STYLES_PAGE=0 skips it always).
 */

const ENTRY_TEST_TIMEOUT_MS = 120_000;
/** `/` is large (the whole catalog): generous bounds for rendering, loading, hydrating and screenshotting it. */
const PAGE_TEST_TIMEOUT_MS = 900_000;
const PAGE_NAV_TIMEOUT_MS = 180_000;
const PAGE_HYDRATION_TIMEOUT_MS = 180_000;
const PAGE_SETTLE_TIMEOUT_MS = 20_000;

/**
 * `oracle:states` hovers, then focuses, the first visible control of these kinds ...
 */
const STATE_CONTROLS = 'sp-button, sp-action-button, sp-checkbox, sp-switch, sp-tab, sp-menu-item, sp-link, sp-textfield';
/** ... or, for an entry without one (pickers, radios, accordions, ...), of these. */
const STATE_CONTROLS_FALLBACK =
  'sp-radio, sp-picker, sp-action-menu, sp-number-field, sp-search, sp-combobox, sp-accordion-item, sp-sidenav-item, sp-swatch, sp-slider';

const CHECK_BY_TITLE: Record<string, CheckName> = {
  oracle: 'styles-oracle',
  'oracle:minified': 'styles-minified',
  'oracle:states': 'styles-states',
  'hydration:trimmed': 'styles-hydration',
  'hydration:restore': 'styles-restore',
  'post-hydration': 'styles-post',
  'post-hydration:states': 'styles-post-states',
  removeServerStyles: 'styles-release',
  size: 'styles-size',
};

/** Mismatch images are written for this many sections of a target (a whole-catalog page can mismatch everywhere). */
const MAX_SAVED_MISMATCHES = 4;

/** How often a capture that differs is repeated in all (page reloads included), see `matchesAnywhere`. */
const ATTEMPTS = 3;

const sizeText = (rect: {width: number; height: number}): string => `${Math.round(rect.width)}x${Math.round(rect.height)}`;

// ---------------------------------------------------------------------------------------------
// Shots: what a page looks like, as one PNG per compared section
// ---------------------------------------------------------------------------------------------

interface Shot {
  /** Section (catalog entry) name. */
  label: string;
  png: Buffer;
  /** Layout size of the section, `WxH`. */
  size: string;
  /** The rectangle that was captured (document coordinates); the page that is compared with this one captures the same. */
  clip: Rect;
}

interface ShotSet {
  shots: Shot[];
}

interface Scope {
  /** Selector whose subtree is settled (`settleTree`) before screenshots. */
  root: string;
}

const scopeOf = (target: StylesTarget): Scope => ({root: target.name === undefined ? '#app' : sectionSelector(target.name)});

/**
 * Screenshots of `target`'s page: an entry page has one (its section), `/` one per catalog section
 * (`section.demo`, document order). Every shot is a document-coordinates clip of a full-page capture, with `reference`'s
 * clip for the same section when given (the same rectangle on both pages). Not `locator.screenshot()`: it scrolls to
 * the element, and on a long page such as `/` the same section then rasterizes with a few anti-aliased pixels that
 * differ from one capture to the next (probed: 2 of 59 sections of the same loaded page); clips are stable.
 */
async function captureShots(page: Page, target: StylesTarget, reference?: ShotSet, only?: readonly string[]): Promise<ShotSet> {
  const options = {fullPage: true, animations: 'disabled', caret: 'hide'} as const;
  const names =
    target.name !== undefined
      ? [target.name]
      : await page.$$eval('#app section.demo[data-component]', (sections) =>
          sections.map((section) => section.getAttribute('data-component') ?? ''),
        );
  const shots: Shot[] = [];
  for (const name of only ? names.filter((candidate) => only.includes(candidate)) : names) {
    const measured = await measureSection(page, sectionSelector(name));
    const clip = reference?.shots.find((shot) => shot.label === name)?.clip ?? measured.clip;
    shots.push({label: name, png: await page.screenshot({clip, ...options}), size: sizeText(measured.exact), clip});
  }
  return {shots};
}

interface Mismatch {
  label: string;
  diffPixels: number;
  sizeFull: string;
  sizeOther: string;
  sizeChanged: boolean;
}

interface Comparison {
  compared: number;
  mismatches: Mismatch[];
  diffPixels: number;
  /** Written mismatch images (repo-relative). */
  files: string[];
}

interface CompareOptions {
  /** Name of the compared page in file names and messages (default: the variant). */
  otherLabel?: string;
  /** Name of the reference page in file names (default `full`). */
  referenceLabel?: string;
  /** Only these sections (default: all of the reference's). */
  only?: readonly string[];
  /** Write images of the first mismatches (default true). */
  save?: boolean;
}

/** Compares two shot sets section by section; writes images of the first mismatches. */
function compareShots(target: StylesTarget, variant: string, full: ShotSet, other: ShotSet, options: CompareOptions = {}): Comparison {
  const {otherLabel = variant, referenceLabel = 'full', only, save = true} = options;
  const references = only ? full.shots.filter((shot) => only.includes(shot.label)) : full.shots;
  const mismatches: Mismatch[] = [];
  const files: string[] = [];
  let diffPixels = 0;
  const otherByLabel = new Map(other.shots.map((shot) => [shot.label, shot]));
  for (const reference of references) {
    const candidate = otherByLabel.get(reference.label);
    if (!candidate) {
      mismatches.push({label: reference.label, diffPixels: -1, sizeFull: reference.size, sizeOther: 'missing', sizeChanged: true});
      continue;
    }
    const diff = exactDiff(reference.png, candidate.png);
    if (diff.diffPixels === 0 && diff.identical) continue;
    diffPixels += diff.diffPixels;
    mismatches.push({
      label: reference.label,
      diffPixels: diff.diffPixels,
      sizeFull: reference.size,
      sizeOther: candidate.size,
      sizeChanged: diff.sizeChanged,
    });
    if (save && mismatches.length <= MAX_SAVED_MISMATCHES) {
      const name = target.name === undefined ? `page-${reference.label}` : reference.label;
      files.push(
        ...saveMismatch(`${name}.${variant}`, otherLabel, {full: reference.png, other: candidate.png, diff: diff.diffPng}, referenceLabel),
      );
    }
  }
  return {compared: references.length, mismatches, diffPixels, files};
}

function describeMismatches(c: Comparison, otherLabel: string): string {
  const list = c.mismatches
    .slice(0, 6)
    .map(
      (m) =>
        `${m.label}: ${m.diffPixels < 0 ? 'section missing' : `${m.diffPixels} px`} (section ${m.sizeFull} full / ${m.sizeOther} ${otherLabel}` +
        `${m.sizeChanged ? ', size changed' : ''})`,
    )
    .join('; ');
  const more = c.mismatches.length > 6 ? `; +${c.mismatches.length - 6} more` : '';
  return `${c.diffPixels} px differ in ${c.mismatches.length}/${c.compared} section(s): ${list}${more}`;
}

const identical = (a: Buffer, b: Buffer): boolean => {
  const diff = exactDiff(a, b);
  return diff.diffPixels === 0 && diff.identical;
};

/**
 * Whether some capture of section `label` in `as` is pixel-identical to some capture of it in `bs`.
 *
 * Two loads of the same CSS do not always look the same: a few anti-aliased pixels (rounded corners of a button) are
 * rasterized differently in about 1 capture in 30 of the `action-menu` section (probed, 30 loads of the full CSS: 28
 * identical, 2 outliers), and the server's first render of a page after it started can differ from the later ones
 * (`color-field`: a 675 px difference on the very first capture, none afterwards). A capture that differs is therefore
 * repeated - the pages are reloaded - up to `ATTEMPTS` times in all, and the CSS only counts as different when no
 * capture of the one equals a capture of the other. A real difference of the CSS is in every capture and is never
 * matched; the retries only absorb that variation.
 */
function matchesAnywhere(label: string, as: readonly ShotSet[], bs: readonly ShotSet[]): boolean {
  const capturesOf = (sets: readonly ShotSet[]): Shot[] => sets.flatMap((set) => set.shots.filter((shot) => shot.label === label));
  const right = capturesOf(bs);
  return capturesOf(as).some((a) => right.some((b) => identical(a.png, b.png)));
}

// ---------------------------------------------------------------------------------------------
// Oracle (no JavaScript)
// ---------------------------------------------------------------------------------------------

/** The full-CSS reference of the target that was captured last; `oracle` and `oracle:minified` share it. */
let fullMemo: {row: string; set: ShotSet} | undefined;

async function openStatic(page: Page, target: StylesTarget, mode: StylesMode): Promise<void> {
  const response = await page.goto(pageUrl(target, mode, ['nohydrate=1']), {timeout: PAGE_NAV_TIMEOUT_MS});
  expect(response?.status(), `GET ${pageUrl(target, mode, ['nohydrate=1'])} status`).toBe(200);
  await page.waitForTimeout(SETTLE_MS);
}

async function fullReference(page: Page, target: StylesTarget): Promise<ShotSet> {
  if (fullMemo?.row === target.row) return fullMemo.set;
  fullMemo = undefined;
  await openStatic(page, target, 'full');
  const set = await captureShots(page, target);
  fullMemo = {row: target.row, set};
  return set;
}

async function runOracle(
  browser: Browser,
  baseURL: string | undefined,
  target: StylesTarget,
  variant: 'trimmed' | 'minified',
  ctx: StepContext,
): Promise<void> {
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const full = await fullReference(page, target);
    const fulls = [full];
    const others: ShotSet[] = [];
    await openStatic(page, target, variant);
    others.push(await captureShots(page, target, full));
    const first = compareShots(target, `oracle.${variant}`, full, others[0]!, {save: false});
    ctx.metrics.sections = first.compared;
    ctx.metrics.diffPixels = first.diffPixels;
    ctx.metrics.mismatchedSections = first.mismatches.length;
    const firstClip = full.shots[0]?.clip;
    if (target.name !== undefined && firstClip) ctx.metrics.clip = `${firstClip.width}x${firstClip.height}`;

    // Sections that differ are captured again (both pages reloaded), see `matchesAnywhere`.
    let failing = first.mismatches.map((m) => m.label);
    for (let attempt = 2; attempt <= ATTEMPTS && failing.length > 0; attempt++) {
      await openStatic(page, target, 'full');
      fulls.push(await captureShots(page, target, full, failing));
      await openStatic(page, target, variant);
      others.push(await captureShots(page, target, full, failing));
      failing = failing.filter((label) => !matchesAnywhere(label, fulls, others));
    }
    ctx.metrics.attempts = others.length;
    if (failing.length === 0) {
      if (first.mismatches.length > 0) {
        ctx.metrics.noisySections = first.mismatches.length;
        ctx.note(
          `${first.mismatches.length} section(s) differed (${first.diffPixels} px) on the first attempt and matched after ${others.length} ` +
            'attempt(s): load-to-load variation of the same CSS (raster noise, or the first render of the page after the server started)',
        );
      }
      return;
    }

    // Still different after every attempt. Control: do two loads of the full CSS differ for these sections as well?
    const result = compareShots(target, `oracle.${variant}`, full, others[0]!, {otherLabel: variant, only: failing});
    const control = compareShots(target, 'control', full, fulls[1]!, {otherLabel: 'full-again', only: failing, save: false});
    ctx.metrics.controlDiffPixels = control.diffPixels;
    ctx.metrics.images = result.files.join(', ');
    throw new Error(
      `${variant} CSS renders differently from the full CSS in all ${others.length} attempt(s): ${describeMismatches(result, variant)}. ` +
        `Control (full CSS loaded twice): ${control.diffPixels} px${control.diffPixels > 0 ? ' (the page itself is not deterministic)' : ''}. ` +
        `Images: ${result.files.join(', ')}`,
    );
  } finally {
    await context.close();
  }
}

/** Index of the first visible, enabled control matching `selector` in the scope, or -1. */
async function firstControlIndex(page: Page, scope: Scope, selector: string): Promise<number> {
  const candidates = page.locator(scope.root).locator(selector);
  const total = await candidates.count();
  for (let i = 0; i < Math.min(total, 25); i++) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible())) continue;
    const disabled = await candidate.evaluate(
      (el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    );
    if (disabled) continue;
    const hoverable = await candidate.hover({trial: true, timeout: 1500}).then(
      () => true,
      () => false,
    );
    if (hoverable) return i;
  }
  return -1;
}

async function stateShots(
  browser: Browser,
  baseURL: string | undefined,
  target: StylesTarget,
  mode: StylesMode,
  selector: string,
  index: number,
  clip: Rect,
): Promise<{hover: Buffer; focus: Buffer}> {
  // A page per mode: both start with the mouse at (0, 0) and nothing focused.
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    await openStatic(page, target, mode);
    const control = page.locator(scopeOf(target).root).locator(selector).nth(index);
    const options = {clip, fullPage: true, animations: 'disabled', caret: 'hide'} as const;
    await control.hover({timeout: 5000});
    await page.waitForTimeout(SETTLE_MS);
    const hover = await page.screenshot(options);
    await control.focus({timeout: 5000});
    await page.waitForTimeout(SETTLE_MS);
    const focus = await page.screenshot(options);
    return {hover, focus};
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Hydration and flicker of a trimmed page
// ---------------------------------------------------------------------------------------------

interface FlickerMeasurement {
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  cls: number;
  layoutChange: boolean;
  sizeBefore: string;
  sizeAfter: string;
}

/**
 * The flicker check of tests/ssr.spec.ts for `?styles=<mode>`: pure-SSR paint (client bundle blocked) vs the hydrated
 * paint. An entry compares its section; `/` compares the first viewport (and the size of `#app`).
 */
async function measureFlicker(page: Page, target: StylesTarget, mode: StylesMode): Promise<FlickerMeasurement> {
  try {
    return await measureFlickerOn(page, target, mode);
  } finally {
    await page.close();
  }
}

async function measureFlickerOn(page: Page, target: StylesTarget, mode: StylesMode): Promise<FlickerMeasurement> {
  const bundle = '**/dist/client.js';
  const scope = scopeOf(target);
  const timeout = target.name === undefined ? PAGE_NAV_TIMEOUT_MS : 30_000;
  const measure = async (): Promise<{exact: Rect; clip: Rect}> => {
    const measured = await measureSection(page, scope.root);
    if (target.name !== undefined) return measured;
    return {exact: measured.exact, clip: {x: 0, y: 0, ...ORACLE_VIEWPORT}};
  };
  await installClsCollector(page);
  await page.route(bundle, (route) => route.abort('blockedbyclient'));
  await page.goto(pageUrl(target, mode), {timeout});
  await page.waitForLoadState('networkidle', {timeout});
  await settleFrames(page, 1);
  await expect(page.locator(scope.root), 'section visible in the pure SSR paint').toBeVisible();
  const before = await measure();
  expect(before.clip.width * before.clip.height, 'no area in the pure SSR paint').toBeGreaterThan(0);
  const shot = {fullPage: true, animations: 'disabled', caret: 'hide'} as const;
  const beforePng = await page.screenshot({clip: before.clip, ...shot});

  // A cache-busting query: a module URL that failed once stays failed in the document's module map.
  await page.unroute(bundle);
  await page.addScriptTag({url: '/dist/client.js?late=1', type: 'module'});
  await awaitHydration(page, target.name === undefined ? PAGE_HYDRATION_TIMEOUT_MS : undefined);
  await page.locator(scope.root).evaluate(settleTree, {timeoutMs: target.name === undefined ? PAGE_SETTLE_TIMEOUT_MS : 5000});
  await settleFrames(page, 2);
  const after = await measure();
  const afterPng = await page.screenshot({clip: after.clip, ...shot});
  const cls = await readCls(page);
  const diff = diffPngs(beforePng, afterPng, {threshold: PIXEL_THRESHOLD});
  const dw = after.exact.width - before.exact.width;
  const dh = after.exact.height - before.exact.height;
  return {
    diffPixels: diff.diffPixels,
    totalPixels: diff.totalPixels,
    ratio: diff.ratio,
    cls,
    layoutChange: Math.abs(dw) > LAYOUT_TOLERANCE_PX || Math.abs(dh) > LAYOUT_TOLERANCE_PX,
    sizeBefore: sizeText(before.exact),
    sizeAfter: sizeText(after.exact),
  };
}

/**
 * What is over the normal thresholds. `cls: false` leaves the layout shift out (recorded, not judged): the CLS of the
 * whole-catalog page is dominated by the timing of its ~1400 elements' hydration (0.00002 and 0.036 were measured for
 * the same page and CSS in two runs), unlike an entry's, which is stable.
 */
const flickerProblems = (m: FlickerMeasurement, judge: {cls: boolean} = {cls: true}): string[] => {
  const problems: string[] = [];
  if (m.ratio >= FLICKER_MAX) {
    problems.push(`${m.diffPixels}/${m.totalPixels} px differ between SSR and hydrated paint (max ${(FLICKER_MAX * 100).toFixed(3)} %)`);
  }
  if (judge.cls && m.cls >= CLS_MAX) problems.push(`cumulative layout shift ${m.cls.toFixed(4)} (max ${CLS_MAX})`);
  if (m.layoutChange) problems.push(`size changed on hydration: ${m.sizeBefore} -> ${m.sizeAfter} (tolerance ${LAYOUT_TOLERANCE_PX}px)`);
  return problems;
};

// ---------------------------------------------------------------------------------------------
// Hydrated pages held at the moment after the definitions and before hydration
// ---------------------------------------------------------------------------------------------

/** The views of a held page that are compared: before hydration, after it, and after each group of states. */
const STATE_VIEWS = STATE_GROUPS.map((_, index) => `states${index}`);
const ALL_VIEWS = ['interim', 'final', ...STATE_VIEWS];

interface Stage {
  /** Screenshots per view (`interim`, `final`, `states<n>`). */
  shots: Record<string, ShotSet>;
  report: HydrationReportLike;
  /** console errors / uncaught exceptions until the hydrated page was captured. */
  errors: string[];
  /** Shadow-root styles after hydration (before any state was set). */
  styles: ShadowStyles;
}

/**
 * One load of `target` in `mode` with the demo client held before `hydrateSpectrum()` (`?hydrateDelay=hold`: what an
 * application with a late bootstrap looks like - every element is defined, `<sp-theme>` has upgraded and replaced its
 * server styles, nothing hydrated yet), captured at three moments: `interim` (held), `final` (hydrated and settled)
 * and, for an entry, once per `STATE_GROUPS` group with those attributes set on every sp-* element. `reference`'s clips
 * are reused so that both pages capture the same rectangles; `only` limits the captured sections.
 */
async function heldStage(
  browser: Browser,
  baseURL: string | undefined,
  target: StylesTarget,
  mode: StylesMode,
  reference?: Stage,
  only?: readonly string[],
): Promise<Stage> {
  const isPage = target.name === undefined;
  const scope = scopeOf(target);
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = pageUrl(target, mode, ['hydrateDelay=hold']);
    const response = await page.goto(url, {timeout: isPage ? PAGE_NAV_TIMEOUT_MS : 30_000});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    try {
      await page.waitForFunction(
        () => (window as unknown as {__swcSsrDefined?: boolean}).__swcSsrDefined === true,
        undefined,
        {timeout: isPage ? PAGE_HYDRATION_TIMEOUT_MS : 30_000},
      );
    } catch {
      throw new Error(`window.__swcSsrDefined was never set on ${url} (client bundle missing or crashed?)`);
    }
    await settleFrames(page, 2);
    await page.waitForTimeout(SETTLE_MS);
    // Repainted like every later capture: `<sp-theme>` upgraded (and, trimmed / minified, got its bridge `<style>`
    // back), so its subtree was repainted with unchanged computed values, and Chrome may rasterize an anti-aliased edge
    // one colour level differently from the first paint until the next repaint. Probed (0.3.0,
    // .probe/integrate/theme-interim-pixels.ts): the minified theme page's interim capture differed from itself by 1 px
    // before / after a repaint in every load, computed styles and geometry of all 49 elements equal to full's; both
    // pages repainted: 0 px. A repaint re-rasterizes the current styles, so a real CSS difference still shows.
    await forceRepaint(page);
    const shots: Record<string, ShotSet> = {};
    shots.interim = await captureShots(page, target, reference?.shots.interim, only);

    await page.evaluate(() => (window as unknown as {__swcSsrRelease?: () => void}).__swcSsrRelease?.());
    const report = await awaitHydration(page, isPage ? PAGE_HYDRATION_TIMEOUT_MS : undefined);
    await page.locator(scope.root).evaluate(settleTree, {timeoutMs: isPage ? PAGE_SETTLE_TIMEOUT_MS : 5000});
    await settleFrames(page, 2);
    await page.waitForTimeout(SETTLE_MS);
    await forceRepaint(page);
    shots.final = await captureShots(page, target, reference?.shots.final, only);
    const styles = await page.evaluate(collectShadowStyles);
    const errors = [...logs.errors];

    if (!isPage) {
      for (const [index, group] of STATE_GROUPS.entries()) {
        await applyStates(page, scope.root, group);
        await settleFrames(page, 2);
        await page.waitForTimeout(SETTLE_MS);
        await forceRepaint(page);
        shots[`states${index}`] = await captureShots(page, target, reference?.shots.final, only);
        await clearStates(page);
        await settleFrames(page, 2);
        await page.waitForTimeout(SETTLE_MS);
      }
    }
    return {shots, report, errors, styles};
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Hydrated pages at normal timing (post-hydration, post-hydration:states)
// ---------------------------------------------------------------------------------------------

interface OpenedPage {
  context: Awaited<ReturnType<typeof newOracleContext>>;
  page: Page;
  report: HydrationReportLike;
  /** console errors / uncaught exceptions since the page was opened (live). */
  errors: string[];
}

/**
 * Opens `target` in `mode` with the demo client as it is (`hydrateSpectrum()` right after the definitions loaded),
 * waits for `window.__swcSsrHydration` and the elements to settle, and repaints the page once (`forceRepaint`), so that
 * every compared page starts from the same raster state. The caller closes `context`.
 */
async function openHydrated(browser: Browser, baseURL: string | undefined, target: StylesTarget, mode: StylesMode): Promise<OpenedPage> {
  const isPage = target.name === undefined;
  const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const logs = collectConsole(page);
    const url = pageUrl(target, mode);
    const response = await page.goto(url, {timeout: isPage ? PAGE_NAV_TIMEOUT_MS : 30_000});
    expect(response?.status(), `GET ${url} status`).toBe(200);
    const report = await awaitHydration(page, isPage ? PAGE_HYDRATION_TIMEOUT_MS : undefined);
    await page.locator(scopeOf(target).root).evaluate(settleTree, {timeoutMs: isPage ? PAGE_SETTLE_TIMEOUT_MS : 5000});
    await settleFrames(page, 2);
    await page.waitForTimeout(SETTLE_MS);
    await forceRepaint(page);
    return {context, page, report, errors: logs.errors};
  } catch (error) {
    await context.close();
    throw error;
  }
}

interface HydratedShots {
  set: ShotSet;
  styles: ShadowStyles;
  report: HydrationReportLike;
  errors: string[];
}

/** `post-hydration`: one hydrated load of `target` in `mode`, its section shots and its shadow-root styles. */
async function hydratedShots(
  browser: Browser,
  baseURL: string | undefined,
  target: StylesTarget,
  mode: StylesMode,
  reference?: ShotSet,
  only?: readonly string[],
): Promise<HydratedShots> {
  const opened = await openHydrated(browser, baseURL, target, mode);
  try {
    const set = await captureShots(opened.page, target, reference, only);
    const styles = await opened.page.evaluate(collectShadowStyles);
    return {set, styles, report: opened.report, errors: [...opened.errors]};
  } finally {
    await opened.context.close();
  }
}

/** What the full-CSS page decided for `post-hydration:states`; the other pages replay it. */
interface PostPlan {
  selector: string;
  index: number;
  control: string;
  /** Steps that changed something on the full-CSS page (the others are skipped everywhere). */
  steps: PostStep[];
  /** Clip per step, measured on the full-CSS page after the step. */
  clips: Partial<Record<PostStep, Rect>>;
  /** Tag of the element each DOM step changed. */
  targets: Partial<Record<PostStep, string>>;
}

interface PostRun {
  plan: PostPlan;
  shots: Partial<Record<PostStep, Buffer>>;
  errors: string[];
}

/**
 * `post-hydration:states`: one hydrated load of `target` in `mode`, then the `POST_STEPS` in order, a screenshot of the
 * section after each. Without `plan` (the full-CSS page) the control and the clips are determined here; undefined when
 * the section has no visible enabled control.
 */
async function postStateRun(
  browser: Browser,
  baseURL: string | undefined,
  target: StylesTarget,
  mode: StylesMode,
  plan?: PostPlan,
): Promise<PostRun | undefined> {
  const scope = scopeOf(target);
  const opened = await openHydrated(browser, baseURL, target, mode);
  try {
    const {page} = opened;
    let selector = plan?.selector ?? STATE_CONTROLS;
    let index = plan?.index ?? (await firstControlIndex(page, scope, selector));
    if (!plan && index < 0) {
      selector = STATE_CONTROLS_FALLBACK;
      index = await firstControlIndex(page, scope, selector);
    }
    if (index < 0) return undefined;
    const control = page.locator(scope.root).locator(selector).nth(index);
    const tag = await control.evaluate((el) => {
      (window as unknown as {__swcControl?: Element}).__swcControl = el;
      return el.localName;
    });
    await page.evaluate(installNavigationGuard);
    const decided: PostPlan = plan ?? {selector, index, control: tag, steps: [], clips: {}, targets: {}};
    const shots: Partial<Record<PostStep, Buffer>> = {};
    for (const name of POST_STEPS) {
      if (plan && !plan.steps.includes(name)) continue;
      if (name === 'hover') await control.hover({timeout: 5000});
      else if (name === 'focus') await control.focus({timeout: 5000});
      else if (name === 'click') await control.click({timeout: 5000});
      else {
        const changed = await applyDomStep(page, scope.root, name);
        if (changed === null) {
          if (plan) throw new Error(`${mode}: step ${name} found no element (the full-CSS page changed <${plan.targets[name]}>)`);
          continue;
        }
        if (!plan) decided.targets[name] = changed;
      }
      await settleFrames(page, 2);
      await page.waitForTimeout(SETTLE_MS);
      const clip = plan?.clips[name] ?? (await measureSection(page, scope.root)).clip;
      if (!plan) {
        decided.steps.push(name);
        decided.clips[name] = clip;
      }
      shots[name] = await page.screenshot({clip, fullPage: true, animations: 'disabled', caret: 'hide'});
    }
    return {plan: decided, shots, errors: [...opened.errors]};
  } finally {
    await opened.context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Layout measured by the elements themselves (post-hydration:layout)
// ---------------------------------------------------------------------------------------------

/** Targets with elements that position their `sp-color-handle` from a measurement of themselves. */
const LAYOUT_TARGETS = new Set(['color-area']);
/** Loads per mode in `post-hydration:layout` (the stuck handle showed up in 11 of 14 catalog loads). */
const LAYOUT_LOADS = 3;

interface HandlePosition {
  /** Host tag and its index among the measured hosts of the scope, e.g. `sp-color-area#2`. */
  host: string;
  /** Offset of the handle's border box from the host's, rounded px, `x,y`. */
  offset: string;
  /** Whether the handle's computed `transform` moves it (translate(0, 0) is the server's unmeasured position). */
  moved: boolean;
}

/** Every `sp-color-handle` in the shadow roots of the color elements under `root` (page function). */
function measureHandles(root: string): HandlePosition[] {
  const scope = document.querySelector(root);
  if (!scope) return [];
  const out: HandlePosition[] = [];
  Array.from(scope.querySelectorAll('sp-color-area, sp-color-slider, sp-color-wheel')).forEach((host, index) => {
    for (const handle of Array.from(host.shadowRoot?.querySelectorAll('sp-color-handle') ?? [])) {
      const h = handle.getBoundingClientRect();
      const a = host.getBoundingClientRect();
      const transform = getComputedStyle(handle).transform;
      const matrix = transform === 'none' ? undefined : new DOMMatrixReadOnly(transform);
      out.push({
        host: `${host.localName}#${index}`,
        offset: `${Math.round(h.left - a.left)},${Math.round(h.top - a.top)}`,
        moved: matrix !== undefined && (matrix.m41 !== 0 || matrix.m42 !== 0),
      });
    }
  });
  return out;
}

/** Differences between `actual` and `reference` handle positions (0 px), and color-area handles that did not move. */
function handleProblems(label: string, actual: HandlePosition[], reference: HandlePosition[]): string[] {
  const problems: string[] = [];
  if (actual.length !== reference.length) {
    problems.push(`${label}: ${actual.length} handles, the client-rendered page has ${reference.length}`);
  }
  actual.forEach((handle, i) => {
    const expected = reference[i];
    if (expected && (expected.host !== handle.host || expected.offset !== handle.offset)) {
      problems.push(`${label}: ${handle.host} handle at ${handle.offset}, client-side rendering ${expected.offset}`);
    }
    if (handle.host.startsWith('sp-color-area') && !handle.moved) {
      problems.push(`${label}: ${handle.host} handle not moved from the corner (${handle.offset})`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

function registerTargetTests(target: StylesTarget, timeoutMs: number): void {
  const {row} = target;
  const isPage = target.name === undefined;
  const scope = scopeOf(target);

  test.describe(isPage ? row : `styles: ${row}`, () => {
    test.describe.configure({timeout: timeoutMs});

    // Fallback so that a timeout / crash that skipped the in-test recording still shows up in the summary.
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

    test('oracle', async ({browser}, testInfo) => {
      await step(testInfo, row, 'styles-oracle', (ctx) => runOracle(browser, testInfo.project.use.baseURL, target, 'trimmed', ctx));
    });

    test('oracle:minified', async ({browser}, testInfo) => {
      await step(testInfo, row, 'styles-minified', (ctx) => runOracle(browser, testInfo.project.use.baseURL, target, 'minified', ctx));
    });

    if (target.interactive) {
      test('oracle:states', async ({browser}, testInfo) => {
        const baseURL = testInfo.project.use.baseURL;
        let skipped: string | undefined;
        await step(testInfo, row, 'styles-states', async (ctx) => {
          // Locate the control and the clip on the full page; the trimmed page uses the same index and clip.
          const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: false});
          let index = -1;
          let selector = STATE_CONTROLS;
          let clip: Rect;
          try {
            const page = await context.newPage();
            await openStatic(page, target, 'full');
            clip = (await measureSection(page, scope.root)).clip;
            index = await firstControlIndex(page, scope, selector);
            if (index < 0) {
              selector = STATE_CONTROLS_FALLBACK;
              index = await firstControlIndex(page, scope, selector);
            }
            if (index >= 0) ctx.metrics.control = await page.locator(scope.root).locator(selector).nth(index).evaluate((el) => el.localName);
          } finally {
            await context.close();
          }
          if (index < 0) {
            skipped = `no visible ${STATE_CONTROLS}, ${STATE_CONTROLS_FALLBACK} in the section`;
            return;
          }
          // Hover, then focus, on a page of each kind; shots that differ are taken again (see `matchesAnywhere`).
          type StateShots = {hover: Buffer; focus: Buffer};
          const fulls: StateShots[] = [];
          const trimmeds: StateShots[] = [];
          let failing: Array<'hover' | 'focus'> = ['hover', 'focus'];
          for (let attempt = 1; attempt <= ATTEMPTS && failing.length > 0; attempt++) {
            fulls.push(await stateShots(browser, baseURL, target, 'full', selector, index, clip));
            trimmeds.push(await stateShots(browser, baseURL, target, 'trimmed', selector, index, clip));
            if (attempt === 1) {
              for (const state of ['hover', 'focus'] as const) {
                ctx.metrics[`${state}DiffPixels`] = exactDiff(fulls[0]![state], trimmeds[0]![state]).diffPixels;
              }
            }
            failing = failing.filter((state) => !fulls.some((f) => trimmeds.some((t) => identical(f[state], t[state]))));
          }
          ctx.metrics.attempts = fulls.length;
          const noisy = (['hover', 'focus'] as const).filter((state) => (ctx.metrics[`${state}DiffPixels`] as number) > 0 && !failing.includes(state));
          if (noisy.length > 0) {
            ctx.note(`${noisy.join(' and ')} differed on the first attempt and matched after ${fulls.length} attempt(s): load-to-load variation of the same CSS`);
          }
          const problems: string[] = [];
          for (const state of failing) {
            const diff = exactDiff(fulls[0]![state], trimmeds[0]![state]);
            const control = fulls[1] ? exactDiff(fulls[0]![state], fulls[1][state]).diffPixels : 0;
            const files = saveMismatch(`${row}.states.${state}`, 'trimmed', {full: fulls[0]![state], other: trimmeds[0]![state], diff: diff.diffPng});
            problems.push(`${state}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s) (control, full CSS loaded twice: ${control} px; ${files.join(', ')})`);
          }
          expect(problems, `trimmed CSS renders hover / focus of the first control differently from the full CSS`).toEqual([]);
        });
        if (skipped !== undefined) recordResult({component: row, check: 'styles-states', status: 'skip', note: skipped});
      });
    }

    test('hydration:trimmed', async ({page}, testInfo) => {
      await step(testInfo, row, 'styles-hydration', async (ctx) => {
        const navTimeout = isPage ? PAGE_NAV_TIMEOUT_MS : 30_000;
        const context = page.context();

        // Clean hydration of a trimmed page and of a minified one.
        for (const mode of ['trimmed', 'minified'] as const) {
          const tab = mode === 'trimmed' ? page : await context.newPage();
          const logs = collectConsole(tab);
          const response = await tab.goto(pageUrl(target, mode), {timeout: navTimeout});
          expect(response?.status(), `GET ${pageUrl(target, mode)} status`).toBe(200);
          const report = await awaitHydration(tab, isPage ? PAGE_HYDRATION_TIMEOUT_MS : undefined);
          await tab.locator(scope.root).evaluate(settleTree, {timeoutMs: isPage ? PAGE_SETTLE_TIMEOUT_MS : 5000});
          const deferredInDom = await tab.evaluate(collectDeferredHydration);
          if (mode === 'trimmed') {
            ctx.metrics.hydratedCount = report.hydratedCount;
            ctx.metrics.consoleErrors = logs.errors.length;
          } else {
            ctx.metrics.hydratedCountMinified = report.hydratedCount;
          }
          expectNone(report.errors, `HydrationReport.errors (${mode})`);
          expectNone(report.deferred, `HydrationReport.deferred (${mode})`);
          expectNone(deferredInDom, `elements still carrying defer-hydration in the DOM (${mode})`);
          expectNone(logs.errors, `console errors / uncaught exceptions during load (${mode})`);
          await tab.close();
        }

        // Flicker in trimmed and in minified mode, on pages of their own (the client bundle is blocked on them).
        // Minified metrics carry the suffix `Minified`; the trimmed ones keep their names (the summary reads them).
        const judge = {cls: !isPage};
        let control: FlickerMeasurement | undefined;
        const unresolved: string[] = [];
        for (const mode of ['trimmed', 'minified'] as const) {
          const metric = (name: string): string => (mode === 'trimmed' ? name : `${name}Minified`);
          const measured = await measureFlicker(await context.newPage(), target, mode);
          ctx.metrics[metric('diffPixels')] = measured.diffPixels;
          ctx.metrics[metric('totalPixels')] = measured.totalPixels;
          ctx.metrics[metric('ratio')] = measured.ratio;
          ctx.metrics[metric('cls')] = measured.cls;
          ctx.metrics[metric('layoutChange')] = measured.layoutChange;
          ctx.metrics[metric('sizeBefore')] = measured.sizeBefore;
          ctx.metrics[metric('sizeAfter')] = measured.sizeAfter;
          const problems = flickerProblems(measured, judge);
          if (problems.length === 0) continue;

          // Over the normal threshold. Some entries can be over it with the full CSS too; only what the trimming
          // adds on top of that is a failure.
          control ??= await measureFlicker(await context.newPage(), target, 'full');
          ctx.metrics.controlRatio = control.ratio;
          ctx.metrics.controlCls = control.cls;
          const worse =
            measured.diffPixels > control.diffPixels ||
            (judge.cls && measured.cls > control.cls + 0.0005) ||
            (measured.layoutChange && !control.layoutChange);
          if (!worse) {
            ctx.note(`${mode}: flicker over the threshold with the full CSS as well (${problems.join('; ')}); the ${mode} CSS adds nothing`);
            ctx.metrics[metric('excusedByFull')] = true;
            continue;
          }
          unresolved.push(
            `${mode}: ${[...problems, `with the full CSS: ${flickerProblems(control, judge).join('; ') || 'under the threshold'}`].join('; ')}`,
          );
        }
        expectNone(unresolved, 'trimmed / minified flicker over the threshold and worse than the full CSS');
      });
    });

    test('hydration:restore', async ({browser}, testInfo) => {
      await step(testInfo, row, 'styles-restore', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const modes = ['trimmed', 'minified'] as const;
        type Mode = (typeof modes)[number];
        const fulls: Stage[] = [await heldStage(browser, baseURL, target, 'full')];
        const others: Record<Mode, Stage[]> = {trimmed: [], minified: []};
        for (const mode of modes) others[mode].push(await heldStage(browser, baseURL, target, mode, fulls[0]));
        const views = ALL_VIEWS.filter((view) => fulls[0]!.shots[view] !== undefined);
        const labels = fulls[0]!.shots.final!.shots.map((shot) => shot.label);

        // (mode, view, section) triples whose capture equals no capture of the full-CSS page; those are captured again
        // (all pages reloaded), see `matchesAnywhere`.
        interface Triple {
          mode: Mode;
          view: string;
          label: string;
        }
        const failing = (): Triple[] => {
          const out: Triple[] = [];
          for (const mode of modes) {
            for (const view of views) {
              for (const label of labels) {
                const as = fulls.map((stage) => stage.shots[view]).filter((set): set is ShotSet => set !== undefined);
                const bs = others[mode].map((stage) => stage.shots[view]).filter((set): set is ShotSet => set !== undefined);
                if (!matchesAnywhere(label, as, bs)) out.push({mode, view, label});
              }
            }
          }
          return out;
        };
        const firstFailing = failing();
        let pending = firstFailing;
        for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
          const only = [...new Set(pending.map((triple) => triple.label))];
          fulls.push(await heldStage(browser, baseURL, target, 'full', fulls[0], only));
          for (const mode of modes) {
            if (pending.some((triple) => triple.mode === mode)) {
              others[mode].push(await heldStage(browser, baseURL, target, mode, fulls[0], only));
            }
          }
          pending = failing();
        }
        ctx.metrics.attempts = fulls.length;
        ctx.metrics.sections = labels.length;
        ctx.metrics.views = views.length;

        // Pixels that differed in the first captures, per mode and moment (a record for the summary).
        const differing = (list: Triple[], mode: Mode, view: string): string[] =>
          list.filter((triple) => triple.mode === mode && triple.view === view).map((triple) => triple.label);
        const firstCompare = (mode: Mode, view: string, list: Triple[], options: CompareOptions = {}): Comparison =>
          compareShots(target, `restore.${mode}.${view}`, fulls[0]!.shots[view]!, others[mode][0]!.shots[view]!, {
            otherLabel: `${mode}-${view}`,
            only: differing(list, mode, view),
            ...options,
          });
        let firstPixels = 0;
        let failingPixels = 0;
        const problems: string[] = [];
        const images: string[] = [];
        for (const mode of modes) {
          const sums = {Interim: 0, Final: 0, States: 0};
          for (const view of views) {
            const group = view === 'interim' ? 'Interim' : view === 'final' ? 'Final' : 'States';
            const firstOnes = differing(firstFailing, mode, view);
            if (firstOnes.length > 0) {
              const first = firstCompare(mode, view, firstFailing, {save: false});
              sums[group] += first.diffPixels;
              firstPixels += first.diffPixels;
            }
            if (differing(pending, mode, view).length > 0) {
              const left = firstCompare(mode, view, pending);
              failingPixels += left.diffPixels;
              images.push(...left.files);
              problems.push(`${mode} ${view}: ${describeMismatches(left, `${mode}`)}`);
            }
          }
          ctx.metrics[`diffPixelsInterim_${mode}`] = sums.Interim;
          ctx.metrics[`diffPixelsFinal_${mode}`] = sums.Final;
          ctx.metrics[`diffPixelsStates_${mode}`] = sums.States;
        }
        ctx.metrics.diffPixelsFirstAttempt = firstPixels;
        ctx.metrics.diffPixels = failingPixels;
        if (images.length > 0) ctx.metrics.images = images.join(', ');
        if (firstFailing.length > 0 && pending.length === 0) {
          ctx.metrics.noisySections = new Set(firstFailing.map((triple) => triple.label)).size;
          ctx.note(
            `${firstFailing.length} capture(s) differed (${firstPixels} px) on the first attempt and matched after ${fulls.length} attempt(s): load-to-load variation of the same CSS`,
          );
        }

        for (const mode of modes) {
          const stage = others[mode][0]!;
          ctx.metrics[`markedLeft_${mode}`] = stage.styles.marked;
          ctx.metrics[`adoptedRoots_${mode}`] = stage.styles.adopted;
          ctx.metrics[`shadowRoots_${mode}`] = stage.styles.hosts;
          ctx.metrics[`hydrationMs_${mode}`] = stage.report.durationMs;
          expectNone(stage.report.errors, `HydrationReport.errors (${mode}, held)`);
          expectNone(stage.report.deferred, `HydrationReport.deferred (${mode}, held)`);
          // A late hydrateSpectrum() must settle: a menu whose update never finishes costs it its timeouts (hooks.ts).
          expectNone(
            stage.report.warnings.filter((warning) => /did not settle|is not defined after|did not converge/.test(warning)),
            `HydrationReport.warnings (${mode}, held): hydration did not settle`,
          );
          expectNone(stage.errors, `console errors during load (${mode}, held)`);
        }
        const leftover = modes.flatMap((mode) =>
          Object.entries(others[mode][0]!.styles.markedByTag).map(([tag, count]) => `${mode}: ${tag} x${count}`),
        );
        expectNone(leftover, 'shadow roots that still hold a trimmed / minified server <style> (data-swc-styles) after hydration');
        expect(
          problems,
          `the hydrated ${modes.join(' / ')} page differs from the hydrated full-CSS page (pixelmatch threshold 0) in ${pending.length} capture(s); ` +
            `the held page is the state of an application that has not called hydrateSpectrum() yet. Images: ${images.join(', ')}`,
        ).toEqual([]);
      });
    });

    test('post-hydration', async ({browser}, testInfo) => {
      await step(testInfo, row, 'styles-post', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const modes = ['trimmed', 'minified'] as const;
        type Mode = (typeof modes)[number];
        const fulls: HydratedShots[] = [await hydratedShots(browser, baseURL, target, 'full')];
        const reference = fulls[0]!.set;
        const others: Record<Mode, HydratedShots[]> = {trimmed: [], minified: []};
        for (const mode of modes) others[mode].push(await hydratedShots(browser, baseURL, target, mode, reference));
        const labels = reference.shots.map((shot) => shot.label);

        // (mode, section) pairs whose capture equals no capture of the full-CSS page: captured again (see `matchesAnywhere`).
        const failing = (): Array<{mode: Mode; label: string}> =>
          modes.flatMap((mode) =>
            labels
              .filter((label) => !matchesAnywhere(label, fulls.map((h) => h.set), others[mode].map((h) => h.set)))
              .map((label) => ({mode, label})),
          );
        const firstFailing = failing();
        let pending = firstFailing;
        for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
          const only = [...new Set(pending.map((pair) => pair.label))];
          fulls.push(await hydratedShots(browser, baseURL, target, 'full', reference, only));
          for (const mode of modes) {
            if (pending.some((pair) => pair.mode === mode)) others[mode].push(await hydratedShots(browser, baseURL, target, mode, reference, only));
          }
          pending = failing();
        }
        ctx.metrics.attempts = fulls.length;
        ctx.metrics.sections = labels.length;

        const problems: string[] = [];
        const images: string[] = [];
        let firstPixels = 0;
        let failingPixels = 0;
        for (const mode of modes) {
          const firstOnes = firstFailing.filter((pair) => pair.mode === mode).map((pair) => pair.label);
          if (firstOnes.length > 0) {
            const first = compareShots(target, `post.${mode}`, reference, others[mode][0]!.set, {only: firstOnes, save: false});
            ctx.metrics[`diffPixelsFirst_${mode}`] = first.diffPixels;
            firstPixels += first.diffPixels;
          }
          const left = pending.filter((pair) => pair.mode === mode).map((pair) => pair.label);
          if (left.length > 0) {
            const comparison = compareShots(target, `post.${mode}`, reference, others[mode][0]!.set, {otherLabel: `${mode}-hydrated`, only: left});
            failingPixels += comparison.diffPixels;
            images.push(...comparison.files);
            problems.push(`${mode}: ${describeMismatches(comparison, mode)}`);
          }
        }
        ctx.metrics.diffPixelsFirstAttempt = firstPixels;
        ctx.metrics.diffPixels = failingPixels;
        if (images.length > 0) ctx.metrics.images = images.join(', ');
        if (firstFailing.length > 0 && pending.length === 0) {
          ctx.metrics.noisySections = new Set(firstFailing.map((pair) => pair.label)).size;
          ctx.note(
            `${firstFailing.length} capture(s) differed (${firstPixels} px) on the first attempt and matched after ${fulls.length} attempt(s): load-to-load variation of the same CSS`,
          );
        }

        ctx.metrics.litElementsFull = fulls[0]!.styles.litElements;
        ctx.metrics.litWithoutAdoptedFull = Object.values(fulls[0]!.styles.litWithoutAdopted).reduce((a, b) => a + b, 0);
        for (const mode of modes) {
          const loaded = others[mode][0]!;
          ctx.metrics[`litElements_${mode}`] = loaded.styles.litElements;
          ctx.metrics[`markedLeft_${mode}`] = loaded.styles.marked;
          ctx.metrics[`hydratedCount_${mode}`] = loaded.report.hydratedCount;
          expectNone(loaded.report.errors, `HydrationReport.errors (${mode})`);
          expectNone(loaded.report.deferred, `HydrationReport.deferred (${mode})`);
          expectNone(loaded.errors, `console errors / uncaught exceptions during load (${mode})`);
        }
        expectNone(
          modes.flatMap((mode) => Object.entries(others[mode][0]!.styles.markedByTag).map(([tag, count]) => `${mode}: ${tag} x${count}`)),
          'shadow roots that still hold a trimmed / minified server <style> (data-swc-styles) after hydration',
        );
        expectNone(
          modes.flatMap((mode) =>
            Object.entries(others[mode][0]!.styles.litWithoutAdopted).map(([tag, count]) => `${mode}: ${tag} x${count}`),
          ),
          'hydrated sp-* Lit elements without adopted style sheets (the complete stylesheets were not restored)',
        );
        expect(
          problems,
          `the hydrated ${modes.join(' / ')} page differs from the hydrated full-CSS page (pixelmatch threshold 0). Images: ${images.join(', ')}`,
        ).toEqual([]);
      });
    });

    if (isPage || LAYOUT_TARGETS.has(target.name ?? '')) {
      /**
       * `sp-color-area` measures itself from a ResizeObserver its own `connectedCallback()` starts at the upgrade,
       * while the element still waits for hydration. Measured before its hydrating update, the hydrating render
       * differed from the server markup only in the handle's `style`, which lit's `hydrate()` does not write: the
       * handle stayed in the corner (11 of 14 catalog loads with the split demo bundle). Every `sp-color-handle` must
       * sit where client-side rendering puts it (0 px) - when `window.__swcSsrHydration` resolves and after the page
       * settled - in every style mode, `LAYOUT_LOADS` loads each, without retries.
       */
      test('post-hydration:layout', async ({browser}, testInfo) => {
        const baseURL = testInfo.project.use.baseURL;
        const navigation = {timeout: isPage ? PAGE_NAV_TIMEOUT_MS : 30_000};
        const hydration = isPage ? PAGE_HYDRATION_TIMEOUT_MS : undefined;
        const settle = {timeoutMs: isPage ? PAGE_SETTLE_TIMEOUT_MS : 5000};

        const csrContext = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
        let reference: HandlePosition[];
        try {
          const page = await csrContext.newPage();
          const url = isPage ? '/csr' : `/csr/${encodeURIComponent(target.name!)}`;
          const response = await page.goto(url, navigation);
          expect(response?.status(), `GET ${url} status`).toBe(200);
          await awaitHydration(page, hydration);
          await page.locator(scope.root).evaluate(settleTree, settle);
          await settleFrames(page, 2);
          await page.waitForTimeout(SETTLE_MS);
          reference = await page.evaluate(measureHandles, scope.root);
        } finally {
          await csrContext.close();
        }
        expect(reference.length, 'sp-color-handle elements on the client-rendered page').toBeGreaterThan(0);
        expectNone(handleProblems('client-side rendering', reference, reference), 'client-rendered color-area handles');

        const problems: string[] = [];
        for (let load = 1; load <= LAYOUT_LOADS; load++) {
          for (const mode of ['full', 'trimmed', 'minified'] as const) {
            const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
            try {
              const page = await context.newPage();
              const errors = collectConsole(page).errors;
              const url = pageUrl(target, mode);
              const response = await page.goto(url, navigation);
              expect(response?.status(), `GET ${url} status`).toBe(200);
              const report = await awaitHydration(page, hydration);
              problems.push(...handleProblems(`load ${load} ${mode} at hydration`, await page.evaluate(measureHandles, scope.root), reference));
              await page.locator(scope.root).evaluate(settleTree, settle);
              await settleFrames(page, 2);
              await page.waitForTimeout(SETTLE_MS);
              problems.push(...handleProblems(`load ${load} ${mode} settled`, await page.evaluate(measureHandles, scope.root), reference));
              problems.push(...report.errors.map((error) => `load ${load} ${mode}: HydrationReport.errors: ${error}`));
              problems.push(...errors.map((error) => `load ${load} ${mode}: console error: ${error}`));
            } finally {
              await context.close();
            }
          }
        }
        expectNone(problems, 'sp-color-handle positions after hydration that differ from client-side rendering');
      });
    }

    if (target.interactive) {
      test('post-hydration:states', async ({browser}, testInfo) => {
        let skipped: string | undefined;
        await step(testInfo, row, 'styles-post-states', async (ctx) => {
          const baseURL = testInfo.project.use.baseURL;
          const modes = ['trimmed', 'minified'] as const;
          type Mode = (typeof modes)[number];
          const firstFull = await postStateRun(browser, baseURL, target, 'full');
          if (!firstFull) {
            skipped = `no visible ${STATE_CONTROLS}, ${STATE_CONTROLS_FALLBACK} in the section`;
            return;
          }
          const plan = firstFull.plan;
          ctx.metrics.control = plan.control;
          ctx.metrics.steps = plan.steps.join(', ');
          ctx.metrics.targets = Object.entries(plan.targets)
            .map(([name, tag]) => `${name}: ${tag}`)
            .join(', ');
          const fulls: PostRun[] = [firstFull];
          const others: Record<Mode, PostRun[]> = {trimmed: [], minified: []};
          for (const mode of modes) others[mode].push((await postStateRun(browser, baseURL, target, mode, plan))!);

          const same = (name: PostStep, as: PostRun[], bs: PostRun[]): boolean =>
            as.some((a) => bs.some((b) => a.shots[name] !== undefined && b.shots[name] !== undefined && identical(a.shots[name]!, b.shots[name]!)));
          const failing = (): Array<{mode: Mode; name: PostStep}> =>
            modes.flatMap((mode) => plan.steps.filter((name) => !same(name, fulls, others[mode])).map((name) => ({mode, name})));
          const firstFailing = failing();
          let pending = firstFailing;
          for (let attempt = 2; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
            fulls.push((await postStateRun(browser, baseURL, target, 'full', plan))!);
            for (const mode of modes) {
              if (pending.some((pair) => pair.mode === mode)) others[mode].push((await postStateRun(browser, baseURL, target, mode, plan))!);
            }
            pending = failing();
          }
          ctx.metrics.attempts = fulls.length;
          let firstPixels = 0;
          for (const {mode, name} of firstFailing) {
            firstPixels += exactDiff(fulls[0]!.shots[name]!, others[mode][0]!.shots[name]!).diffPixels;
          }
          ctx.metrics.diffPixelsFirstAttempt = firstPixels;
          if (firstFailing.length > 0 && pending.length === 0) {
            ctx.note(
              `${firstFailing.map(({mode, name}) => `${mode} ${name}`).join(', ')} differed (${firstPixels} px) on the first attempt and matched after ${fulls.length} attempt(s): load-to-load variation of the same CSS`,
            );
          }
          const problems: string[] = [];
          let failingPixels = 0;
          for (const {mode, name} of pending) {
            const diff = exactDiff(fulls[0]!.shots[name]!, others[mode][0]!.shots[name]!);
            const control = fulls[1] ? exactDiff(fulls[0]!.shots[name]!, fulls[1].shots[name]!).diffPixels : 0;
            failingPixels += diff.diffPixels;
            const files = saveMismatch(`${row}.post.${name}`, mode, {full: fulls[0]!.shots[name]!, other: others[mode][0]!.shots[name]!, diff: diff.diffPng});
            problems.push(
              `${mode} after ${name}${plan.targets[name] ? ` (<${plan.targets[name]}>)` : ` (<${plan.control}>)`}: ${diff.diffPixels} px differ in all ${fulls.length} attempt(s) ` +
                `(control, full CSS loaded twice: ${control} px; ${files.join(', ')})`,
            );
          }
          ctx.metrics.diffPixels = failingPixels;
          expect(problems, 'after hydration, the trimmed / minified page renders state changes differently from the full-CSS page').toEqual([]);
        });
        if (skipped !== undefined) recordResult({component: row, check: 'styles-post-states', status: 'skip', note: skipped});
      });
    }

    test('removeServerStyles', async ({browser}, testInfo) => {
      await step(testInfo, row, 'styles-release', async (ctx) => {
        const baseURL = testInfo.project.use.baseURL;
        const navTimeout = isPage ? PAGE_NAV_TIMEOUT_MS : 30_000;
        // One hydrated page per variant, closed after its screenshots (`/` is large).
        const hydrated = async (mode: StylesMode, extra: string[], reference?: ShotSet, only?: readonly string[]) => {
          const context = await newOracleContext(browser, baseURL, {javaScriptEnabled: true});
          try {
            const page = await context.newPage();
            await page.emulateMedia({reducedMotion: 'reduce'});
            const logs = collectConsole(page);
            const response = await page.goto(pageUrl(target, mode, extra), {timeout: navTimeout});
            expect(response?.status(), `GET ${pageUrl(target, mode, extra)} status`).toBe(200);
            const report = await awaitHydration(page, isPage ? PAGE_HYDRATION_TIMEOUT_MS : undefined);
            await page.locator(scope.root).evaluate(settleTree, {timeoutMs: isPage ? PAGE_SETTLE_TIMEOUT_MS : 5000});
            await settleFrames(page, 2);
            await page.waitForTimeout(SETTLE_MS);
            await forceRepaint(page);
            return {
              set: await captureShots(page, target, reference, only),
              styles: await page.evaluate(collectShadowStyles),
              report,
              errors: logs.errors,
            };
          } finally {
            await context.close();
          }
        };

        // The control keeps the complete server styles; the two variants release them, one of them from trimmed CSS
        // (which the client replaces by the complete stylesheets whether or not `removeStyles=1` is set).
        const kept = await hydrated('full', []);
        const releasedFull = await hydrated('full', ['removeStyles=1'], kept.set);
        const releasedTrimmed = await hydrated('trimmed', ['removeStyles=1'], kept.set);
        ctx.metrics.styleElementsKept = kept.styles.total;
        ctx.metrics.styleElementsReleased = releasedFull.styles.total;
        ctx.metrics.styleElementsReleasedTrimmed = releasedTrimmed.styles.total;
        ctx.metrics.adoptedRootsKept = kept.styles.adopted;
        ctx.metrics.adoptedRoots = releasedFull.styles.adopted;
        ctx.metrics.adoptedRootsTrimmed = releasedTrimmed.styles.adopted;
        ctx.metrics.shadowRoots = releasedFull.styles.hosts;
        expectNone(releasedFull.report.errors, 'HydrationReport.errors (full, removeStyles=1)');
        expectNone(releasedTrimmed.report.errors, 'HydrationReport.errors (trimmed, removeStyles=1)');
        expectNone(releasedFull.errors, 'console errors during load (full, removeStyles=1)');
        expectNone(releasedTrimmed.errors, 'console errors during load (trimmed, removeStyles=1)');
        expect(kept.styles.total, 'the control page (complete server styles kept) has <style> elements in sp-* shadow roots').toBeGreaterThan(0);
        const leftover = (styles: ShadowStyles, label: string): string[] =>
          Object.entries(styles.byTag).map(([tag, count]) => `${label}: ${tag} x${count}`);
        expectNone(
          [...leftover(releasedFull.styles, 'full'), ...leftover(releasedTrimmed.styles, 'trimmed')],
          'sp-* shadow roots that still hold a <style> element after hydration with removeStyles=1',
        );

        // The released pages look like the page that kept its styles (the control).
        const keptSets = [kept.set];
        const fullSets = [releasedFull.set];
        const trimmedSets = [releasedTrimmed.set];
        const labels = kept.set.shots.map((shot) => shot.label);
        const open = (): string[] =>
          labels.filter((label) => !matchesAnywhere(label, keptSets, fullSets) || !matchesAnywhere(label, keptSets, trimmedSets));
        for (let attempt = 2, pending = open(); attempt <= ATTEMPTS && pending.length > 0; attempt++) {
          keptSets.push((await hydrated('full', [], kept.set, pending)).set);
          fullSets.push((await hydrated('full', ['removeStyles=1'], kept.set, pending)).set);
          trimmedSets.push((await hydrated('trimmed', ['removeStyles=1'], kept.set, pending)).set);
          pending = open();
        }
        ctx.metrics.attempts = keptSets.length;
        const wrongFull = labels.filter((label) => !matchesAnywhere(label, keptSets, fullSets));
        const wrongTrimmed = labels.filter((label) => !matchesAnywhere(label, keptSets, trimmedSets));
        const vsFull = compareShots(target, 'release.full', kept.set, releasedFull.set, {
          otherLabel: 'removed-full',
          referenceLabel: 'kept',
          only: wrongFull,
        });
        const vsTrimmed = compareShots(target, 'release.trimmed', kept.set, releasedTrimmed.set, {
          otherLabel: 'removed-trimmed',
          referenceLabel: 'kept',
          only: wrongTrimmed,
        });
        ctx.metrics.diffPixels = vsFull.diffPixels + vsTrimmed.diffPixels;
        ctx.metrics.diffPixelsTrimmed = vsTrimmed.diffPixels;
        ctx.metrics.mismatchedSections = vsFull.mismatches.length + vsTrimmed.mismatches.length;
        const images = [...vsFull.files, ...vsTrimmed.files];
        if (images.length > 0) ctx.metrics.images = images.join(', ');
        expect(
          [
            ...(wrongFull.length > 0 ? [`full CSS: ${describeMismatches(vsFull, 'removed')}`] : []),
            ...(wrongTrimmed.length > 0 ? [`trimmed CSS: ${describeMismatches(vsTrimmed, 'removed')}`] : []),
          ],
          `after removeServerStyles the hydrated page differs from the one that kept the server styles. Images: ${images.join(', ')}`,
        ).toEqual([]);
      });
    });

    test('size', async ({request}, testInfo) => {
      await step(testInfo, row, 'styles-size', async (ctx) => {
        const timeout = isPage ? PAGE_NAV_TIMEOUT_MS : 60_000;
        const full = await fetchStylesInfo(request, target, 'full', timeout);
        const trimmed = await fetchStylesInfo(request, target, 'trimmed', timeout);
        const minified = await fetchStylesInfo(request, target, 'minified', timeout);
        const m: Metrics = ctx.metrics;
        m.cssFull = full.cssBytes;
        m.cssTrimmed = trimmed.cssBytes;
        m.cssMinified = minified.cssBytes;
        m.htmlFull = full.htmlBytes;
        m.htmlTrimmed = trimmed.htmlBytes;
        m.htmlMinified = minified.htmlBytes;
        m.gzipFull = full.gzipBytes;
        m.gzipTrimmed = trimmed.gzipBytes;
        m.gzipMinified = minified.gzipBytes;
        m.reported = trimmed.reported;
        m.reportedFull = trimmed.reported ? trimmed.fullBytes : null;
        m.reportedTrimmed = trimmed.reported ? trimmed.trimmedBytes : null;
        m.sheets = trimmed.sheets.length;
        m.share = full.cssBytes > 0 ? trimmed.cssBytes / full.cssBytes : null;
        m.under25 = full.cssBytes > 0 && trimmed.cssBytes < 0.25 * full.cssBytes;
        if (!m.under25 && full.cssBytes > 0) {
          ctx.note(`trimmed CSS is ${(((m.share as number) || 0) * 100).toFixed(1)} % of the full CSS (target < 25 %; ${kib(full.cssBytes)} -> ${kib(trimmed.cssBytes)} KiB)`);
        }
        expect(trimmed.cssBytes, `trimmed CSS (${kib(trimmed.cssBytes)} KiB) must be smaller than the full CSS (${kib(full.cssBytes)} KiB)`).toBeLessThan(full.cssBytes);
        if (trimmed.reported) {
          expect.soft(trimmed.trimmedBytes, 'report.styles.trimmedBytes must not exceed report.styles.fullBytes').toBeLessThanOrEqual(trimmed.fullBytes);
        }
      });
    });
  });
}

// The oracle only means something if the comparison forgives nothing.
test.describe('styles: pixel comparison', () => {
  const image = (width: number, height: number, tweak?: (png: PNG) => void): Buffer => {
    const png = new PNG({width, height});
    for (let i = 0; i < png.data.length; i += 4) png.data.set([200, 100, 50, 255], i);
    tweak?.(png);
    return PNG.sync.write(png);
  };

  test('identical images have no difference', () => {
    const diff = exactDiff(image(8, 8), image(8, 8));
    expect(diff.diffPixels).toBe(0);
    expect(diff.identical).toBe(true);
  });

  test('a single pixel that differs by one level of one channel is a difference', () => {
    const diff = exactDiff(image(8, 8), image(8, 8, (png) => (png.data[(3 * 8 + 4) * 4 + 2] = 51)));
    expect(diff.diffPixels).toBe(1);
    expect(diff.identical).toBe(false);
  });

  test('a different size is flagged', () => {
    const diff = exactDiff(image(8, 8), image(8, 9));
    expect(diff.sizeChanged).toBe(true);
    expect(diff.identical).toBe(false);
  });
});

// Entries of the catalog (after SWC_SSR_COMPONENTS / SWC_SSR_SMOKE) ...
for (const entry of selectedEntries) {
  registerTargetTests({row: entry.name, name: entry.name, interactive: entry.interactive}, ENTRY_TEST_TIMEOUT_MS);
}

// ... and the whole-catalog page.
const pageSwitch = process.env.SWC_SSR_STYLES_PAGE;
const filtered = [process.env.SWC_SSR_COMPONENTS, process.env.SWC_SSR_SMOKE].some(
  (value) => value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false',
);
const includePage = pageSwitch === '1' || (pageSwitch !== '0' && !filtered);
if (includePage && allEntries.length > 0) {
  registerTargetTests({row: STYLES_PAGE_ROW, interactive: false}, PAGE_TEST_TIMEOUT_MS);
}
