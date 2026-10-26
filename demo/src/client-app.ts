import {hydrateSpectrum, hydrationReport} from 'spectrum-web-components-ssr/client';
import type {HydrateSpectrumOptions, HydrationReport} from 'spectrum-web-components-ssr/client';
import {render} from 'lit';
import {findEntry} from './catalog/index.js';
import type {CatalogEntry} from './catalog/types.js';
import {pageTemplate} from './page.js';

/**
 * The application part of the demo's browser code, loaded by demo/src/client.ts with a dynamic `import()` AFTER
 * `spectrum-web-components-ssr/client` has been evaluated: this module (and with it `lit` and, through the catalog, everything that
 * evaluates `lit-element`) must not be part of the static import graph of the entry. See the comment in client.ts.
 *
 * `#app` is rendered by demo/src/server.ts:
 *   data-mode="ssr"  server-rendered content inside #app  -> hydrate it
 *   data-mode="csr"  empty #app                           -> render the same template client-side (reference DOM)
 *   data-components  comma separated catalog entry names that are on the page
 *
 * Hooks set here (the others are set by client.ts):
 *   window.__swcSsrDefined     true once every custom element of the page is defined (before hydrateSpectrum() runs)
 *   window.__swcSsrRelease()   with ?hydrateDelay=hold: lets hydrateSpectrum() run
 */

function failureReport(message: string): HydrationReport {
  return {...hydrationReport(), errors: [...hydrationReport().errors, message]};
}

/** Registers the page's custom elements, then hydrates (SSR) or renders (CSR) it. Resolves with the HydrationReport. */
export async function start(): Promise<HydrationReport> {
  const app = document.getElementById('app');
  const mode: 'ssr' | 'csr' = app?.dataset.mode === 'csr' ? 'csr' : 'ssr';
  if (!app) {
    console.error('[swc-ssr demo] #app not found');
    return failureReport('#app not found');
  }

  const params = new URLSearchParams(location.search);
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
  window.__swcSsrDefined = true;

  if (mode === 'csr') {
    render(pageTemplate(entries), app);
    // Nothing to hydrate; this waits until every element has rendered, then counts the elements with a shadow root.
    return hydrateSpectrum(app);
  }

  const delay = params.get('hydrateDelay');
  if (delay === 'hold') {
    await new Promise<void>((resolve) => (window.__swcSsrRelease = resolve));
  } else if (Number(delay) > 0) {
    await new Promise((resolve) => setTimeout(resolve, Number(delay)));
  }
  const options: HydrateSpectrumOptions = {removeServerStyles: params.get('removeStyles') === '1'};
  if (params.get('agnostic') !== '1') options.template = pageTemplate(entries);
  return hydrateSpectrum(app, options);
}
