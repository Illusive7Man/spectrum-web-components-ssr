# swc-ssr demo

An express app that server-side renders Spectrum Web Components (1st-gen, 1.12.4) with `swc-ssr/server`,
and a browser entry that hydrates the result with `swc-ssr/client`. One showcase per component package lives in
`src/catalog/`.

## Run

From the repository root:

```sh
npm run demo        # builds the client bundle, then starts the server
npm run demo:dev    # starts the server only (reuses an existing demo/public/dist/client.js)
npm run build:client   # rebuilds demo/public/dist/client.js only
```

Open <http://localhost:3000/>. `PORT=4000 npm run demo` changes the port.

The server logs one line per request, including the render time, for example:

```
[demo] GET /component/button -> 200 in 41.7 ms | render 38.2 ms (renderSpectrum 35.9 ms), 7 elements, 0 errors, 0 fallbacks, lang en-US, styles full n/a
```

(`styles trimmed 823.6/1230.5 KB` with `?styles=trimmed`: trimmed / full CSS of the page.)

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
| `?removeStyles=1` on an SSR route | The client calls `hydrateSpectrum(app, {removeServerStyles: true})` |
| `?hydrateDelay=<ms>` / `?hydrateDelay=hold` on an SSR route | The client calls `hydrateSpectrum()` that much later than the definitions loaded, or when the page calls `window.__swcSsrRelease()` (the state of an app with a late bootstrap; `window.__swcSsrDefined` is true once the definitions loaded) |
| `?lang=<tag>` on SSR and CSR routes | Page language (e.g. `?lang=de`). Without it, the request's most preferred `Accept-Language` language, else `en`. Passed to `renderSpectrum({lang})` and written to `<html lang>`, so the client formats like the server |
| `HEAD` on any path | 200 with an empty body, never renders (health checks / preview monitors). Logged once, then as a per-minute count |
| `GET /report.json` | `RenderReport` of the last SSR render (per element id: tag, errors, warnings, fallback), plus `loadErrors`. `?component=<name>` (or `*` for the whole catalog) returns the last report of that page, which is race-free when pages are rendered in parallel |
| `GET /styles.json?component=<name\|*>&styles=<mode>` | Renders the page on demand (leaves `/report.json` alone) and returns the CSS sizes: `report.styles` (`fullBytes`, `trimmedBytes`, `sheets`, `durationMs`) plus the measured `<style>` text (`cssBytes`), document and gzip sizes |
| `GET /catalog.json` | `[{name, interactive, notes}]` for every catalog entry |
| `GET /dist/*` | Static files from `demo/public/dist` (the client bundle and its source map) |

HTML is sent with `Cache-Control: no-store`; the server-timing header `Server-Timing: ssr;dur=...` carries the render time.
Renders run one at a time (the DOM shim and the element registry are process-wide state).
On `/`, a catalog entry whose `load()` throws is left out of the page and listed in `/report.json` under `loadErrors`
(`#app`'s `data-components` only names the entries that are on the page, so the client stays consistent with the server);
`/component/:name` answers 500 instead. A render that throws answers 500 with the stack trace.

## Page shell

```html
<!doctype html><html lang="en"><!-- the page language --><head>... <style>/* layout only, see layoutCss in src/page.ts */</style></head>
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

`src/client.ts` imports `swc-ssr/client` **first**. That module

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
| `src/server.ts` | express app, routes above |
| `src/page.ts` | `pageTemplate(entries)` and the layout CSS of the shell |
| `src/client.ts` | browser entry: load the entries, hydrate or render |
| `src/catalog/` | one showcase module per component package, `index.ts` exports `catalog` and `findEntry` |
| `build.mjs` | esbuild: `src/client.ts` -> `public/dist/client.js` (ESM, source map, no `development` condition) |
| `public/dist/` | build output (git-ignored) |
