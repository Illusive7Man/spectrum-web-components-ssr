import 'swc-ssr/client'; // must stay the FIRST import: installs lit's hydration support before lit / Spectrum load
import {hydrateSpectrum, hydrationReport} from 'swc-ssr/client';
import type {HydrationReport} from 'swc-ssr/client';
import {render} from 'lit';
import {findEntry} from './catalog/index.js';
import type {CatalogEntry} from './catalog/types.js';
import {pageTemplate} from './page.js';

/**
 * Browser entry of the demo. `#app` is rendered by demo/src/server.ts:
 *   data-mode="ssr"  server-rendered content inside #app  -> hydrate it
 *   data-mode="csr"  empty #app                           -> render the same template client-side (reference DOM)
 *   data-components  comma separated catalog entry names that are on the page
 *
 * Hooks for the e2e tests:
 *   window.__swcSsrMode        'ssr' | 'csr'
 *   window.__swcSsrHydration   Promise<HydrationReport>, set synchronously, resolves when the page has settled
 *   window.__swcSsrReport()    the current HydrationReport (swc-ssr/client hydrationReport())
 *
 * URL options (SSR mode):
 *   ?agnostic=1   hydrate without the template: remove `defer-hydration` top-down (the framework-agnostic path)
 */
declare global {
  interface Window {
    __swcSsrMode?: 'ssr' | 'csr';
    __swcSsrHydration?: Promise<HydrationReport>;
    __swcSsrReport?: () => HydrationReport;
  }
}

const app = document.getElementById('app');
const mode: 'ssr' | 'csr' = app?.dataset.mode === 'csr' ? 'csr' : 'ssr';
window.__swcSsrMode = mode;
window.__swcSsrReport = () => hydrationReport();

function failureReport(message: string): HydrationReport {
  return {...hydrationReport(), errors: [...hydrationReport().errors, message]};
}

async function start(): Promise<HydrationReport> {
  if (!app) {
    console.error('[swc-ssr demo] #app not found');
    return failureReport('#app not found');
  }

  const names = (app.dataset.components ?? '').split(',').filter((name) => name !== '');
  const entries: CatalogEntry[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const entry = findEntry(name);
    if (entry) entries.push(entry);
    else unknown.push(name);
  }
  if (unknown.length > 0) console.error(`[swc-ssr demo] unknown catalog entries: ${unknown.join(', ')}`);

  // Registers every custom element the page needs. Elements still carry `defer-hydration`, so none of them
  // hydrates before hydrateSpectrum() below says so.
  await Promise.all(entries.map((entry) => entry.load()));

  if (mode === 'csr') {
    render(pageTemplate(entries), app);
    // Nothing to hydrate; this waits until every element has rendered, then counts the elements with a shadow root.
    return hydrateSpectrum(app);
  }

  const agnostic = new URLSearchParams(location.search).get('agnostic') === '1';
  return hydrateSpectrum(app, agnostic ? {} : {template: pageTemplate(entries)});
}

window.__swcSsrHydration = start().catch((error: unknown) => {
  const message = `[swc-ssr demo] startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  console.error(message);
  return failureReport(message);
});
