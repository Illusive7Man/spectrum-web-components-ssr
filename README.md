# Spectrum SSR

Server-side rendering and hydration for [Adobe Spectrum Web Components](https://github.com/adobe/spectrum-web-components)
(1st-gen, `@spectrum-web-components/*` 1.12.4), built as a plugin for [`@lit-labs/ssr`](https://lit.dev/docs/ssr/overview/) 4.1.0.
No Spectrum source is modified: everything is done through the Lit SSR extension points, a DOM-shim extension and
runtime adapters.

Status (2026-10-15): 55 of 59 catalog entries render, hydrate without errors and without flicker, and match the
client-rendered DOM (`tests/results/summary.md`); the whole-catalog page, the framework-agnostic path, a localized page
and the phone checks (picker, action menu, contextual help at 390x844) are green. Memory is flat across renders
(about 110 MB heap for repeated full-catalog renders).

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
| `/` | all 59 catalog entries on one page (about 19 MB, about 2.5 s to render) |
| `/component/number-field?lang=de` | rendered in German (otherwise the browser's `Accept-Language`, else `en`) |
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

The e2e run starts the demo server itself (or reuses one on port 3000), takes about three minutes and rewrites
`tests/results/summary.md` plus screenshots under `tests/results/`. Besides the per-component matrix it covers the
whole-catalog page, the framework-agnostic path (`tests/agnostic.spec.ts`), a localized page (`tests/locale.spec.ts`)
and phones (`tests/mobile.spec.ts`). Variants:

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
  {deferHydration: true, lang: 'en'},   // lang: the page's <html lang>, so server and client format alike
);
```

Options worth knowing (all in [docs/API.md](docs/API.md)): `lang`, `timeoutMs` (default 10 s; a render that does not
settle returns its last completed pass), `lazyDefinitionWaitMs`, `deterministicIds`, `lifecycleByTag` /
`isManagedClass` (only Spectrum classes get the full server lifecycle by default; other Lit elements keep upstream
semantics).

`installSpectrumSsr()` installs browser globals (`window`, `navigator`, `matchMedia`, ...) for the whole process and
never removes them. Libraries that check `typeof window` to detect a browser take their browser branch afterwards:
import them before `installSpectrumSsr()` or run them in a separate worker.

In the browser, import `swc-ssr/client` before `lit` and before any Spectrum module, load the element definitions,
then call `hydrateSpectrum(root)` (framework-agnostic) or `hydrateSpectrum(root, {template})` when the page is a Lit
template. Details and the `HydrationReport` shape are in [docs/API.md](docs/API.md).

## Known issues

* picker, breadcrumbs: after hydration the roving `tabindex="0"` sits on the selected menu item, a client render puts it on the first item.
* swatch: the selected swatch carries an extra `focusable` attribute.
* table: `sp-table` inserts its checkbox cells at runtime, so they appear only after hydration (1.4 % pixel change);
  the render report lists them as `dropped DOM change` warnings.
* Layout-dependent state (tabs indicator, color handles, split-view sizes) is approximated on the server and corrected after hydration.
* Phones: the server's `matchMedia` never matches, so the server always renders the desktop state. Phones hydrate it
  without a mismatch and then re-render into the mobile state (tray, `mobile-view`, modal contextual help) on the next
  update; closed overlays make that change invisible (0.000 % pixel change in `tests/mobile.spec.ts`).
* Locale: the server formats numbers in the language passed as `lang` (or `<sp-theme lang>`); without either it uses
  `en-US` and reports `locale: no language is set` warnings. Pass the page's `<html lang>`.
* Some Spectrum code keeps running asynchronously after a render and can reject late (a disabled `sp-slider`'s
  `focusable.js` `handleDisabledChanged()`, `sp-action-menu`'s `manageSelection()`). Rejections that arrive while the
  render runs become report warnings; later ones are only logged in debug mode. A test runner with its own
  `unhandledRejection` listener (`node:test`) still sees them.
* The first and later renders of one process differ in a few generated ids (module-level counters such as
  `sp-dialog-label-N`); the markup is otherwise deterministic.

The full review findings and the hardening plan are tracked in `docs/DESIGN.md`.
