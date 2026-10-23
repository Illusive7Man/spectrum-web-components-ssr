# spectrum-web-components-ssr

Server-side rendering and hydration for [Adobe Spectrum Web Components](https://github.com/adobe/spectrum-web-components)
(1st generation, `@spectrum-web-components/*` 1.12), built as a plugin for [`@lit-labs/ssr`](https://lit.dev/docs/ssr/overview/).
The server renders Spectrum elements to HTML with declarative shadow DOM; the browser hydrates that HTML in place, with no
visible change.

- Spectrum itself is not modified and nothing in `node_modules` is patched: everything goes through Lit SSR's extension
  points, a DOM shim and per-component adapters.
- Live demo: <https://spectrum-web-components-ssr.vercel.app/> (source and tests in the
  [repository](https://github.com/Illusive7Man/spectrum-web-components-ssr)).
- Independent project, not affiliated with or endorsed by Adobe.

## Install

```sh
npm install spectrum-web-components-ssr
npm install lit@3.3.3 lit-html@3.3.3 lit-element@4.2.2 @lit-labs/ssr@4.1.0 @lit-labs/ssr-client@1.1.8 @lit-labs/ssr-dom-shim@1.6.0
npm install @spectrum-web-components/bundle@1.12.4
```

The second line installs the peer dependencies at the versions this package is tested with. Your app and this package
must share one copy of each (two copies of `lit-html` break hydration), and `@lit-labs/ssr` has to stay on 4.1.x: the
renderers rely on its internals. Node 20 or newer; for TypeScript, a `moduleResolution` of `bundler`, `node16` or
`nodenext`.

The package has three entry points:

| Import | Runs in | Gives you |
|---|---|---|
| `spectrum-web-components-ssr/server` | Node | `renderSpectrum()`. Importing it also sets up the DOM globals Spectrum needs. |
| `spectrum-web-components-ssr/client` | browser | `hydrateSpectrum()`. |
| `spectrum-web-components-ssr/dom-shim` | Node | only the DOM globals, if you need them without the renderer. |

## Render on the server

```ts
// Keep this the first import of your server entry: it prepares the DOM globals before Lit and Spectrum load.
import {renderSpectrum} from 'spectrum-web-components-ssr/server';
import {html} from 'lit';

// Spectrum modules are loaded after the import above, so use import() for them.
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');

const {html: markup} = await renderSpectrum(
  html`<sp-theme system="spectrum" color="light" scale="medium"><sp-button>Save</sp-button></sp-theme>`,
  {deferHydration: true, lang: 'en'},
);
```

`markup` is the HTML to put into your page. `deferHydration: true` marks every element so that nothing hydrates before
the client is ready; `lang` is the page language (the same value you write to `<html lang>`), which components use to
format numbers and pick labels.

Two rules: import Spectrum modules by their package name (`@spectrum-web-components/button/sp-button.js`), never by file
path, and keep the `/server` import first. The DOM globals it installs stay for the life of the process.

## Hydrate in the browser

```ts
// Keep this the first import of your browser bundle: it has to run before Lit and before any Spectrum module.
import {hydrateSpectrum} from 'spectrum-web-components-ssr/client';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/button/sp-button.js';

await hydrateSpectrum(document.getElementById('app')!);
```

That is the framework-agnostic form: it works for any server-rendered markup (Angular, plain HTML). If your page is a
Lit template that the server rendered, pass the same template and Lit wires its bindings as well:

```ts
await hydrateSpectrum(document.getElementById('app')!, {template: page()});
```

`hydrateSpectrum()` never rejects. It resolves to a report: `{errors, warnings, deferred, hydratedCount, durationMs}`;
a non-empty `deferred` means some elements are still waiting for their definition.

## A complete page with Express

```ts
import {renderSpectrum} from 'spectrum-web-components-ssr/server'; // first import
import express from 'express';
import {html} from 'lit';

await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');

const page = () => html`<sp-theme system="spectrum" color="light" scale="medium"><sp-button>Save</sp-button></sp-theme>`;

const app = express();
app.get('/', async (_req, res) => {
  const {html: markup} = await renderSpectrum(page(), {deferHydration: true, lang: 'en'});
  res.type('html').send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head>` +
      `<body><div id="app">${markup}</div><script type="module" src="/client.js"></script></body></html>`,
  );
});
app.listen(3000);
```

`client.js` is the browser bundle from the previous section. Serve the HTML compressed; brotli works best, because a
server-rendered page repeats each component's stylesheet in every shadow root and brotli's window spans those copies.
The demo server in the repository (`demo/src/server.ts`) is a complete, commented example.

## Options of `renderSpectrum()`

| Option | Default | What it does |
|---|---|---|
| `deferHydration` | `false` | adds `defer-hydration` to every element. Use `true` together with `hydrateSpectrum()`. |
| `lang` | none | the page language for this render. Without it numbers format as `en-US` and the report warns. |
| `timeoutMs` | `10000` | deadline for one render. A render that does not settle returns its last completed pass plus a warning. |
| `lifecycle` | `'full'` | how much of the element lifecycle runs on the server: `'none'`, `'connected'` or `'full'` (the settled state). |
| `lifecycleByTag` | none | per-tag override, e.g. `{'sp-overlay': 'none', 'my-element': 'full'}`. |
| `elementRenderers` | none | your own `@lit-labs/ssr` element renderers, tried first. |
| `deterministicIds` | `true` | generated ids are the same for the same page. |
| `styles` | `{mode: 'full'}` | the CSS written into the shadow roots; see [Smaller pages](#smaller-pages). |
| `debug` | `false` | keeps the internal markers in the output and logs details. |

The full contract, the `report` shape and the rarely needed options are in
[docs/API.md](https://github.com/Illusive7Man/spectrum-web-components-ssr/blob/main/docs/API.md).

## Adapters

Everything specific to one component lives in an adapter. Built in: `sp-theme`, `sp-overlay`, `sp-picker`,
`sp-breadcrumbs`, `sp-split-view`, `sp-color-wheel`, `sp-table`. You can add your own, or replace a built-in one:

```ts
import {registerAdapter} from 'spectrum-web-components-ssr/server';

registerAdapter({
  tag: 'my-element', // or a RegExp such as /^my-/
  beforeRender(element, ctx) {
    // runs before the element renders, with its light DOM and slots in place
  },
});
```

The client side has the same idea: `registerHydrationAdapter({tag, beforeHydrate, afterHydrate})` from the `/client`
entry runs code around an element's first update in the browser. Both contracts are in docs/API.md.

## Angular SSR

Angular's server renderer (`@angular/ssr`, Angular 20) does not use Lit, so the Spectrum elements in its output are
plain elements without a shadow root. The integration below renders them in a step after Angular and hydrates them
without a template, after Angular's own hydration. It comes from a production application (Angular 20, `NgModule`-based,
zoneless, Express 5); the package's tests cover the template-free hydration path, not Angular itself.

**1. Dependencies** in `package.json`: the ones from [Install](#install) plus `@angular/ssr` and `express`.

**2. `angular.json`**: a server entry and the Express entry. `@lit-labs/ssr-dom-shim` is external in the development
configuration only, so that the dev server (which loads the two server bundles separately) uses one copy of it; the
production build bundles everything, since the deployed output has no `node_modules`.

```json
"options": {
  "server": "src/main.server.ts",
  "outputMode": "server",
  "ssr": {"entry": "src/server.ts"}
},
"configurations": {
  "development": {"externalDependencies": ["@lit-labs/ssr-dom-shim"]}
}
```

The server entries use top-level `await`, so `tsconfig.json` needs `"module"` and `"target"` of `ES2022` or later;
`tsconfig.app.json` lists `src/main.server.ts` and `src/server.ts` in `files` and has `"node"` in `types`.

**3. Install the DOM shim first, load everything else after it.** The shim must exist before Lit is evaluated, and the
bundler may place Lit in a shared chunk that runs early, so the application is loaded with `import()`.

```ts
// spectrum-dom-shim.ts
const nativeFetch = globalThis.fetch; // the shim replaces fetch; Angular's HttpClient needs the native one
const {installSpectrumDomShim} = await import('spectrum-web-components-ssr/dom-shim');
installSpectrumDomShim();
globalThis.fetch = nativeFetch;
export {};
```

```ts
// main.server.ts
import './spectrum-dom-shim';
import {SPECTRUM_SSR} from './ssr-bridge';

const [{AppServerModule}, spectrumSsr] = await Promise.all([import('./app/app.module.server'), import('./spectrum-ssr')]);
globalThis[SPECTRUM_SSR] = spectrumSsr; // handed to server.ts, which lives in another bundle
export default AppServerModule;
```

```ts
// ssr-bridge.ts: the two server bundles share the renderer through a global
export const SPECTRUM_SSR = Symbol.for('my-app.ssr.spectrum');
```

**4. Render the HTML Angular produced.** Angular's output is passed to `renderSpectrum()` as a static template.

```ts
// spectrum-ssr.ts
import {renderSpectrum} from 'spectrum-web-components-ssr/server';
import {html} from 'lit';

export function renderSpectrumMarkup(markup: string, lang: string) {
  const strings = Object.assign([markup], {raw: [markup]}) as unknown as TemplateStringsArray;
  return renderSpectrum(html(strings), {deferHydration: true, lang});
}
```

**5. Write bound properties as attributes before Angular serializes.** Angular binds component inputs as DOM
properties (`[selected]`, `[formControl]`), and properties are not part of the serialized HTML. A `BEFORE_APP_SERIALIZED`
hook copies every bound property of a Lit element that has an attribute into that attribute:

```ts
// app.module.server.ts
providers: [
  provideServerRendering(withRoutes(serverRoutes)),
  {provide: BEFORE_APP_SERIALIZED, multi: true, useFactory: () => {
    const document = inject(DOCUMENT);
    return () => reflectCustomElementProperties(document);
  }},
]
```

```ts
// reflect-custom-element-properties.ts (server only)
export function reflectCustomElementProperties(document: Document): void {
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (!element.localName.includes('-')) continue;
    const ctor = customElements.get(element.localName) as LitElementClass | undefined;
    if (!ctor?.observedAttributes) continue; // also finalizes the class, which fills elementProperties
    for (const name of Object.keys(element)) {
      const options = ctor.elementProperties?.get(name);
      if (!options || options.state || options.attribute === false) continue;
      const attribute = typeof options.attribute === 'string' ? options.attribute : name.toLowerCase();
      const toAttribute = typeof options.converter === 'object' && options.converter.toAttribute || defaultToAttribute;
      const value = toAttribute(element[name], options.type); // defaultToAttribute: Lit's defaultConverter.toAttribute
      if (value == null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, String(value));
    }
  }
}
```

**6. `server.ts`: let Angular render, then render the Spectrum elements.** The `<app-root>` of an HTML response is
replaced with the Spectrum render of that markup; on any failure, Angular's output is returned unchanged.

```ts
import {SPECTRUM_SSR} from './ssr-bridge';
import {AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse} from '@angular/ssr/node';
import express from 'express';

const spectrumSsr = () => globalThis[SPECTRUM_SSR] as typeof import('./spectrum-ssr') | undefined;
const appRootPattern = /<app-root\b[^>]*>[\s\S]*?<\/app-root>/i;
const htmlLanguagePattern = /<html\b[^>]*\blang=["']([^"']+)["']/i;

async function renderSpectrumComponents(response: Response): Promise<Response> {
  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const angularHtml = await response.text();
  const appRoot = angularHtml.match(appRootPattern)?.[0];
  if (!appRoot) return responseWithBody(response, angularHtml);
  const lang = angularHtml.match(htmlLanguagePattern)?.[1] ?? 'en';
  try {
    const spectrum = await spectrumSsr()!.renderSpectrumMarkup(appRoot, lang);
    return responseWithBody(response, angularHtml.replace(appRoot, () => spectrum.html));
  } catch (error) {
    console.error('Spectrum SSR failed; returning Angular SSR output.', error);
    return responseWithBody(response, angularHtml);
  }
}

// responseWithBody(response, body): a copy of the Response with the new body and without content-length

const app = express();
const angularApp = new AngularNodeAppEngine();
app.use((req, res, next) => {
  angularApp.handle(req)
    .then(response => response ? renderSpectrumComponents(response) : null)
    .then(response => response ? writeResponseToNodeResponse(response, res) : next())
    .catch(next);
});
export const reqHandler = createNodeRequestHandler(app);
```

**7. `main.ts`: hydrate after Angular.** The client entry is imported first, Angular is bootstrapped through `import()`
(so Lit and the Spectrum definitions evaluate after the client entry), and Spectrum hydrates once Angular is stable.

```ts
import {hydrateSpectrum} from 'spectrum-web-components-ssr/client'; // first import
import {ApplicationRef} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import('./app/app.module')
  .then(({AppModule}) => platformBrowserDynamic().bootstrapModule(AppModule, {ngZone: 'noop'}))
  .then(moduleRef => moduleRef.injector.get(ApplicationRef).whenStable())
  .then(() => hydrateSpectrum(document.body))
  .catch(error => console.error(error));
```

`AppModule` provides `provideClientHydration(...)` and imports the Spectrum definitions from one module (every
`sp-*.js` registration the app uses); the server bundle imports the same module, so both sides define the same elements.

## Smaller pages

Most of a server-rendered Spectrum page is CSS: every shadow root carries the complete stylesheets of its component.
Compression alone brings a 1.2 MB button page down to about 45 KB over the wire, so start there. The options below
reduce the HTML itself; they are optional and independent of each other.

### Trimmed CSS

`styles: {mode: 'trimmed'}` keeps only the rules that can apply to what the page rendered (state pseudo-classes such as
`:hover` count), and only the theme variables the page uses. The button page goes from 1.2 MB to 0.8 MB, the demo's
59-component catalog from 18.7 MB to 13.3 MB.

```ts
const {html: markup} = await renderSpectrum(page(), {
  deferHydration: true,
  lang: 'en',
  styles: {mode: 'trimmed'},
});
```

Two things to know:

- Trimmed pages need `spectrum-web-components-ssr/client` in the browser: it gives every hydrated element its complete
  stylesheets back, so states the page did not render (a button being hovered after hydration) are styled.
- If your own CSS reads Spectrum theme variables, list them so they are not trimmed away:
  `styles: {mode: 'trimmed', references: scanCustomPropertyReferences(appCss)}` (`scanCustomPropertyReferences` is
  exported by the `/server` entry; `references: ['--spectrum-*']` keeps them all).

### One copy of each stylesheet

`styles: {dedupe: 'link'}` writes each distinct stylesheet once and links it from the shadow roots
(`<link rel="stylesheet" href="/swc-css/<hash>.css">`) instead of repeating it. Works with `full` and `trimmed`. You
serve the stylesheets from the store and put `head` (preload hints) into your page:

```ts
import {getStyleSheet, renderSpectrum} from 'spectrum-web-components-ssr/server';

app.get('/swc-css/:file', (req, res) => {
  const css = getStyleSheet(req.params.file.replace(/\.css$/, ''));
  if (css === undefined) return void res.status(404).set('Cache-Control', 'no-store').end();
  res.set('Cache-Control', 'public, max-age=31536000, immutable').type('text/css; charset=utf-8').send(css);
});

app.get('/', async (_req, res) => {
  const {html: markup, head} = await renderSpectrum(page(), {deferHydration: true, lang: 'en', styles: {mode: 'trimmed', dedupe: 'link'}});
  res.type('html').send(`<!doctype html><html lang="en"><head>${head}</head><body><div id="app">${markup}</div></body></html>`);
});
```

It is off by default because browsers differ: Chromium waits for a shadow root's stylesheet before painting it, Firefox
paints the content first and styles it when the sheet arrives (on cold loads and when the sheets come from the disk
cache). The store is per process and bounded (32 MiB); with several server instances, give `dedupeUrl(hash, css)` a
function that uploads the text to shared storage and returns its URL.

### Short custom-property names

`styles: {mode: 'trimmed', minifyCustomProperties: true}` additionally renames the remaining theme variables to short
names (`--a`, `--b`, ...), which roughly halves the trimmed HTML again (button page 0.8 MB to 0.5 MB). It is the most
invasive option: your own CSS must not set or read `--spectrum-*` variables without listing them in `references`, and
`sp-theme` must be defined before hydration. Read "Styles" in docs/API.md before turning it on; for most pages, trimming
plus compression is enough.

## Limitations

- **Process-wide state.** The DOM globals are installed once per process and never removed; renders run one at a time.
- **Layout is not computed.** State that depends on layout (the tabs indicator, color handles, split-view sizes) is
  approximated on the server and corrected after hydration.
- **Phones.** The server's `matchMedia` never matches, so it renders the desktop state; phones switch to the mobile
  state after hydration.
- **Locale.** Without `lang`, numbers format as `en-US`.
- **Known differences from a client render.** `sp-picker` and `sp-breadcrumbs` put the roving `tabindex="0"` on the
  selected item after hydration (a client render: on the first item); `sp-swatch` carries an extra `focusable` attribute
  on the selected swatch. The full per-component matrix is in
  [tests/results/summary.md](https://github.com/Illusive7Man/spectrum-web-components-ssr/blob/main/tests/results/summary.md).
- **Late work after a render.** Some Spectrum code keeps running after the render; rejections during the render become
  report warnings, later ones print a `SWC_SSR_LATE_REJECTION` process warning.
- **Generated ids** differ slightly between the first and later renders of a process (module-level counters in Spectrum).
- **Lit versions.** The package uses private Lit modules (`lit-element/private-ssr-support.js`), so keep `lit` inside the
  peer range and `@lit-labs/ssr` on 4.1.x.
- The test suite runs in Chromium only.

## License

Apache-2.0, the license of Spectrum Web Components. Copyright 2026 Savo Pejović. See [LICENSE](./LICENSE).
