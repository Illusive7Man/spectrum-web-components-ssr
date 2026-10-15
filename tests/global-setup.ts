import {narrowedBy, resetResults} from './helpers/results.ts';

/**
 * Clears the run's raw results file (and makes sure the results directories exist) at the start of every run:
 * `tests/results/raw.jsonl`, or for a narrowed run (`SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`) a raw file of its own,
 * which the workers find through the environment (tests/helpers/results.ts `RAW_FILE_ENV`).
 */
export default async function globalSetup(): Promise<void> {
  const file = resetResults();
  const narrowed = narrowedBy();
  if (narrowed) console.log(`[swc-ssr] narrowed run (${narrowed}): results go to ${file}, the summary to summary.partial.md`);
}
