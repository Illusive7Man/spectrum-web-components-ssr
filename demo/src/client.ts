import 'swc-ssr/client'; // must stay the FIRST import: installs lit's hydration support before lit / Spectrum load
import {hydrateSpectrum, hydrationReport} from 'swc-ssr/client';
import type {HydrateSpectrumOptions, HydrationReport} from 'swc-ssr/client';
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
 *   window.__swcSsrDefined     true once every custom element of the page is defined (before hydrateSpectrum() runs)
 *   window.__swcSsrRelease()   with ?hydrateDelay=hold: lets hydrateSpectrum() run
 *   window.__swcSsrDefineLate() with ?late=: defines the held-back tags now; resolves (with their number) when they are
 *                              defined and every element of the page has settled
 *
 * URL options (SSR mode):
 *   ?agnostic=1      hydrate without the template: remove `defer-hydration` top-down (the framework-agnostic path)
 *   ?removeStyles=1  hydrateSpectrum({removeServerStyles: true}): free the server's <style> elements after hydration
 *   ?hydrateDelay=N  wait N ms (after the definitions loaded) before calling hydrateSpectrum(): holds the page in the
 *                    state an application with a late bootstrap is in - elements defined, nothing hydrated yet;
 *                    `hold` instead of N waits until the page calls window.__swcSsrRelease()
 *   ?late=<tag>[,<tag>...]  holds back the `customElements.define()` of these tags (intercepted before any Spectrum
 *                    module loads) until the page calls window.__swcSsrDefineLate() - e.g. after hydrateSpectrum()
 *                    finished: elements whose definition arrives after hydration (a lazily loaded chunk, a theme
 *                    registered late) or never (the page never calls it). hydrateSpectrum() waits for them as for any
 *                    missing definition (its timeout, then a warning) and hydrates the rest.
 */
declare global {
  interface Window {
    __swcSsrMode?: 'ssr' | 'csr';
    __swcSsrHydration?: Promise<HydrationReport>;
    __swcSsrReport?: () => HydrationReport;
    __swcSsrDefined?: boolean;
    __swcSsrRelease?: () => void;
    __swcSsrDefineLate?: () => Promise<number>;
  }
}

const app = document.getElementById('app');
const mode: 'ssr' | 'csr' = app?.dataset.mode === 'csr' ? 'csr' : 'ssr';
window.__swcSsrMode = mode;
window.__swcSsrReport = () => hydrationReport();

/** `?late=`: the definitions held back until `window.__swcSsrDefineLate()` (see the file comment). */
const lateTags = new Set(
  (new URLSearchParams(location.search).get('late') ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== ''),
);
if (mode === 'ssr' && lateTags.size > 0) {
  const held: Array<() => void> = [];
  let released = false;
  const define = CustomElementRegistry.prototype.define;
  CustomElementRegistry.prototype.define = function (
    this: CustomElementRegistry,
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void {
    if (!released && lateTags.has(name)) {
      held.push(() => define.call(this, name, constructor, options));
      return;
    }
    define.call(this, name, constructor, options);
  };
  window.__swcSsrDefineLate = async () => {
    released = true;
    const definitions = held.splice(0);
    for (const definition of definitions) definition();
    // The upgraded elements hydrate on their own (their `defer-hydration` was removed by hydrateSpectrum()).
    const updates: unknown[] = [];
    const visit = (scope: ParentNode): void => {
      for (const el of Array.from(scope.querySelectorAll('*'))) {
        updates.push((el as {updateComplete?: unknown}).updateComplete);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    await Promise.race([
      Promise.all(updates.filter((update) => update instanceof Promise).map((update) => (update as Promise<unknown>).catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    return definitions.length;
  };
}

function failureReport(message: string): HydrationReport {
  return {...hydrationReport(), errors: [...hydrationReport().errors, message]};
}

async function start(): Promise<HydrationReport> {
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

window.__swcSsrHydration = start().catch((error: unknown) => {
  const message = `[swc-ssr demo] startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  console.error(message);
  return failureReport(message);
});
