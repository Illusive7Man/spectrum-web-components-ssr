# API contract (binding for all implementation work)

## `swc-ssr/dom-shim`  (`packages/swc-ssr/src/dom-shim/index.ts`)

```ts
export function installSpectrumDomShim(): void;   // idempotent; installs @lit-labs/ssr global dom shim + Spectrum extras
export const isSpectrumDomShimInstalled: () => boolean;

// crypto.getRandomValues wrapper (process-wide). During the synchronous parts of a render, requests shaped like
// Spectrum's randomID() (shared/src/random-id.js: a plain Uint8Array of length 4) get bytes from the render's
// deterministic source; every other request (nonces, tokens, UUIDs, Buffer, Uint32Array, ...) always goes to the
// real CSPRNG, which keeps its own validation.
export interface RandomSourceOptions { deterministicIds?: boolean; }   // default true
export function configureRandomSource(options: RandomSourceOptions): Required<RandomSourceOptions>; // returns previous
export function isRandomIdRequest(array: unknown): array is Uint8Array;
export function setSelectorErrorHandler(handler: SelectorErrorHandler | undefined): SelectorErrorHandler | undefined; // returns previous
```

`installSpectrumDomShim()` installs **process-wide, permanent** globals that are never removed: `window` (=
`globalThis`, a plain data property), `navigator`, `matchMedia` (never matches), `requestAnimationFrame` /
`cancelAnimationFrame` / `requestIdleCallback` (queued into the running render, dropped outside renders),
`getComputedStyle`, `CSS`, no-op `addEventListener` / `removeEventListener` / `dispatchEvent` on the global,
`innerWidth` & co., `screen`, `scrollTo` / `scrollBy` and the element / event classes. Libraries that sniff
`typeof window` take their browser branch afterwards: import them before `installSpectrumSsr()` or keep them in a
separate process / worker. Scoping `window` to renders is not feasible (see DESIGN.md "Process-wide state").

## `swc-ssr/server`  (`packages/swc-ssr/src/server/index.ts`)

```ts
import type {TemplateResult} from 'lit';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';

export function installSpectrumSsr(): void;      // = installSpectrumDomShim(); call before importing any @spectrum-web-components module

export type LifecycleMode = 'none' | 'connected' | 'full';
// 'none'      : Lit default (willUpdate + attribute reflection only)
// 'connected' : + element.connectedCallback() with enableUpdating no-op'd
// 'full'      : + firstUpdated/updated + rAF flush + bounded re-render (default for managed classes)

export interface RenderSpectrumOptions {
  deferHydration?: boolean;          // forwarded to @lit-labs/ssr render(); default false
  debug?: boolean;                   // keep data-swc-ssr markers and log details; default false
  lifecycle?: LifecycleMode;         // lifecycle of managed classes; default 'full'
  lifecycleByTag?: Record<string, LifecycleMode>;  // per-tag override (also opts non-managed classes in),
                                                   // e.g. {'sp-overlay': 'none', 'my-element': 'full'}
  elementRenderers?: ElementRendererConstructor[]; // extra renderers tried BEFORE the Spectrum ones
  isManagedClass?: (ctor: CustomElementConstructor, tagName: string) => boolean;
                                     // which classes get `lifecycle` by default; default: Spectrum classes
                                     // (SpectrumMixin / SpectrumElement in the prototype chain)
  timeoutMs?: number;                // deadline of one render; default 10000, 0 / Infinity disables it
  lazyDefinitionWaitMs?: number;     // wait for lazily imported definitions; default 250, 0 disables it
  lang?: string;                     // document language during the render (document.documentElement.lang,
                                     // restored afterwards); components resolve their locale from it
  deterministicIds?: boolean;        // default true: randomID() ids are deterministic per render; false: this
                                     // render's randomID() calls use the CSPRNG too (process-wide switch:
                                     // configureRandomSource from swc-ssr/dom-shim)
}

export interface ElementReport {
  id: number;             // -1: not an element of the final output (see below)
  tagName: string;        // '#render' for warnings not tied to an element
  errors: string[];       // messages of exceptions caught for this element in the FINAL pass
  warnings: string[];     // incl. errors/warnings of earlier passes, prefixed 'pass N: '
  fallback: boolean;      // true if the final pass failed and the previous pass's output was used for this element
}

export interface RenderReport {
  elements: ElementReport[];
  passes: number;         // 2 normally; 3 when elements without tree information failed in pass 2, or a `full`
                          // element was updated after its markup was emitted (at most 3)
  durationMs: number;     // includes the event-loop turn at the end of the render (see below)
}

export interface RenderSpectrumResult { html: string; report: RenderReport; }

export function renderSpectrum(value: unknown, options?: RenderSpectrumOptions): Promise<RenderSpectrumResult>;

export class SpectrumElementRenderer /* extends LitElementRenderer */ {}
export class ThemeRenderer /* extends ElementRenderer */ {}
export const spectrumElementRenderers: ElementRendererConstructor[]; // [ThemeRenderer, SpectrumElementRenderer]

// adapters registry (Spectrum-specific behaviour lives ONLY here)
export interface ElementAdapter {
  tag: string | RegExp;
  lifecycle?: LifecycleMode;
  prepare?(element: HTMLElement, ctx: AdapterContext): void;        // every pass, right after the instance is created,
                                                                    // before attributes/properties/lifecycle
  beforeRender?(element: HTMLElement, ctx: AdapterContext): void;   // pass >= 2, after lifecycle, before render()
  afterRender?(element: HTMLElement, ctx: AdapterContext): void;    // pass >= 2
}
export interface AdapterContext {
  id: number;                     // data-swc-ssr id in this pass; -1 in prepare() of pre-built (not yet rendered) elements
  pass: number;                   // 1, 2 or 3
  key: string;                    // structural key (stable across passes)
  previousId: number | undefined; // the element's id in the previous pass
  tree: ServerTree | undefined;
  report: ElementReport;
}
export function registerAdapter(adapter: ElementAdapter): void;   // the last registration for a tag wins

export function getCurrentRenderContext(): unknown;   // the running render's context (undefined outside a render)
export class ServerTree { /* see below */ }
```

Built-in adapters (`packages/swc-ssr/src/server/adapters/`): `sp-theme` (lifecycle `none`), `sp-overlay` (kept closed,
`prepare`), `sp-picker` (selection safety net), `sp-breadcrumbs` / `sp-split-view` / `sp-color-wheel` (layout-dependent
state computed without layout, `prepare`). An internal inspector (`adapters/language.ts`) runs over the final pass's
elements and warns about elements whose locale falls back to `navigator.language`.

### Lifecycle and `renderOptions`

The effective lifecycle of an element, in order of precedence:

1. `lifecycleByTag[tag]`;
2. `LitElementRenderer.renderOptions` returning `connectedCallback: false` -> `'none'`;
3. managed classes (`isManagedClass`, default Spectrum's): min(`lifecycle`, the adapter's `lifecycle`), default `'full'`;
4. other Lit elements keep upstream semantics: `'connected'` when `renderOptions` returns `connectedCallback: true` (or
   the deprecated `globalThis.litSsrCallConnectedCallback` is set), otherwise `'none'`. They keep the light-DOM /
   shadow facades in every mode.

Pass 1 never goes beyond `'connected'`. `LitElementRenderer.renderOptions` are honoured for every element, pre-built
ones included, and evaluated after the element's attributes and properties are set (as upstream does). With
`disableSsr` the element is not pooled, connected or updated; it renders without a shadow root (upstream's output)
with its light DOM, and other elements see a plain facade of it.

Connected elements get browser-like attribute reactions: when an observed attribute changes through the element's
own `setAttribute` / `removeAttribute` / `toggleAttribute` (component code), its `attributeChangedCallback` runs, as
in browsers. Writes made by the renderer (upstream `ElementRenderer.setAttribute`, replays) notify exactly once.

### `renderSpectrum()` semantics

* Renders are serialized in a queue. A `renderSpectrum()` called from inside a running render - synchronously or
  from asynchronous work the render started (detected through an `AsyncLocalStorage` scope) - runs nested instead of
  queueing.
* `timeoutMs`: when a render does not settle in time (e.g. a template awaits a promise that never settles), the
  output of the last completed pass is returned with a `#render` warning; when pass 1 did not complete, the promise
  rejects with `renderSpectrum: the render did not settle within N ms (pass 1 did not complete)`. Either way the queue
  moves on; the abandoned work stops at its next step.
* `lazyDefinitionWaitMs`: components that import what they render lazily (`sp-slider` -> `sp-number-field`) render
  those tags as plain elements first; the render waits (once per tag and process) for definitions of tags it
  rendered while undefined and repeats pass 1 when they arrive (also when a tag got defined while pass 1 ran).
* At the end of every render (also a failed one), every element swc-ssr connected, in any pass, gets its
  `disconnectedCallback` (like a browser removing the tree), the pass contexts are disposed, and the render waits one
  event-loop turn (`setTimeout 0`) with its session still active before the report is built, so zero-delay timers and
  late promise continuations of component code run attributed to this render.
* `unhandledRejection`: a listener is installed with the first render and kept for the life of the process. It only
  attributes rejections of promises created inside a render's scope; late ones after the render ended are only logged
  in debug mode. Other rejections get Node's behaviour for the `--unhandled-rejections` mode (throw by default), or are
  left to the application when it has its own listener (which also sees render-created rejections: Node emits to
  every listener).

### Report semantics

The pass-2 pool is keyed structurally: tree scope + tag + a short hash of the template's static attributes +
ordinal. Adoption of a previous-pass instance is refused when its static attributes differ; attributes the previous
pass's element got from upstream that are not set again are removed (with `attributeChangedCallback`) before the
lifecycle runs. The sequential `id` is the `data-swc-ssr` value and the report id. Elements pre-built from the
previous pass but not rendered, or only present in earlier passes, are reported with `id: -1` (only when they have
messages). Messages of earlier passes are prefixed `pass N: `.

Messages that can appear:

| Message | Where | Meaning |
|---|---|---|
| `unhandled rejection: ...` | the element whose hook created the promise, else `#render` | a rejection nobody handled, of a promise created inside the render's scope (never an unrelated one) |
| `disconnectedCallback: ...` | element | its `disconnectedCallback` threw at the end of the render |
| `updated after its markup was emitted in pass N (changed: a, b); another pass is made` | element | a `full` element was updated after its markup was emitted (last pass: `the output shows the earlier state`) |
| `dropped DOM change: <op>(<node>) on <target> [in <host>] has no effect on the server output ...` | the element whose code made the change, else the closest rendered custom element, else `#render` | structure changes on rendered nodes (from pass 2 on), e.g. `sp-table` checkbox cells |
| `light-DOM attribute change not applied: ...` | host or `#render` | an attribute change on a plain element could not be located in the final output |
| `locale: no language is set ...` | element | its locale falls back to `navigator.language` (pass `lang`, or set `<sp-theme lang>`) |
| `attributeChangedCallback(<name>): ...` | element | an attribute reaction threw |
| `the render did not settle within N ms: pass K was abandoned, the output of pass K-1 is used` | `#render` | see `timeoutMs` |

`ServerTree` (internal, `packages/swc-ssr/src/server/server-tree.ts`): parse5 (htmlparser2 adapter) document of the pass-1
HTML with lookup `byId(id)`, `lightChildren(id)`, `shadowRoot(id)`, `query(node, selector)`, `queryAll(node, selector)` via `css-select`.

## `swc-ssr/client`  (`packages/swc-ssr/src/client/index.ts`)

Must be the FIRST import of the client bundle (before `lit` and before any `@spectrum-web-components` import).

```ts
export interface HydrationReport {
  errors: string[];        // console.error / uncaught errors captured during hydration
  warnings: string[];      // console.warn captured during hydration
  deferred: string[];      // tag names of elements that still carry defer-hydration after hydration
  hydratedCount: number;   // number of hydration candidates (custom elements: sp-* and others such as
                           // <overlay-trigger>) that have a (declarative) shadow root, are upgraded and not deferred
  durationMs: number;
}

export interface HydrateSpectrumOptions {
  template?: unknown;      // a lit TemplateResult: if given, @lit-labs/ssr-client hydrate(template, root) is used
                           // (after the light-DOM elements below root were enabled in document order)
  whenDefined?: boolean;   // default true: await customElements.whenDefined for the candidate tags of root's light
                           // DOM first, and after hydrating for tags inside shadow roots (often defined lazily by
                           // their host)
  timeoutMs?: number;      // default 3000: bound for each individual wait; waits that run into it become warnings
}

export function hydrateSpectrum(root?: Element, options?: HydrateSpectrumOptions): Promise<HydrationReport>;  // never rejects
export function hydrationReport(): HydrationReport;   // last report (empty report if none yet)
export function applyDeclarativeShadowDomPolyfill(root?: ParentNode): boolean;   // also applied on import when needed

// Client counterpart of the server adapters: per-tag code around the first ("hydrating") update.
export interface HydrationAdapter {
  tag: string | RegExp;
  beforeHydrate?(element: HTMLElement): void;   // start of the first performUpdate(), before willUpdate()/render()
  afterHydrate?(element: HTMLElement): void;    // right after the hydrating update() (before firstUpdated())
  slotchangePlan?: 'before-willupdate' | 'after-willupdate';
                                                // when the initial-slotchange plan (one extra render()) runs; default
                                                // 'after-willupdate' (right before the hydrating render); the last
                                                // matching adapter that sets it wins
}
export function registerHydrationAdapter(adapter: HydrationAdapter): void;
```

Hydration candidates (`client/elements.ts` `isHydrationCandidate`, one predicate for collection, `whenDefined`, the
agnostic path and the report): an element that carries `defer-hydration`, or whose tag is a valid custom element
name and that is `sp-*`, has a shadow root, or is already defined. Undefined custom-element-named tags without a
declarative shadow root and without `defer-hydration` (e.g. Angular component hosts such as `<app-root>`) are not
awaited. The agnostic path removes `defer-hydration` from every deferred candidate, not only `sp-*`.

Besides the adapters (built in: `sp-picker`, `sp-slider`, `sp-breadcrumbs`, `sp-checkbox`, and a `MatchMediaController`
adapter for `sp-picker` / `sp-action-menu` / `sp-contextual-help`), importing `swc-ssr/client` installs two generic
hooks on every Lit element whose pre-existing shadow root was rendered by `@lit-labs/ssr` (it contains a `<!--lit-part`
marker) or whose tag starts with `sp-`: the initial `slotchange` (which declarative shadow roots never receive) is
emulated like the server does, and a hydration mismatch is recovered from by re-rendering that element on the client
(reported via `console.error`). Other Lit elements with a declarative shadow root are left to lit's own hydrate support.

The `MatchMediaController` adapter: the server's `matchMedia()` never matches, so the server renders the desktop state
(popover, no `mobile-view`). `beforeHydrate` pins every controller's `matches` to that server value; `afterHydrate`
restores it from `media.matches` and requests an update before `firstUpdated()`, so phones hydrate the desktop markup
without a mismatch and re-render into the mobile state (tray, `mobile-view`, modal contextual help) on the next update. Errors/warnings are captured from the moment
the module is loaded; the first `hydrateSpectrum()` report includes them. The template path works with server output
rendered with either `deferHydration` setting; `true` is recommended (nothing hydrates before `hydrateSpectrum()`, and
light-DOM elements then update in document order, as in client-side rendering).

The demo client must set `window.__swcSsrHydration = hydrateSpectrum(...)` (a Promise<HydrationReport>) so tests can await it,
and `window.__swcSsrMode = 'ssr' | 'csr'`.

## Demo catalog entry  (`demo/src/catalog/types.ts`)

```ts
import type {TemplateResult} from 'lit';
export interface CatalogEntry {
  name: string;                 // kebab-case package name, e.g. 'action-button'; used in URLs and data-component
  packages: string[];           // @spectrum-web-components package names this entry needs
  load(): Promise<void>;        // dynamic bare-specifier imports of the registration modules (sp-*.js) + icons used
  render(): TemplateResult;     // the showcase for this component (several variants, realistic slotted content)
  notes?: string;               // known SSR caveats
  interactive?: boolean;        // true if the e2e interaction smoke test should click the first focusable control
}
```
`demo/src/catalog/index.ts` exports `export const catalog: CatalogEntry[]` (sorted by name) and `export function findEntry(name: string): CatalogEntry | undefined`,
plus `export const smokeSet: string[]` (entry names of the e2e smoke run) and `export function loadEntries(entries?): Promise<void>`.
The exported entries' `load()` also registers `sp-theme` with the light/medium fragments the page shell needs.

## Demo server routes (`demo/src/server.ts`, port 3000, `PORT` env overrides)

| Route | Behaviour |
|---|---|
| `GET /` | SSR of the whole catalog + client bundle (hydrates) |
| `GET /component/:name` | SSR of one entry + client bundle |
| `GET /csr` , `GET /csr/:name` | same page shell, **no SSR**: empty `#app`, the client renders with lit `render()` (reference DOM) |
| `?nohydrate=1` on any SSR route | omit the client bundle `<script>` (pure SSR view) |
| `GET /report.json` | the `RenderReport` of the last SSR render (+ `loadErrors`); `?component=<name>` (or `*` for `/`) returns the last report of that page |
| `GET /catalog.json` | `[{name, interactive, notes}]` |
| `?agnostic=1` on an SSR route | hydrate without the template (framework-agnostic path) |
| `?lang=<BCP 47 tag>` on SSR and CSR routes | page language; otherwise the request's most preferred `Accept-Language` language (`*` ignored, canonicalized with `Intl.getCanonicalLocales`), otherwise `en`. Passed to `renderSpectrum({lang})` and written to `<html lang>` |
| `HEAD` on any path | 200 with an empty body, never renders; not in the request log (the first HEAD gets its own line, later ones a per-minute count) |
| `GET /dist/*` | static from `demo/public/dist` |

The demo renders with `renderSpectrum(pageTemplate(entries), {deferHydration: true, lang})`.

Page shell: `<!doctype html><html lang="<page language>"><head><meta charset="utf-8"><title>…</title><style>/* layout only */</style></head><body><div id="app">…</div><script type="module" src="/dist/client.js"></script></body></html>`.
The SSR'd content inside `#app` is `pageTemplate(entries)` = `<sp-theme system="spectrum" color="light" scale="medium">` + one `<section class="demo" data-component="<name>"><h2>…</h2>…render()…</section>` per entry.
The client reads `data-mode` and `data-components` attributes on `#app` to know what to hydrate/render.
