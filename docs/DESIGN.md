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
* Server styles (0.2.0, see "Style trimming"): a hydrated element whose server `<style>` was trimmed adopts its class's
  complete `elementStyles` in its hydrating update, and the server's `<sp-theme>` `<style>` is bridged until then
  (0.2.1: only upgraded themes lose it; minified elements wait for a pending theme and keep their minified `<style>`
  until no element runs on minified CSS).

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
  signature (tag + `id`/`name`/`slot`/`type`/`role`/`part`/`for`/`href`/`src` + `class`) and content; otherwise the
  change moves to the single exact match in the scope, or stays at the recorded position when the scope's structure
  along the path is unchanged, or is skipped with a warning (order: `light-mutations.ts` file comment). Whole documents are parsed with parse5 `parse()`
  (`isDocumentHtml` is shared with `ServerTree`).
* The previous pass's shadow used as fallback output has its `data-swc-ssr` markers stripped
  (`ServerTree.serializeShadow(id, {stripMarkers: true})`).
* Lazy definitions: undefined tags are tracked per render session; pass 1 is repeated when such a tag got defined
  while the pass was running too. The wait is configurable (`lazyDefinitionWaitMs`), only happens for tags this
  render rendered while undefined (still once per tag per process) and never goes beyond the render's deadline.
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
   render finished before a nested one). Since 0.1.1 the hooks dispatch by render scope (see "Second review").
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
  otherwise to `#render`. Late ones after the render: see "Second review" (M2); everything else gets Node's
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
* M9: `MatchMediaController` adapter (since 0.1.1 for every hydrating element with controllers; it was `sp-picker`,
  `sp-action-menu`, `sp-contextual-help`) (pins `matches` to the
  server value during hydration, restores it afterwards). The server still cannot render the mobile state (no
  client hints); phones hydrate the desktop markup without a mismatch and then re-render. Covered by
  `tests/mobile.spec.ts` (390x844, touch, including the deprecated `<sp-picker><sp-menu>` variant that renders its
  closed overlay at once).
* L6: hooks only for `@lit-labs/ssr` shadow roots or `sp-*`; the initial-slotchange plan runs after
  `willUpdate()`/`hostUpdate()` (adapters can opt into `slotchangePlan: 'before-willupdate'`).
* L8: runtime dependencies declared in `packages/swc-ssr/package.json`.

### Second review (0.1.1)

An independent reviewer reproduced twelve more findings with in-process probes (`.probe/review/*.ts`); each fix has a
unit test that fails on 0.1.0 and passes now. The catalog output is unchanged apart from the spurious
`<!--lit-node-->` markers after `<sp-tooltip>` (L5 below); the reports are identical; full-catalog renders stay at
2.3-2.6 s with a flat heap (110-112 MB, `.probe/leak.ts`).

* M1 (rAF sink / listener log of the wrong render; `queue.ts` 7d): the process-wide hooks pointed at the most recent
  active session, so a timer of a finished render that requested an animation frame while the next queued render ran
  had its frame flushed (and its error attributed) there. `context.ts` now installs dispatchers while any session is
  active; every call is filed under the session of the caller's `AsyncLocalStorage` render scope, and only callers
  without a scope go to the most recent active session. A finished render's frames are dropped (debug log) and its
  late `document` listeners are removed at once (the shim now logs a listener after adding it). The selector error
  handler and the dropped-mutation reporter dispatch the same way. Frames carry the requesting scope and their
  callbacks run in it (errors go to that element, else to the element whose lifecycle ran last). `runInContext`
  makes sure its code runs in the context's render scope. `setListenerLog` takes any `ListenerLog` (`{push}`).
  `.probe/review/queue.ts` 7d: render 2's report is clean.
* M2 (late rejections swallowed; `rejection-scope.ts`): after a render ended, rejections from its own scope (no
  element: templates, directives, custom renderers, long-lived resources first created there) get Node's behaviour
  (`forwardUnhandledRejection`); rejections from an element's hooks (component code of the discarded tree) become a
  `SWC_SSR_LATE_REJECTION` process warning instead of a crash - Spectrum leaves such work behind, and
  `test/server-rejections.test.ts` requires that it does not kill the process. Constructors now run in their
  element's scope (realm and fresh builds), so promises they create count as the element's. While the render runs,
  attribution is unchanged. The probe now fails with the rejection, like its control.
* M3 (adoption by key only; `claims.ts` WHICH=5): a renderer is constructed before its element's light DOM is
  rendered, so a construction-time key cannot contain it. `plan.ts` `verifyAdoptions` checks after each pass >= 2
  (with the pass output parsed, reused as the next pass's tree): within a key group (scope, tag, static attributes),
  an element whose light-DOM signature (`server-tree.ts` `lightSignature`: child tags with `slot`, text hash)
  differs from the element it adopted, while another member of the group (this pass or the previous one) has
  exactly that signature, adopted the wrong instance: warning `adopted candidate rejected: light DOM differs` and one
  more pass. That pass is built from the pass output, whose ordinals already follow the new order, so the keys stay
  as they are ("re-deriving ordinals per light signature" adds nothing once the tree reflects the new order).
  Elements whose content merely changed (no other candidate) keep their adoption. Cost: ~70 ms on the full catalog
  (one extra parse of the final pass), ~3 ms on one-component pages; `.probe/review/key-shift.ts` still shows 0
  shifts, the catalog no rejections. Limitation (unchanged): an element whose own light DOM changes between the
  passes renders with the previous pass's light DOM unless another pass is made for other reasons.
* L4 (`renderOptions` evaluated twice; `options-twice.ts`): `TreeRealm.createInstance` stores its decision next to the
  lifecycle mode (`renderOptionsOf`); the renderer reuses it for pooled elements and evaluates only for elements it
  builds. One evaluation per element and pass, before connecting, as upstream.
* L5 (host stack leak; `host-leak.ts`): `FallbackElementRenderer` (render-spectrum.ts) replaces upstream's
  `FallbackRenderer` for non-Lit custom elements (after `LitElementRenderer`); its `renderShadow()` pops
  `customElementHostStack`, which upstream 4.1.0 pops only when a shadow was emitted. Elements after an
  `<sp-tooltip>` (its shadow renders `sp-tooltip-openable`) are no longer keyed in the tooltip's scope, get no
  `__host` = tooltip, and no `defer-hydration` / `<!--lit-node-->` they should not have (upstream has the same bug).
* L6 (timer overflow; `overflow.ts`): `timerDelay` (context.ts): delays above 2^31 - 1 ms mean "no timer"
  (`timeoutMs`: no deadline; `lazyDefinitionWaitMs`: wait until defined, bounded by the render deadline; 0.1.2
  made that bound real, see "Third review").
* L7 (document templates and `lang`): from pass 2 on, a whole-document template's own `<html lang>` (pass-1 tree,
  `ServerTree.documentLanguage`) is the document language when `options.lang` is not set (`setDocumentLanguage`).
* L8 (light mutations in shadow scopes; `mutations.ts`): the recorded element's content (child tags, text; same
  format as `lightSignature`) is part of its signature. The element at the recorded path is used when signature and
  content match; otherwise the one element with both, or the only element with the signature; several candidates
  and not exactly one with the content: warning, not applied (0.1.2: unless the scope kept its structure, see
  "Third review").
* L9 (`MatchMediaController` adapter by tag): applies to every hydrating element and acts only on elements that have
  controllers (`findMatchMediaControllers`), so subclasses under other tags are pinned too.
* L10 (deterministic 4-byte requests): documented (API.md "Deterministic ids, caveat"); no code change - restricting
  it to `randomID()` would need stack inspection, which breaks in bundled servers.
* L11 (packaging): the `@lit-labs/ssr` peer is `~4.1.0` - the renderers rely on 4.1.0 internals (the element-part
  marker passed as a static attribute, the host-stack behaviour of `custom-element-shadow`, `lib/render.js`
  `renderThunked`); `package-lock.json` refreshed (`npm install --package-lock-only`), `npm ls` clean; the
  `REPLACE_WITH_OWNER` placeholders stay for the owner.
* L12 (demo): `HEAD /dist/*` goes to `express.static` (Content-Type, Content-Length, 404); other HEAD requests keep
  the empty 200 health-check answer (`tests/server.spec.ts`).

### Third review (0.1.2)

A third reviewer checked 0.1.1 and reproduced four problems with probes (`.probe/review2/`: `l8.ts`, `lazy-inf.ts`,
`m3.ts` WHICH=a|b, `options-count.ts`; `base/` is a d7d001b copy). Each fix has a unit test that fails on 0.1.1 and
passes now (122 unit tests). Full catalog: HTML and reports identical to 0.1.1 (`.probe/review3/snap.ts` +
`.probe/review2/cmp.mjs`, ids normalized), render times unchanged (`.probe/review3/timing.ts`, alternating runs: baseline and
0.1.2 both 2.9-5.0 s on a loaded machine; `verifyAdoptions` 3-9 ms per pass), heap flat at 111-112 MB from render 2
(`.probe/leak.ts`, N=8), `.probe/review/key-shift.ts` unchanged (passes 3, findings
59, 0 shifts).

* Light mutations, regression of the 0.1.1 content check (`l8.ts`): with two or more same-signature elements in a
  scope whose content changed between the passes (headings rendered from state the host only knows from pass 2 on:
  `<h2 slot="heading">First (${state})</h2>` twice), none had the recorded content, so 0.1.1 dropped the ids with a
  "2 elements match and none has the recorded content" warning while the hosts' `aria-labelledby` pointed at them
  (dangling references; d7d001b applied them). The element at the recorded position is used again when it has the
  signature and the scope's structure along its path is unchanged (same tags at every level, `sameStructure`); a
  debug note, no warning. A redirect away from the recorded position still needs exactly one other element with the
  recorded content; a scope whose structure changed (`x-mark-ambiguous`: one span became two) still warns.
* Lazy definitions with `lazyDefinitionWaitMs: Infinity` (`lazy-inf.ts`): 0.1.1 raced the definitions against
  nothing, so a tag never defined on the server (a client-only element in a component's `render()`) made every render
  wait until `timeoutMs` and reject ("pass 1 did not complete": pass 1 was recorded only after the wait), the tag was
  never given up, and the pending wait kept each render reachable. Now: pass 1 is recorded before the wait; the wait
  is bounded by the render's deadline (`RenderSession.deadlineAt` / `signal`, aborted with the render, so a wait
  that reaches the deadline is ended by the deadline itself, not by a timer that fires just before it); tags still
  undefined are added to `abandonedTags` whenever the wait ends (definitions, timer or deadline). Decision:
  `Infinity` means "up to the render's deadline" (that render returns its pass-1 output with a
  `the wait for lazily defined elements (<tag>) was abandoned` warning; later renders do not wait); without a deadline
  (`timeoutMs` 0 / Infinity) `Infinity` means the default 250 ms, because an unbounded wait for a client-only tag would
  never end. Probe: 3 x ~410 ms rejections -> 427 ms (pass-1 output + warning), then 23 / 16 ms with 2 passes.
* Adoption verification by bound values (`m3.ts` WHICH=a): same-kind elements told apart only by bound attributes /
  properties (`<x-leaf-a label=${'extra'}>` rendered before `<x-leaf-a label=${'main'}>` once the host knows its
  light DOM; empty light DOM) still swapped instances (the extra one rendered `derived-from-main`). `verifyAdoptions`
  now has a second criterion: the attributes and properties upstream set (`ElementRecord.attributes` /
  `properties`; static ones are equal within a key group; property values compared with `sameValue` after
  translating previous-pass instances), skipped when the light DOM alone identifies the element (same light DOM as
  its source, unique in the group - e.g. tabs with distinct labels whose bound `selected` moved). Warning
  `adopted candidate rejected: upstream attributes / properties differ ...`, corrected by the extra pass.
  Values created anew per render (object literals, closures) never compare equal, so they never confirm another
  candidate (no rejection). Known limitation: elements with no light DOM that differ only by a bound value moving
  from one to another between the passes look like a reorder (third pass + warning).
* Adoption verification false positive (`m3.ts` WHICH=b): `<x-leaf-b>${known ? 'B' : 'A'}</x-leaf-b><x-leaf-b>A</x-leaf-b>`
  got a spurious rejection and a third pass, because the sibling had the first element's old light DOM. `misadopted`
  (plan.ts) now counts only a current element like the adopted source whose own adoption is mismatched or missing,
  and only a previous element like this one that no like current element adopted (for both criteria). Probe: 2
  passes, clean (as d7d001b).
* `renderOptions` of `disableSsr` elements (`options-count.ts`): evaluated 3 times over 2 passes (pass 1, the
  discarded pre-built instance in `createInstance`, again on the element the renderer builds). `TreeRealm` keeps the
  decision per tree node (`ssrDisabled` map) and `renderOptionsOf(element, node)` hands it to the renderer for the
  element it builds for that node: `{"off":2,"normal":2}`. The decision is made on an instance with the previous
  pass's attributes, as for every pre-built element, and matches the plain facade other elements saw.

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
* The `unhandledRejection` listener (see M2) is installed with the first render and kept. Rejections of a finished
  render's own scope get Node's behaviour; those of its elements' hooks a `SWC_SSR_LATE_REJECTION` warning.
* While renders run, the rAF sink, the `document` listener log, the selector error handler and the dropped-mutation
  reporter are dispatchers that file each call under the caller's render (by `AsyncLocalStorage` scope); outside
  renders the hooks that were there before are back.
* `document.documentElement.lang` is set per render (`lang`, else a whole-document template's own `<html lang>` from
  pass 2 on) and restored.
* Module-level instance counters in Spectrum ids (`sp-dialog-label-N`) make the output of the first and later renders
  of one process differ slightly; fidelity tests normalize them.

## Style trimming (0.2.0)

Why: in `full` mode every declarative shadow root carries its element's complete stylesheets, about 95 % of a page's
HTML (button page 1.22 MB, 98.3 % CSS, 33 `<style>` blocks with 6 distinct texts; whole catalog 18.66 MB, 94.9 % CSS,
1346 blocks / 87 distinct). The theme alone is 312 KB (core + spectrum + light + medium, 3377 custom-property
declarations), of which a button-only page references about 204 properties. The idea comes from the user's
post-build tool in SluzbeniList (`AngularApp/unused-css-builder/src/my-builder.ts`: collect `var()` references,
compute transitive custom-property dependencies, delete unreferenced declarations, collapse `var(--undefined, V)`,
rename to short names); here it runs per rendered page, with the rendered tree as the source of truth. Contract:
docs/API.md "Styles". Code: `packages/swc-ssr/src/server/styles/`, `packages/swc-ssr/src/client/server-styles.ts`.

### Server

1. **Emission placeholders** (`styles/collector.ts`). With `styles: {mode: 'trimmed'}` the renderers
   (`SpectrumElementRenderer.renderShadow`, `ThemeRenderer.renderShadow`) write a token `\u0001swc-css:<n>\u0001` per
   stylesheet instead of its `cssText`. A token stands for (element tag, stylesheet object) - one entry of the class's
   `elementStyles`, or one theme fragment - so all instances of a class share one trimmed text and the browser's
   sharing of identical `<style>` texts keeps working. The registry belongs to the render session (the previous
   pass's markup, reused as fallback shadow content, carries the same tokens). `full` mode emits the `cssText` as
   before, byte for byte. Tokens keep the final HTML small, so parsing it once more is cheap.
2. **Resolution** (`styles/trim.ts` `resolveStyles`, called from `render-spectrum.ts` after the final pass and the
   end-of-render event-loop turn). The final HTML is parsed into a `ServerTree` (parse5 + htmlparser2 adapter; the CSS
   of other `<style>` elements is swapped for placeholders while parsing and restored by `ServerTree.styleText`). Every
   `<style>` holding tokens is attributed to the host of its declarative shadow root (`Instance`); a token without a
   host (inside a plain `<template>`) keeps its stylesheet complete. `style` attributes and other CSS of the output are
   collected as "seen by the page".
3. **Parsing** (`styles/css-text.ts`): a small slice-preserving structural parser (no css-tree / postcss): style rules,
   conditional group rules (`@media`, `@supports`, `@container`, `@layer` blocks, `@starting-style`) with nested
   rules, `@keyframes`, everything else opaque; strings, comments, `url()`, escapes and native nesting (the theme's
   `:host{...;&:lang(ar){...}}`) are handled. Kept rules are copied verbatim; only rewritten blocks are re-joined.
   Parsed sheets and compiled selectors are cached process-wide per stylesheet object (`WeakMap`).
4. **Selector evaluation** (`styles/selector-match.ts`): selectors parsed with `css-what`, compound selectors evaluated
   with `css-select` over the server tree, the shadow-DOM parts by a small right-to-left matcher: `:host` /
   `:host(<compound>)` against the host (featureless otherwise), `:host-context()` against the shadow-including
   ancestors (a fragment render may match unknown ancestors), `::slotted()` against the flattened assigned elements
   (forwarded `<slot>`s resolved through the outer host), combinators climbing from the shadow content to the host.
   Structural pseudo-classes are evaluated; every other pseudo-class (states, `:dir()`, `:lang()`, `:empty`,
   `:defined`, unknown) counts as matching; `:not()` with a non-evaluable argument, `:is()` / `:where()` / `:has()` are
   weakened; anything unparsable keeps its rule. The rule: a rule is dropped only when none of its selectors can match
   in any instance. Instances with equal fingerprints (host attributes and siblings, shadow content, light children)
   are evaluated once, except for sheets with `:host-context()` or `:has()`. css-select lowercases names in HTML mode
   while parse5 keeps SVG names camelCased, so the adapter compares names case-insensitively
   (`::slotted(svg[viewBox])` of `illustrated-message`).
5. **Theme closure** (`trimTheme`): the theme's custom-property declarations are kept when used transitively (through
   the theme's own definitions, `var()` fallbacks included) by a kept component rule, a non-custom-property
   declaration / nested rule / at-rule body of the trimmed sheets, a `style` attribute, other CSS of the output, or
   `references`. The theme's rules other than `:host` are selector-filtered like any sheet (they cannot match a shadow
   root that only holds a `<slot>`). The components' own custom-property declarations are not pruned: one trimmed text
   per class and the contract's rule-level granularity keep them.
6. **`undefinedPrefixes`** collapse `var(--prefix-x, V)` to `V` in kept rules when nothing on the page defines
   `--prefix-x` (`var(` inside strings and comments is not a reference: the scan is string / comment aware).
   **`minifyCustomProperties`** renames, most used first, to `--a`.. (skipping every name on the page and every
   `references` name or prefix) only names the client can switch in one step (0.2.1): names whose every definition
   is in the theme (the bridge keeps the short name defined for elements on minified CSS, the upgraded theme the
   original one for restored elements), or whose every definition and use is inside the sheets of one element class
   (restored together) or inside one sheet object several classes share (each instance defines and reads the name in
   its own root). Owners are computed per trimmed sheet (`#theme`, the tag, the sheet object). Never renamed:
   `PUBLIC_CUSTOM_PROPERTY_PREFIXES` (`--mod-*`, `--highcontrast-*`, `--system-*`, Spectrum's customisation API,
   whatever the options), names one element class defines and another reads, `references`, names in `style`
   attributes or uncontrolled CSS, and names that are only read. Joining classes that share a sheet into one owner
   (union-find) was measured and rejected: one checkmark / chevron icon sheet joins 20 classes - `sp-picker` with
   `sp-popover` and `sp-menu-item`, `sp-tray` with `sp-dialog-wrapper`, `sp-menu` with `sp-menu-group` -, which
   are exactly the parent / child pairs the rule exists for.
7. **Assembly and markers.** `@keyframes` are kept when a kept rule or other CSS names them; groups when a rule inside
   is kept (named `@layer` blocks always). A sheet nothing was taken from is emitted as its original text (so it is
   byte-identical and unmarked). Every token is replaced by its sheet's text; a `<style>` whose text changed gets
   `data-swc-styles="trimmed"` / `"minified"`. `report.styles` lists every sheet with its instances and sizes. A
   failure in any step falls back to the complete stylesheets with a `#render` warning.

Measured (`.probe/css-stats.ts`, `.probe/review-styles/sizes.ts`, docs/API.md "Styles" has the table): button page CSS
1230 -> 823 KB trimmed / 454 KB minified (gzip 120 -> 79 / 15 KB), picker 1294 -> 475 / 330 KB, whole catalog
18121 -> 12616 KB (69.6 %) / 8224 KB (45.4 %), 6864 KB (37.9 %) with `undefinedPrefixes: ['--mod-']`. 0.2.0 renamed
more (minified 298 KB / 231 KB / 5689 KB = 31.4 %, 4329 KB = 23.9 % with `--mod-` collapsed); the names 0.2.1 keeps
(`.probe/review-styles/long-names.ts`, catalog with `--mod-` collapsed): `--system-*` 0.92 MB, `--highcontrast-*`
0.76 MB, cross-class `--spectrum-*` 0.76 MB (1.37 MB before shared sheets counted as one owner), `--mod-*` the page
defines 0.51 MB. Trimming costs 9-23 ms on one-component pages and
about 0.2-0.6 s on the whole catalog (up to 1.4 s on a loaded machine), which is less than the variance of the
catalog render itself. Heap stays flat (`.probe/leak.ts` STYLES=trimmed N=8: 102-103 MB from render 2). Two early
targets are not reachable under the contract (one trimmed text per element class, rule granularity for component
sheets): the catalog's trimmed CSS stays at 69.6 % of full (the catalog renders nearly every variant of every
component, and the remaining bulk is the components' own custom-property declarations), and the button page's
`sp-button` sheets keep 36.6 of 41 KB trimmed (19.9 KB minified, 12.9 KB in 0.2.0).

### Hydration semantics (the user's report: "hydration broke / ignored all styling")

Measured in a browser on the button page before the client fix: full and trimmed mode showed 0 differing pixels
before vs after hydration, minified mode 85,664 (`.probe/hydration-styles.ts`): the button background became
transparent and its height went from 32 to 22.8 px. After hydration `<sp-theme>` had 3 adopted sheets and no `<style>`
(Theme.js `attachShadow()` clears the declarative shadow root, `adoptStyles()` adopts its complete fragments), while
`sp-button` had 0 adopted sheets and 1 `<style>`: `@lit-labs/ssr-client/lit-element-hydrate-support.js`'s
`createRenderRoot()` returns the existing shadow root and never calls `adoptStyles()`, so a hydrated element keeps the
server `<style>` as its only stylesheet. Consequences: (1) minified components read renamed properties that stop
existing the moment the theme upgrades - the page loses its styling; (2) trimmed components paint right at first, but
any later state (an app toggling `disabled`, a variant, `selected`, an overlay opening) hits rules the trimmer
removed. Neither is visible to a pre-hydration oracle.

Fix (`client/server-styles.ts`, called from the hydration hooks in `hooks.ts` and from `index.ts`):

* **Restoration.** In each element's hydrating update, right after `update()` (same task, nothing paints in between):
  when its server `<style>` carries `data-swc-styles` (or, unmarked, differs from the class's `elementStyles` text),
  the element adopts the class's complete `elementStyles` - one shared `CSSStyleSheet` per `CSSResult` through the
  `CSSResult.styleSheet` getter, exactly what `createRenderRoot()` adopts on the client - and the server `<style>`s are
  removed. On a page with any marked `<style>`, every hydrated Lit element does this (also the ones whose sheets came
  out complete), so after hydration the page runs on adopted complete sheets throughout. Unconditional, independent of
  `removeServerStyles`, which keeps its meaning for `full` pages. Mismatch recovery keeps the server `<style>`s and
  restores afterwards. Browsers without constructable stylesheets get the complete text in the first server `<style>`
  (minified: in an added `<style>` after the kept one). Unmarked server CSS on a page without any marked `<style>`
  is restored only when its text differs from the class's (lengths first, the text once per class: 0.2.1, see below).
* **Minified elements (0.2.1).** A restored minified element keeps its server `<style>`s (`keepUntilSettled`): they
  are removed with the bridges, when no marked `<style>` is pending (restored hosts do not count). The kept rules are
  a subset of the adopted complete sheets, which come later in the cascade and win wherever both have a rule; the kept
  `<style>` only adds definitions of short names, for elements below that still read them (not hydrated, or defined
  late). And while a bridged theme has not upgraded (`themePending`: connected, not an instance of the defined
  `sp-theme` class), a minified element is not restored at all - the theme's server `<style>` defines the short
  names only, so the complete sheets would find nothing; `onThemeDefined` (the `whenDefined('sp-theme')` microtask,
  after the bridges are re-inserted) restores the hydrated ones.
* **Theme bridge.** At import of `swc-ssr/client` (before any definition), every `<sp-theme>` (light DOM or open
  shadow roots) whose declarative shadow root holds a marked `<style>` is recorded, with a count of the other marked
  `<style>`s. In the `whenDefined('sp-theme')` microtask - the same task as the upgrade, so before any paint - the
  recorded `<style>` elements are put back into the themes' shadow roots. They are removed when the count of marked
  `<style>`s reaches 0 and a scan of the document confirms it, or at the end of `hydrateSpectrum()` when none is left;
  otherwise they stay (late or lazy hydration, elements that never get defined). Only upgraded themes (re-inserted, or
  an instance of the defined class) lose them: the server `<style>` of a theme whose definition comes after the
  components hydrated, or never, is all that theme has (0.2.0 removed it: the theme catalog entry with `sp-theme`
  defined late lost its theme in trimmed and minified mode, 51 of 52 elements styled differently; `.probe/review-styles/deep2.ts`).
  The bridge is installed whether or not the browser has constructable stylesheets (it is a plain `<style>`). A
  `<style>` element instead of an
  adopted `CSSStyleSheet` (the first design): `Theme.adoptStyles()` re-assigns `adoptedStyleSheets` whenever a theme
  fragment is registered, which would drop an adopted bridge; a `<style>` in the shadow root comes before the adopted
  sheets in the cascade, so the complete theme still wins wherever both define a name.
* **Late hydration.** Testing the held state uncovered an unrelated hang: hydrating more than a frame after the
  definitions loaded, every `sp-menu` / `sp-menu-group` (and so `sp-picker`, `sp-action-menu`, `sp-combobox`) never
  finished updating - `Menu.updateCache()` (started by `sp-menu-item-added-or-updated` events reaching the deferred
  menu) waits for `updateComplete`, and `getUpdateComplete()` waits for `cacheUpdated`, that same call. A shape-based
  hydration adapter (`hooks.ts`, tag `/^/`) gives such a menu a `cacheUpdated` that settles with the next frame at the
  end of its hydrating update; the whole catalog hydrated late now settles in about 0.6 s instead of running into the
  3 s timeouts twice.

### Oracles (tests/styles.spec.ts)

Every comparison is pixel-exact: pixelmatch threshold 0 with anti-aliased pixels counted, plus a byte comparison of the
decoded images, same viewport, same document-coordinate clip. A capture that differs is repeated with fresh page loads
(up to 3 attempts) and only fails when no capture of the one page equals a capture of the other - a real CSS
difference is in every capture; load-to-load raster noise (a few anti-aliased pixels in about 1 of 30 loads of
`action-menu`, the server's very first render of a page) is not. Hydrated pages are repainted once (`forceRepaint`)
before they are captured: a page that swapped its style sources repaints regions whose computed values did not change,
and Chrome then rasterizes some anti-aliased edges one colour level differently from the first paint (probed: 8 px of
`field-label`, deterministic, gone after any later repaint; computed styles and layout identical). Per catalog entry
and for `/`:

| Check | What |
|---|---|
| `oracle`, `oracle:minified` | no JavaScript: trimmed / minified page equals the full page |
| `oracle:states` | no JavaScript, interactive entries: hover, then focus, of the first control |
| `hydration:trimmed` | trimmed and minified pages hydrate without errors / deferred elements; pure-SSR paint vs hydrated paint under the flicker threshold (or no worse than full CSS) |
| `hydration:restore` | `?hydrateDelay=hold`: interim (every element defined, `<sp-theme>` upgraded, nothing hydrated), hydrated, and four groups of states set on every sp-* element; trimmed and minified equal the full page; no marked `<style>` left; late hydration settles |
| `post-hydration` | normal timing: after `window.__swcSsrHydration` the trimmed and minified pages equal the hydrated full page; no `<style data-swc-styles>` in any shadow root; every hydrated sp-* Lit element has adopted sheets |
| `post-hydration:states` | interactive entries, after hydration: hover, focus, click the first control, `disabled` on it, `size="xl"` on the first button, `quiet` toggled, `selected` on the first menu item / tab, `invalid` on the first text field (each awaited through `updateComplete`); every step equals the full page |
| `removeServerStyles` | `?removeStyles=1` on full and trimmed pages: no `<style>` left in sp-* shadow roots, paint equals the full page |
| `size` | `/styles.json`: trimmed smaller than full; `report.styles` consistent |
| `late definition: <tag>` (tests/styles-late.spec.ts) | `?late=<tag>` holds a definition back until after `hydrateSpectrum()`: `sp-theme` (button, theme), `sp-tab` (tabs), `sp-menu-item` (menu), `sp-table-cell` (table); trimmed and minified equal full while it is missing and after it arrived; then no marked `<style>` left, every hydrated Lit element on adopted sheets |
| `app --mod-* override` (tests/styles-late.spec.ts) | an application stylesheet sets `--mod-actionbutton-*` on `sp-action-button`: without the client and hydrated, trimmed and minified equal full |
| `without constructable stylesheets` (tests/styles-late.spec.ts) | only the client's feature test fails (Lit and `<sp-theme>` keep adopting): held and hydrated button / tabs pages, trimmed and minified equal full |

A negative control (restoration and bridge disabled) fails `post-hydration` exactly like the report (minified button
section 98,653 px, its height 541 -> 470 px; trimmed tabs 2,155 px after hydration) and `post-hydration:states` in
every step. The tests of tests/styles-late.spec.ts fail on the 0.2.0 sources: late `sp-theme` 98,215 px (button) /
255,805 px (theme) in trimmed and minified mode, late `sp-tab` 31,472 px, `sp-menu-item` 26,522 px, `sp-table-cell`
111,874 px (minified), the `--mod-*` override 37,248 px (minified, without the client), the held minified page without
constructable stylesheets 98,653 px (button) / 29,068 px (tabs).

### Review fixes (0.2.1)

* **Pending themes (H1).** See "Theme bridge" and "Minified elements" above. Probe: `.probe/review-styles/deep2.ts`
  with `EXTRA=late=sp-theme` (the demo's `?late=`, `AFTER='window.__swcSsrDefineLate()'`): 0 differing elements of
  52 (theme) / 143 (button) before and after the definition, trimmed and minified (0.2.0: 51 of 52 measured here, 142 of
  143 on the button page in the review).
* **Cross-element names (M1).** Server: the ownership rule of step 6 removes the dependency (a restored parent
  defines, in its complete sheets, the original name its unhydrated children read - also for states it enters later).
  Client: kept minified `<style>`s are the second line, for what the rule cannot see (inheritance between nested
  instances of one class, or of classes sharing a sheet; output of a 0.2.0 server). Probe as above with `late=sp-tab` / `sp-menu-item` / `sp-table-cell`:
  0 differing elements (0.2.0: 124 / 155 / 131 in minified mode).
* **Public names (M2).** `PUBLIC_CUSTOM_PROPERTY_PREFIXES`; `.probe/review-styles/mod-override.ts`: minified without
  the client now shows the app's `rgb(255, 0, 0)` (0.2.0: `rgb(253, 253, 253)`).
* **Strings (L1)**: `collapseVars` finds `var(` with `nextVarCall` (the parser's string / comment / `url()` skipping).
  **Single-string options (L2)**: `listOption` in collector.ts. **Cost on full pages (L3)**: `differsFromClass`
  (lengths, then the text once per class, `textLength` reads the text nodes' `length` without building the string)
  and `serverStyleElements` indexing the live `childNodes` instead of `Array.from()`; `.probe/review-styles/client-cost-prof.ts`
  (CDP CPU profile of the catalog in `full` mode, 6 loads before and after): `settleServerStyles` 19.8-32.9 -> 7.0-14.1 ms,
  the text comparison 7.9-17.0 -> 2.8-6.2 ms, the scan at load 9.5-27.5 -> 6.2-10.4 ms; minified pages unchanged within
  noise.
  The fallback is kept on pages without marked `<style>`s (instead of being skipped there): it is what moves a `full`
  page whose client bundle was rewritten by a build-time renamer onto consistent (client) names after hydration.
  **Bridge without constructable stylesheets (L4)**: the install condition no longer asks.
* **Docs (L5)**: docs/API.md "What trimming can break" (attributes set in `connectedCallback()`, build-time renamers).

## Coding conventions

Never define per-instance accessors (`get` / `set`) whose functions are closures over render state: V8 keeps accessor
functions in shared hidden classes, so they outlive the instance and pin the render. Use shared accessor functions
plus a `WeakMap` (as `realm.ts` event links and `adapters/overlay.ts` `keepClosed` do).

TypeScript strict, ESM, Node >= 20. No build step for the server (run with `tsx`); client via esbuild. Keep every Spectrum-specific
behaviour in `packages/swc-ssr/src/server/adapters/*.ts` (one file per tag or family) registered in a map, so the generic
renderer stays library-agnostic. Log with a `debug` flag only. Every workaround gets a comment naming the Spectrum source
file/mixin that needs it (e.g. `shared/src/observe-slot-presence.js`).
