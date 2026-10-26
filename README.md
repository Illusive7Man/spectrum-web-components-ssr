# Spectrum Web Components SSR

[![Live demo](https://img.shields.io/badge/live%20demo-spectrum--web--components--ssr.vercel.app-000?logo=vercel)](https://spectrum-web-components-ssr.vercel.app/)
[![npm](https://img.shields.io/npm/v/spectrum-web-components-ssr?label=npm)](https://www.npmjs.com/package/spectrum-web-components-ssr)

Server-side rendering and hydration for [Adobe Spectrum Web Components](https://github.com/adobe/spectrum-web-components)
(1st generation), built as a plugin for [`@lit-labs/ssr`](https://lit.dev/docs/ssr/overview/). The server renders
Spectrum elements to HTML with declarative shadow DOM; the browser hydrates that HTML in place, with no visible change.
Spectrum itself is not modified.

This repository holds the npm package, a demo site and the test suite.

| Path | What it is |
|---|---|
| [`packages/spectrum-web-components-ssr/`](packages/spectrum-web-components-ssr/README.md) | the package `spectrum-web-components-ssr`. **Start with its README: install, examples, options.** |
| [`demo/`](demo/README.md) | the demo: an Express server with one page per Spectrum component, server-rendered and hydrated |
| `tests/` | Playwright suite: markup, hydration, flicker and fidelity against a client render, per component |
| [`docs/API.md`](docs/API.md) | the complete API contract |
| [`docs/DESIGN.md`](docs/DESIGN.md) | how it works inside (two-pass render, styles, measurements) |

## Use it in your app

```ts
import {renderSpectrum} from 'spectrum-web-components-ssr/server'; // first import of the server
import {html} from 'lit';

await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');

const {html: markup} = await renderSpectrum(
  html`<sp-theme system="spectrum" color="light" scale="medium"><sp-button>Save</sp-button></sp-theme>`,
  {deferHydration: true, lang: 'en'},
);
```

In the browser, `hydrateSpectrum(root)` from `spectrum-web-components-ssr/client` hydrates the markup. Everything else
(installation, Express and Angular examples, options, smaller pages) is in the
[package README](packages/spectrum-web-components-ssr/README.md).

## Run the demo

Node 20 or newer.

```bash
npm install
```

```bash
npm run demo
```

Then open <http://localhost:3000/component/button>. Pages worth a look:

| URL | Shows |
|---|---|
| `/component/picker` | one component, server-rendered, then hydrated |
| `/component/picker?nohydrate=1` | the pure server output, no JavaScript |
| `/csr/picker` | the same page rendered only in the browser, for comparison |
| `/component/picker?agnostic=1` | hydration without a Lit template, the way an Angular app does it |
| `/` | all 59 components on one page |
| `/component/number-field?lang=de` | rendered in German |
| `/component/button?styles=trimmed` | trimmed server CSS (`&dedupe=link`: each stylesheet once, linked) |
| `/report.json` | errors and warnings of the last render, per element |

The same demo runs at <https://spectrum-web-components-ssr.vercel.app/>.

## Status

56 of the 59 components in the demo render on the server, hydrate without errors or flicker, and end up with the same
DOM as a client render ([support matrix](tests/results/summary.md)). The three that differ:

- `picker` and `breadcrumbs`: after hydration the roving `tabindex="0"` sits on the selected item, a client render puts it on the first item.
- `swatch`: the selected swatch carries an extra `focusable` attribute.

More in the package README under [Limitations](packages/spectrum-web-components-ssr/README.md#limitations).

## Development

```bash
npm run typecheck
```

```bash
npm run test:unit
```

```bash
npx playwright test
```

The Playwright run needs Chromium once (`npx playwright install chromium`), starts the demo server itself and takes
about 45 minutes; it rewrites `tests/results/summary.md`. Quicker variants:

```bash
SWC_SSR_SMOKE=1 npx playwright test
```

```bash
SWC_SSR_COMPONENTS=picker,tabs npx playwright test
```

The committed manifest of `packages/spectrum-web-components-ssr` points its `exports` at the TypeScript sources, so
the demo and the tests run through `tsx` without a build, and it is marked private. Publishing switches it to the
built `dist/` and drops the private flag:

```bash
npm run build:pkg
```

```bash
npm run pkg:verify
```

```bash
npm run pkg:prepare
```

```bash
npm publish ./packages/spectrum-web-components-ssr --access public
```

```bash
npm run pkg:restore
```

`pkg:verify` builds, packs, installs the tarball into a scratch directory and renders from it; `pkg:restore` puts the
workspace manifest back after publishing.
