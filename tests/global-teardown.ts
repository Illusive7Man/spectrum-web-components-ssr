import fs from 'node:fs';
import {ensureResultDirs, narrowedBy, rawFile, readResults, summaryFile} from './helpers/results.ts';
import {buildSummary} from './helpers/summary.ts';

/**
 * Turns the run's raw results into the summary: `tests/results/summary.md` (the support matrix) for a complete run,
 * `tests/results/summary.partial.md` for a narrowed one (`SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`), which must not
 * replace the matrix with a partial table. Runs even when tests failed, because every check records its outcome before
 * it asserts/throws.
 */
export default async function globalTeardown(): Promise<void> {
  ensureResultDirs();
  const records = readResults();
  const file = summaryFile();
  const narrowed = narrowedBy();
  fs.writeFileSync(file, buildSummary(records, new Date(), narrowed ? {narrowedBy: narrowed, rawFile: rawFile()} : {}));
  console.log(`[swc-ssr] wrote ${file} (${records.length} recorded checks)`);
}
