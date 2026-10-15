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
// Internal hooks the renderer plugs into (also exported): setRafSink(sink), setListenerLog(log), setRandomSource(fn),
// setConstructionHook(fn), each returning the previous value. `setListenerLog` takes any `ListenerLog`
// (`{push(record)}`; an array is one); document listeners are logged after they were added.
```

**Deterministic ids, caveat.** The deterministic source cannot tell who asks: *any* plain `Uint8Array(4)` request made
synchronously during a render - also by application code in a template, a directive or a custom element renderer -
gets the render's deterministic bytes (the same in every render of the same page). Spectrum's `randomID()` is the
only Spectrum caller of that shape. Do not use 4-byte `getRandomValues` results for anything secret inside render
code, or turn the deterministic ids off: per render with `renderSpectrum(value, {deterministicIds: false})`, for the
process with `configureRandomSource({deterministicIds: false})` (Spectrum's ids then differ between the passes and
renders of a page, which can break server-rendered `aria-labelledby` / `id` pairs). Restricting it to `randomID()`
itself would need a stack inspection per request, which breaks as soon as the server is bundled; it is not done.
`randomID()` calls made outside the synchronous parts of a render (e.g. in a microtask a component scheduled) use the
CSPRNG, so those ids differ between renders.

`installSpectrumDomShim()` installs **process-wide, permanent** globals that are never removed: `window` (=
`globalThis`, a plain data property), `navigator`, `matchMedia` (never matches), `requestAnimationFrame` /
`cancelAnimationFrame` / `requestIdleCallback` (queued into the render whose code requested them, found by its
`AsyncLocalStorage` render scope; dropped outside renders and when that render already ended),
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
  elementRenderers?: ElementRendererConstructor[]; // extra renderers tried BEFORE the Spectrum ones (one whose
                                     // renderShadow() returns undefined must pop renderInfo.customElementHostStack
                                     // itself: @lit-labs/ssr 4.1.0 pops it only after an emitted shadow; swc-ssr's
                                     // own fallback renderer for non-Lit custom elements does)
  isManagedClass?: (ctor: CustomElementConstructor, tagName: string) => boolean;
                                     // which classes get `lifecycle` by default; default: Spectrum classes
                                     // (SpectrumMixin / SpectrumElement in the prototype chain)
  timeoutMs?: number;                // deadline of one render; default 10000, 0 / Infinity disables it
                                     // (values >= 2^31 ms, beyond the longest timer delay, count as Infinity)
  lazyDefinitionWaitMs?: number;     // wait for lazily imported definitions; default 250, 0 disables it;
                                     // never beyond the render's deadline (timeoutMs). Infinity (or >= 2^31
                                     // ms): up to the deadline (then: pass-1 output + warning); without a
                                     // deadline the default 250 ms. Once per tag and process (see below)
  lang?: string;                     // document language during the render (document.documentElement.lang,
                                     // restored afterwards); components resolve their locale from it. Without
                                     // it, a whole-document template's own <html lang> is used from pass 2 on
  deterministicIds?: boolean;        // default true: randomID() ids are deterministic per render; false: this
                                     // render's randomID() calls use the CSPRNG too (process-wide switch:
                                     // configureRandomSource from swc-ssr/dom-shim; see the caveat above)
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
  passes: number;         // 2 normally; 3 when elements without tree information failed in pass 2, a `full`
                          // element was updated after its markup was emitted, or an element adopted the
                          // previous-pass instance of another element (`adopted candidate rejected`) (at most 3)
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
ones included, and evaluated after the element's attributes and properties are set (as upstream does), once per
element and pass, before anything connects it: pre-built elements when they are created (the renderer that adopts
one reuses that decision; it does not ask again after the document lifecycle updated the element). With
`disableSsr` the element is not pooled, connected or updated; it renders without a shadow root (upstream's output)
with its light DOM, and other elements see a plain facade of it. The pre-built instance of such an element is
discarded (never connected), and the renderer reuses the decision made on it for the element it builds instead
(since 0.1.2; 0.1.1 asked again: three evaluations over two passes), so `disableSsr` elements are evaluated once per
pass too, on an instance that has the previous pass's attributes and properties, like every pre-built element.

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
  "Once per tag and process": whenever a wait ends - the definitions arrived, the wait time passed, or the render's
  deadline ended it - the tags still undefined are never waited for again. The wait never goes beyond the render's
  deadline. `Infinity` (or >= 2^31 ms) means "up to the deadline": when the deadline passes during the wait, the
  render returns its pass-1 output with the `#render` warning `the render did not settle within N ms: the wait for
  lazily defined elements (<tag>) was abandoned, the output of pass 1 is used` - so a client-only element that is
  never defined on the server costs one such render per process, later renders do not wait for it. A render
  without a deadline (`timeoutMs` 0 / Infinity) waits the default 250 ms for `Infinity`: an unbounded wait for a
  tag that is never defined would never end. Lazily defined tags are only noticed in components' `render()`
  results, not in the top-level template.
* At the end of every render (also a failed one), every element swc-ssr connected, in any pass, gets its
  `disconnectedCallback` (like a browser removing the tree), the pass contexts are disposed, and the render waits one
  event-loop turn (`setTimeout 0`) with its session still active before the report is built, so zero-delay timers and
  late promise continuations of component code run attributed to this render.
* Work a render leaves behind belongs to that render, never to another one: animation frames, `document` listeners,
  unsupported-selector logs and dropped DOM changes are filed under the render of the caller's `AsyncLocalStorage`
  render scope (also in timers and promise continuations the render started). Once that render ended, its frames
  are dropped and the `document` listeners it adds are removed at once. Only code without a render scope goes to the
  most recent active render.
* `unhandledRejection`: a listener is installed with the first render and kept for the life of the process. While a
  render is in progress it attributes rejections of promises created inside the render's scope (to the element
  whose hook created them, else `#render`). After the render ended: rejections from its own scope (templates,
  directives, custom renderers, and long-lived resources first created there, e.g. a lazily created client or an
  interval) get Node's behaviour; rejections from an element's hooks (component code of the discarded tree) become a
  process warning (`SWC_SSR_LATE_REJECTION`) instead of a crash. Other rejections get Node's behaviour for the
  `--unhandled-rejections` mode (throw by default). An application with its own listener decides itself (it also sees
  render-created rejections: Node emits to every listener), and no warning is emitted then.

### Report semantics

The pass-2 pool is keyed structurally: tree scope + tag + a short hash of the template's static attributes +
ordinal. Adoption of a previous-pass instance is refused when its static attributes differ; attributes the previous
pass's element got from upstream that are not set again are removed (with `attributeChangedCallback`) before the
lifecycle runs. The key is all upstream gives a renderer when it constructs it (the element's light DOM is rendered
later), so adoptions are verified after the pass, against the pass's own output and records, by two criteria:
the element's light DOM (child tags, `slot` names, text), and the attributes / properties upstream set on it (its
bindings; since 0.1.2, skipped when the light DOM alone identifies the element). An element that differs by one of
them from the element it adopted, while another element of the same tag, static attributes and scope explains the
difference - an element of this pass that is like the adopted one and did not get a matching instance itself, or a
previous-pass element like this one that no matching element adopted - adopted the wrong instance; it is reported
and another pass is made, whose ordinals follow the new order. Elements that are the same element with changed
content or bound values are not affected (since 0.1.2 also when a sibling has the old content). Elements with no
light DOM that differ only by a bound value which moves from one to another between the passes cannot be told from
reordered ones (a third pass and the warning). The sequential `id` is the `data-swc-ssr` value and the report id.
Elements pre-built from the previous pass but not rendered, or only present in earlier passes, are reported with
`id: -1` (only when they have messages). Messages of earlier passes are prefixed `pass N: `.

Messages that can appear:

| Message | Where | Meaning |
|---|---|---|
| `unhandled rejection: ...` | the element whose hook created the promise, else `#render` | a rejection nobody handled, of a promise created inside the render's scope (never an unrelated one), arriving while the render is in progress (later ones: see `unhandledRejection` above) |
| `disconnectedCallback: ...` | element | its `disconnectedCallback` threw at the end of the render |
| `updated after its markup was emitted in pass N (changed: a, b); another pass is made` | element | a `full` element was updated after its markup was emitted (last pass: `the output shows the earlier state`) |
| `dropped DOM change: <op>(<node>) on <target> [in <host>] has no effect on the server output ...` | the element whose code made the change, else the closest rendered custom element, else `#render` | structure changes on rendered nodes (from pass 2 on), e.g. `sp-table` checkbox cells |
| `light-DOM attribute change not applied: ...` | host or `#render` | an attribute change on a plain element could not be located in the final output: no element with its signature (tag, `id`, `name`, `slot`, `type`, `role`, `part`, `for`, `href`, `src`, `class`), or several, not exactly one with its content (child tags, text), and the scope's structure along the element's path changed (with an unchanged structure the element at the recorded position gets the change) |
| `adopted candidate rejected: light DOM differs from the pass-N <tag> it was matched with ...; another pass is made` (or `upstream attributes / properties differ ...`) | element | the element took over the previous-pass instance of another element of the same kind (see above); the next pass corrects it (last pass: `the output may show the state of that element`) |
| `locale: no language is set ...` | element | its locale falls back to `navigator.language` (pass `lang`, or set `<sp-theme lang>`) |
| `attributeChangedCallback(<name>): ...` | element | an attribute reaction threw |
| `the render did not settle within N ms: pass K was abandoned, the output of pass K-1 is used` | `#render` | see `timeoutMs` |
| `the render did not settle within N ms: the wait for lazily defined elements (<tag>) was abandoned, the output of pass 1 is used` | `#render` | the deadline passed while pass 1 waited for lazy definitions (see `lazyDefinitionWaitMs`) |

`ServerTree` (internal, `packages/swc-ssr/src/server/server-tree.ts`): parse5 (htmlparser2 adapter) document of the pass-1
HTML with lookup `byId(id)`, `lightChildren(id)`, `shadowRoot(id)`, `query(node, selector)`, `queryAll(node, selector)` via `css-select`,
`documentLanguage()` (whole documents: the `<html lang>`), and `lightSignature(node)` (child tags with `slot`, text hash;
used to verify adoptions and to locate light-DOM attribute changes).

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
adapter for every hydrating element that has `MatchMediaController`s - `sp-picker` / `sp-action-menu` /
`sp-contextual-help`, subclasses registered under other tags, application components), importing `swc-ssr/client` installs two generic
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
| `HEAD` on any path except `/dist/*` | 200 with an empty body, never renders; not in the request log (the first HEAD gets its own line, later ones a per-minute count) |
| `HEAD /dist/*` | like `GET` without the body (static handler): the file's `Content-Type` / `Content-Length`, 404 for a missing file |
| `GET /dist/*` | static from `demo/public/dist` |

The demo renders with `renderSpectrum(pageTemplate(entries), {deferHydration: true, lang})`.

Page shell: `<!doctype html><html lang="<page language>"><head><meta charset="utf-8"><title>…</title><style>/* layout only */</style></head><body><div id="app">…</div><script type="module" src="/dist/client.js"></script></body></html>`.
The SSR'd content inside `#app` is `pageTemplate(entries)` = `<sp-theme system="spectrum" color="light" scale="medium">` + one `<section class="demo" data-component="<name>"><h2>…</h2>…render()…</section>` per entry.
The client reads `data-mode` and `data-components` attributes on `#app` to know what to hydrate/render.
