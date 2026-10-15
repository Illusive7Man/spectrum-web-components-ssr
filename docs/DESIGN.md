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
4. **Server lifecycle extension (pass 2 only, default on for managed classes - Spectrum's, see `isManagedClass` - with
   per-tag overrides; other Lit elements keep upstream semantics)** - after the standard
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
- this is what the real Theme does with `adoptedStyleSheets`. It does not set `dir` (1.12's Theme does not either; an
extra attribute would differ from the client-rendered DOM).

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
  The page language (`?lang=`, else `Accept-Language`, else `en`) goes to `renderSpectrum({lang})` and `<html lang>`;
  `HEAD` on any path answers 200 without rendering (health checks).
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
so that every run shows the current support matrix. `tests/all-components.spec.ts` checks the whole-catalog page `GET /`
(SSR markup with every section, render report, hydration without errors / deferred elements / console errors) and
`GET /csr`; it is reported as the `all-components` row of a separate "Pages" table (not counted as a component).
Its soft check "GET / slider section fidelity" compares attribute values verbatim (`rawAttributeValues`) between the
slider section of `/` (a page that needs a third pass) and `/component/slider`; it never fails the run and shows in
the Pages table's Fidelity column. More rows of the Pages table: `tests/agnostic.spec.ts` (`agnostic: overlay-trigger`,
`?agnostic=1`: nothing stays deferred, every candidate hydrates, a click opens the trigger) and
`tests/locale.spec.ts` (`locale: number-field`, `?lang=de` and `Accept-Language`: German formatting in the server
markup, hydration, fidelity against the client-rendered page in the same language). `tests/mobile.spec.ts` (390x844,
`isMobile`, `hasTouch`, `deviceScaleFactor` 3) checks picker / action-menu / contextual-help on phones (no hydration
errors or mismatch recoveries, mobile state after hydration, flicker, a tap opens an `sp-tray`) and writes the
"Mobile" table. These specs follow `SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`.

Fidelity normalization (`tests/helpers/dom.ts`): generated ids in id / id-reference attributes (Spectrum's `randomID()`
suffixes and instance counters) are compared by reference structure (`<prefix>#n` in order of first appearance), and
form controls by live state (`.value` / `.checked` instead of the `value` / `checked` attributes and textarea content,
which the server uses to transport property bindings), `style` attributes by their declarations (CSSOM `cssText`).
The interaction smoke test clicks the first control that is visible, enabled and actually receives pointer events. Check (1) skips `sp-*` elements that never have a shadow root
(`sp-tooltip-openable`, a plain `HTMLElement` in `tooltip/src/Tooltip.js`).

## Integration findings (Oct 2026)

Server (`swc-ssr/server`, all outside Spectrum sources):

* Render order: pass-2 elements connect and run their first update tree scope by tree scope (light DOM before the
  shadow content of its hosts, document order within a scope), the order client-side rendering creates them in.
* An element's own shadow content from the previous pass (its render root facade) is only exposed once its first
  update in the current pass has rendered, as in client-side rendering; before that (constructor, setters,
  `connectedCallback`, Lit's `wrapped` property initialization, `willUpdate`, `hostUpdate`) the render root is empty.
  The markup cannot carry property bindings of plain shadow elements (`.model=${...}` on `sp-slider`'s handle
  inputs), so earlier exposure made `sp-slider` throw on pages that need a third pass (e.g. together with `sp-dialog`).
  A throwing `wrapped` getter is reported per element (`initialize wrapped property <name>`), never fatal.
* `materialize()` before each server render: DOM nodes in text positions become text / raw HTML regions without
  template-level hydration markers (the client hydrates a node value as an opaque leaf); boolean property bindings on
  plain elements (`.checked=${false}`, which @lit-labs/ssr 4.1.0 would emit as `checked="false"`) are emitted as a bare
  attribute or not at all; textarea `.value` bindings become the textarea's text content.
* The element-binding marker attribute that @lit-labs/ssr 4.1.0 passes to custom element renderers as a static
  attribute (`lit$123$8=""`) is never applied.
* Lazily imported elements (`sp-slider` imports `sp-number-field` in `render()`): @lit-labs/ssr decides once per
  template whether a tag is a custom element. A render waits briefly (once per tag) for definitions its templates
  referenced while undefined and repeats pass 1 when they arrive; templates seen with an undefined tag get a fresh
  strings array once it is defined, so later renders are not stuck with a plain element.
* The initial `slotchange` emulation delivers one event per slot with assigned nodes and lets it bubble to listeners
  on ancestor slots (`help-text/src/HelpTextManager.js`); bound slots with generated names are matched by position.
* Attribute changes components make on plain (non-custom) elements - in the light DOM (ids for `aria-labelledby`
  targets in dialogs, menu groups, split view) and in shadow roots (e.g. the `tabindex` / `disabled` checkbox moves
  onto its input) - are written into the output (`light-mutations.ts`), so the references resolve without
  JavaScript and the client reuses those ids instead of adding a second set.
* The initial `slotchange` emulation also dispatches one event at the shadow root (`swatch/src/SwatchGroup.js` listens
  there). Client and server share the binding detection (`src/shared/slot-bindings.ts`).
* DOM shim: HTML constraint validation for form controls (`required`, `pattern`, `type`, `min`/`max`), the Popover API
  (so `overlay/src/Overlay.js` picks the same strategy and renders the same `popover` attribute as in browsers).
* Adapters for layout-dependent state (`sp-breadcrumbs`, `sp-split-view`, `sp-color-wheel`): computed from design tokens /
  "enough room" instead of zero sizes.
* Render end: elements are disconnected (`disconnectedCallback` on everything swc-ssr connected, every pass), pass
  contexts disposed, one event-loop turn before the result (see "Hardening" below).
* Light mutations are located by the element-child path in their tree scope and must match the recorded element's
  signature (tag + `id`/`name`/`slot`/`type`/`role`/`part`/`for`/`href`/`src` + `class`); otherwise the change moves to
  the single exact match in the scope, or is skipped with a warning. Whole documents are parsed with parse5 `parse()`
  (`isDocumentHtml` is shared with `ServerTree`).
* The previous pass's shadow used as fallback output has its `data-swc-ssr` markers stripped
  (`ServerTree.serializeShadow(id, {stripMarkers: true})`).
* Lazy definitions: undefined tags are tracked per render session; pass 1 is repeated when such a tag got defined
  while the pass was running too. The wait is configurable (`lazyDefinitionWaitMs`) and only happens for tags this
  render rendered while undefined (still once per tag per process).
* Attribute reactions: connected elements get `attributeChangedCallback` for observed attributes their own code
  changes (`setAttribute` / `removeAttribute`, and `toggleAttribute` through them), as in browsers; the shim's
  `Element` only stores the attribute. Without it `field-label/src/FieldLabel.js` (sets its generated `id` attribute in
  `willUpdate()`, relies on the `id` property following) appended an empty id to `aria-labelledby` (`"label "` on
  `sp-slider` inputs of pages that need a third pass), and `action-group/src/ActionGroup.js` setting `role="radio"` on its
  buttons left `ActionButton`'s `role` property at `button` (an extra `aria-pressed` in the server markup). The
  renderer's own writes are excluded (`withoutAttributeReactions` in `lifecycle.ts`): upstream's
  `ElementRenderer.setAttribute` notifies explicitly.

Client (`swc-ssr/client`, `hooks.ts`): the first client render must match the server markup, which shows the settled
state. The hooks apply to elements whose pre-existing shadow root was rendered by `@lit-labs/ssr` (contains a
`<!--lit-part` marker) or whose tag starts with `sp-`; other Lit elements with a declarative shadow root are left to
lit's own hydrate support. Hydration adapters restore server state before the hydrating update (`sp-picker` selected item,
`sp-breadcrumbs` overflow state) or hide server-rendered shadow content from code that runs before the first render
(`sp-slider` handle cache); the initial `slotchange` is emulated before hydrating when it changes what the element
renders, otherwise after the hydrating update (CSR timing); a remaining mismatch re-renders that element on the client
and is reported. Server output is rendered with `deferHydration: true` and the light-DOM elements are enabled in
document order, so first updates run in CSR order regardless of the order definitions load in.

Known differences that remain (see `tests/results/summary.md`): light-DOM insertions made by components on the server
(e.g. `sp-table` checkbox cells) are not rendered (reported as `dropped DOM change` warnings); state that depends on timing in client-side rendering (which item of a
menu starts with `tabindex="0"` in `sp-picker` / `sp-action-menu` in `sp-breadcrumbs`) can settle differently, and an
element's first client update sees the server's final attributes (`sp-swatch` sets `focusable` on the selected swatch).
Layout-dependent values are approximated without layout (`sp-tabs` selection indicator, `sp-color-area` handle) and
corrected after hydration.

## Hardening (Oct 2026, after the review)

Three streams fixed the review findings; this records what changed and why.

### Memory (the 226 MB-per-render leak)

Full catalog x8 (`.probe/leak.ts`, GC after each render): heapUsed went from 333 -> 1919 MB (about 226 MB kept per
render, render time growing 3.3 -> 4.3 s) to a flat 110-112 MB with 2.3-2.9 s renders (no trend). Retention paths, each fixed
where it starts (comments name the path):

1. Elements were never disconnected: `LanguageResolutionController` registers a listener in a module-level Map
   (`reactive-controllers/src/AttributeObserver.js`) that held the element, its structure backing, the realm and the
   whole render; same for `IconsetRegistry` and `document` listeners. `connectElement()` records every element
   swc-ssr connects (all passes) in the session; `disconnectAll()` runs their `disconnectedCallback` at the end of
   every render, also a failed one.
2. `dom-shim/install.ts` listener this-binding: the wrapper table is `WeakMap<callback, WeakMap<target, wrapper>>`
   (weak on both sides), so `document` no longer keeps every callback ever added.
3. Session hooks (`context.ts`) are an ordered set of active sessions; ending one re-points the hooks at the most
   recent session still active (or what was there before any session). A finished session is marked `ended` and
   nothing is queued into it (it used to collect rAF callbacks and document listeners without bound when an outer
   render finished before a nested one).
4. V8 keeps accessor functions in the shared hidden class, so per-instance accessor closures pinned the first
   instance's render forever. `realm.ts` (event links `__host` / `__eventTargetParent`) and `adapters/overlay.ts`
   (`keepClosed` `open`) use shared accessor functions plus a `WeakMap`.
5. Back-to-back queued renders ran in one microtask chain, so zero-delay timers and Node's pending-rejection
   processing never ran between them. A render now waits one event-loop turn (`setTimeout 0`) after disconnecting,
   with its session still active, before building the report; late rejections that arrive then become `#render` /
   element warnings.
6. `RenderContext.dispose()` clears realm, previous, tree, pool, records, reports and stacks after the report is
   built. `TreeRealm.dispose()` stops creating instances but keeps structure backings (late component continuations,
   e.g. `sp-slider`'s `getUpdateComplete` reading its `@query` number field, still need them).

`packages/swc-ssr/test/memory.test.ts` guards this (heap growth between renders 4 and 12 of a mid-size page, render
contexts collected, removed listeners collected, out-of-order session ends). Note: in some runs the very first render
of a process still measures about 317 MB when GC runs right after its promise resolved (no event-loop turn in
between); it is freed at the next turn (`YIELD=50` in the probe: flat 110 MB from render 1), later renders never show
it, and a server yields between requests anyway.

### Server (review H1, M1-M7, L1-L5)

* H1: `LitElementRenderer.renderOptions` apply to every element, pre-built or not, evaluated after attributes and
  properties are set, as upstream does (`render-options.ts`). `disableSsr`: not pooled / connected / updated, no
  shadow root, light DOM still rendered.
* M1: `'full'` is the default only for managed classes (`isManagedClass`, default `adapters/spectrum-class.ts`: the
  `SpectrumMixin` prototype; on the catalog every Lit element except `sp-theme` and `sp-tooltip-openable`). Other Lit
  elements keep upstream behaviour unless `lifecycleByTag` / `isManagedClass` opt them in.
* M2: rejections are attributed through an `AsyncLocalStorage` scope per render (and per element around its hooks):
  only rejections of promises the render created go into its report, to the element whose hook created them,
  otherwise to `#render`. Late ones after the render are only logged in debug mode; everything else gets Node's
  behaviour for the `--unhandled-rejections` mode (or the application's own listener decides).
* M3: pool key = scope + tag + hash of static attributes + ordinal; adoption refused when static attributes differ;
  stale upstream attributes are removed (with `attributeChangedCallback`) before the lifecycle.
* M4 / M5: light mutations matched by signature (see Integration findings); whole documents parsed with `parse()`.
* M6: `timeoutMs` deadline (the queue never deadlocks), nested renders from async work of a running render run inline,
  `lazyDefinitionWaitMs`.
* M7: `lang` option (sets `document.documentElement.lang` for the render) and a language inspector warning about
  elements whose locale falls back to `navigator.language`. The demo always passes the page language.
* L1: fallback shadow markup without previous-pass markers. L2: `full` elements updated after their markup was
  emitted are reported and trigger one more pass (still at most 3). L3: adapters get the real pass, key and
  `previousId`. L4: pre-instantiation uses a Set. L5: structure changes on rendered nodes are reported (`dropped DOM
  change`), via `setDroppedMutationHandler` in `dom-shim/hooks.ts` and three call sites in `install.ts`.

### Client and DOM shim (review H2, M8, M9, L6-L8)

* H2: one predicate for hydration candidates (`client/elements.ts`): `defer-hydration`, or a valid custom element
  name that is `sp-*`, has a shadow root, or is already defined. Non-prefixed Spectrum elements (`<overlay-trigger>`)
  hydrate on the agnostic path; framework component hosts (`<app-root>`) are not awaited. Covered by
  `tests/agnostic.spec.ts`.
* M8: `crypto.getRandomValues` returns deterministic bytes only for `randomID()`-shaped requests (plain
  `Uint8Array(4)`) during the synchronous parts of a render; everything else uses the CSPRNG.
  `configureRandomSource({deterministicIds})` (process-wide) and `RenderSpectrumOptions.deterministicIds` (per render).
* M9: `MatchMediaController` adapter for `sp-picker`, `sp-action-menu`, `sp-contextual-help` (pins `matches` to the
  server value during hydration, restores it afterwards). The server still cannot render the mobile state (no
  client hints); phones hydrate the desktop markup without a mismatch and then re-render. Covered by
  `tests/mobile.spec.ts` (390x844, touch, including the deprecated `<sp-picker><sp-menu>` variant that renders its
  closed overlay at once).
* L6: hooks only for `@lit-labs/ssr` shadow roots or `sp-*`; the initial-slotchange plan runs after
  `willUpdate()`/`hostUpdate()` (adapters can opt into `slotchangePlan: 'before-willupdate'`).
* L8: runtime dependencies declared in `packages/swc-ssr/package.json`.

### Process-wide state

* The DOM shim's globals are **process-wide and permanent** (review L7, not feasible to scope): `window` (=
  `globalThis`), `navigator`, `matchMedia`, `requestAnimationFrame` & co., `getComputedStyle`, `CSS`, no-op global
  event methods, `innerWidth`, `screen`, `scrollTo`, element / event classes. Measured with `.probe/window-scope.ts`
  (full catalog, 2 renders): 128 `window` reads while the registration modules are imported (no detectable end of an
  application's import phase), 6344 inside the synchronous parts of renders, 12 outside them (`TopNav.manageItems`
  via the initial slotchange); lazily imported modules (`sp-number-field`, `sp-color-handle`, `sp-color-loupe`,
  chevron icons) evaluate asynchronously and would throw in `defineElement` and stay failed. Libraries that sniff
  `typeof window` take their browser branch once the shim is installed: import them first or isolate them in a
  worker.
* The `unhandledRejection` listener (see M2) is installed with the first render and kept.
* `document.documentElement.lang` is set per render (`lang`) and restored.
* Module-level instance counters in Spectrum ids (`sp-dialog-label-N`) make the output of the first and later renders
  of one process differ slightly; fidelity tests normalize them.

## Coding conventions

Never define per-instance accessors (`get` / `set`) whose functions are closures over render state: V8 keeps accessor
functions in shared hidden classes, so they outlive the instance and pin the render. Use shared accessor functions
plus a `WeakMap` (as `realm.ts` event links and `adapters/overlay.ts` `keepClosed` do).

TypeScript strict, ESM, Node >= 20. No build step for the server (run with `tsx`); client via esbuild. Keep every Spectrum-specific
behaviour in `packages/swc-ssr/src/server/adapters/*.ts` (one file per tag or family) registered in a map, so the generic
renderer stays library-agnostic. Log with a `debug` flag only. Every workaround gets a comment naming the Spectrum source
file/mixin that needs it (e.g. `shared/src/observe-slot-presence.js`).
