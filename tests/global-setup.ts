import {resetResults} from './helpers/results.ts';

/** Clears `tests/results/raw.jsonl` (and makes sure the results directories exist) at the start of every run. */
export default async function globalSetup(): Promise<void> {
  resetResults();
}
