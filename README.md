# Spectrum SSR

Server-side rendering and hydration for [Adobe Spectrum Web Components](https://github.com/adobe/spectrum-web-components)
(1st-gen, `@spectrum-web-components/*` 1.12.4), built as a plugin for [`@lit-labs/ssr`](https://lit.dev/docs/ssr/overview/) 4.1.0.
No Spectrum source is modified: everything is done through the Lit SSR extension points, a DOM-shim extension and
runtime adapters.

Status (2026-10-16, 0.3.0): 55 of 59 catalog entries render, hydrate without errors and without flicker, and match the
client-rendered DOM (`tests/results/summary.md`); the whole-catalog page, the framework-agnostic path, a localized page
and the phone checks (picker, action menu, contextual help at 390x844) are green. Memory is flat across renders
(111-114 MB heap for repeated full-catalog renders).

0.3.0 is about speed and bytes: the server renders about twice as fast on big pages (the 1349-element catalog:
3.8 s -> 1.9 s on a 15 W laptop, 1.4 ms per element; one-component pages 1.3-1.4x) with the same output apart from
generated ids; the demo compresses its responses (brotli: the button page goes over the wire as 44 KB instead of
1.25 MB, the catalog as 255 KB instead of 19 MB) and ships a code-split, minified client (the catalog page now hydrates
in 3.9 s instead of 20.4 s over a 10 Mbit/s link); and `styles: {dedupe: 'link'}` (opt-in) stores each distinct
stylesheet once and links it from every shadow root.

Since 0.2.0 the server can trim the CSS it writes into the declarative shadow roots (`styles: {mode: 'trimmed'}`,
optionally with short custom-property names): the button page goes from 1.22 MB to 0.83 MB (0.47 MB minified), the
whole catalog from 18.7 MB to 13.3 MB (9.1 MB minified), and every trimmed / minified page renders pixel-identically to
the full-CSS page before hydration, after it, and after state changes (`tests/styles.spec.ts`), also when definitions
(`sp-theme` included) arrive after hydration or never (`tests/styles-late.spec.ts`).

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
| `/` | all 59 catalog entries on one page (about 19 MB uncompressed, 255 KB with brotli; about 2 s to render) |
| `/component/number-field?lang=de` | rendered in German (otherwise the browser's `Accept-Language`, else `en`) |
| `/component/button?styles=trimmed` | trimmed server CSS (`?styles=minified`: trimmed + short custom-property names; `?refs=--a,--b`: `references`) |
| `/component/button?styles=trimmed&dedupe=link` | each distinct stylesheet once, linked from the shadow roots (`/swc-css/<hash>.css`) |
| `/styles.json?component=button&styles=minified` | CSS / HTML / gzip sizes of a render, per stylesheet |
| `/report.json` | per-element errors and warnings of the last render (and `styles` in trimmed mode) |

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

The e2e run starts the demo server itself (or reuses one on port 3000; `SWC_SSR_BASE_URL=http://localhost:3100`
picks another port), takes about 45 minutes (about 8 without `tests/styles.spec.ts` and `tests/styles-dedupe.spec.ts`,
the pixel oracles of the trimmed and linked CSS) and rewrites `tests/results/summary.md` plus screenshots under `tests/results/`. Besides the per-component matrix it
covers the whole-catalog page, the framework-agnostic path (`tests/agnostic.spec.ts`), a localized page
(`tests/locale.spec.ts`), phones (`tests/mobile.spec.ts`), the trimmed / minified CSS (`tests/styles.spec.ts`, and
`tests/styles-late.spec.ts` for late definitions, application `--mod-*` overrides and browsers without constructable
stylesheets), linked stylesheets (`tests/styles-dedupe.spec.ts`) and the demo server's compression, routes and split
bundle (`tests/server.spec.ts`). A narrowed run (`SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`) writes
`tests/results/summary.partial.md` and leaves `summary.md` alone.
Variants:

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
semantics), `styles`.

Smaller pages: `styles: {mode: 'trimmed'}` keeps only the CSS rules that can match what the page rendered (state
pseudo-classes such as `:hover` count as matching) and the theme custom properties they use;
`minifyCustomProperties: true` also renames the remaining custom properties to short names.

```ts
import {renderSpectrum, scanCustomPropertyReferences} from 'swc-ssr/server';

const {html: markup, report} = await renderSpectrum(page(), {
  deferHydration: true,
  lang: 'en',
  styles: {
    mode: 'trimmed',
    minifyCustomProperties: true,                       // optional; see the caveats in docs/API.md "Styles"
    references: scanCustomPropertyReferences(appCss),   // theme variables your own CSS reads
  },
});
// report.styles: {fullBytes, trimmedBytes, sheets, durationMs}
```

| Page (HTML: identity / gzip / brotli) | full | trimmed | minified | trimmed + `dedupe: 'link'` (HTML / linked CSS, brotli) |
|---|---|---|---|---|
| button | 1253 / 121 / 44 KB | 847 / 80 / 12 KB | 478 / 15 / 10 KB | 3 KB / 12 KB |
| picker | 1351 / 118 / 48 KB | 539 / 57 / 13 KB | 408 / 47 / 12 KB | 5 KB / 12 KB |
| whole catalog | 19106 / 1489 / 255 KB | 13633 / 997 / 180 KB | 9324 / 644 / 156 KB | 62 KB / 139 KB |

(KiB as served by the demo; the linked CSS is fetched once and cached, docs/DESIGN.md "Performance".)

Trimmed and minified pages **require `swc-ssr/client`** in the browser. Lit's hydration support keeps a hydrated
element's server `<style>` as its only stylesheet, and `<sp-theme>` replaces its server `<style>` with the complete
theme when it upgrades: without the client, trimmed elements have no rules for states entered after hydration, and
minified elements lose all theme values when the theme upgrades. `swc-ssr/client` gives every hydrated element its
complete stylesheets back (in the same task as its hydrating update) and keeps the server's theme `<style>` until the
last element is restored. Application CSS that reads Spectrum theme variables needs `references` (or
`trimTheme: false`); details in [docs/API.md](docs/API.md) "Styles".

`installSpectrumSsr()` installs browser globals (`window`, `navigator`, `matchMedia`, ...) for the whole process and
never removes them. Libraries that check `typeof window` to detect a browser take their browser branch afterwards:
import them before `installSpectrumSsr()` or run them in a separate worker.

In the browser, import `swc-ssr/client` before `lit` and before any Spectrum module, load the element definitions,
then call `hydrateSpectrum(root)` (framework-agnostic) or `hydrateSpectrum(root, {template})` when the page is a Lit
template. `removeServerStyles: true` also frees the complete server `<style>` elements of `full` pages once the elements
adopted their sheets. Details and the `HydrationReport` shape are in [docs/API.md](docs/API.md).

Serve the HTML compressed (brotli if you can: its window spans the stylesheet copies of the shadow roots, gzip's
32 KB window does not). `styles: {dedupe: 'link'}` replaces the copies with `<link>`s to one stylesheet per distinct
text (serve `getStyleSheet(hash)` and put `result.head` into `<head>`); it is off by default because Firefox paints
the content before such a stylesheet has loaded (Chromium waits). Details: docs/API.md "Styles", docs/DESIGN.md
"Style de-duplication". If you split your client bundle, define `sp-theme` after its theme fragments and parents
before their children, in one task (docs/API.md "What trimming can break").

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
  `sp-dialog-label-N`); the markup is otherwise deterministic. Since 0.3.0 the generated ids of a page differ from
  0.2.x (the id seed of pass 2 hashes the parsed text, not the whole HTML).
* `?dedupe=link` / `styles: {dedupe: 'link'}`: Firefox shows content unstyled for a few frames until its linked
  stylesheet arrives (Chromium waits); WebKit is untested. Off by default.

The full review findings and the hardening plan are tracked in `docs/DESIGN.md`.
