# swc-ssr — SSR for Spectrum Web Components (1st-gen) as a plugin for @lit-labs/ssr

Status: design contract for the implementation. All implementation work must follow this file.
Target: `@spectrum-web-components/*` **1.12.4** (1st-gen). gen2 (`@adobe/spectrum-wc` 2.0.0-beta) is out of scope for now.
Hard constraint: **no edits to any `@spectrum-web-components/*` source**. Everything is done by
(a) extending the DOM shim, (b) a custom `ElementRenderer`, (c) prototype/instance overrides applied at runtime, (d) a client hydration helper.

## Why a plugin (not a fork of @lit-labs/ssr, not an SWC PR yet)

* `@lit-labs/ssr` 4.1.0 exposes exactly the extension points we need: `render(value, {elementRenderers: [...]})`,
  `ElementRenderer` subclassing, `LitElementRenderer.renderOptions` (per-element `connectedCallback`/`disableSsr`),
  the `@lit-labs/ssr-dom-shim` globals, and `renderInfo.customElementInstanceStack` / `customElementHostStack` / `slotStack`.
* Adobe closed "[Feat]: Investigate SSR Support" (#2675) as "tracked in Jira / backlog". A working, tested standalone
  package is the strongest basis for a later upstream PR (e.g. as `1st-gen/tools/ssr`). The package layout mirrors
  SWC's tool packages so it can be moved into the monorepo later.
* The previous attempt (SluzbeniList fork of lit-labs-ssr 1.x, `workspace-root/AngularApp/packages/lit-labs-ssr`) forked
  `render-value.ts`. It proved what SWC needs but is unmaintainable. We keep the learnings, not the fork.

## Lessons from the SluzbeniList fork (what it did and where it stopped)

* It solved light-DOM access by consuming the light-DOM ops **before** rendering the host's shadow
  (`opsUntilCustomElementClose` in `render-value.ts`), collecting child renderers, then defining per-instance
  `querySelector` / `querySelectorAll` / `children` / `childNodes` (tag name, `#id`, `slot`, `slot:not([name])`,
  `[slot="x"]` only; text nodes extracted with regexes) and `HTMLSlotElement.assignedNodes` via an `elementSlotMap`.
* It called the element `connectedCallback`, `willUpdate`, `update`, then **`firstUpdated`** (needed because many
  Spectrum components compute render state there, e.g. button variant, `slotHasContent`), flushed a fake
  `requestAnimationFrame` queue, made `updateComplete` resolve synchronously, and re-rendered the shadow if
  `changedProperties` was non-empty afterwards. `manageTextObservedSlot` was neutralised so `slotHasContent` did not flip
  between first render and `firstUpdated`.
* It wrapped every `LitElement` subclass `update()` so that a throwing component-level `update` still ran
  `ReactiveElement.update` (attribute reflection), and no-op'd `addController` on `SpectrumElement`.
* `sp-theme` needed a dedicated renderer (`ThemeRenderer`): emit the theme fragment CSS as `<style>` inside the DSD and a
  `<slot>`, skip `shouldAdoptStyles`, fake `attachShadow`, default `dir="ltr"`.
* Event classes (`KeyboardEvent`, `FocusEvent`), `MutationObserver`, `Node` constants, `window.__swc`, `matchMedia`,
  `CSS.supports`, `crypto.getRandomValues`, `document.{documentElement,body,createElement,addEventListener,...}` were
  all needed as globals (see `AngularApp/src/app/server-rendering.ts`).
* Last recorded gap (commit 711d9abd): `sp-picker`'s `@query('sp-menu')` targets the picker's **own shadow root**, which
  the light-DOM-only `querySelector` could not serve. The design below covers shadow content too.

## Facts established by scouting (Oct 2026)

* Lit SSR 4.1.0 op order for a custom element (all as in-order thunks, see `node_modules/@lit-labs/ssr/lib/render-value.js` ~L585):
  `custom-element-open` (construct element via `getElementRenderer`, `addElementToEventPath` sets `element.__host`
  and `element.__eventTargetParent`, then static `setAttribute`s) -> dynamic attribute/property parts
  (`setAttribute`/`setProperty`) -> `custom-element-attributes` (**`renderer.connectedCallback()`**, then
  `renderAttributes()`, then ` defer-hydration` if nested or `deferHydration`) -> `custom-element-shadow`
  (`renderShadow(renderInfo)` -> `<template shadowrootmode>`) -> **light-DOM children ops** (`slotted-element-open`
  pushes slot name on `renderInfo.slotStack`, then the child's `custom-element-open`...) -> `custom-element-close`.
  Consequence: when a host renders its shadow, none of its light-DOM children exist yet. Spectrum relies on light DOM
  (`querySelector('[slot=icon]')`, `ObserveSlotText`/`ObserveSlotPresence`, picker/menu selection, tabs, radio-group, ...).
* `LitElementRenderer` (4.1.0): constructs the element in its constructor, reflects `ElementInternals` ARIA attrs,
  `connectedCallback()` -> optional element `connectedCallback` (if `renderOptions` says so, with `enableUpdating` no-op'd)
  -> `willUpdate(changed)` -> `ReactiveElement.prototype.update` (attribute reflection only). `renderShadow` = `<style>` of
  `elementStyles` + `render()`. `firstUpdated`/`updated`/controllers' `hostUpdate` never run.
* `@lit-labs/ssr-dom-shim` 1.6.0 provides: `EventTarget`, `Node` (only `getRootNode`), `Element` (attributes, `attachShadow`,
  `attachInternals`, `shadowRoot`), `HTMLElement`, `HTMLSlotElement`, `ShadowRoot` (`host`, `mode`), `Document` (stubs),
  `CustomElementRegistry`, `ElementInternals`, `CSSStyleSheet` family, `MutationObserver`/`ResizeObserver`/`IntersectionObserver`
  no-ops, `Event`/`CustomEvent`, `globalThis.litServerRoot`. After `@lit-labs/ssr/lib/install-global-dom-shim.js`:
  `window` is **undefined**, `Node` is **undefined** (not installed globally), no `KeyboardEvent`/`FocusEvent`/`MouseEvent`/
  `PointerEvent`, no `getComputedStyle`, `matchMedia`, `CSS`, `document.documentElement/body/head`, no
  `Element.prototype.querySelector/querySelectorAll/closest/matches/children/childNodes/textContent/classList`.
* With the following extra globals installed **before** importing Spectrum, all 180 `sp-*.js` registration modules of 1.12.4
  import without error (verified): `globalThis.Node` (= shim `Node` + the `*_NODE` constants; the `focus-visible` polyfill reads
  `Node.DOCUMENT_FRAGMENT_NODE` at import), `window = globalThis` (SWC's `defineElement` touches `window.__swc`),
  `navigator`, `matchMedia()`, `requestAnimationFrame/cancelAnimationFrame`, `getComputedStyle()` (returns `{direction:'ltr'}`;
  `SpectrumElement.dir` getter uses it in 1.12), `CSS.supports/escape`, `document.{documentElement,body,head,addEventListener,
  removeEventListener,querySelector,querySelectorAll,getElementById,createElement,createElementNS,createComment,
  createDocumentFragment}`, `addEventListener/removeEventListener/dispatchEvent` on global, event classes
  `KeyboardEvent, FocusEvent, MouseEvent, PointerEvent, UIEvent, InputEvent, AnimationEvent, TransitionEvent`.
  Module-level DOM usage in 1.12.4: only `overlay` (`"showPopover" in document.createElement("div")`) and `focus-visible`.
* Rendering `<sp-theme><sp-button>...<sp-picker><sp-menu-item>...` with plain `LitElementRenderer` currently throws
  `this.querySelector is not a function` from `ObserveSlotPresence` **in the element constructor** -> light-DOM methods must
  exist on `Element.prototype` (returning null/empty) even before any tree info is known.
* Import Spectrum modules by **bare specifier** (`@spectrum-web-components/button/sp-button.js`), never by file URL, or the
  module graph is evaluated twice and `customElements.define` throws on the duplicate.
* SWC's `SpectrumElement` (1.12) no longer manages `dir` with a module-level `MutationObserver`; `dir` is a getter using
  `getComputedStyle`. `sp-theme` still manages theme fragments via static `registerThemeFragment` and
  `adoptedStyleSheets`/`shouldAdoptStyles`.

## Architecture: two-pass render on top of unmodified @lit-labs/ssr

`renderSpectrum(template, options)` in `swc-ssr/server`:

1. **Pass 1 ("collect")** - call upstream `render(template, {elementRenderers: [SpectrumElementRenderer, LitElementRenderer], deferHydration, ...})`
   with the renderer in collect mode. Each `SpectrumElementRenderer` instance gets a sequential id (construction order ==
   document pre-order, including declarative-shadow-root template contents). The renderer:
   * records per id: tagName, every `setAttribute`/`setProperty` it received (incl. dynamic property bindings, which are
     otherwise invisible in HTML), `__eventTargetParent`/`__host` links;
   * emits a marker attribute `data-swc-ssr="<id>"` in `renderAttributes()`;
   * does the minimal safe lifecycle (same as `LitElementRenderer`: optional `connectedCallback` with `enableUpdating` no-op'd,
     `willUpdate`, attribute reflection) and renders the shadow with `render()`; errors in pass 1 are caught per element and
     recorded (the element still gets an empty/fallback shadow so the pass completes).
2. **Build the server tree** - parse the pass-1 HTML with `parse5` using `parse5-htmlparser2-tree-adapter` so `css-select`
   can run real CSS selectors over it. For every element with `data-swc-ssr` link: node <-> id. Expose for each id:
   light-DOM children (elements + text, ignoring `<!--lit-*-->` comments), `slot` attribute, `textContent`, and its
   shadow content (the `<template shadowrootmode>` child) for `renderRoot.querySelector` emulation.
3. **Pass 2 ("render")** - call upstream `render()` again with the same template (rendering is deterministic, so the Nth
   renderer instance corresponds to id N; assert tagName matches, otherwise fall back to pass-1 output for that element
   and log a warning). In pass 2 each element instance is given a **light-DOM facade** (`querySelector`, `querySelectorAll`,
   `children`, `childNodes`, `firstElementChild`, `lastElementChild`, `childElementCount`, `textContent`, `hasChildNodes`,
   `closest`, `matches`, `parentElement`, `parentNode`, `assignedSlot`, `classList` facade, `getAttributeNames`,
   `innerText`) backed by the server tree. Queries that match a Spectrum custom element return the **real element
   instance** for that id. Because upstream constructs children only after the parent's shadow is rendered, pass 2
   **pre-instantiates** descendants: when renderer N is constructed, every descendant id in its light DOM / shadow is
   constructed from the pool (`new ctor()`, attributes + recorded properties applied, `connectedCallback` run as configured)
   and when upstream later asks `new SpectrumElementRenderer(tag)` for id N+k, the pooled instance is handed out
   (`setAttribute`/`setProperty`/`connectedCallback` are idempotent: second application is skipped or harmless).
   `renderRoot`/`shadowRoot` get a facade over the pass-1 shadow content so `@query` decorators resolve to real instances
   (e.g. `sp-picker`'s `sp-menu` inside its shadow). Slots get `assignedNodes()/assignedElements()` from the tree.
4. **Server lifecycle extension (pass 2 only, opt-in per element, default on, with per-tag overrides)** - after the standard
   `willUpdate`+reflection and before `render()`: run `firstUpdated(changed)` and `updated(changed)` in try/catch, flush a
   synchronous microtask/rAF queue (`requestAnimationFrame` callbacks are queued and flushed by the renderer, `updateComplete`
   resolves immediately), and if the element requested another update (`isUpdatePending` / changed properties non-empty),
   run `willUpdate`+reflect again and render. Bounded to 3 iterations. Component-specific "adapters" (a small registry keyed by
   tag) may replace this generic behaviour where it is unsafe or insufficient (e.g. `sp-theme`, `sp-picker`/`sp-menu` selection,
   `sp-tabs` selected indicator, `sp-overlay`/popover content that must stay closed).
5. **Output**: pass-2 HTML with `data-swc-ssr` markers stripped (keep them when `options.debug`). Also returns a report:
   per element id -> tagName, errors, warnings, whether it used pass-1 fallback.

`sp-theme`: a dedicated `ThemeRenderer` (matches `registerThemeFragment` static) that emits the theme fragment CSS for
the element's `system`/`color`/`scale` (plus `core`/`global` fragments) as `<style>` inside its DSD and `<slot></slot>`
- this is what the real Theme does with `adoptedStyleSheets`. Also sets `dir`.

### DOM shim extras (`swc-ssr/dom-shim`)

`installSpectrumDomShim()` - idempotent; must run before any Spectrum import. Installs the globals listed above, plus
`Element.prototype` defaults for the light-DOM API (return null / empty / '' when no tree is attached),
`ShadowRoot.prototype.querySelector*` (null/empty by default), `HTMLElement.prototype.focus/blur/click` no-ops,
`Element.prototype.getBoundingClientRect` -> zero rect, `scrollIntoView` no-op, `classList` facade over the `class` attribute,
`id` property <-> attribute, `hidden`, `tabIndex`, `dataset` facade, `style` object facade (`setProperty`, `getPropertyValue`,
`removeProperty`, property assignment -> serialized into the `style` attribute), `HTMLSlotElement.assignedNodes/assignedElements`
(empty by default), `Node` constants, `document.activeElement = null`, `crypto.getRandomValues`.
Everything via `??=` / `defineProperty` guarded by existence so newer `@lit-labs/ssr-dom-shim` versions can take over.
Must not break `lit`'s own SSR (`isServer` from `lit` must stay `true`; do not define browser-detection globals that flip
Lit into browser mode - check `lit`'s `node` export conditions).

### Client (`swc-ssr/client`)

* `swc-ssr/client` must be imported **before** `lit` and before any Spectrum module: it imports
  `@lit-labs/ssr-client/lit-element-hydrate-support.js`, and the `@webcomponents/template-shadowroot` polyfill applied
  when `HTMLTemplateElement.prototype.shadowRootMode` is unsupported.
* `hydrateSpectrum(root = document.body, {template?, data?})`: if a Lit template is given, calls `hydrate()` from
  `@lit-labs/ssr-client` on it; otherwise (framework-agnostic, e.g. Angular/plain HTML) removes `defer-hydration` top-down
  in document order after the relevant definitions are loaded (await `customElements.whenDefined` per tag present), so
  nested Spectrum elements enable in parent-first order.
* Provide a `hydrationReport()` that collects hydration-time console errors and `defer-hydration` leftovers (for the tests).

### Demo (`demo/`)

* `demo/src/catalog/<component>.ts` - one module per 1st-gen component package (all 70+ in `@spectrum-web-components/bundle`),
  exporting `{ name, load(): Promise<void> (dynamic imports of the registration modules), render(): TemplateResult,
  notes?: string }`. `render()` shows the main variants with realistic light-DOM content (slotted icons, menu items, tabs...).
  `demo/src/catalog/index.ts` exports the ordered list.
* `demo/src/page.ts` - `pageTemplate(entries)` - `<sp-theme system="spectrum" color="light" scale="medium">` wrapping one
  `<section data-component="name">` per entry.
* `demo/src/server.ts` - express: `GET /` SSR of all; `GET /component/:name` SSR of one; `GET /csr` and
  `GET /csr/:name` client-only versions (same template, no SSR, used as the reference DOM); `?nohydrate=1` serves SSR
  without the client bundle (pure SSR view); `GET /report.json` last render report. Serves `demo/public` (client bundle).
* `demo/build.mjs` - esbuild bundle of `demo/src/client.ts` -> `demo/public/dist/client.js` (ESM, sourcemap).
* `demo/src/client.ts` - imports `swc-ssr/client` first, loads the catalog, hydrates with the same template + data as the server.

### Tests (`tests/`, Playwright; unit tests in `packages/swc-ssr/test` via `tsx --test`)

Per catalog component: (1) SSR HTML contains a declarative shadow root for every `sp-*` element in the section and no
`data-swc-ssr` leftovers; (2) with JS disabled the page renders (screenshot saved); (3) hydration produces no console
errors/warnings mentioning hydration/lit/Spectrum, and no `defer-hydration` attributes remain; (4) **flicker**: screenshot
of the section right after first paint (before the client bundle executes - block the bundle request, screenshot, then
unblock) vs after hydration is complete; pixel diff must be below a threshold, and `layout-shift` entries (PerformanceObserver)
must be ~0; (5) **fidelity**: the post-hydration DOM (light + shadow, serialized with attributes sorted and lit comments
stripped) equals the CSR reference DOM of `/csr/:name`; (6) interaction smoke: clicking a button/picker/checkbox works after
hydration. The runner writes `tests/results/summary.md` (a table: component -> SSR ok / hydrate ok / flicker px / fidelity)
so that every run shows the current support matrix.

## Coding conventions

TypeScript strict, ESM, Node >= 20. No build step for the server (run with `tsx`); client via esbuild. Keep every Spectrum-specific
behaviour in `packages/swc-ssr/src/server/adapters/*.ts` (one file per tag or family) registered in a map, so the generic
renderer stays library-agnostic. Log with a `debug` flag only. Every workaround gets a comment naming the Spectrum source
file/mixin that needs it (e.g. `shared/src/observe-slot-presence.js`).
