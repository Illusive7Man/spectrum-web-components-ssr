import path from 'node:path';
import type {CheckName, ResultRecord} from './results.ts';
import {CLS_MAX, FLICKER_MAX} from './thresholds.ts';

/** Pure markdown builder for `tests/results/summary.md` (the support matrix; `summary.partial.md` for narrowed runs). */

export interface Row {
  component: string;
  checks: Partial<Record<CheckName, ResultRecord>>;
}

const COLUMN_CHECKS: CheckName[] = ['ssr', 'ssr-errors', 'nojs', 'hydration', 'flicker', 'fidelity', 'interaction'];

/** Result rows of whole pages (not catalog components): reported in their own table, not counted as components. */
export const ALL_COMPONENTS_ROW = 'all-components';
/** tests/agnostic.spec.ts: the framework-agnostic hydration path (no template) on a non-`sp-*` Spectrum element. */
export const AGNOSTIC_ROW = 'agnostic: overlay-trigger';
/** tests/locale.spec.ts: a server render with a request language. */
export const LOCALE_ROW = 'locale: number-field';

interface PageDefinition {
  routes: string;
  /** Checks the page must pass to count as green. */
  checks: CheckName[];
}

const PAGES: Record<string, PageDefinition> = {
  [ALL_COMPONENTS_ROW]: {routes: '`/`, `/csr`', checks: ['ssr', 'ssr-errors', 'hydration', 'csr']},
  [AGNOSTIC_ROW]: {routes: '`/component/overlay-trigger?agnostic=1`', checks: ['hydration', 'interaction']},
  [LOCALE_ROW]: {routes: '`/component/number-field?lang=de`, `/csr/number-field?lang=de`', checks: ['ssr', 'hydration', 'fidelity']},
};
/**
 * Every check that can appear in a Pages row (and its notes). A recorded check a page does not list in `checks` is a
 * soft check: shown, not counted for green (all-components: fidelity of the slider section of `/` vs
 * `/component/slider`, tests/all-components.spec.ts, which never fails the run).
 */
const PAGE_CHECKS: CheckName[] = ['ssr', 'ssr-errors', 'hydration', 'csr', 'interaction', 'fidelity'];

export function isPageRow(row: Row): boolean {
  return Object.prototype.hasOwnProperty.call(PAGES, row.component);
}

/**
 * tests/styles.spec.ts, the whole-catalog page `/` with trimmed CSS. Its row is not a component (and not a Pages row): it
 * feeds the totals of the "Styles" section. The styles checks of the catalog entries are recorded on the component rows.
 */
export const STYLES_PAGE_ROW = 'styles: /';

export function isStylesPageRow(row: Row): boolean {
  return row.component === STYLES_PAGE_ROW;
}

/** The checks of tests/styles.spec.ts (optional trimmed CSS), in the order of the Styles table. */
const STYLE_CHECKS: CheckName[] = [
  'styles-oracle',
  'styles-minified',
  'styles-states',
  'styles-hydration',
  'styles-restore',
  'styles-post',
  'styles-post-states',
  'styles-release',
  'styles-size',
  'styles-late',
  'styles-app-mod',
  'styles-no-cssom',
];

/** Result rows of the phone emulation (tests/mobile.spec.ts), one per component: `mobile: <name>`. */
const MOBILE_PREFIX = 'mobile: ';
export const mobileRow = (name: string): string => `${MOBILE_PREFIX}${name}`;
const MOBILE_CHECKS: CheckName[] = ['hydration', 'interaction'];

export function isMobileRow(row: Row): boolean {
  return row.component.startsWith(MOBILE_PREFIX);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function groupByComponent(records: ResultRecord[]): Row[] {
  const rows = new Map<string, Row>();
  for (const record of records) {
    let row = rows.get(record.component);
    if (!row) {
      row = {component: record.component, checks: {}};
      rows.set(record.component, row);
    }
    row.checks[record.check] = record; // later records win
  }
  return [...rows.values()];
}

function ssrCell(row: Row): string {
  const {ssr, nojs} = row.checks;
  const errs = row.checks['ssr-errors'];
  if (!ssr && !errs && !nojs) return '-';
  const problems: string[] = [];
  if (ssr?.status === 'fail') problems.push('markup FAIL');
  if (errs?.status === 'fail') {
    const n = num(errs.metrics.erroredElements);
    problems.push(n !== undefined ? `${n} element error${n === 1 ? '' : 's'}` : 'element errors');
  }
  if (nojs?.status === 'fail') problems.push('no-js FAIL');
  if (problems.length > 0) return problems.join(', ');
  return ssr || errs ? 'ok' : 'no-js only';
}

function hydrationCell(row: Row): string {
  const rec = row.checks.hydration;
  if (!rec) return '-';
  const n = num(rec.metrics.hydratedCount);
  if (rec.status === 'pass') return n !== undefined ? `ok (${n})` : 'ok';
  return 'FAIL';
}

function flickerCell(row: Row): string {
  const rec = row.checks.flicker;
  if (!rec) return '-';
  const ratio = num(rec.metrics.ratio);
  const text = ratio !== undefined ? (ratio * 100).toFixed(3) : 'n/a';
  return rec.status === 'fail' ? `${text} FAIL` : text;
}

function clsCell(row: Row): string {
  const rec = row.checks.flicker;
  const cls = rec ? num(rec.metrics.cls) : undefined;
  return cls !== undefined ? cls.toFixed(4) : '-';
}

function fidelityCell(row: Row): string {
  const rec = row.checks.fidelity;
  if (!rec) return '-';
  if (rec.status === 'pass') return 'ok';
  const removed = num(rec.metrics.diffRemoved);
  const added = num(rec.metrics.diffAdded);
  return removed !== undefined && added !== undefined ? `FAIL (-${removed}/+${added} lines)` : 'FAIL';
}

function interactionCell(row: Row): string {
  const rec = row.checks.interaction;
  if (!rec) return '-';
  return rec.status === 'pass' ? 'ok' : rec.status === 'skip' ? 'skip' : 'FAIL';
}

function notesCell(row: Row): string {
  const notes: string[] = [];
  for (const check of COLUMN_CHECKS) {
    const rec = row.checks[check];
    if (rec?.status === 'fail' && rec.note) notes.push(`${check}: ${truncate(rec.note, 200)}`);
  }
  const catalogNotes = row.checks.ssr?.metrics.catalogNotes;
  if (typeof catalogNotes === 'string' && catalogNotes) notes.push(`known: ${truncate(catalogNotes, 160)}`);
  const skippedBy = row.checks.interaction?.status === 'skip' ? row.checks.interaction.note : undefined;
  if (skippedBy) notes.push(skippedBy);
  return notes.join('; ');
}

function csrCell(row: Row): string {
  const rec = row.checks.csr;
  if (!rec) return '-';
  const n = num(rec.metrics.renderedCount);
  if (rec.status === 'pass') return n !== undefined ? `ok (${n})` : 'ok';
  return 'FAIL';
}

/** A soft fidelity check of a page section (see PAGE_CHECKS): `ok` or `differs (-a/+b lines)`. */
function pageFidelityCell(row: Row): string {
  const rec = row.checks.fidelity;
  if (!rec) return '-';
  const what = typeof rec.metrics.section === 'string' ? `${rec.metrics.section}: ` : '';
  if (rec.status === 'pass') return `${what}ok`;
  if (rec.status === 'skip') return `${what}skip`;
  const removed = num(rec.metrics.diffRemoved);
  const added = num(rec.metrics.diffAdded);
  return `${what}differs${removed !== undefined && added !== undefined ? ` (-${removed}/+${added} lines)` : ''}`;
}

function mobileHydrationCell(row: Row): string {
  const rec = row.checks.hydration;
  if (!rec) return '-';
  const n = num(rec.metrics.hydratedCount);
  if (rec.status === 'pass') return n !== undefined ? `ok (${n})` : 'ok';
  return 'FAIL';
}

function mobileFlickerCell(row: Row): string {
  const rec = row.checks.hydration;
  const ratio = rec ? num(rec.metrics.ratio) : undefined;
  return ratio !== undefined ? (ratio * 100).toFixed(3) : '-';
}

function mobileNotesCell(row: Row): string {
  const notes: string[] = [];
  for (const check of MOBILE_CHECKS) {
    const rec = row.checks[check];
    if (rec?.status === 'fail' && rec.note) notes.push(`${check}: ${truncate(rec.note, 200)}`);
  }
  return notes.join('; ');
}

function pageNotesCell(row: Row): string {
  const notes: string[] = [];
  for (const check of PAGE_CHECKS) {
    const rec = row.checks[check];
    if (rec?.status === 'fail' && rec.note) notes.push(`${check}: ${truncate(rec.note, 200)}`);
  }
  return notes.join('; ');
}

/**
 * A page is green when every check of its definition passed (all-components: SSR markup, render report, hydration
 * and the client-rendered reference; soft checks are not part of it).
 */
export function isPageGreen(row: Row): boolean {
  const checks = PAGES[row.component]?.checks ?? [];
  return checks.length > 0 && checks.every((check) => row.checks[check]?.status === 'pass');
}

/** Section fidelity in the Pages table: soft for all-components (`differs`), a real check for the locale page. */
function pageFidelity(row: Row): string {
  const soft = !(PAGES[row.component]?.checks ?? []).includes('fidelity');
  if (!soft) return fidelityCell(row);
  return pageFidelityCell(row);
}

/** A component is fully green when every check that matters ran and passed (interaction only if it ran). */
export function isFullyGreen(row: Row): boolean {
  const required: CheckName[] = ['ssr', 'ssr-errors', 'nojs', 'hydration', 'flicker', 'fidelity'];
  if (!required.every((check) => row.checks[check]?.status === 'pass')) return false;
  const interaction = row.checks.interaction;
  return !interaction || interaction.status !== 'fail';
}

const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

/** `full -> trimmed (minified)` in KiB, from the metrics of a `styles-size` record; `-` when it did not run. */
function kbChain(metrics: ResultRecord['metrics'] | undefined, keys: [string, string, string]): string {
  if (!metrics) return '-';
  const [full, trimmed, minified] = keys.map((key) => num(metrics[key]));
  if (full === undefined || trimmed === undefined) return '-';
  return `${kb(full)} -> ${kb(trimmed)}${minified !== undefined ? ` (${kb(minified)})` : ''}`;
}

function cssCell(row: Row): string {
  return kbChain(row.checks['styles-size']?.metrics, ['cssFull', 'cssTrimmed', 'cssMinified']);
}

function styleStatus(row: Row, check: CheckName, detail?: (record: ResultRecord) => string): string {
  const rec = row.checks[check];
  if (!rec) return '-';
  if (rec.status === 'pass') return 'ok';
  if (rec.status === 'skip') return 'skip';
  return `FAIL${detail ? detail(rec) : ''}`;
}

const pixels = (record: ResultRecord): string => {
  const n = num(record.metrics.diffPixels);
  return n !== undefined && n > 0 ? ` (${n} px)` : '';
};

function styleFlickerCell(row: Row): string {
  const rec = row.checks['styles-hydration'];
  const ratio = rec ? num(rec.metrics.ratio) : undefined;
  if (ratio === undefined) return '-';
  const text = (ratio * 100).toFixed(3);
  return rec?.metrics.excusedByFull === true ? `${text} (as full)` : text;
}

function shareCell(row: Row): string {
  const share = num(row.checks['styles-size']?.metrics.share);
  return share === undefined ? '-' : `${(share * 100).toFixed(1)} %`;
}

function styleNotesCell(row: Row): string {
  const notes: string[] = [];
  for (const check of STYLE_CHECKS) {
    const rec = row.checks[check];
    const alwaysNoted: CheckName[] = ['styles-size', 'styles-hydration', 'styles-restore', 'styles-post', 'styles-post-states', 'styles-release'];
    if (rec?.note && (rec.status === 'fail' || alwaysNoted.includes(check))) {
      notes.push(`${check.slice('styles-'.length)}: ${truncate(rec.note, 200)}`);
    }
  }
  return notes.join('; ');
}

/** A component is green for the styles checks when it ran at least one and none failed. */
function isStylesGreen(row: Row): boolean {
  const ran = STYLE_CHECKS.filter((check) => row.checks[check]);
  return ran.length > 0 && ran.every((check) => row.checks[check]!.status !== 'fail');
}

/**
 * The "Styles" section (tests/styles.spec.ts): oracle / hydration / release outcomes per component, and the CSS
 * totals: the sums over the catalog entries' own pages, and the whole-catalog page `/` (full vs trimmed vs minified).
 * Empty when the styles spec did not run.
 */
function stylesSection(rows: Row[], pageRow: Row | undefined): string[] {
  const styleRows = rows.filter((row) => STYLE_CHECKS.some((check) => row.checks[check]));
  if (styleRows.length === 0 && !pageRow) return [];
  const lines: string[] = [];
  const green = styleRows.filter(isStylesGreen).length;
  lines.push('## Styles (optional trimmed CSS, tests/styles.spec.ts)');
  lines.push('');
  lines.push(
    `- **${green}/${styleRows.length} components green**${pageRow ? `; page \`/\`: ${STYLE_CHECKS.every((check) => pageRow.checks[check]?.status !== 'fail') ? 'green' : 'FAIL'}` : ''}`,
  );
  lines.push(
    '- Oracle = no JavaScript, same viewport and clip, `?styles=trimmed` (`minified`) vs `?styles=full`: 0 differing pixels ' +
      '(pixelmatch threshold 0, anti-aliased pixels counted). States = hover, then focus, of the first interactive control. ' +
      'Hydration / Flicker % = `?styles=trimmed` (`minified`) hydrates cleanly and its pure-SSR paint equals the hydrated paint (`as full`: over the ' +
      'threshold with the full CSS too). Restore = the hydrated trimmed / minified page against the hydrated full-CSS page, 0 differing pixels, in three ' +
      'moments: after every element is defined but none hydrated (`<sp-theme>` has already replaced its server styles), after hydration, and after ' +
      'setting states the server did not render (selected, quiet, invalid, checked, disabled, ...) on every sp-* element; afterwards no marked server ' +
      '`<style>` is left. Post = the same at normal timing (`hydrateSpectrum()` right after the definitions): the hydrated trimmed / minified page ' +
      'equals the hydrated full-CSS page (0 px), no `<style data-swc-styles>` is left in any shadow root, and every hydrated sp-* Lit element runs on ' +
      'adopted sheets. Post states = then hover, focus and click the first control, set `disabled` on it, `size="xl"` on the first button, toggle ' +
      '`quiet`, select the first menu item / tab, set `invalid` on the first text field: every step equals the full-CSS page (0 px). ' +
      'Release = `removeServerStyles`: no `<style>` left in the sp-* shadow roots, and the hydrated paint equals the full-CSS page. ' +
      'Late = tests/styles-late.spec.ts, a definition held back until after hydration (`?late=<tag>`: sp-theme, sp-tab, sp-menu-item, ' +
      'sp-table-cell, and the parents sp-menu, sp-breadcrumbs, sp-table with a state change on their children while they are missing): ' +
      'the trimmed / minified page equals the full-CSS page while it is missing and after it arrived (0 px; late sp-theme on the ' +
      'table page: after it arrived, and the theme-pending warning is reported). ' +
      'App --mod- = an application stylesheet setting the `--mod-*` hooks of Spectrum: trimmed / minified equal full before and after hydration. ' +
      'No CSSOM = the client on its path for browsers without constructable stylesheets: held (theme upgraded, nothing hydrated) and hydrated equal full.',
  );
  lines.push('- Sizes are the text of the `<style>` elements of the served page (KiB); gzip is of the whole html document.');
  lines.push('');

  // Totals over the entries' pages.
  const sized = styleRows.map((row) => row.checks['styles-size']?.metrics).filter((m): m is NonNullable<typeof m> => m !== undefined);
  const sum = (key: string): number => sized.reduce((total, m) => total + (num(m[key]) ?? 0), 0);
  const withSizes = sized.filter((m) => num(m.cssFull) !== undefined);
  if (withSizes.length > 0) {
    lines.push(`Totals over the ${withSizes.length} catalog entries' own pages (each rendered alone):`);
    lines.push('');
    lines.push('| | full | trimmed | minified |');
    lines.push('|---|---|---|---|');
    lines.push(`| CSS KiB | ${kb(sum('cssFull'))} | ${kb(sum('cssTrimmed'))} | ${kb(sum('cssMinified'))} |`);
    lines.push(`| html KiB | ${kb(sum('htmlFull'))} | ${kb(sum('htmlTrimmed'))} | ${kb(sum('htmlMinified'))} |`);
    lines.push(`| gzip KiB | ${kb(sum('gzipFull'))} | ${kb(sum('gzipTrimmed'))} | ${kb(sum('gzipMinified'))} |`);
    lines.push('');
  }

  // The whole-catalog page.
  const page = pageRow?.checks['styles-size']?.metrics;
  if (page && num(page.cssFull) !== undefined) {
    const modes = [
      ['full', 'Full'],
      ['trimmed', 'Trimmed'],
      ['minified', 'Minified'],
    ] as const;
    const pageValue = (suffix: string, mode: string): number | undefined => num(page[`${suffix}${mode}`]);
    lines.push('Whole-catalog page `/`:');
    lines.push('');
    lines.push('| Mode | html KiB | CSS KiB | CSS share of html | CSS vs full | gzip KiB | gzip vs full |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const [mode, suffix] of modes) {
      const html = pageValue('html', suffix);
      const css = pageValue('css', suffix);
      const gzip = pageValue('gzip', suffix);
      const cssFull = pageValue('css', 'Full');
      const gzipFull = pageValue('gzip', 'Full');
      lines.push(
        '| ' +
          [
            mode,
            html !== undefined ? kb(html) : '-',
            css !== undefined ? kb(css) : '-',
            html && css !== undefined ? `${((css / html) * 100).toFixed(1)} %` : '-',
            css !== undefined && cssFull ? `${((css / cssFull) * 100).toFixed(1)} %` : '-',
            gzip !== undefined ? kb(gzip) : '-',
            gzip !== undefined && gzipFull ? `${((gzip / gzipFull) * 100).toFixed(1)} %` : '-',
          ].join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  if (pageRow) {
    const checks = STYLE_CHECKS.filter(
      (check) =>
        check !== 'styles-states' &&
        check !== 'styles-post-states' &&
        check !== 'styles-late' &&
        check !== 'styles-app-mod' &&
        check !== 'styles-no-cssom',
    )
      .map((check) => {
        const rec = pageRow.checks[check];
        const name = check.slice('styles-'.length);
        return `${name} ${rec ? (rec.status === 'pass' ? 'ok' : rec.status === 'skip' ? 'skip' : `FAIL${pixels(rec)}`) : '-'}`;
      })
      .join(', ');
    lines.push(`Page \`/\` checks: ${checks}`);
    const notes = styleNotesCell(pageRow);
    if (notes) lines.push(`Page \`/\` notes: ${notes}`);
    lines.push('');
  }

  lines.push(
    '| Component | Oracle | Minified | States | Hydration | Flicker % | Restore | Post | Post states | Release | Late | App --mod- | No CSSOM | CSS KiB full -> trimmed (minified) | Trimmed share | gzip KiB full -> trimmed (minified) | Notes |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of styleRows) {
    lines.push(
      '| ' +
        [
          row.component,
          styleStatus(row, 'styles-oracle', pixels),
          styleStatus(row, 'styles-minified', pixels),
          styleStatus(row, 'styles-states'),
          styleStatus(row, 'styles-hydration'),
          styleFlickerCell(row),
          styleStatus(row, 'styles-restore', pixels),
          styleStatus(row, 'styles-post', pixels),
          styleStatus(row, 'styles-post-states', pixels),
          styleStatus(row, 'styles-release', pixels),
          styleStatus(row, 'styles-late', pixels),
          styleStatus(row, 'styles-app-mod', pixels),
          styleStatus(row, 'styles-no-cssom', pixels),
          cssCell(row),
          shareCell(row),
          kbChain(row.checks['styles-size']?.metrics, ['gzipFull', 'gzipTrimmed', 'gzipMinified']),
          styleNotesCell(row),
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    );
  }
  lines.push('');
  return lines;
}

/** The checks of tests/styles-dedupe.spec.ts (`StyleOptions.dedupe: 'link'`). */
const DEDUPE_CHECKS: CheckName[] = ['styles-dedupe', 'styles-dedupe-post', 'styles-dedupe-paint'];

/**
 * The "Style de-duplication" section (tests/styles-dedupe.spec.ts): outcomes per component, the page sizes inline vs
 * linked, and the first-frame timings of the paint check. Empty when the spec did not run.
 */
function dedupeSection(rows: Row[]): string[] {
  const dedupeRows = rows.filter((row) => DEDUPE_CHECKS.some((check) => row.checks[check]));
  if (dedupeRows.length === 0) return [];
  const green = dedupeRows.filter((row) => DEDUPE_CHECKS.every((check) => row.checks[check]?.status !== 'fail')).length;
  const lines: string[] = [];
  lines.push("## Style de-duplication (optional `dedupe: 'link'`, tests/styles-dedupe.spec.ts)");
  lines.push('');
  lines.push(`- **${green}/${dedupeRows.length} components green**`);
  lines.push(
    '- Static = no client (`nohydrate=1`, both pages repainted once), `?styles=full|trimmed|minified&dedupe=link` equals `?styles=full` (0 px); every server link loaded; ' +
      'the head preloads exactly the linked URLs; every URL is `text/css`, `immutable`. Post = hydrated (normal timing, then the ' +
      'state groups) and held / released linked pages equal full (0 px); no server link or marked style left; every hydrated sp-* ' +
      'Lit element on adopted sheets. Paint = first frames over an emulated 150 ms round trip, cold and warm cache, with and ' +
      'without head hints, without and with the client: no frame paints content without its sheet (Chromium).',
  );
  lines.push('');
  lines.push(
    '| Component | Static | Post | Paint | html KiB trimmed: inline -> link | linked CSS KiB (sheets / links) | cold DCL ms trimmed: inline -> link (preload / none) | warm DCL ms | Notes |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const row of dedupeRows) {
    const s = row.checks['styles-dedupe']?.metrics;
    const p = row.checks['styles-dedupe-paint']?.metrics;
    const html =
      s && num(s.html_trimmed) !== undefined && num(s.htmlLink_trimmed) !== undefined
        ? `${kb(num(s.html_trimmed)!)} -> ${kb(num(s.htmlLink_trimmed)!)}`
        : '-';
    const css =
      s && num(s.linkedCss_trimmed) !== undefined ? `${kb(num(s.linkedCss_trimmed)!)} (${s.sheets_trimmed} / ${s.links_trimmed})` : '-';
    const ms = (value: unknown): string => (num(value) === undefined ? '-' : String(num(value)));
    const cold = p ? `${ms(p.trimmed_inline_dcl)} -> ${ms(p.trimmed_preload_nojs_cold_dcl)} / ${ms(p.trimmed_none_nojs_cold_dcl)}` : '-';
    const warm = p ? `${ms(p.trimmed_preload_nojs_warm_dcl)} / ${ms(p.trimmed_none_nojs_warm_dcl)}` : '-';
    const notes = DEDUPE_CHECKS.map((check) => row.checks[check])
      .filter((rec): rec is ResultRecord => rec !== undefined && rec.note !== undefined)
      .map((rec) => `${rec.check.slice('styles-'.length)}: ${truncate(rec.note!, 200)}`)
      .join('; ');
    lines.push(
      '| ' +
        [
          row.component,
          styleStatus(row, 'styles-dedupe'),
          styleStatus(row, 'styles-dedupe-post'),
          styleStatus(row, 'styles-dedupe-paint'),
          html,
          css,
          cold,
          warm,
          notes,
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    );
  }
  lines.push('');
  return lines;
}

export interface SummaryOptions {
  /** The run covered only part of the catalog (`SWC_SSR_COMPONENTS=...`): stated at the top of the partial summary. */
  narrowedBy?: string;
  /** Raw results file of a narrowed run. */
  rawFile?: string;
}

export function buildSummary(records: ResultRecord[], now: Date = new Date(), options: SummaryOptions = {}): string {
  const allRows = groupByComponent(records);
  const pageRows = allRows.filter(isPageRow);
  const mobileRows = allRows.filter(isMobileRow);
  const stylesPageRow = allRows.find(isStylesPageRow);
  const rows = allRows.filter((row) => !isPageRow(row) && !isMobileRow(row) && !isStylesPageRow(row));
  const green = rows.filter(isFullyGreen).length;

  const count = (check: CheckName): {ok: number; total: number} => {
    const present = rows.filter((r) => r.checks[check]);
    return {ok: present.filter((r) => r.checks[check]!.status === 'pass').length, total: present.length};
  };
  const ssr = count('ssr');
  const hyd = count('hydration');
  const fl = count('flicker');
  const fid = count('fidelity');
  const inter = count('interaction');

  const lines: string[] = [];
  lines.push(options.narrowedBy ? '# Spectrum SSR support matrix (partial run)' : '# Spectrum SSR support matrix');
  lines.push('');
  lines.push(`- Run: ${now.toISOString()}`);
  if (options.narrowedBy) {
    const raw = options.rawFile ? ` (raw results: ${path.basename(options.rawFile)})` : '';
    lines.push(`- **Narrowed run** (${options.narrowedBy}): only the selected entries; the complete matrix stays in summary.md${raw}`);
  }
  lines.push(`- **${green}/${rows.length} components fully green**`);
  lines.push(
    `- Per check: SSR markup ${ssr.ok}/${ssr.total}, hydration ${hyd.ok}/${hyd.total}, flicker ${fl.ok}/${fl.total}, ` +
      `fidelity ${fid.ok}/${fid.total}, interaction ${inter.ok}/${inter.total}`,
  );
  lines.push(
    `- Thresholds: flicker < ${(FLICKER_MAX * 100).toFixed(3)} % of pixels, CLS < ${CLS_MAX}, ` +
      'fidelity = post-hydration DOM equals the client-rendered DOM',
  );
  lines.push('- Legend: `ok` passed, `FAIL` failed, `-` not run / not applicable. Flicker % = differing pixels between the ' +
    'pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated custom elements (sp-* and others, e.g. overlay-trigger).');
  lines.push('');
  lines.push('| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | CSS KB full -> trimmed (minified) | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      '| ' +
        [
          row.component,
          ssrCell(row),
          hydrationCell(row),
          flickerCell(row),
          clsCell(row),
          fidelityCell(row),
          interactionCell(row),
          cssCell(row),
          notesCell(row),
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    );
  }
  if (rows.length === 0) lines.push('| _no results recorded_ | | | | | | | | |');
  lines.push('');
  lines.push(...stylesSection(rows, stylesPageRow));
  lines.push(...dedupeSection(rows));
  if (pageRows.length > 0) {
    lines.push('## Pages');
    lines.push('');
    lines.push(
      `- **${pageRows.filter(isPageGreen).length}/${pageRows.length} pages green** (SSR markup + render report, ` +
        'hydration without errors / deferred elements / console errors, client-rendered reference page)',
    );
    lines.push(
      '- Fidelity of all-components is a soft check (not counted for green): the hydrated slider section of `/` vs ' +
        'the hydrated `/component/slider` section; both trees are written to tests/results/fidelity/ when they differ. ' +
        'The locale page compares its hydrated SSR section with the client-rendered one (same language).',
    );
    lines.push('');
    lines.push('| Page | Routes | SSR | Hydration | CSR | Interaction | Fidelity | Notes |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const row of pageRows) {
      lines.push(
        '| ' +
          [
            row.component,
            PAGES[row.component]?.routes ?? '',
            ssrCell(row),
            hydrationCell(row),
            csrCell(row),
            interactionCell(row),
            pageFidelity(row),
            pageNotesCell(row),
          ]
            .map(cell)
            .join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  if (mobileRows.length > 0) {
    const green = mobileRows.filter((row) => MOBILE_CHECKS.every((check) => row.checks[check]?.status !== 'fail')).length;
    lines.push('## Mobile (390x844, touch, tests/mobile.spec.ts)');
    lines.push('');
    lines.push(
      `- **${green}/${mobileRows.length} green**: hydration without errors / mismatch recoveries / deferred elements, ` +
        'components in their mobile state afterwards; flicker % between the pure-SSR and the hydrated paint ' +
        '(screenshots `<name>-mobile-{before,after,diff,open}.png`); tapping a picker / action menu opens an sp-tray',
    );
    lines.push('');
    lines.push('| Component | Hydration | Flicker % | Tap opens tray | Notes |');
    lines.push('|---|---|---|---|---|');
    for (const row of mobileRows) {
      lines.push(
        '| ' +
          [
            row.component.slice(MOBILE_PREFIX.length),
            mobileHydrationCell(row),
            mobileFlickerCell(row),
            interactionCell(row),
            mobileNotesCell(row),
          ]
            .map(cell)
            .join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
