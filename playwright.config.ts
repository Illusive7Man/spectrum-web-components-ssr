import {defineConfig, devices} from '@playwright/test';

/**
 * Playwright configuration for the swc-ssr end-to-end suite (see docs/DESIGN.md "Tests").
 *
 * The suite is deliberately serial (one worker, no retries): it shares the demo server's
 * `/report.json` ("report of the last SSR render") and writes its raw results to a single JSONL file.
 *
 * Environment knobs (all optional):
 *   SWC_SSR_COMPONENTS="button,picker"  only run these catalog entries
 *   SWC_SSR_SMOKE=1                     only run the catalog's smoke set
 *   SWC_SSR_FLICKER_MAX=0.002           max fraction of differing pixels before/after hydration
 *   SWC_SSR_CLS_MAX=0.01                max cumulative layout shift
 *   SWC_SSR_BASE_URL=http://localhost:3000   (the port is forwarded to the demo server as PORT)
 */
const BASE_URL = process.env.SWC_SSR_BASE_URL ?? 'http://localhost:3000';
const PORT = new URL(BASE_URL).port || '3000';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {timeout: 10_000},
  reporter: [['list'], ['html', {outputFolder: 'playwright-report', open: 'never'}]],
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    // Screenshots are taken manually by the specs and written to tests/results/screenshots.
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    },
  ],
  webServer: {
    command: 'npm run demo',
    url: `${BASE_URL}/catalog.json`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {PORT},
  },
});
