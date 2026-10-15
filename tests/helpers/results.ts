import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TestInfo} from '@playwright/test';

/**
 * Shared results store. Every check appends one JSON line to the run's raw file, so that the summary can be produced
 * by the global teardown even when tests fail or time out.
 *
 * A complete run uses `tests/results/raw.jsonl` and writes `tests/results/summary.md` (the support matrix). A narrowed
 * run (`SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`, see `narrowedBy`) must not replace that matrix with a partial table: it
 * writes `tests/results/summary.partial.md`, from a raw file of its own (`raw.partial-<time>-<pid>.jsonl`, handed to the
 * workers through `RAW_FILE_ENV` by the global setup), so that narrowed runs at the same time do not mix their records.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = path.resolve(here, '..');
export const RESULTS_DIR = path.join(TESTS_DIR, 'results');
export const SCREENSHOT_DIR = path.join(RESULTS_DIR, 'screenshots');
export const FIDELITY_DIR = path.join(RESULTS_DIR, 'fidelity');
export const RAW_FILE = path.join(RESULTS_DIR, 'raw.jsonl');
export const SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.md');
/** Summary of a narrowed run (never `summary.md`). */
export const PARTIAL_SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.partial.md');
/** The raw file of this run, when it is not `RAW_FILE`: set by the global setup, inherited by the workers. */
export const RAW_FILE_ENV = 'SWC_SSR_RAW_FILE';
const PARTIAL_RAW_PREFIX = 'raw.partial-';
/** Raw files of narrowed runs older than this are deleted by the global setup of a later narrowed run. */
const PARTIAL_RAW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Why this run covers only part of the catalog (`SWC_SSR_COMPONENTS=...`, `SWC_SSR_SMOKE=...`), or undefined for a
 * complete run. The same reading of the variables as tests/helpers/catalog.ts.
 */
export function narrowedBy(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const reasons: string[] = [];
  const components = env.SWC_SSR_COMPONENTS;
  if (components !== undefined && components.trim() !== '') reasons.push(`SWC_SSR_COMPONENTS=${components.trim()}`);
  const smoke = env.SWC_SSR_SMOKE;
  if (smoke !== undefined && smoke !== '' && smoke !== '0' && smoke.toLowerCase() !== 'false') reasons.push(`SWC_SSR_SMOKE=${smoke}`);
  return reasons.length > 0 ? reasons.join(', ') : undefined;
}

/** The raw file records go to (and the teardown reads). */
export function rawFile(): string {
  const file = process.env[RAW_FILE_ENV];
  return file !== undefined && file !== '' ? file : RAW_FILE;
}

/** Where the global teardown writes the summary of this run. */
export function summaryFile(): string {
  return narrowedBy() ? PARTIAL_SUMMARY_FILE : SUMMARY_FILE;
}

/**
 * `csr` is only recorded for whole pages (tests/all-components.spec.ts): the client-rendered reference page.
 * The `styles-*` checks belong to tests/styles.spec.ts (optional trimmed CSS, docs/API.md "Styles"): `styles-oracle` /
 * `styles-minified` trimmed / minified CSS renders pixel-identically to the full CSS, `styles-states` the same for
 * hover and focus, `styles-hydration` hydration (and flicker) of a trimmed page, `styles-restore` the held (late)
 * hydration against the full CSS, `styles-post` the hydrated trimmed / minified page against the hydrated full-CSS page
 * (normal timing), `styles-post-states` the same after hover / focus / click and DOM changes made after hydration,
 * `styles-release` the client's `removeServerStyles`, `styles-size` the CSS bytes. tests/styles-late.spec.ts adds
 * `styles-late` (a definition held back until after hydration, `?late=<tag>`: trimmed / minified equal full before and
 * after it arrives), `styles-app-mod` (an application stylesheet that sets Spectrum's `--mod-*` hooks) and
 * `styles-no-cssom` (swc-ssr/client on its path for browsers without constructable stylesheets).
 */
export type CheckName =
  | 'ssr'
  | 'ssr-errors'
  | 'nojs'
  | 'hydration'
  | 'flicker'
  | 'fidelity'
  | 'interaction'
  | 'csr'
  | 'styles-oracle'
  | 'styles-minified'
  | 'styles-states'
  | 'styles-hydration'
  | 'styles-restore'
  | 'styles-post'
  | 'styles-post-states'
  | 'styles-release'
  | 'styles-size'
  | 'styles-late'
  | 'styles-app-mod'
  | 'styles-no-cssom';
export type CheckStatus = 'pass' | 'fail' | 'skip';
export type MetricValue = string | number | boolean | null;
export type Metrics = Record<string, MetricValue>;

export interface ResultRecord {
  component: string;
  check: CheckName;
  status: CheckStatus;
  metrics: Metrics;
  note?: string;
  at: string;
}

export interface NewResult {
  component: string;
  check: CheckName;
  status: CheckStatus;
  metrics?: Metrics;
  note?: string;
}

/** (component, check) pairs recorded by this worker process; used by the afterEach fallback. */
const recordedInProcess = new Set<string>();

export function ensureResultDirs(): void {
  fs.mkdirSync(SCREENSHOT_DIR, {recursive: true});
  fs.mkdirSync(FIDELITY_DIR, {recursive: true});
}

/**
 * Start of a run (global setup): a complete run clears `RAW_FILE`; a narrowed run gets a raw file of its own (published
 * through `RAW_FILE_ENV` for the workers) and leaves `RAW_FILE` alone. Raw files of old narrowed runs are deleted.
 * Returns the raw file of the run.
 */
export function resetResults(): string {
  ensureResultDirs();
  if (!narrowedBy()) {
    delete process.env[RAW_FILE_ENV];
    fs.writeFileSync(RAW_FILE, '');
    return RAW_FILE;
  }
  const now = Date.now();
  for (const name of fs.readdirSync(RESULTS_DIR)) {
    if (!name.startsWith(PARTIAL_RAW_PREFIX)) continue;
    const file = path.join(RESULTS_DIR, name);
    try {
      if (now - fs.statSync(file).mtimeMs > PARTIAL_RAW_MAX_AGE_MS) fs.rmSync(file, {force: true});
    } catch {
      /* removed by another run meanwhile */
    }
  }
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(RESULTS_DIR, `${PARTIAL_RAW_PREFIX}${stamp}-${process.pid}.jsonl`);
  fs.writeFileSync(file, '');
  process.env[RAW_FILE_ENV] = file;
  return file;
}

export function recordResult(result: NewResult): void {
  ensureResultDirs();
  const record: ResultRecord = {
    component: result.component,
    check: result.check,
    status: result.status,
    metrics: result.metrics ?? {},
    ...(result.note ? {note: result.note} : {}),
    at: new Date().toISOString(),
  };
  fs.appendFileSync(rawFile(), JSON.stringify(record) + '\n');
  recordedInProcess.add(`${result.component}\u0000${result.check}`);
}

export function wasRecorded(component: string, check: CheckName): boolean {
  return recordedInProcess.has(`${component}\u0000${check}`);
}

/** Reads all records; tolerates a missing file and truncated/invalid lines. Later records win per (component, check). */
export function readResults(): ResultRecord[] {
  let text = '';
  try {
    text = fs.readFileSync(rawFile(), 'utf8');
  } catch {
    return [];
  }
  const records: ResultRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ResultRecord;
      if (parsed && typeof parsed.component === 'string' && typeof parsed.check === 'string') records.push(parsed);
    } catch {
      /* ignore a partially written line */
    }
  }
  return records;
}

// ---------------------------------------------------------------------------------------------
// step(): run one check, always record its outcome (and metrics) before re-throwing
// ---------------------------------------------------------------------------------------------

export interface StepContext {
  /** Fill while the check runs; recorded for both passing and failing checks. */
  metrics: Metrics;
  /** Free-text remark that ends up in the Notes column of the summary. */
  note(text: string): void;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * One-line description of a failure: the first non-empty message line without the "Error: " prefix. For assertions
 * with a custom message (`expect(x, 'message')`) that line is the custom message, which is what the summary shows.
 */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const first =
    raw
      .replace(ANSI, '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? 'failed';
  const text = first.replace(/^Error:\s*/, '');
  return text.length > 400 ? text.slice(0, 397) + '...' : text;
}

/**
 * Runs `body`, then records pass/fail for (component, check). Soft assertions (`expect.soft`) that fail
 * inside `body` are detected through `testInfo.errors` and also mark the check as failed. A thrown error
 * is re-thrown after recording so Playwright still reports the failure.
 */
export async function step(
  testInfo: TestInfo,
  component: string,
  check: CheckName,
  body: (ctx: StepContext) => Promise<void>,
): Promise<void> {
  const errorsBefore = testInfo.errors.length;
  const notes: string[] = [];
  const ctx: StepContext = {metrics: {}, note: (text) => notes.push(text)};
  let thrown: unknown;
  let didThrow = false;
  try {
    await body(ctx);
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  const timedOut = testInfo.status === 'timedOut';
  // The runner's own "Test timeout of Nms exceeded." entry is reported once, as "test timed out" below.
  const softFailures = testInfo.errors
    .slice(errorsBefore)
    .map((e) => errorMessage(e.message ?? ''))
    .filter((message) => !/^Test timeout of/.test(message));
  const failed = didThrow || timedOut || softFailures.length > 0;
  const thrownText = timedOut ? `test timed out after ${testInfo.timeout} ms` : didThrow ? errorMessage(thrown) : '';
  const failureText = [...softFailures, thrownText].filter(Boolean).join(' | ');
  const note = [...notes, failed ? failureText : ''].filter(Boolean).join('; ');
  recordResult({component, check, status: failed ? 'fail' : 'pass', metrics: ctx.metrics, note: note || undefined});
  if (didThrow) throw thrown;
}
