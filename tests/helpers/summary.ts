import type {CheckName, ResultRecord} from './results.ts';
import {CLS_MAX, FLICKER_MAX} from './thresholds.ts';

/** Pure markdown builder for `tests/results/summary.md` (the support matrix). */

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

export function buildSummary(records: ResultRecord[], now: Date = new Date()): string {
  const allRows = groupByComponent(records);
  const pageRows = allRows.filter(isPageRow);
  const mobileRows = allRows.filter(isMobileRow);
  const rows = allRows.filter((row) => !isPageRow(row) && !isMobileRow(row));
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
  lines.push('# Spectrum SSR support matrix');
  lines.push('');
  lines.push(`- Run: ${now.toISOString()}`);
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
  lines.push('| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|');
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
          notesCell(row),
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    );
  }
  if (rows.length === 0) lines.push('| _no results recorded_ | | | | | | | |');
  lines.push('');
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
