import fs from 'node:fs';
import {ensureResultDirs, readResults, SUMMARY_FILE} from './helpers/results.ts';
import {buildSummary} from './helpers/summary.ts';

/**
 * Turns `tests/results/raw.jsonl` into `tests/results/summary.md` (the support matrix).
 * Runs even when tests failed, because every check records its outcome before it asserts/throws.
 */
export default async function globalTeardown(): Promise<void> {
  ensureResultDirs();
  const records = readResults();
  fs.writeFileSync(SUMMARY_FILE, buildSummary(records, new Date()));
  console.log(`[swc-ssr] wrote ${SUMMARY_FILE} (${records.length} recorded checks)`);
}
