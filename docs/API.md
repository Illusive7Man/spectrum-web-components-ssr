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
CSPRNG, so those ids differ between renders. The source of pass 2 and later passes is seeded from the previous pass's
output: since 0.3.0 from the FNV-1a hash of its parsed text (the HTML with every `<style>` body of 64 or more
characters replaced by a numbered placeholder, `ServerTree.contentHash`), before from the whole HTML. The same page
therefore gets other `randomID()` suffixes than with 0.2.x (`sp-field-label-xxxxxxxx`), still the same ones in every
render; structure and references are unchanged.

`installSpectrumDomShim()` installs **process-wide, permanent** globals that are never removed: `window` (=
`globalThis`, a plain data property), `navigator`, `matchMedia` (never matches), `requestAnimationFrame` /
`cancelAnimationFrame` / `requestIdleCallback` (queued into the render whose code requested them, found by its
`AsyncLocalStorage` render scope; dropped outside renders and when that render already ended),
`getComputedStyle`, `CSS`, no-op `addEventListener` / `removeEventListener` / `dispatchEvent` on the global,
`innerWidth` & co., `screen`, `scrollTo` / `scrollBy` and the element / event classes. Libraries that sniff
`typeof window` take their browser branch afterwards: import them before `installSpectrumSsr()` or keep them in a
separate process / worker. Scoping `window` to renders is not feasible (see DESIGN.md "Process-wide state").

**Selectors.** `querySelector` / `querySelectorAll` / `matches` / `closest` on server nodes evaluate the selector
against the tree as it is at the call (attributes are read through `getAttribute`), like a browser: a query after a
component changed an ancestor's attributes sees the change. Since 0.3.0 compiled selectors are cached process-wide
(bounded, per selector string; selectors with `:scope` are compiled per call); they are compiled with css-select's
`cacheResults: false`, so a compiled selector keeps no state about the nodes it saw. (The 0.3.0 review found the
default `cacheResults: true` returning stale results through the shared cache: `.on span` stayed unmatched after
`p.setAttribute('class', 'on')`, and a component that queried after its sibling marked an ancestor rendered other
markup than the browser. Fixed before release; the render time is unaffected.)

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
  styles?: StyleOptions;             // the CSS of the declarative shadow roots; default {mode: 'full'} (byte-identical
                                     // to 0.1.x). {mode: 'trimmed'} needs swc-ssr/client on the page: see "Styles" below
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
  styles?: StylesReport;  // when StyleOptions.mode is 'trimmed', and in any mode with dedupe: 'link' (see "Styles")
}

export interface RenderSpectrumResult {
  html: string;
  report: RenderReport;
  head?: string;          // 0.3.0: markup for the page's <head> - with StyleOptions.dedupe 'link' one
                          // <link rel="preload" href="..." as="style"> per linked URL (order of first use), else ''.
                          // Optional in this type only; renderSpectrum() below always sets it
}

export function renderSpectrum(
  value: unknown,
  options?: RenderSpectrumOptions,
): Promise<RenderSpectrumResult & {head: string}>;

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
  handlesMutation?(element: HTMLElement, target: object, operation: string, node?: unknown): boolean;
                                                                    // true when lightDomInsertions reproduces it
  lightDomInsertions?(element: HTMLElement): Iterable<LightDomInsertion> | undefined;
                                                                    // fully SSR'd content prepended to final targets
}
export interface LightDomInsertion {
  target: HTMLElement;             // a custom element rendered in the final pass
  value: unknown;                  // rendered through a supplemental two-pass Spectrum render
  position?: 'afterbegin';        // the only supported (and default) position: first in the target's light DOM
}| undefined;
                                                                    // fully SSR'd content prepended to final targets
}
export interface LightDomInsertion {
  target: HTMLElement;             // a custom element rendered in the final pass
  value: unknown;                  // rendered through a supplemental two-pass Spectrum render
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

// Styles (see "Styles" below)
export function scanCustomPropertyReferences(text: string): string[];  // every var(--x) name of a CSS / JS text
export const STYLE_MARKER_ATTRIBUTE = 'data-swc-styles';
export type StyleMarker = 'trimmed' | 'minified' | 'complete';   // 'complete' (0.3.0): only on a dedupe <link>
export type {StyleOptions, StylesReport, StylesDedupeReport};

// Style de-duplication (0.3.0, StyleOptions.dedupe: 'link'; see "Styles")
export class StyleSheetStore {                              // LRU of distinct stylesheet texts by content hash
  constructor(options?: StyleSheetStoreOptions);            // {maxBytes?, minLifetimeMs?, now?: () => number}
  maxBytes: number;                                         // budget (UTF-8 bytes of the texts), default 32 MiB;
                                                            // lowering it evicts at once
  minLifetimeMs: number;                                    // 0.3.0 review: a text is not evicted for this long after
                                                            // a render last put it (default 60_000; 0 = pure LRU), so
                                                            // pages just served can still fetch their sheets; above
                                                            // 2 x maxBytes the oldest go even when fresh
  evictions: number; freshEvictions: number;                // counters: texts evicted / of those, within their
                                                            // protection (each one a possible 404)
  readonly size: number; readonly bytes: number;
  get(hash: string): string | undefined;                    // counts as a use
  put(css: string): string;                                 // stores under styleSheetHash(css), returns the hash
                                                            // (a use, and a new protection period)
  has(hash: string): boolean; delete(hash: string): boolean; clear(): void;
}
export const DEFAULT_STORE_MIN_LIFETIME_MS = 60_000;
export const styleSheetStore: StyleSheetStore;              // the process-wide store renderSpectrum() puts into
                                                            // (least recently used evicted first)
export function getStyleSheet(hash: string): string | undefined;   // styleSheetStore.get(hash) for a well-formed
                                                            // hash: serve it as text/css (see "Styles")
export function styleSheetHash(css: string): string;        // 16 characters of base64url (96 bits of SHA-256 of
                                                            // the UTF-8 text)
export const DEFAULT_STYLE_SHEET_PATH = '/swc-css/';        // default URLs: /swc-css/<hash>.css
export const STYLE_SHEET_HASH_RE: RegExp;                   // what a hash looks like (route validation)
export type StyleHeadHint = 'preload' | 'stylesheet-not-all';
export function styleHeadOf(styles: StylesReport | undefined, hint?: StyleHeadHint): string;
                                                            // the <head> markup for report.styles.dedupe ('' without);
                                                            // 'preload' (default, = result.head) or
                                                            // <link rel="stylesheet" media="not all">
```

Built-in adapters (`packages/swc-ssr/src/server/adapters/`): `sp-theme` (lifecycle `none`), `sp-overlay` (kept closed,
`prepare`), `sp-picker` (selection safety net), `sp-breadcrumbs` / `sp-split-view` / `sp-color-wheel` (layout-dependent
state computed without layout, `prepare`), and `sp-table` (fully rendered selection cells inserted into the final light
DOM). An internal inspector (`adapters/language.ts`) runs over the final pass's elements and warns about elements whose
locale falls back to `navigator.language`.

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

### Performance notes

* **Cost.** A render is synchronous CPU work for most of its time and runs in the renderers' queue (one at a time per
  process): about 0.65-0.7 ms per element on one-component pages and 1.4 ms per element on the 1349-element catalog
  page (3 passes) in 0.3.0, measured on a 15 W laptop CPU (`/component/button` 21 ms, the catalog 1.9 s in `full` mode,
  2.1-2.2 s trimmed / minified; 0.2.1: 30 ms and 3.8 s; docs/DESIGN.md "Performance"). The whole page is rendered before
  `renderSpectrum()` resolves; nothing is streamed. Pages that need a third pass (an element appears only in pass 2 and
  fails there: `sp-action-menu` in an `sp-breadcrumbs` overflow, `sp-button-group` in an `sp-dialog` footer, `sp-slider`
  on a page with a dialog) cost one more pass. Trimming adds about 9-25 ms per one-component page and 0.25 s on the
  catalog; `dedupe: 'link'` adds nothing measurable. A long render blocks the event loop of its process (rendering in
  `worker_threads` workers, each with its own shim and queue, is not tested here).
* **Linear finish.** The last step of a render (light-DOM attribute edits, `data-swc-ssr` marker removal, raw DOM-node
  regions) is one pass over the page whatever the number of raw regions (0.3.0 review: a marker scan restarted at every
  region boundary made pages with thousands of raw regions after their last marker quadratic - 5,000 regions up to
  3.1 s, 20,000 regions 15 s; now 14 ms / 32 ms, `perf-finalize.test.ts` guards the ratio).
* **Bytes.** Serve the HTML compressed, brotli if possible: every shadow root repeats its class's stylesheet, which
  brotli's window removes and gzip's 32 KB window does not (`full` button page: 1253 KB, 121 KB gzip, 44 KB brotli;
  the trimmed catalog: 13.6 MB, 997 KB gzip, 180 KB brotli). Trimming and minification shrink what is parsed and kept in
  memory by the browser as well, not only the transfer. `dedupe: 'link'` cuts the HTML to 3-9 % of the trimmed page (button:
  28 KB, catalog 1.2 MB) and moves the CSS into cacheable files; with brotli its first (cold) load transfers about as
  much as the inline page (button trimmed: 15 KB vs 12 KB, catalog 201 KB vs 180 KB), repeat visits transfer the HTML
  only (3 KB / 62 KB). See "Styles" for its paint trade-off.
* **Memory.** Heap after GC is flat over repeated renders (whole catalog: 111-114 MB `full`, 100-103 MB trimmed, 50-51 MB
  trimmed + `dedupe: 'link'`). Process-wide caches are bounded (docs/DESIGN.md "Process-wide state"); `styleSheetStore`
  holds at most `maxBytes` (32 MiB) of stylesheet text.

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
| `dropped DOM change: <op>(<node>) on <target> [in <host>] has no effect on the server output ...` | the element whose code made the change, else the closest rendered custom element, else `#render` | structure changes on rendered nodes (from pass 2 on) that no adapter reproduces in the final light DOM |
| `light-DOM attribute change not applied: ...` | host or `#render` | an attribute change on a plain element could not be located in the final output: no element with its signature (tag, `id`, `name`, `slot`, `type`, `role`, `part`, `for`, `href`, `src`, `class`), or several, not exactly one with its content (child tags, text), and the scope's structure along the element's path changed (with an unchanged structure the element at the recorded position gets the change) |
| `adopted candidate rejected: light DOM differs from the pass-N <tag> it was matched with ...; another pass is made` (or `upstream attributes / properties differ ...`) | element | the element took over the previous-pass instance of another element of the same kind (see above); the next pass corrects it (last pass: `the output may show the state of that element`) |
| `locale: no language is set ...` | element | its locale falls back to `navigator.language` (pass `lang`, or set `<sp-theme lang>`) |
| `attributeChangedCallback(<name>): ...` | element | an attribute reaction threw |
| `the render did not settle within N ms: pass K was abandoned, the output of pass K-1 is used` | `#render` | see `timeoutMs` |
| `the render did not settle within N ms: the wait for lazily defined elements (<tag>) was abandoned, the output of pass 1 is used` | `#render` | the deadline passed while pass 1 waited for lazy definitions (see `lazyDefinitionWaitMs`) |

### Styles (`RenderSpectrumOptions.styles`)

In the default `full` mode every declarative shadow root carries the complete stylesheets of its element (the class's
`elementStyles`, and for `<sp-theme>` its theme fragments): about 95 % of the HTML of a Spectrum page (measured: the
button page is 1.22 MB of which 98.3 % is CSS, in 33 `<style>` blocks with 6 distinct texts). `trimmed` keeps, per
stylesheet, only what the rendered page can use.

```ts
export interface StyleOptions {
  mode?: 'full' | 'trimmed';           // default 'full'; any other value counts as 'full'
  trimTheme?: boolean;                 // default true (trimmed mode)
  references?: readonly string[] | Iterable<string>;
                                       // '--name' or '--prefix-*': custom properties the app's own CSS uses; a
                                       // single string is one entry (not iterated per character)
  undefinedPrefixes?: readonly string[];  // e.g. ['--mod-']: var(--mod-x, V) collapses to V. Default []
  minifyCustomProperties?: boolean;    // default false; unsafe when the app sets / reads --spectrum-* names
  keep?: ReadonlyArray<string | RegExp>;  // selectors (substring of, or RegExp tested against, the selector text)
                                       // always kept; a single string or RegExp is one entry
  dedupe?: 'none' | 'link';            // 0.3.0, default 'none' (other values count as 'none'); any mode. 'link': one
                                       // copy per distinct stylesheet text, linked from every shadow root (below)
  dedupeUrl?: (hash: string, css: string) => string;
                                       // dedupe 'link': URL of a stored text; default `/swc-css/${hash}.css`. Called
                                       // once per distinct text and render; the result is HTML-escaped
}

export interface StylesReport {        // RenderReport.styles: trimmed mode, and any mode with dedupe 'link'
  mode: string;                        // 'trimmed' (also with minifyCustomProperties), or 'full' (dedupe 'link' only)
  sheets: Array<{id: string; tag: string; instances: number; fullBytes: number; trimmedBytes: number;
                 hash?: string}>;      // hash (dedupe 'link'): the stored text the sheet was linked as; absent inline
  fullBytes: number;                   // sum of fullBytes x instances: the CSS the page carries in full mode
  trimmedBytes: number;                // sum of trimmedBytes x instances: the CSS it carries without dedupe
  durationMs: number;                  // time spent trimming / linking (part of RenderReport.durationMs)
  dedupe?: StylesDedupeReport;         // dedupe 'link' only
}

export interface StylesDedupeReport {
  mode: 'link';
  sheets: Array<{hash: string; url: string; bytes: number; links: number}>;  // distinct linked texts, order of first
                                       // use (= the order of RenderSpectrumResult.head)
  links: number;                       // <link> elements in the output
  linkedBytes: number;                 // UTF-8 bytes of the distinct linked texts (fetched once, cacheable)
  inlineBytes: number;                 // UTF-8 bytes of the CSS that stayed inline, every copy counted
}
```

**What `mode: 'trimmed'` keeps.** The renderers emit a placeholder per stylesheet; after the final pass the output is
parsed once and every stylesheet (element tag + stylesheet object) is resolved against all shadow roots that carry it:

* a style rule is kept when one of its selectors *may match* the rendered DOM of one of those instances, or matches
  `keep`. All instances of one element class share one trimmed text (browsers keep sharing identical `<style>`
  elements); `:host`, `:host()`, `:host-context()`, `::slotted()` (with forwarded slots flattened), combinators and
  structural pseudo-classes (`:first-child`, `:nth-*`) are evaluated; every other pseudo-class - states (`:hover`,
  `:focus-visible`, `:checked`, `:disabled`), `:dir()`, `:lang()`, `:empty`, `:defined` and anything unknown - counts as
  matching; a `:not()` whose argument cannot be evaluated, and `:is()` / `:where()` / `:has()` the same way, are
  weakened to "may match"; pseudo-elements are ignored; a selector that cannot be parsed keeps its rule. Attribute and
  tag names compare case-insensitively (SVG's `viewBox`). `:host-context()` in a fragment (not a whole document) may
  match ancestors the render does not see.
* `@media` / `@supports` / `@container` / `@starting-style` / `@layer` blocks are kept when a rule inside is kept (named
  `@layer` blocks always, for the layer order); `@keyframes` when a kept rule, a `style` attribute or another
  `<style>` of the output names them; `@font-face`, `@property`, `@import`, `@layer` statements, `@scope` and unknown
  at-rules always.
* `trimTheme` (default true): the `<sp-theme>` fragments are filtered by selector too (the theme's shadow root only
  holds a `<slot>`), and their custom-property declarations are kept only when used - transitively through `var()`
  chains, fallbacks included - by a kept rule of a component stylesheet, a non-custom-property declaration, nested rule
  or at-rule body of the theme, a `style` attribute or another `<style>` of the output, or `references`. The
  components' own custom-property declarations are never pruned (only rules).
* `undefinedPrefixes`: `var(--prefix-x, V)` becomes `V` in kept rules unless the page defines `--prefix-x` (a kept
  rule, a `style` attribute, another `<style>`). `var()`s without a fallback are left alone, and so is text inside
  strings and comments (`content: "var(--mod-x, y)"`).
* `minifyCustomProperties`: custom properties of the trimmed stylesheets are renamed to short names (`--a` ... `--z`,
  `--A` ... `--Z`, `--aa`, ..., most used first) consistently across the page - but only names the client can switch
  in one step: names that only the theme defines and no element class's complete stylesheet defines (the client
  bridges the theme's server `<style>`), and names whose every definition and use is inside the stylesheets of one
  element class or inside one stylesheet several classes share. Ownership is judged on the trimmed texts AND on the
  complete stylesheets of every element class on the page (since 0.2.2): the client restores complete sheets, and a
  rule the trimmer dropped from a child's sheet may read a name only its parent defines. Never renamed:
  * Spectrum's public customisation names `--mod-*`, `--highcontrast-*` and `--system-*`, whatever the options: an
    application sets them (`sp-action-button { --mod-actionbutton-background-color-default: red }`) and reads them,
    and the components define many of them too (kept rules defined 253 `--mod-*` names on the catalog), so 0.2.0,
    which renamed those, cut application overrides off until hydration, and for good without JavaScript;
  * names one element class defines and another reads (`sp-tabs` -> `sp-tab`, `sp-table` -> its rows and cells,
    `sp-menu-group` -> `sp-menu-item`, `sp-picker` -> `sp-popover`, `sp-number-field` -> `sp-infield-button`,
    `sp-tray` -> `sp-dialog-wrapper`): a child that is defined or hydrates after its parent was restored would read
    a short name nothing defines any more;
  * names another element class's complete stylesheet mentions (0.2.2; e.g. `sp-menu` -> `sp-menu-item`'s disabled
    icon colour `--spectrum-menu-item-label-icon-color-disabled`, `sp-breadcrumbs` -> `sp-breadcrumb-item`'s disabled
    text colour, `sp-table` -> `active` head cells / `drop-target` rows): 0.2.1 judged from the trimmed texts only,
    and a child restored while its parent was defined late read the original name while the parent defined only the
    short one;
  * `references` names and prefixes, names that occur in a `style` attribute or in CSS the trimmer does not control
    (other `<style>` elements, stylesheets left complete), and names that are only read (`var(--x)` with no
    definition on the page: the application may define them).

  Short names never take a name that occurs on the page or a `references` name or prefix. The exclusions cost bytes
  (see the table below: 0.2.0 renamed those names).
* A stylesheet nothing was dropped from is emitted byte-identical to its `cssText`. A stylesheet whose host cannot be
  determined (markup inside a plain `<template>`) stays complete. When trimming throws, the complete stylesheets are
  used and a `#render` warning `could not trim the stylesheets, the complete stylesheets are used: ...` is reported.

**Markers.** Every `<style>` whose text the trimmer changed carries `data-swc-styles="trimmed"`, or `"minified"` when
names in it were renamed (wins when one `<style>` holds several stylesheets). Full mode, stylesheets that came out
complete, stylesheets left complete and the fallback carry no attribute on a `<style>`; with `dedupe: 'link'` every
`<link>` is marked, a complete one `"complete"`. `report.styles.sheets[].id` is
`<tag>:<index in elementStyles>` or `<tag>:<kind>/<name>` for theme fragments (`sp-theme:color/light`), `#<n>`
appended to a repeated id; `instances` is the number of shadow roots carrying the sheet; the per-sheet sizes are the
UTF-8 bytes of one copy.

**De-duplication (`dedupe: 'link'`, 0.3.0, opt-in).** Without it every shadow root carries its own `<style>` copy of its
class's stylesheets (the button page: 21 copies of one 36 KB `sp-button` sheet; the catalog: 1346 shadow roots, about
0.6-1.9 MB of distinct CSS repeated into 8-18 MB). Declarative shadow DOM has no way to share a sheet between roots
without JavaScript except the HTTP cache, so with `'link'`:

* every distinct stylesheet text (after trimming / minification; the complete `cssText` in `full` mode, where nothing is
  parsed, only counted) is put into the process-wide `styleSheetStore` under `styleSheetHash(text)`, and each shadow
  root gets `<link rel="stylesheet" href="<dedupeUrl(hash, text)>" data-swc-styles="trimmed|minified|complete">` in the
  sheet's place - in the `elementStyles` order, so `<style>A B C</style>` with B linked becomes
  `<style>A</style><link B><style>C</style>` and the cascade order is unchanged. `'complete'` marks a linked sheet
  nothing was taken from (it never occurs on a `<style>`);
* stays inline: minified theme sheets (the client's theme bridge must move them back as `<style>` elements; a
  re-inserted `<link>` would be processed again), sheets under 160 bytes (a `<link>` is about 90), and sheets with a
  relative `url()` / `@import` or a quoted relative URL in `image-set()` / `-webkit-image-set()` / `src()` (a linked
  sheet resolves them against its own URL). Fragment-only references
  (`url(#checkerboard-primary)` of the theme) are document-local in every stylesheet and are linked (an open
  `sp-color-loupe` renders identically, Chromium and Firefox);
* `RenderSpectrumResult.head` is one `<link rel="preload" href="..." as="style">` per distinct URL in order of first use:
  put it into the page's `<head>` so all downloads start before the parser reaches the shadow roots.
  `styleHeadOf(report.styles, 'stylesheet-not-all')` gives `<link rel="stylesheet" media="not all">` instead (measured:
  no difference in Chromium, whose preload scanner already finds the links inside the declarative templates; the hint
  only matters for streamed responses). The texts cannot be announced as document stylesheets: their rules (`#input`,
  `.icon`, `input`) would match the light DOM;
* the application serves the store: `GET <path>/<hash>.css` -> `getStyleSheet(hash)` as `text/css; charset=utf-8` with
  `Cache-Control: public, max-age=31536000, immutable` (a hash names one text for ever), and `404` with `no-store` for
  an unknown hash (demo: `demo/src/styles-routes.ts`, which also compresses each text once and answers GET, HEAD and
  304 with the same `Content-Encoding` / `ETag` / `Vary`). The store is per process and an LRU (`maxBytes`, 32 MiB by
  default) that does not evict a text for `minLifetimeMs` (60 s) after a render last put it, so the pages just served
  can still fetch their sheets (above twice the budget the oldest go anyway; `evictions` / `freshEvictions` count
  them): behind a load balancer without sticky sessions, or after an eviction, a URL can 404 - Chromium then parses on
  without the sheet and the elements stay unstyled until they hydrate (the client restores the complete sheets). For
  several instances, write the texts to shared storage from `dedupeUrl` (it receives every text) and serve them from
  there. A `dedupeUrl` that throws for a text keeps that text inline (trimmed) and adds a `#render` warning
  `StyleOptions.dedupeUrl threw for stylesheet <hash> ...`; the rest of the page is linked as usual;
* `swc-ssr/client` treats a server `<link data-swc-styles>` like a marked `<style>` (restored, removed, minified ones
  kept until settled, counted for the theme bridge); a theme `<link>` is never bridged (only minified theme sheets need
  the bridge, and those stay inline), and `'complete'` does not count for the theme-pending warning. Without
  constructable stylesheets a `<style>` with the complete text takes the first link's place.

Trade-off (measured, docs/DESIGN.md "Style de-duplication"): **Chromium** waits in the parser at a pending shadow-root
`<link rel="stylesheet">`, as at an in-body one: it never painted content without its CSS (0 unstyled frames on
button and catalog, local to slow 3G, cold and warm cache, with and without hints and client), but a cold load renders
progressively and its DOMContentLoaded waits for the sheets that are not cached yet (trimmed button page, 150 ms
round trip: 178 ms inline, 493 ms linked cold, 187 ms warm). **Firefox** (157) does not wait: it paints content
without its sheet until the sheet arrives - for the whole download on a cold load, and for 2-9 frames even from a
warm cache - and CSS transitions then run from the unstyled values (an `sp-button` is a transparent 45x18 px block,
then fades in its background). WebKit was not measured. That is why `dedupe` is off by default. It pays where the same
sheets repeat across pages and the cache is warm (`full` + `'link'`: 94 % of the CSS of the 59 catalog pages is
shared; trimmed 14 %, minified 2 %, since their texts are page-specific) and in browsers that wait for the link. With
compression on the wire the inline page is already small (brotli's window spans the repeated sheets; table below).

`scanCustomPropertyReferences(text)` returns every custom-property name used through `var()` in a CSS or JavaScript
text, fallbacks included, in order of first appearance: `references: scanCustomPropertyReferences(appCss)`.

**Hydration: trimmed and minified pages REQUIRE `swc-ssr/client`.** Lit's hydration support
(`@lit-labs/ssr-client/lit-element-hydrate-support.js`) returns the declarative shadow root from `createRenderRoot()`
and never calls `adoptStyles()`: a hydrated element keeps the server's `<style>` as its ONLY stylesheet
(`adoptedStyleSheets` stays empty). `<sp-theme>` is the opposite: its constructor's `attachShadow()` clears the
declarative shadow root and it adopts its complete theme fragments. Without `swc-ssr/client`, a trimmed page renders
correctly until something changes (the app toggles `disabled`, a variant, `selected`, an overlay opens): those rules
were trimmed away and stay missing. A minified page breaks the moment `<sp-theme>` upgrades: the components read
renamed properties (`var(--a)`) that only the server's theme `<style>` defined (measured on the button page: 85,664
differing pixels, the buttons lose their background and shrink from 32 to 22.8 px). `swc-ssr/client` therefore:

* in every element's hydrating update (the template path, the agnostic path, and elements that hydrate on their own):
  when its server `<style>` carries `data-swc-styles` (or its text differs from the class's `elementStyles`, the
  fallback for unmarked output), the element adopts its class's complete `elementStyles` (one shared `CSSStyleSheet`
  per `CSSResult`, the same sheets `createRenderRoot()` adopts for a client-rendered element) and the server
  `<style>` is removed, synchronously after the hydrating `update()`, so nothing paints in between. On a page with any
  marked `<style>` every hydrated Lit element does this, also those whose server CSS came out complete: after
  hydration every element runs on its adopted complete sheets. Unconditional; no option.
* when it is imported (before any definition loads), keeps the marked `<style>` of every `<sp-theme>` (light DOM or
  open shadow roots): it is re-inserted into the theme's shadow root in the microtask after the theme upgraded
  (before the next paint) and removed when the last marked `<style>` in the document is gone (confirmed by a scan), or
  at the end of `hydrateSpectrum()` when none is left - but only from themes that have upgraded. A theme whose
  definition loads after the components hydrated, or never, keeps its server `<style>` where the server put it (it
  is all that theme has; its upgrade clears it anyway). `hydrateSpectrum()` reports such a theme:
  `HydrationReport.warnings` gets `theme pending: sp-theme not defined; trimmed/minified theme values incomplete (...)`
  (since 0.2.2). Elements not hydrated yet - an application that calls
  `hydrateSpectrum()` late (an Angular bootstrap), elements that hydrate lazily or are defined late - keep their theme
  values meanwhile. It is a `<style>` element, not an adopted sheet, because `Theme.adoptStyles()` re-assigns
  `adoptedStyleSheets` whenever a theme fragment is registered; it does not depend on constructable stylesheets.
* minified server CSS (`data-swc-styles="minified"`) is handled like the theme: an element restored to its complete
  sheets keeps its minified `<style>` (its rules are a subset of the adopted sheets, which come later in the cascade
  and win) until no element runs on minified CSS any more, then it goes with the bridge - elements below it that are
  not hydrated or not defined yet may still read the short names it defines. While a bridged `<sp-theme>` has not
  upgraded (`sp-theme` defined late, or never), a minified element is not restored at all: the theme's server
  `<style>` defines the short names only, so the complete sheets (original names) would find no theme values; it is
  restored when `sp-theme` gets defined.
* in a browser without constructable stylesheets (declarative shadow DOM polyfill path) the first server `<style>` gets
  the class's complete CSS text instead (minified: a `<style>` with the complete text is added after the kept one).
  Spectrum's `<sp-theme>` itself requires constructable stylesheets; `tests/styles-late.spec.ts` exercises the path
  with only the client's own feature test failing.
* on pages without any marked `<style>`, an unmarked server `<style>` is restored only when its text is not the
  class's `elementStyles` text (lengths are compared first, the text once per class).

**What trimming can break.** The server sees the rendered markup, not the application:

* **Application CSS that reads theme variables** (`color: var(--spectrum-gray-800)` in the app's stylesheet, or in
  markup the server did not render, such as the page shell): those declarations are pruned from the theme and the
  app's CSS falls back until `<sp-theme>` upgrades and adopts the complete theme. Pass `references`
  (`scanCustomPropertyReferences(appCss)`, or a prefix such as `'--spectrum-*'`) or `trimTheme: false`. `style`
  attributes and `<style>` elements inside the rendered template are seen and need nothing.
* **State changes before hydration**: attributes the app sets on Spectrum elements, light-DOM children it inserts
  (`::slotted()` rules) or overlays opened before the element hydrated have no rules until it hydrates; elements whose
  definition never loads keep the trimmed CSS for good. List such selectors in `keep`.
* **Attributes a component sets in `connectedCallback()`** (or otherwise only on the client: a `role`, a `tabindex`,
  a state attribute) are not in the server output, so the trimmer sees no element that has them and drops their
  `:host([attr])` rules. Between the definition (the element connects and sets the attribute) and its hydration the
  trimmed CSS has no rules for them; the hydrating update restores the complete sheets. If that window shows (a late
  `hydrateSpectrum()`, lazy hydration), list such selectors in `keep` (e.g. `keep: [':host([role=presentation])']`).
* **`minifyCustomProperties` is unsafe when the application sets or reads `--spectrum-*` properties**: an app
  stylesheet that overrides `--spectrum-accent-background-color-default` on a container, or JavaScript that reads one
  through `getComputedStyle()`, does not reach the renamed names until the elements hydrate. List such names (or
  prefixes) in `references`: they are kept and never renamed. Spectrum's public `--mod-*` / `--highcontrast-*` /
  `--system-*` names are never renamed (since 0.2.1). A short name can also collide with an app property of the same
  name (`--a`): pass the app's names through `references` (short names skip them). `undefinedPrefixes` is unsafe for
  prefixes the application does define (e.g. `--mod-*` overrides in its CSS).
* **Theme switches before hydration** (changing `color` / `scale` of `<sp-theme>` while elements still run on minified
  CSS): the bridged server theme keeps the server's values for the renamed names until each element hydrates.
* **`sp-theme` defined late, or never** (a lazily loaded theme chunk, an app that never defines it): until it upgrades,
  the theme's server `<style>` holds only what the server kept - the theme properties the rendered markup used
  (`trimTheme`), under the short names (`minifyCustomProperties`). Content the client creates meanwhile (a pending
  button's progress circle, overlays), states entered after hydration and
  restored elements that read pruned or renamed names find no theme values until `sp-theme` is defined (measured,
  table page with `?late=sp-theme`: 8,139 px trimmed / 106,988 px minified differ from full while it is missing, 0 px
  after the definition). `trimTheme` and `minifyCustomProperties` assume that `sp-theme` is defined before client-side
  changes; otherwise use `trimTheme: false` and no minification. `hydrateSpectrum()` reports the situation as a
  warning starting with `theme pending: sp-theme not defined; trimmed/minified theme values incomplete`.
* **Definition order on the client** (code-split bundles): define `sp-theme` after the theme fragments it uses
  (`theme-light`, `scale-medium`, ...) - its constructor's `attachShadow()` empties the declarative shadow root, and
  without registered fragments nothing replaces the server's theme `<style>` (with `full` CSS too: an unthemed frame,
  CLS 0.012-0.032 measured on the menu / badge pages) - and parents before their children (`sp-sidenav` before
  `sp-sidenav-item`: the reverse throws `startTrackingSelectionForItem is not a function` in about 15 % of loads;
  combobox / sidenav items ended with roving `tabindex="-1"` when their definitions arrived in different tasks).
  Define one page area's elements in one task, in dependency order (the demo's per-entry registration modules,
  docs/DESIGN.md "Demo build"); do not let the order of parallel `import()` chunks decide it.
* **A build-time custom-property renamer** (an "unused CSS" / minifier step over the built bundle, e.g. a custom builder
  that collects `var()` references, deletes unreferenced declarations and renames custom properties) must process the
  SSR SERVER bundle (the code `renderSpectrum()` runs) exactly like the client bundle, or be disabled while swc-ssr
  renders. Otherwise the two sides disagree on the names - also in `full` mode: the server writes the original names
  into the declarative shadow roots, the client's `<sp-theme>` upgrades and adopts its fragments under the renamed
  names, and every component that has not hydrated yet loses its theme values (the symptom: the server page looks
  right, the page goes unstyled at hydration). After hydration the client's fallback (the server text differs from the
  class's `elementStyles`) moves each element to the client's sheets, but elements that hydrate late or never stay
  broken. Do not combine such a step with server-side minification either: `minifyCustomProperties` renames both sides
  consistently (the server output and, through restoration and the theme bridge, the client) and is the supported way
  to get short names.

**Measured** (`.probe/css-stats.ts`, last of 3-4 renders; CSS = text of all `<style>` elements, KiB; render times
vary with machine load, see docs/DESIGN.md "Style trimming"):

| Page | Mode | HTML | CSS | distinct CSS | gzip | trimming |
|---|---|---|---|---|---|---|
| `/component/button` | full | 1.22 MB | 1230 KB (98.3 %) | 384 KB | 120 KB | - |
| | trimmed | 0.83 MB | 823 KB | 77 KB | 79 KB | 9 ms |
| | minified (0.2.0: 0.31 MB, 298 KB, 13 KB gzip) | 0.47 MB | 454 KB | 46 KB | 15 KB | 9 ms |
| `/component/picker` | full | 1.32 MB | 1294 KB (95.9 %) | 392 KB | 117 KB | - |
| | trimmed | 0.52 MB | 475 KB | 54 KB | 56 KB | 16 ms |
| | minified (0.2.0: 0.28 MB, 231 KB, 24 KB gzip) | 0.39 MB | 346 KB | 34 KB | 45 KB | 19 ms |
| `/` (59 entries, 1349 elements) | full | 18.66 MB | 18121 KB (94.9 %) | 1937 KB | 1488 KB | - |
| | trimmed | 13.31 MB | 12616 KB (69.6 % of full) | 997 KB | 996 KB | 0.4-0.6 s |
| | minified (0.2.0: 6.55 MB, 5689 KB = 31.4 %, 486 KB gzip) | 9.10 MB | 8305 KB (45.8 %) | 619 KB | 643 KB | 0.3-0.4 s |
| | minified + `undefinedPrefixes: ['--mod-']` (0.2.0: 5.22 MB, 4329 KB = 23.9 %) | 7.78 MB | 6945 KB (38.3 %) | 536 KB | 550 KB | 0.3-0.4 s |

The button page renders every variant of `sp-button`, so its two `sp-button` sheets keep 36.6 KB of 41 KB trimmed
(19.9 KB minified; 12.9 KB in 0.2.0, which also renamed the `--system-*` / `--highcontrast-*` / `--mod-*` names),
while its theme goes from 312 KB to 20.4 KB (about 5 KB minified). One-component pages of the
catalog keep 3-67 % of their CSS (sum over the 59 entry pages: see `tests/results/summary.md`, "Styles").

On the wire (the demo, KiB; `.probe/integrate/wire.ts`; the linked CSS fetched once per distinct URL, compressed like
every response; docs/DESIGN.md "Performance" has every mode):

| Page | Mode | HTML | HTML gzip | HTML brotli | linked CSS (brotli) | cold load, brotli | repeat visit, brotli |
|---|---|---|---|---|---|---|---|
| `/component/button` | full | 1252.6 | 120.5 | 43.7 | - | 43.7 | 43.7 |
| | trimmed | 846.6 | 80.0 | 12.0 | - | 12.0 | 12.0 |
| | minified | 477.8 | 15.4 | 10.4 | - | 10.4 | 10.4 |
| | trimmed + `dedupe: 'link'` | 28.4 | 3.2 | 3.0 | 77.0 (12.1), 12 sheets | 15.2 | 3.0 |
| `/component/picker` | trimmed | 538.9 | 57.3 | 13.2 | - | 13.2 | 13.2 |
| | trimmed + `dedupe: 'link'` | 66.6 | 5.0 | 4.8 | 59.4 (12.0), 13 sheets | 16.8 | 4.8 |
| `/` | full | 19105.7 | 1488.7 | 255.4 | - | 255.4 | 255.4 |
| | trimmed | 13632.5 | 997.2 | 179.5 | - | 179.5 | 179.5 |
| | minified | 9323.9 | 643.6 | 156.0 | - | 156.0 | 156.0 |
| | trimmed + `dedupe: 'link'` | 1169.9 | 88.2 | 62.3 | 822.9 (138.8), 122 sheets | 201.1 | 62.3 |
| | full + `dedupe: 'link'` | 1164.5 | 87.0 | 61.5 | 1170.0 (160.7), 101 sheets | 222.1 | 61.5 |

`ServerTree` (internal, `packages/swc-ssr/src/server/server-tree.ts`): parse5 (htmlparser2 adapter) document of the pass-1
HTML with lookup `byId(id)`, `lightChildren(id)`, `shadowRoot(id)`, `query(node, selector)`, `queryAll(node, selector)` via `css-select`,
`documentLanguage()` (whole documents: the `<html lang>`), and `lightSignature(node)` (child tags with `slot`, text hash;
used to verify adoptions and to locate light-DOM attribute changes). Since 0.3.0: `new ServerTree(html, {locations})`
records parse5 source locations (`hasLocations`; `sourceOffset(offset)` maps a parsed offset back to the original
HTML across the replaced `<style>` bodies), and `contentHash` is the FNV-1a hash of the parsed text (the next pass's
id seed, see "Deterministic ids").

## `swc-ssr/client`  (`packages/swc-ssr/src/client/index.ts`)

Must be the FIRST import of the client bundle (before `lit` and before any `@spectrum-web-components` import).

```ts
export interface HydrationReport {
  errors: string[];        // console.error / uncaught errors captured during hydration
  warnings: string[];      // console.warn captured during hydration, definition / settle timeouts, and
                           // `theme pending: ...` (a trimmed / minified theme that has not upgraded, "Styles")
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
  removeServerStyles?: boolean;  // default false: after an element's first update (its adoptedStyleSheets are set),
                           // remove the <style> elements of its declarative shadow root to free memory (see below)
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

**Server styles** (`client/server-styles.ts`, see "Styles" above): trimmed / minified server CSS is always replaced
by the class's complete `elementStyles` in the element's hydrating update, and the marked `<sp-theme>` `<style>` is
bridged until no marked `<style>` is left. `removeServerStyles: true` additionally releases COMPLETE server styles
(`full` pages): a Lit element adopts its class's `elementStyles` and its server `<style>`s are removed after its
hydrating update (when every class sheet could be adopted); `<sp-theme>` and other non-Lit elements only lose them when
they adopted sheets themselves. It applies to the elements that hydrate while `hydrateSpectrum()` runs and to the ones
already hydrated when it settles; nothing is removed from a root that would not hold the complete CSS afterwards, and
in browsers without constructable stylesheets nothing is released.

Hydration candidates (`client/elements.ts` `isHydrationCandidate`, one predicate for collection, `whenDefined`, the
agnostic path and the report): an element that carries `defer-hydration`, or whose tag is a valid custom element
name and that is `sp-*`, has a shadow root, or is already defined. Undefined custom-element-named tags without a
declarative shadow root and without `defer-hydration` (e.g. Angular component hosts such as `<app-root>`) are not
awaited. The agnostic path removes `defer-hydration` from every deferred candidate, not only `sp-*`.

Besides the adapters (built in: `sp-picker`, `sp-slider`, `sp-breadcrumbs`, `sp-checkbox`, `sp-table` (adopts the
server-rendered selection cells), a `MatchMediaController` adapter for every hydrating element that has
`MatchMediaController`s - `sp-picker` / `sp-action-menu` /
`sp-contextual-help`, subclasses registered under other tags, application components - and, since 0.2.0, a
`Menu` adapter for every element built on `menu/src/Menu.js` that breaks the `updateCache()` / `getUpdateComplete()`
cycle a menu hydrated more than a frame after its items were defined got stuck in, so `hydrateSpectrum()` may run any
time after the definitions load, and, since 0.3.0, a measured-layout adapter for `sp-color-area` / `sp-color-wheel` and
their subclasses, see below), importing `swc-ssr/client` installs two generic
hooks on every Lit element whose pre-existing shadow root was rendered by `@lit-labs/ssr` (it contains a `<!--lit-part`
marker) or whose tag starts with `sp-`: the initial `slotchange` (which declarative shadow roots never receive) is
emulated like the server does, and a hydration mismatch is recovered from by re-rendering that element on the client
(reported via `console.error`). Other Lit elements with a declarative shadow root are left to lit's own hydrate support.

The measured-layout adapter (0.3.0 review): `sp-color-area` positions its handle (`style="transform: translate()"`)
and `sp-color-wheel` its track and handle from a measurement of itself (`boundingClientRect`), which their own
`connectedCallback()` starts with a ResizeObserver at the upgrade - while the element still carries
`defer-hydration`. When a rendering opportunity passes between the definition and the hydrating update (definitions
in several chunks, `hydrateSpectrum()` called later, `?hydrateDelay=`), the hydrating render used the measurement, and
lit's `hydrate()` primes attribute bindings with their first client value without writing them: the DOM kept the
server's unmeasured `translate(0px, 0px)` and the handle stayed in the corner until the color changed (the demo
catalog with the code-split bundle: 11 of 14 loads). The adapter (by shape: `getContentBoundingRect()` /
`cacheLayoutData()`) hides the measurement for the hydrating render, gives it back right after it and requests one
more update, which writes the measured layout at once (also when nothing was measured before hydration: no unmeasured
frame after hydration). Application components that render from a measurement taken before their first update need
the same treatment (a hydration adapter): lit's hydration never writes attribute values.

The `MatchMediaController` adapter: the server's `matchMedia()` never matches, so the server renders the desktop state
(popover, no `mobile-view`). `beforeHydrate` pins every controller's `matches` to that server value; `afterHydrate`
restores it from `media.matches` and requests an update before `firstUpdated()`, so phones hydrate the desktop markup
without a mismatch and re-render into the mobile state (tray, `mobile-view`, modal contextual help) on the next update. Errors/warnings are captured from the moment
the module is loaded; the first `hydrateSpectrum()` report includes them. The template path works with server output
rendered with either `deferHydration` setting; `true` is recommended (nothing hydrates before `hydrateSpectrum()`, and
light-DOM elements then update in document order, as in client-side rendering).

The demo client must set `window.__swcSsrHydration = hydrateSpectrum(...)` (a Promise<HydrationReport>) so tests can await it,
and `window.__swcSsrMode = 'ssr' | 'csr'`. It also sets `window.__swcSsrDefined = true` once every definition of the
page loaded (before `hydrateSpectrum()` runs) and, with `?hydrateDelay=hold`, `window.__swcSsrRelease()` which lets
`hydrateSpectrum()` run. Client URL options: `?removeStyles=1` (`removeServerStyles: true`), `?hydrateDelay=<ms>|hold`
(call `hydrateSpectrum()` that much later than the definitions, or when released: the state of an application with a
late bootstrap), `?agnostic=1`, `?late=<tag>[,<tag>...]` (the `customElements.define()` of these tags is held back
until the page calls `window.__swcSsrDefineLate()`, which resolves when they are defined and the page settled:
definitions that arrive after hydration, or never; `hydrateSpectrum()` waits its timeout for them and warns).

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
| `GET /report.json` | the `RenderReport` of the last SSR render (+ `loadErrors`; `styles` in trimmed / minified mode); `?component=<name>` (or `*` for `/`) returns the last report of that page |
| `?styles=full\|trimmed\|minified` on every SSR route | `renderSpectrum({styles})`: `full` (default), `trimmed` = `{mode: 'trimmed'}`, `minified` = `{mode: 'trimmed', minifyCustomProperties: true}`; anything else is answered with 400 |
| `?refs=--a,--b,--prefix-*` on every SSR route | `StyleOptions.references` (comma separated, may repeat); a value that is not a custom-property name or prefix is answered with 400 |
| `?dedupe=none\|link` on every SSR route and `/styles.json` (0.3.0) | `link`: `StyleOptions.dedupe: 'link'` in any `?styles=` mode, and the page's `<head>` gets the render's stylesheet hints; `none` / absent: inline; anything else is answered with 400 |
| `?hints=preload\|not-all\|none` with `?dedupe=link` | what `<head>` announces: `result.head` (preload, default), `<link rel="stylesheet" media="not all">`, or nothing (a measurement knob) |
| `GET /swc-css/<hash>.css` (and `HEAD`) | a stylesheet a `?dedupe=link` render linked (`getStyleSheet`): `text/css; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable`, brotli (q4) / gzip computed once per hash (texts of 1 KB or more), `Content-Encoding` / `Content-Length` / one `ETag` per coding / `Vary: Accept-Encoding` the same for GET and HEAD, `If-None-Match` answered with 304 (with `Vary`); mounted before the compression middleware; an unknown hash is a 404 with `no-store`. Successful answers are not in the request log |
| `GET /styles.json?component=<name\|*>&styles=<mode>&refs=...&dedupe=...` | renders the page on demand (leaves `/report.json` alone) and returns `{component, styles, reported, fullBytes, trimmedBytes, cssBytes, htmlBytes, gzipBytes, sheets, dedupe, durationMs, elements}`: `report.styles` values plus the measured `<style>` text, document and gzip sizes (`gzipBytes` is computed on the uncompressed document, whatever the response's own `Content-Encoding`); `dedupe` is `report.styles.dedupe` (or null), `sheets[].hash` the linked text of a sheet, and `cssBytes` then counts only the CSS left inline |
| `GET /catalog.json` | `[{name, interactive, notes}]` |
| `?agnostic=1` on an SSR route | hydrate without the template (framework-agnostic path) |
| `?lang=<BCP 47 tag>` on SSR and CSR routes | page language; otherwise the request's most preferred `Accept-Language` language (`*` ignored, canonicalized with `Intl.getCanonicalLocales`), otherwise `en`. Passed to `renderSpectrum({lang})` and written to `<html lang>` |
| `HEAD` on any path except `/dist/*` and `/swc-css/*` | 200 with an empty body, never renders; not in the request log (the first HEAD gets its own line, later ones a per-minute count) |
| `HEAD /dist/*`, `HEAD /swc-css/*` | like `GET` without the body: the file's `Content-Type` / `Content-Length` (and `Content-Encoding` of a precompressed sibling), 404 for a missing file |
| `GET /dist/*` | static from `demo/public/dist` (`SWC_SSR_DEMO_DIST` overrides the directory). Serves the build's precompressed `<file>.br` / `<file>.gz` with `Content-Encoding` to clients that accept them (the plain file is the identity answer, `Content-Type` of the original either way); `/dist/chunks/*` are `Cache-Control: public, max-age=31536000, immutable` (content-hashed names), `client.js` and its map `no-cache` (revalidated with their ETag) |

Compression (0.3.0): every other compressible response (HTML, JSON, the `/swc-css/` stylesheets) is compressed on the
fly for clients that accept it - brotli quality 4 preferred over gzip (the client's q-values are honoured), nothing
under 1 KB, `Vary: Accept-Encoding` always. Brotli's window spans the stylesheets every shadow root repeats, gzip's
32 KB window does not (button page, `full`: 1253 KB identity, 121 KB gzip, 44 KB brotli).

The demo renders with `renderSpectrum(pageTemplate(entries), {deferHydration: true, lang, styles})` (`styles` from
`?styles=` / `?refs=` / `?dedupe=`). The request log line of an SSR route ends with
`styles <mode> <trimmed>/<full> KB` (with `?dedupe=link` also `, linked <n> sheets <KB> KB (<links> links)`).

Page shell: `<!doctype html><html lang="<page language>"><head><meta charset="utf-8"><meta name="viewport" …><title>…</title><link rel="icon" href="data:,">[stylesheet hints with ?dedupe=link]<style>/* layout only */</style></head><body><div id="app">…</div><script type="module" src="/dist/client.js"></script></body></html>`.
`/dist/client.js` is a 1.2 KB bootstrap (0.3.0): it imports `swc-ssr/client` (its static graph: `swc-ssr/client`, Lit's
hydrate support, nothing of `lit-element` or Spectrum), sets `window.__swcSsrHydration`, `__swcSsrMode`,
`__swcSsrReport` and `__swcSsrDefineLate` synchronously and loads the application (`client-app.ts`, which sets
`__swcSsrDefined` and `__swcSsrRelease`) and the page's catalog entries from `/dist/chunks/*.js` with `import()`.
The SSR'd content inside `#app` is `pageTemplate(entries)` = `<sp-theme system="spectrum" color="light" scale="medium">` + one `<section class="demo" data-component="<name>"><h2>…</h2>…render()…</section>` per entry.
The client reads `data-mode` and `data-components` attributes on `#app` to know what to hydrate/render.
