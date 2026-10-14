import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TestInfo} from '@playwright/test';

/**
 * Shared results store. Every check appends one JSON line to `tests/results/raw.jsonl`, so that
 * `tests/results/summary.md` can be produced by the global teardown even when tests fail or time out.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = path.resolve(here, '..');
export const RESULTS_DIR = path.join(TESTS_DIR, 'results');
export const SCREENSHOT_DIR = path.join(RESULTS_DIR, 'screenshots');
export const FIDELITY_DIR = path.join(RESULTS_DIR, 'fidelity');
export const RAW_FILE = path.join(RESULTS_DIR, 'raw.jsonl');
export const SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.md');

/** `csr` is only recorded for whole pages (tests/all-components.spec.ts): the client-rendered reference page. */
export type CheckName = 'ssr' | 'ssr-errors' | 'nojs' | 'hydration' | 'flicker' | 'fidelity' | 'interaction' | 'csr';
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

export function resetResults(): void {
  ensureResultDirs();
  fs.writeFileSync(RAW_FILE, '');
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
  fs.appendFileSync(RAW_FILE, JSON.stringify(record) + '\n');
  recordedInProcess.add(`${result.component}\u0000${result.check}`);
}

export function wasRecorded(component: string, check: CheckName): boolean {
  return recordedInProcess.has(`${component}\u0000${check}`);
}

/** Reads all records; tolerates a missing file and truncated/invalid lines. Later records win per (component, check). */
export function readResults(): ResultRecord[] {
  let text = '';
  try {
    text = fs.readFileSync(RAW_FILE, 'utf8');
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
