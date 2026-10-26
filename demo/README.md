# Demo

An Express app that server-side renders Spectrum Web Components with `spectrum-web-components-ssr/server`, and a browser entry that
hydrates the result with `spectrum-web-components-ssr/client`. One showcase per component package lives in `src/catalog/`.

## Run

From the repository root:

```sh
npm run demo           # builds the client bundle, then starts the server
npm run demo:dev       # starts the server only (reuses an existing demo/public/dist/)
npm run build:client   # rebuilds demo/public/dist/ only
```

Open <http://localhost:3000/>. `PORT=4000 npm run demo` changes the port. The server logs one line per request with
the render time:

```
[demo] GET /component/button -> 200 in 41.7 ms | render 38.2 ms (renderSpectrum 35.9 ms), 7 elements, 0 errors, 0 fallbacks, lang en-US, styles full n/a
```

## Routes

| Route | What you get |
|---|---|
| `GET /` | the whole catalog, server-rendered, then hydrated |
| `GET /component/:name` | one catalog entry, e.g. `/component/action-button` |
| `GET /csr`, `GET /csr/:name` | the same page rendered only in the browser: the reference DOM the tests compare against |
| `?nohydrate=1` | no client script: the pure server output |
| `?agnostic=1` | hydrate without the Lit template (the path an Angular or plain-HTML app uses) |
| `?lang=de` | page language; otherwise the request's `Accept-Language`, else `en` |
| `?styles=full\|trimmed\|minified` | server CSS: complete (default), trimmed, or trimmed with short custom-property names |
| `?dedupe=link` | each distinct stylesheet once, linked from the shadow roots as `/swc-css/<hash>.css` |
| `?refs=--a,--b` | theme variables to keep when trimming (`StyleOptions.references`) |
| `?removeStyles=1` | hydrate with `removeServerStyles: true` |
| `?hydrateDelay=<ms>\|hold` | hydrate later, or only when the page calls `window.__swcSsrRelease()` |
| `?late=<tag>,...` | define these elements only when the page calls `window.__swcSsrDefineLate()` |
| `GET /swc-css/<hash>.css` | a stylesheet a `?dedupe=link` render linked (immutable, compressed) |
| `GET /report.json` | the last render's report: per element, its errors, warnings and fallbacks |
| `GET /styles.json?component=<name>&styles=<mode>` | renders the page and returns its CSS and HTML sizes |
| `GET /catalog.json` | the catalog entries |
| `GET /dist/*` | the client bundle |

HTML is sent with `Cache-Control: no-store` and compressed (brotli preferred). The client bundle is code-split and
minified by `build.mjs` (esbuild): a small `client.js` bootstrap plus content-hashed chunks, one registration chunk per
catalog entry so that an entry's elements are defined in one task and in order.

## Page shell

```html
<!doctype html><html lang="en"><head>...</head>
<body>
  <div id="app" data-mode="ssr" data-components="accordion,button">
    <!-- renderSpectrum(pageTemplate(entries)) -->
  </div>
  <script type="module" src="/dist/client.js"></script>
</body></html>
```

`pageTemplate(entries)` (`src/page.ts`) is shared by the server and the browser: an `<sp-theme>` with one
`<section class="demo" data-component="NAME">` per entry. The client reads `data-mode` (`ssr` or `csr`) and
`data-components` from `#app`.

## How hydration works

`src/client.ts` imports `spectrum-web-components-ssr/client` first (its only static import) and loads the application with `import()`.
`spectrum-web-components-ssr/client` installs Lit's hydration support, which has to exist before Lit creates `LitElement`; afterwards every
Lit element honours `defer-hydration` and adopts its declarative shadow root instead of rendering a new one. It also
hooks into each element's first update, where per-component hydration adapters restore the state the server rendered
with (the selected item of `sp-picker`, for example).

The server renders with `deferHydration: true`, so nothing hydrates while the client is still loading definitions. The
client loads the registration modules of the entries on the page, then calls `hydrateSpectrum(app, options)`:

- **Template path** (default): `hydrateSpectrum(app, {template: pageTemplate(entries)})` enables the elements in document
  order and runs Lit's `hydrate()`, which wires bindings before any element updates. The template must be the one the
  server rendered.
- **Framework-agnostic path** (`?agnostic=1`): `hydrateSpectrum(app)` has no template. It finds the server-rendered
  elements, waits for their definitions and enables them top-down in document order.
- **CSR** (`/csr`): the client renders the template with Lit's `render()`; `hydrateSpectrum(app)` only waits for the
  elements to finish.

`hydrateSpectrum()` never rejects. It returns `{errors, warnings, deferred, hydratedCount, durationMs}`; a non-empty
`deferred` means hydration got stuck on those tags.

### Hooks for tests

| Global | Value |
|---|---|
| `window.__swcSsrMode` | `'ssr'` or `'csr'` |
| `window.__swcSsrHydration` | `Promise<HydrationReport>`, resolves once the page has settled |
| `window.__swcSsrReport()` | the current `HydrationReport` |

```ts
await page.goto('/component/button');
const report = await page.evaluate(() => window.__swcSsrHydration);
```

## Files

| File | Purpose |
|---|---|
| `src/ssr-setup.ts` | installs the DOM shim, imported first by the server |
| `src/server.ts` | the Express app and the routes above |
| `src/styles-routes.ts` | `?dedupe=` parsing and `GET /swc-css/<hash>.css` |
| `src/page.ts` | `pageTemplate(entries)` and the shell's layout CSS |
| `src/client.ts` | browser entry: imports `spectrum-web-components-ssr/client`, sets the test hooks, loads `client-app.ts` |
| `src/client-app.ts` | the application: loads the page's entries, hydrates or renders |
| `src/catalog/` | one showcase module per component package; `index.ts` exports `catalog` and `findEntry` |
| `build.mjs` | esbuild: the code-split, minified client bundle in `public/dist/` |
| `public/dist/` | build output (git-ignored) |
