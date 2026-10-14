# Spectrum SSR

Server-side rendering and hydration for [Adobe Spectrum Web Components](https://github.com/adobe/spectrum-web-components)
(1st-gen, `@spectrum-web-components/*` 1.12.4), built as a plugin for [`@lit-labs/ssr`](https://lit.dev/docs/ssr/overview/) 4.1.0.
No Spectrum source is modified: everything is done through the Lit SSR extension points, a DOM-shim extension and
runtime adapters.

Status (2026-10-14): 54 of 58 component packages render, hydrate without errors and without flicker, and match the
client-rendered DOM (`tests/results/summary.md`). Known blocker before any real deployment: the server leaks roughly
226 MB per full-catalog render (see "Known issues").

## Layout

| Path | What it is |
|---|---|
| `packages/swc-ssr/` | the plugin: `swc-ssr/server` (renderer), `swc-ssr/client` (hydration), `swc-ssr/dom-shim` (globals Spectrum needs under Node) |
| `demo/` | express demo: one showcase per component (`demo/src/catalog/`), SSR and client-only routes. See [demo/README.md](demo/README.md) |
| `tests/` | Playwright suite measuring SSR markup, hydration, flicker, fidelity vs client render and interaction per component; writes `tests/results/summary.md` |
| `docs/DESIGN.md`, `docs/API.md` | architecture (two-pass render) and the API contract |

## Requirements

Node 20 or newer (developed on 22), npm. Playwright needs Chromium once: `npx playwright install chromium`.

## Quick start

```bash
npm install
```

```bash
npm run demo
```

Then open <http://localhost:3000/component/button>. Useful pages:

| URL | Shows |
|---|---|
| `/component/picker` | one component, server-rendered, then hydrated |
| `/component/picker?nohydrate=1` | the pure server output, no JavaScript |
| `/csr/picker` | the same page rendered only in the browser (reference) |
| `/component/picker?agnostic=1` | hydration without a Lit template (the path an Angular app would use) |
| `/` | all 58 components on one page (about 19 MB, 3 to 10 s to render; see the leak note) |
| `/report.json` | per-element errors and warnings of the last render |

## Tests

```bash
npm run typecheck
```

```bash
npm run test:unit
```

```bash
npx playwright test
```

The e2e run starts the demo server itself (or reuses one on port 3000), takes about four minutes and rewrites
`tests/results/summary.md` plus screenshots under `tests/results/`. Variants:

```bash
SWC_SSR_SMOKE=1 npx playwright test
```

```bash
SWC_SSR_COMPONENTS=picker,tabs npx playwright test
```

## Using the plugin in your own server

```ts
import {installSpectrumSsr, renderSpectrum} from 'swc-ssr/server';
installSpectrumSsr();                       // before any @spectrum-web-components import
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');
import {html} from 'lit';

const {html: markup, report} = await renderSpectrum(
  html`<sp-theme system="spectrum" color="light" scale="medium"><sp-button>Save</sp-button></sp-theme>`,
  {deferHydration: true},
);
```

In the browser, import `swc-ssr/client` before `lit` and before any Spectrum module, load the element definitions,
then call `hydrateSpectrum(root)` (framework-agnostic) or `hydrateSpectrum(root, {template})` when the page is a Lit
template. Details and the `HydrationReport` shape are in [docs/API.md](docs/API.md).

## Known issues

* Memory leak: each full-catalog render retains about 226 MB (about 4 MB for a single-component page); a server
  that renders repeatedly runs out of heap. Fix pending.
* picker, breadcrumbs: after hydration the roving `tabindex="0"` sits on the selected menu item, a client render puts it on the first item.
* swatch: the selected swatch carries an extra `focusable` attribute.
* table: `sp-table` inserts its checkbox cells at runtime, so they appear only after hydration (1.4 % pixel change).
* Layout-dependent state (tabs indicator, color handles, split-view sizes) is approximated on the server and corrected after hydration.
* The server's `matchMedia` always reports `false`, so pages served to phones hydrate a popover where Spectrum expects a tray.

The full review findings and the hardening plan are tracked in `docs/DESIGN.md`.
