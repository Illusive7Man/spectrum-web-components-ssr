# swc-ssr demo

An express app that server-side renders Spectrum Web Components (1st-gen, 1.12.4) with `swc-ssr/server`,
and a browser entry that hydrates the result with `swc-ssr/client`. One showcase per component package lives in
`src/catalog/`.

## Run

From the repository root:

```sh
npm run demo        # builds the client bundle, then starts the server
npm run demo:dev    # starts the server only (reuses an existing demo/public/dist/)
npm run build:client   # rebuilds demo/public/dist/ only
```

Open <http://localhost:3000/>. `PORT=4000 npm run demo` changes the port; `SWC_SSR_DEMO_DIST=<dir>` makes the build
write (and wipe) another directory instead of `demo/public/dist`, and the server serve it.

The server logs one line per request, including the render time, for example:

```
[demo] GET /component/button -> 200 in 41.7 ms | render 38.2 ms (renderSpectrum 35.9 ms), 7 elements, 0 errors, 0 fallbacks, lang en-US, styles full n/a
```

(`styles trimmed 823.6/1230.5 KB` with `?styles=trimmed`: trimmed / full CSS of the page; with `?dedupe=link` also
`, linked 12 sheets 77.0 KB (62 links)`: the distinct stylesheets the page links to.) Requests for `/dist/*` and
successful ones for `/swc-css/*` are not logged.

## Production setup: compression and a split bundle

The demo serves its pages the way a production server would, because the size of the markup is the point:

* **Compression.** HTML, JSON and the linked stylesheets are compressed on the fly (`compression`): brotli at quality 4
  preferred over gzip (the client's q-values are honoured), nothing under 1 KB, `Vary: Accept-Encoding` always. A
  server-rendered page repeats each component's stylesheet in every shadow root; brotli's window spans those copies,
  gzip's 32 KB window does not. Bytes on the wire of the HTML (measured: docs/DESIGN.md "Performance" has the full
  table):

  | Page | identity | gzip | brotli |
  |---|---|---|---|
  | `/component/button` full | 1253 KB | 121 KB | 44 KB |
  | `/component/button?styles=minified` | 478 KB | 15 KB | 10 KB |
  | `/component/button?styles=trimmed&dedupe=link` | 28 KB (+ 77 KB CSS, cached) | 3 KB (+ 12 KB) | 3 KB (+ 12 KB) |
  | `/` full | 19106 KB | 1489 KB | 255 KB |
  | `/?styles=minified` | 9324 KB | 644 KB | 156 KB |
  | `/?styles=trimmed&dedupe=link` | 1170 KB (+ 823 KB CSS) | 88 KB (+ 136 KB) | 62 KB (+ 139 KB) |

* **Code-split, minified client.** `build.mjs` (esbuild) writes `dist/client.js`, a 1.2 KB bootstrap, and content-hashed
  chunks in `dist/chunks/` (the application `client-app-*.js`, one `register-<entry>-*.js` per catalog entry, shared
  modules), with source maps and build-time `.br` (q11) / `.gz` (9) siblings for every script of 1 KB or more. The
  server sends those siblings with `Content-Encoding` (identical `Content-Type`, ETag / 304 / HEAD work), the chunks
  with `Cache-Control: public, max-age=31536000, immutable`, `client.js` with `no-cache`. A component page downloads
  67-125 KB of JavaScript over the wire (483-743 KB decoded, 21-54 files) instead of the 2548 KB single file of 0.2.x;
  the whole catalog page 364 KB (1997 KB, 171 files).
* **Evaluation order.** `client.ts` statically imports only `swc-ssr/client` (Lit's hydration support must exist before
  `lit-element` creates `LitElement`) and loads `client-app.ts` with `import()`. The build fails when `lit-element` or a
  Spectrum module is in the entry's static import graph (a bundler may hoist shared modules into a chunk the entry
  imports first), and prints the evaluation order.
* **Registration modules.** Plain per-module `import()` chunks raced: `sp-sidenav-item` defined before `sp-sidenav`
  threw `startTrackingSelectionForItem is not a function` in about 15 % of loads, and combobox / sidenav items ended with
  roving `tabindex="-1"`. A plugin in `build.mjs` turns each entry's `load()` into one module of static imports in the
  order `load()` lists them, so an entry's elements are defined in one task, in that order (the files still download in
  parallel). Rule for catalog entries: keep `async load() { await Promise.all([import('...'), ...]); },` (or awaited
  single `import('...')` calls) with plain string literals only; the build fails with a message otherwise.
  `catalog/page-theme-register.ts` likewise imports the theme fragments before `sp-theme`: defining `sp-theme` first
  empties its declarative shadow root before any fragment is registered and paints an unthemed frame (CLS 0.032 on the
  badge page).

On localhost without throttling the split bundle hydrates somewhat later than the single file did (more requests, an
import waterfall about 5 levels deep); over a 10 Mbit/s, 40 ms link it hydrates much sooner (numbers: docs/DESIGN.md
"Performance").

## Routes

| Route | What you get |
|---|---|
| `GET /` | SSR of the whole catalog, then the client bundle hydrates it |
| `GET /component/:name` | SSR of one catalog entry (e.g. `/component/action-button`) + client bundle |
| `GET /csr`, `GET /csr/:name` | Same page shell, no SSR: `#app` is empty and the client renders the template with lit's `render()`. This is the reference DOM that the e2e tests compare the hydrated DOM against |
| `?nohydrate=1` on an SSR route | Omits the client `<script>`: the pure server-rendered view (what a visitor without JavaScript, or before the bundle arrives, sees) |
| `?agnostic=1` on an SSR route | Hydrates with the framework-agnostic path instead of the template path (see below) |
| `?styles=full\|trimmed\|minified` on an SSR route | Server CSS: `full` (default), `trimmed` (`renderSpectrum({styles: {mode: 'trimmed'}})`), `minified` (trimmed + `minifyCustomProperties`). Anything else: 400 |
| `?refs=--a,--b,--prefix-*` on an SSR route | `StyleOptions.references` (custom properties the page's own CSS uses). Invalid names: 400 |
| `?dedupe=link` on an SSR route (any `?styles=`) | `StyleOptions.dedupe: 'link'`: one copy per distinct stylesheet, linked from every shadow root (`/swc-css/<hash>.css`), and preload hints in `<head>`. `?dedupe=none` (default) inlines; anything else: 400 |
| `?hints=preload\|not-all\|none` with `?dedupe=link` | What `<head>` announces: `<link rel="preload" as="style">` (default), `<link rel="stylesheet" media="not all">`, or nothing |
| `GET /swc-css/<hash>.css` | A stylesheet a `?dedupe=link` render linked (`src/styles-routes.ts`): `text/css`, `Cache-Control: public, max-age=31536000, immutable`, brotli / gzip compressed once per hash (the route sits before the compression middleware; GET, HEAD and 304 carry the same `Content-Encoding`, `ETag` and `Vary`); an unknown hash (never rendered by this process, or evicted) is a 404 with `no-store` |
| `?removeStyles=1` on an SSR route | The client calls `hydrateSpectrum(app, {removeServerStyles: true})` |
| `?hydrateDelay=<ms>` / `?hydrateDelay=hold` on an SSR route | The client calls `hydrateSpectrum()` that much later than the definitions loaded, or when the page calls `window.__swcSsrRelease()` (the state of an app with a late bootstrap; `window.__swcSsrDefined` is true once the definitions loaded) |
| `?late=<tag>[,<tag>...]` on an SSR route | The client holds `customElements.define()` of these tags back until the page calls `window.__swcSsrDefineLate()` (resolves when they are defined and the page settled): definitions that arrive after hydration, or never. `hydrateSpectrum()` waits its timeout for them, warns, and hydrates the rest |
| `?lang=<tag>` on SSR and CSR routes | Page language (e.g. `?lang=de`). Without it, the request's most preferred `Accept-Language` language, else `en`. Passed to `renderSpectrum({lang})` and written to `<html lang>`, so the client formats like the server |
| `HEAD` on any path except `/dist/*` and `/swc-css/*` | 200 with an empty body, never renders (health checks / preview monitors). Logged once, then as a per-minute count. `HEAD /dist/*` and `/swc-css/*` answer like the `GET` without the body |
| `GET /report.json` | `RenderReport` of the last SSR render (per element id: tag, errors, warnings, fallback), plus `loadErrors`. `?component=<name>` (or `*` for the whole catalog) returns the last report of that page, which is race-free when pages are rendered in parallel |
| `GET /styles.json?component=<name\|*>&styles=<mode>` | Renders the page on demand (leaves `/report.json` alone) and returns the CSS sizes: `report.styles` (`fullBytes`, `trimmedBytes`, `sheets`, `durationMs`) plus the measured `<style>` text (`cssBytes`), document and gzip sizes (`gzipBytes`: gzip of the uncompressed document, unrelated to the response's own compression). With `&dedupe=link`: `dedupe` (the linked texts: hash, url, bytes, links) and `sheets[].hash`; `cssBytes` then counts the CSS left inline |
| `GET /catalog.json` | `[{name, interactive, notes}]` for every catalog entry |
| `GET /dist/*` | Static files from `demo/public/dist` (the split client bundle): precompressed `.br` / `.gz` for clients that accept them, `dist/chunks/*` immutable, `client.js` revalidated (`no-cache`) |

HTML is sent with `Cache-Control: no-store` (compressed when the client accepts it); the server-timing header
`Server-Timing: ssr;dur=...` carries the render time.
Renders run one at a time (the DOM shim and the element registry are process-wide state).
On `/`, a catalog entry whose `load()` throws is left out of the page and listed in `/report.json` under `loadErrors`
(`#app`'s `data-components` only names the entries that are on the page, so the client stays consistent with the server);
`/component/:name` answers 500 instead. A render that throws answers 500 with the stack trace.

## Page shell

```html
<!doctype html><html lang="en"><!-- the page language --><head>... <!-- ?dedupe=link: stylesheet preload hints --><style>/* layout only, see layoutCss in src/page.ts */</style></head>
<body>
  <div id="app" data-mode="ssr" data-components="accordion,button">
    <!-- renderSpectrum(pageTemplate(entries)) -->
  </div>
  <script type="module" src="/dist/client.js"></script>
</body></html>
```

`pageTemplate(entries)` (`src/page.ts`) is shared by the server and the browser:
`<sp-theme system="spectrum" color="light" scale="medium">` containing one
`<section class="demo" data-component="NAME"><h2>NAME</h2>...entry.render()...</section>` per entry.
The client reads `data-mode` (`ssr` | `csr`) and `data-components` from `#app`.

## How hydration works

`src/client.ts` imports `swc-ssr/client` **first** (its only static import; the application, `src/client-app.ts`,
follows with `import()`). That module

1. imports `@lit-labs/ssr-client/lit-element-hydrate-support.js`, which has to run before `lit` creates `LitElement`:
   afterwards every Lit element honours the `defer-hydration` attribute and adopts its declarative shadow root instead of
   rendering a new one;
2. applies the `@webcomponents/template-shadowroot` polyfill, only if a `<template shadowrootmode>` is still in the
   document (browsers without declarative shadow DOM, or markup that was injected with `innerHTML`);
3. hooks into the first ("hydrating") update of every Lit element with a server-rendered shadow root
   (`packages/swc-ssr/src/client/hooks.ts`): per-tag hydration adapters restore state the server rendered with (e.g.
   the selected item of `sp-picker`), the initial `slotchange` that declarative shadow roots never get is emulated
   before hydrating (as the server does before its final render), and a structural mismatch is recovered from by
   re-rendering that one element on the client (reported with `console.error`).

The server renders with `deferHydration: true`: every element carries `defer-hydration`, so nothing hydrates while the
client is still loading definitions. The client loads the registration modules of the entries on the page
(`entry.load()`), then calls `hydrateSpectrum(app, options)`:

* **Template path** (default, `mode=ssr`): `hydrateSpectrum(app, {template: pageTemplate(entries)})` first removes
  `defer-hydration` from the elements of the light DOM in document order (one synchronous pass, so their first updates
  run in document order, as with client-side rendering, not in the order the definitions loaded), then runs lit's
  `hydrate()`, which wires bindings (properties, event listeners) before any of those updates runs. Each element
  hydrates its own shadow root on its first update, which in turn enables the elements inside it (`hydrate()` removes
  their `defer-hydration`). The template must be exactly the one the server rendered.
* **Framework-agnostic path** (`?agnostic=1`): `hydrateSpectrum(app)` has no template. It collects every hydration
  candidate - elements with `defer-hydration`, and custom elements that are `sp-*`, have a shadow root or are already
  defined, e.g. `<overlay-trigger>` (document order, including open shadow roots) - awaits `customElements.whenDefined`
  for their tags (not for never-defined framework hosts such as `<app-root>`), removes
  `defer-hydration` top-down in document order and waits for the updates (`updateComplete`) so that elements inside a
  shadow root are only enabled after their host has hydrated. It also works for markup rendered with
  `deferHydration: true`. This is the path an Angular or plain-HTML app would use.
* **CSR** (`mode=csr`): `render(pageTemplate(entries), app)` with lit, then `hydrateSpectrum(app)` only to wait until every
  element has rendered and to count the elements with a shadow root.

`hydrateSpectrum` never rejects. It captures `console.error` / `console.warn` (still forwarded to the console), window
`error` and `unhandledrejection` from the moment `swc-ssr/client` is loaded until it has finished (what happened
before the first call is included in that call's report), and returns a `HydrationReport`:
`{errors, warnings, deferred, hydratedCount, durationMs}`. `deferred` lists the tags that still carry `defer-hydration`
afterwards (a non-empty list means hydration got stuck).

Notes on the two server-side options this relies on:

* `deferHydration: true`: @lit-labs/ssr adds `defer-hydration` to every element but only emits the `<!--lit-node-->`
  marker that `hydrate()` needs for elements nested in a shadow root or with bindings, so `hydrate()` alone would leave
  unbound light-DOM elements deferred; that is why the template path enables the light-DOM elements itself first.
  Both paths also work with `deferHydration: false` (light-DOM elements then hydrate as soon as their definition loads,
  in definition order rather than document order).
* Property, event and boolean bindings (`.prop=${}`, `@click=${}`, `?attr=${}`) on a light-DOM element are applied by
  `hydrate()` right after the elements were enabled and before their first update, as in client-side rendering.

### Hooks for tests

| Global | Value |
|---|---|
| `window.__swcSsrMode` | `'ssr'` or `'csr'`, set when the script starts |
| `window.__swcSsrHydration` | `Promise<HydrationReport>`, set when the script starts; resolves once the page has settled |
| `window.__swcSsrReport()` | the current `HydrationReport` (`hydrationReport()` of `swc-ssr/client`) |

```ts
await page.goto('/component/button');
const report = await page.evaluate(() => window.__swcSsrHydration);
```

## Files

| File | Purpose |
|---|---|
| `src/ssr-setup.ts` | installs the DOM shim (`installSpectrumSsr()`), imported first by the server |
| `src/server.ts` | express app, routes above, compression and the precompressed `/dist` handler |
| `src/styles-routes.ts` | `?dedupe=` / `?hints=` parsing and `GET /swc-css/<hash>.css` (`StyleOptions.dedupe: 'link'`) |
| `src/page.ts` | `pageTemplate(entries)` and the layout CSS of the shell |
| `src/client.ts` | browser entry: a 1.2 KB bootstrap that imports `swc-ssr/client`, sets the test hooks and loads `client-app.ts` |
| `src/client-app.ts` | the application: loads the page's entries, hydrates or renders |
| `src/catalog/` | one showcase module per component package, `index.ts` exports `catalog` and `findEntry` |
| `src/catalog/page-theme.ts`, `page-theme-register.ts` | the shell's `sp-theme` and its light / medium fragments (fragments registered first) |
| `build.mjs` | esbuild: minified, code-split ESM (`public/dist/client.js` + `public/dist/chunks/`), source maps, precompressed `.br` / `.gz`, one ordered registration chunk per catalog entry, an evaluation-order check; no `development` condition |
| `public/dist/` | build output (git-ignored) |
