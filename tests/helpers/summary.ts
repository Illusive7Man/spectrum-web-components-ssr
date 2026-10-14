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
const PAGE_ROUTES: Record<string, string> = {[ALL_COMPONENTS_ROW]: '`/`, `/csr`'};
const PAGE_CHECKS: CheckName[] = ['ssr', 'ssr-errors', 'hydration', 'csr'];

export function isPageRow(row: Row): boolean {
  return Object.prototype.hasOwnProperty.call(PAGE_ROUTES, row.component);
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

function pageNotesCell(row: Row): string {
  const notes: string[] = [];
  for (const check of PAGE_CHECKS) {
    const rec = row.checks[check];
    if (rec?.status === 'fail' && rec.note) notes.push(`${check}: ${truncate(rec.note, 200)}`);
  }
  return notes.join('; ');
}

/** A page is green when its SSR markup, render report, hydration and client-rendered reference all passed. */
export function isPageGreen(row: Row): boolean {
  return PAGE_CHECKS.every((check) => row.checks[check]?.status === 'pass');
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
  const rows = allRows.filter((row) => !isPageRow(row));
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
    'pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated sp-* elements.');
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
    lines.push('');
    lines.push('| Page | Routes | SSR | Hydration | CSR | Notes |');
    lines.push('|---|---|---|---|---|---|');
    for (const row of pageRows) {
      lines.push(
        '| ' +
          [row.component, PAGE_ROUTES[row.component] ?? '', ssrCell(row), hydrationCell(row), csrCell(row), pageNotesCell(row)]
            .map(cell)
            .join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
