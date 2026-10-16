import 'swc-ssr/client'; // must stay the FIRST import: installs lit's hydration support before lit / Spectrum load
import {hydrationReport} from 'swc-ssr/client';
import type {HydrationReport} from 'swc-ssr/client';

/**
 * Browser entry of the demo (dist/client.js). It is a small bootstrap on purpose:
 *
 *   1. `swc-ssr/client` is its only static import. Evaluating it installs lit's hydration support (and the hooks
 *      around it), which has to happen BEFORE `lit-element` creates the LitElement class.
 *   2. The application (demo/src/client-app.ts: lit, the page template, the catalog, hydrateSpectrum()) is loaded with
 *      `import()` afterwards. With code splitting a bundler may move any module that several chunks share into a
 *      chunk that the entry imports FIRST; had `lit` been a static import of this file, `lit-element` would have been
 *      evaluated before this file's own body - before hydration support existed. demo/build.mjs fails the build when
 *      `lit-element` or a Spectrum module is part of the static import graph of this entry.
 *   3. Everything that tests and applications hook into is set synchronously here, as it always was:
 *      `window.__swcSsrHydration` exists as soon as the entry has run, although the application arrives a moment later.
 *
 * `#app` is rendered by demo/src/server.ts:
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

window.__swcSsrHydration = import('./client-app.js')
  .then((application) => application.start())
  .catch((error: unknown) => {
    const message = `[swc-ssr demo] startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    console.error(message);
    return failureReport(message);
  });
