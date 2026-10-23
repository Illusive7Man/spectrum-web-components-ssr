# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Until 1.0.0 a minor version may contain breaking changes.

## [0.3.3] - 2026-10-23

### Changed

- Documentation: the install notes no longer claim that npm leaves peer dependencies to you (npm 7 and newer install
  them; the pinned versions are the tested ones), and the Firefox note for `dedupe: 'link'` carries the Firefox 158
  measurement: unstyled frames on cold loads and when the sheets come from the disk cache (new tab, new session),
  none on a same-tab reload (docs/DESIGN.md "Style de-duplication").
- Documentation: the README is rewritten around the simplest examples first (server render, browser hydration, an Express
  page), without version history; CSS trimming, linked stylesheets and short custom-property names moved to the end
  as optional steps.
- Documentation, Angular SSR: `@lit-labs/ssr-dom-shim` is external in the development configuration only (the production
  build bundles it; the deployed output has no `node_modules`), plus the `tsconfig` settings the server entries need.

## [0.3.1] - 2026-10-20

### Added

- Selectable `sp-table` elements now include their imperatively created head/row checkbox cells in the server HTML,
  with full declarative shadow roots, selection state, labels and trimmed/deduplicated styles. Spectrum's own
  `manageCheckboxes()` runs on the server; the adapter records the `TableCheckboxCell` instances it creates and renders
  them with their properties, so no table logic is duplicated. The client hydration adapter adopts those cells instead
  of creating duplicates. Server adapters can support similar component-owned light DOM with `handlesMutation()` and
  `lightDomInsertions()` (`LightDomInsertion`, `position: 'afterbegin'`); the supplemental render lives in
  `server/light-dom-insertions.ts`. This turns the table's former flicker red into a green row of the matrix.

## [0.3.0] - unreleased

Render speed, fewer bytes (details: `docs/DESIGN.md` "Performance" and "Style de-duplication", `docs/API.md` "Styles").

### Added

- `StyleOptions.dedupe: 'link'` (opt-in, any mode, default `'none'`): every distinct stylesheet text is stored once in
  the process-wide `styleSheetStore` (LRU, 32 MiB) under a content hash, and every shadow root gets `<link
  rel="stylesheet" href="/swc-css/<hash>.css" data-swc-styles="trimmed|minified|complete">` in the sheet's place instead
  of a `<style>` copy. `StyleOptions.dedupeUrl(hash, css)` chooses the URLs. Minified theme sheets, sheets under 160
  bytes and sheets with relative `url()` / `@import` stay inline. Trimmed button page: 846.6 KiB of HTML -> 28.4 KiB
  plus 77.0 KiB in 12 cacheable sheets (brotli: 12.0 KiB -> 3.0 + 12.1 KiB, a repeat visit 3.0 KiB); trimmed catalog
  13633 -> 1170 KiB plus 823 KiB in 122 sheets (brotli 180 -> 62 + 139 KiB). Off by default: Chromium waits for a shadow
  root's pending stylesheet link and never paints unstyled content (a cold load renders progressively and finishes later),
  Firefox paints the content first (2-9 unstyled frames even from a warm cache).
- `RenderSpectrumResult.head`: with `dedupe: 'link'` one `<link rel="preload" as="style">` per linked URL, for the
  page's `<head>` ('' otherwise; `renderSpectrum` of `swc-ssr/server` always sets it). `StylesReport.dedupe`
  (`StylesDedupeReport`: the linked texts with hash, url, bytes and links; `linkedBytes`, `inlineBytes`),
  `StylesReport.sheets[].hash`, `StyleMarker` `'complete'`.
- Exports: `styleSheetStore`, `StyleSheetStore`, `getStyleSheet(hash)`, `styleSheetHash(css)`,
  `styleHeadOf(report.styles, 'preload' | 'stylesheet-not-all')`, `DEFAULT_STYLE_SHEET_PATH`, `STYLE_SHEET_HASH_RE`;
  types `StyleHeadHint`, `StylesDedupeReport`.
- `swc-ssr/client` treats a server `<link data-swc-styles>` like a marked `<style>` (restored, removed, minified ones
  kept until settled; never bridged; `'complete'` does not trigger the theme-pending warning); without constructable
  stylesheets a `<style>` with the complete text takes its place.
- Demo: compression (brotli q4 preferred over gzip, nothing under 1 KB; `/dist` from build-time `.br` / `.gz`, chunks
  `immutable`), a code-split minified client (a 1.2 KB bootstrap, one ordered registration chunk per catalog entry),
  `?dedupe=none|link`, `?hints=preload|not-all|none`, `GET /swc-css/<hash>.css`, `/styles.json` `dedupe`.
- Tests: `tests/styles-dedupe.spec.ts` (linked pages equal full at 0 px without JavaScript, hydrated, held and after
  state changes; 0 unstyled frames in Chromium), `tests/server.spec.ts` (compression, precompressed `/dist`, `?dedupe=`
  routes, the split build), unit tests `styles-dedupe.test.ts` (16), `perf-scaling.test.ts` (2N copies of a fragment
  render in under 2.6x the time of N; 0.2.2 fails the light-mutation-heavy fragment at 3.43), `perf-finalize.test.ts`,
  two `ServerTree` tests. 178 unit tests (187 with the review fixes below).

### Changed

- Render speed, same output: the whole catalog (1349 elements, 3 passes) renders in 1.9 s instead of 3.8 s (`full`;
  2.0x, 1.4 ms per element on a 15 W laptop; trimmed / minified 2.2 s instead of 2.5-2.6 s), one-component pages
  1.3-1.4x faster (button 30 -> 21 ms); the HTML and reports of every catalog page, the catalog and dialog + slider are
  identical to 0.2.2 in `full`, `trimmed` and `minified` mode apart from generated ids (below); heap flat at 111-114 MB.
  Light-DOM attribute changes are located in the `ServerTree` the renderer built anyway to verify the final pass's
  adoptions (now with source locations) and applied in one copy of the page (0.2.x copied the whole page once per
  change: 21-34 % of a catalog render); in `full` mode the changes, the marker removal and the raw regions are finished
  in one pass. Structure backings are shared-method objects instead of 4-5 closures per node, plain facades get their
  backing at construction, two `WeakMap` entries per facade are gone, compiled css-select queries are cached per
  selector, static-attribute canonicalization and hashes are cached, `verifyAdoptions` counts signatures once per group,
  `collect()` joins once and enters the render context once per synchronous stretch, and the catalog needs 3 parses per
  render instead of 4.
- Generated ids: the deterministic source of pass 2 and later is seeded with the FNV-1a hash of the previous pass's
  parsed text (long `<style>` bodies replaced by placeholders) instead of the whole HTML (about 60 ms per catalog
  render). `randomID()` suffixes of a page differ from 0.2.x; they are still the same in every render of that page, and
  the structure and references are unchanged.
- `ServerText(data, backing?)` (dom-shim) takes an optional structure backing; `nodeList()`'s `item` is one shared
  function that uses `this` (`list.item(i)` is unchanged; a detached `item` reference throws).
- Tests: the held (`interim`) captures of the pixel oracles are repainted once before the capture, like every later
  capture (with the code-split demo bundle the theme upgrades after the first paint, and the minified theme page then
  showed 1 px of raster noise; computed styles and geometry identical, 0 px repainted).

### Fixed (review of the 0.3.0 changes)

- Stale selector results (regression of the compiled-selector cache): css-select's default `cacheResults: true` keeps
  a set of non-matching ancestors inside every compiled descendant combinator (and per `:has` / `:contains`), and the
  compiled selectors now live for the whole process, so `querySelector` / `querySelectorAll` / `matches` / `closest`
  missed an ancestor whose attributes changed after the same selector ran (`div.querySelector('.on span')` stayed `null`
  after `p.setAttribute('class', 'on')`; a component that queried after its sibling marked an ancestor rendered
  `none` where the browser renders `found`). Compiled with `cacheResults: false`; the cache of compiled selectors
  stays (catalog render 1190 ms vs 1207 ms with the stale caches, 0.2.1 2550 ms: still 2.1x), output identical to
  0.2.2 (372 of 372 files).
- `finalizeHtml` scanned for the next `data-swc-ssr` marker from every raw-region boundary to the end of the page when
  no marker followed: quadratic in the number of raw regions (5,000 regions 775-3124 ms, 20,000 regions 15 s; 0.2.1
  5-36 ms). The scan result is kept across regions (each character scanned once; 20,000 regions 32 ms), and the check
  of every edit against the regions is a binary search.
- `swc-ssr/client`: `sp-color-area` handles stayed in the top-left corner after hydration whenever a frame passed
  between the element's definition and its hydrating update (the catalog page with the code-split demo bundle: 11 of
  14 loads; any page with `?hydrateDelay=300`, also with the 0.2.x single bundle). Its own `connectedCallback()` starts
  a ResizeObserver at the upgrade, while the element still waits with `defer-hydration`; measured before hydration,
  the hydrating render differed from the server markup only in the handle's `style`, which lit's `hydrate()` primes
  without writing. A new built-in hydration adapter (elements with `getContentBoundingRect()` / `cacheLayoutData()`:
  `sp-color-area`, `sp-color-wheel` and subclasses) hides the measurement for the hydrating render and requests one
  more update right after it, which writes the measured layout at once (no unmeasured frame after hydration either).
- `StyleOptions.dedupeUrl` throwing for one text aborted the style resolution and the page fell back to the complete,
  untrimmed stylesheets (11.5 MB on the catalog). Now that text stays inline (trimmed), the others are linked, and the
  render reports `StyleOptions.dedupeUrl threw for stylesheet <hash> ...` (a `#render` warning).
- `styleSheetStore` could evict a text a page had just linked before the browser fetched it (a 404, unstyled until
  hydration). Texts are protected for `minLifetimeMs` (default 60 s, `DEFAULT_STORE_MIN_LIFETIME_MS`) after a render last
  put them; above twice the budget the oldest go anyway. `new StyleSheetStore({maxBytes, minLifetimeMs, now})`,
  counters `evictions` / `freshEvictions`; type `StyleSheetStoreOptions`.
- `hasRelativeUrl` missed quoted relative URLs in `image-set()` / `-webkit-image-set()` / `src()`: such a sheet now
  stays inline (strings at the function's own level that are not absolute or `#fragment`; `type("image/avif")` does
  not count).
- Demo: `/swc-css/<hash>.css` was compressed per request behind the `compression` middleware, and HEAD with
  `Accept-Encoding: br` reported the identity `Content-Length` and no `Content-Encoding` while the GET was brotli; a 304
  had no `Vary`. The route is mounted before the middleware, compresses each text once (brotli q4, gzip) and sets
  `Content-Encoding` / `Content-Length` / per-representation `ETag` / `Vary` for GET, HEAD and 304.
- Tests: `select-cache.test.ts` (3), a many-regions ratio case in `perf-finalize.test.ts`, three measured-layout cases
  in `client-hooks.test.ts`, the store protection and a throwing `dedupeUrl` in `styles-dedupe.test.ts` (18); e2e
  `post-hydration:layout` in `tests/styles.spec.ts` (`/` and the color-area entry: every `sp-color-handle` where
  client-side rendering puts it, 0 px, at hydration and settled, full / trimmed / minified, 3 loads each) and HEAD /
  304 per coding for `/swc-css/` in `tests/server.spec.ts`. 187 unit tests.

## [0.2.2] - unreleased

Last review findings of the style trimming (details: `docs/API.md` "Styles", `docs/DESIGN.md` "Style trimming").

### Fixed

- `minifyCustomProperties` judged ownership from the trimmed texts only, but `swc-ssr/client` restores the complete
  stylesheets: names a parent defines and only a rule the trimmer dropped from a child's sheet reads were still renamed
  (`sp-menu` / `sp-menu-group` -> `sp-menu-item` / `sp-menu-divider`, `sp-table` -> its head cells and rows,
  `sp-breadcrumbs` -> `sp-breadcrumb-item`, `sp-search` -> the textfield family; 42 names on the catalog with
  `undefinedPrefixes: ['--mod-']`). With the parent defined late, a restored child lost those values (minified menu
  page, `?late=sp-menu`: a disabled menu-item icon was rgb(0, 0, 0) instead of rgb(177, 177, 177)). The minifier now
  also scans the complete stylesheets of every element class on the page: a name another class's complete sheet
  mentions stays long, and a theme name an element class's complete sheet defines is no longer renamed as
  theme-owned.

### Added

- `HydrationReport.warnings`: `theme pending: sp-theme not defined; trimmed/minified theme values incomplete (...)`
  when `hydrateSpectrum()` ends while an `<sp-theme>` whose server CSS was trimmed or minified has not upgraded
  (`sp-theme` defined late, or never). Such a theme provides only the theme properties the server kept, under the
  names it chose: content created on the client (an `sp-table`'s checkbox cells, a pending button's progress circle,
  overlays) and states entered later lack theme values until `sp-theme` is defined.
- Tests: late parents (`?late=sp-menu` on menu, `sp-breadcrumbs` on breadcrumbs, `sp-table` on table) with a state
  change on their children while they are missing (an icon and `disabled` / `focused` on menu items, `disabled` on a
  breadcrumb item, `active` / `drop-target` on a table head cell / row): trimmed and minified equal full before and
  after the definition (0 px; 0.2.1 failed in the state view: 117 / 232 / 20,613 px). `?late=sp-theme` on the table
  page: the theme-pending warning is reported and the page equals full after the definition. A catalog unit test
  checks every renamed name against the complete stylesheets of the page's element classes.

### Changed

- Minified output is slightly larger: whole catalog 8224 -> 8305 KiB = 45.4 -> 45.8 % of full (with
  `undefinedPrefixes: ['--mod-']` 6864 -> 6945 KiB = 37.9 -> 38.3 %; gzip 640 -> 643 KiB), picker page 330 -> 346 KiB
  (gzip 43 -> 45 KiB), menu 142 -> 146 KiB, table 142 -> 144 KiB, breadcrumbs 204 -> 208 KiB; button and search
  pages unchanged. Trimmed output is unchanged.
- Tests: a narrowed Playwright run (`SWC_SSR_COMPONENTS` / `SWC_SSR_SMOKE`) writes `tests/results/summary.partial.md`
  (never `summary.md`) from a raw file of its own (`tests/results/raw.partial-<time>-<pid>.jsonl`), so concurrent
  narrowed runs do not mix their records; complete runs keep `raw.jsonl` / `summary.md`. The late-definition cases
  of one catalog entry run in one test (one `styles-late` record per entry).

## [0.2.1] - unreleased

Fixes of the review of the style trimming (details: `docs/API.md` "Styles", `docs/DESIGN.md` "Style trimming").

### Fixed

- Trimmed and minified pages lost their theme when `sp-theme` was defined after the components hydrated, or never on
  the client: the theme bridge removed the server `<style>` of themes that had not upgraded (measured on the theme
  catalog entry: 51 of 52 elements styled differently). The bridge now leaves a theme that has not upgraded alone; a
  minified element keeps its minified CSS while such a theme is pending (its server `<style>` defines the short names
  only) and gets its complete stylesheets when `sp-theme` is defined.
- Minified pages: an element defined or hydrated after its parent was restored read custom properties that nothing
  defined any more (`sp-tabs` -> `sp-tab`, `sp-table` -> rows and cells, `sp-menu-group` -> `sp-menu-item`,
  `sp-picker` -> `sp-popover`, `sp-number-field` -> `sp-infield-button`, `sp-tray` -> `sp-dialog-wrapper`; 124-155
  elements styled differently while the child was undefined, for good if it never got defined). Both sides changed:
  `minifyCustomProperties` renames only names that the theme alone defines or that live inside the stylesheets of one
  element class (or one stylesheet several classes share), and `swc-ssr/client` keeps a restored element's minified
  `<style>` (a subset of its adopted sheets, which win the cascade) until no element runs on minified CSS.
- `minifyCustomProperties` never renames Spectrum's public customisation names `--mod-*`, `--highcontrast-*` and
  `--system-*` any more: kept component rules define many of them (253 `--mod-*` names on the catalog), and renaming
  them cut application overrides (`sp-action-button { --mod-actionbutton-background-color-default: red }`) off before
  hydration, and for good without JavaScript.
- `undefinedPrefixes` no longer rewrites `var(` inside strings and comments (`content: "var(--mod-x, y)"`).
- `references`, `undefinedPrefixes` and `keep` given as a single string (or RegExp) count as one entry: a bare
  `references: '--spectrum-*'` was iterated per character, and its `'*'` became an empty prefix that matched every
  name (theme pruning off).
- The theme bridge no longer depends on constructable-stylesheet support: it is a plain `<style>`, and the client's
  path for browsers without constructable stylesheets needs it as much.

### Changed

- Minified output is larger because of the names above: button page CSS 298 -> 454 KiB (gzip 13 -> 15 KiB), picker
  231 -> 330 KiB (gzip 24 -> 43 KiB), whole catalog 5689 -> 8224 KiB = 31.4 -> 45.4 % of full (gzip 486 -> 640 KiB).
  Trimmed output is unchanged.
- `swc-ssr/client` costs less on pages without trimmed CSS: the fallback for unmarked server CSS compares lengths
  first and the text once per class, and the server `<style>` lookup no longer copies `childNodes` (whole catalog,
  `full` mode, CPU profile, 6 loads each: 20-33 ms -> 7-14 ms of server-style work while hydrating, 10-28 ms -> 6-10 ms
  for the scan at load).
- `StyleOptions.references` is typed `readonly string[] | Iterable<string>`, `undefinedPrefixes` `readonly string[]`,
  `keep` `ReadonlyArray<string | RegExp>`.
- Documentation: attributes a component sets in `connectedCallback()` have no trimmed rules until hydration (use
  `keep`); a build-time custom-property renamer must process the SSR server bundle too, or be disabled while swc-ssr
  renders (else `full` pages go unstyled at hydration).

### Added

- Demo: `?late=<tag>[,...]` holds `customElements.define()` of these tags back until `window.__swcSsrDefineLate()`.
- Tests: `tests/styles-late.spec.ts` (definitions that arrive after hydration or never - `sp-theme`, `sp-tab`,
  `sp-menu-item`, `sp-table-cell` -, an application stylesheet setting `--mod-*` hooks, and the client's path without
  constructable stylesheets; pixel-exact against the full CSS), unit tests for the minifier's name rules, strings in
  `undefinedPrefixes`, single-string options and the cost of the unmarked-CSS fallback.

## [0.2.0] - unreleased

Optional trimming of the server CSS, and the hydration semantics it needs (details: `docs/API.md` "Styles",
`docs/DESIGN.md` "Style trimming").

### Added

- `RenderSpectrumOptions.styles` (`StyleOptions`): `mode: 'trimmed'` keeps, per stylesheet, the rules whose selectors
  can match the rendered DOM of its instances on the page (state and unknown pseudo-classes count as matching) plus the
  at-rules they need; `trimTheme` (default true) prunes theme custom properties nothing on the page uses (transitively
  through `var()` chains); `references` keeps the names the application's own CSS uses; `undefinedPrefixes` collapses
  `var(--prefix-x, V)` to `V`; `minifyCustomProperties` renames the remaining custom properties to short names; `keep`
  forces rules. Default `mode: 'full'`: the output is byte-identical to 0.1.x. Measured: button page 1.22 MB -> 0.83 MB
  (0.31 MB minified), whole catalog 18.66 MB -> 13.31 MB (6.55 MB minified); trimming takes 9-23 ms per one-component
  page and about half a second on the 59-component catalog.
- `RenderReport.styles` (`StylesReport`, trimmed mode): every stylesheet with its instances, full and trimmed sizes, and
  the time spent trimming.
- `scanCustomPropertyReferences(text)`: every `var(--x)` name of a CSS or JavaScript text, for `references`.
- `STYLE_MARKER_ATTRIBUTE` (`data-swc-styles`) and `StyleMarker`: every `<style>` the trimmer changed carries
  `data-swc-styles="trimmed"` or `"minified"`.
- `HydrateSpectrumOptions.removeServerStyles` (default false): frees the complete server `<style>` elements of `full`
  pages once the elements adopted their stylesheets.
- Demo: `?styles=full|trimmed|minified` and `?refs=` on every SSR route, `report.styles` in `/report.json`,
  `GET /styles.json`, client options `?removeStyles=1` and `?hydrateDelay=<ms>|hold`.
- Tests: `tests/styles.spec.ts`, a pixel-exact oracle (threshold 0) of trimmed and minified CSS against full CSS for
  every catalog entry and the whole-catalog page: without JavaScript, hover / focus, flicker, late hydration,
  post-hydration, state changes after hydration, `removeServerStyles`, sizes; a "Styles" section in
  `tests/results/summary.md`.

### Fixed

- Hydrated pages no longer lose their styling with trimmed / minified server CSS (reported: "hydration broke / ignored
  all styling"). Lit's hydration support keeps a hydrated element's server `<style>` as its only stylesheet, and
  `<sp-theme>` replaces its server `<style>` with the complete theme when it upgrades, so minified components lost
  every theme value and trimmed components had no rules for later states. `swc-ssr/client` now gives every hydrated
  element its class's complete `elementStyles` (shared constructable sheets) in the same task as its hydrating update,
  and keeps the server's `<sp-theme>` `<style>` until the last marked `<style>` is gone.
- `hydrateSpectrum()` called more than a frame after the definitions loaded no longer waits out its timeouts on pages
  with menus: a hydration adapter breaks the `Menu.updateCache()` / `getUpdateComplete()` cycle of `sp-menu`,
  `sp-picker`, `sp-action-menu` and `sp-combobox` (whole catalog hydrated late: about 0.6 s instead of 6 s and a
  `did not settle` warning).

### Changed

- New runtime dependency `css-what` (the selector parser `css-select` already uses).

## [0.1.2] - unreleased

Fixes of a third review (details: `docs/DESIGN.md`, "Hardening" / "Third review").

### Fixed

- Light-DOM attribute changes (e.g. the ids components give slotted headings for `aria-labelledby`) are applied
  again when several same-signature elements of a scope changed their content between the passes and the scope kept
  its structure; 0.1.1 dropped them with a warning, leaving dangling references (regression of 0.1.1).
- `lazyDefinitionWaitMs: Infinity` (or >= 2^31 ms) no longer makes every render wait until `timeoutMs` and reject
  when a tag is never defined on the server: the wait is bounded by the render's deadline, pass 1 is kept as fallback
  output, and tags still undefined when a wait ends (for any reason) are never waited for again (regression of 0.1.1).
- Elements of the same kind told apart only by bound attributes / properties no longer silently take over each
  other's instance when one is rendered before the other in a later pass: adoptions are also verified against the
  values upstream set (`adopted candidate rejected: upstream attributes / properties differ`, one more pass).
- An element whose light DOM changed between the passes while a sibling has its old content no longer gets a spurious
  `adopted candidate rejected` warning and a third pass.
- `LitElementRenderer.renderOptions` of `disableSsr` elements are evaluated once per pass (were three times over two
  passes): the decision made on the discarded pre-built instance is reused.

### Changed

- `lazyDefinitionWaitMs: Infinity` means "up to the render's deadline" (that render returns its pass-1 output with a
  warning); in a render without a deadline it means the default 250 ms.

## [0.1.1] - unreleased

Fixes of a second independent review (details: `docs/DESIGN.md`, "Hardening" / "Second review").

### Fixed

- Work a finished render leaves behind no longer reaches the next render: animation frames, `document` listeners,
  unsupported-selector logs and dropped DOM changes are filed under the render of the caller's `AsyncLocalStorage`
  scope instead of the most recent active render. A finished render's frames are dropped and its late `document`
  listeners removed at once; frame callbacks run in the scope of the code that requested them.
- Unhandled rejections after a render ended are no longer swallowed: those of the render's own scope (templates,
  directives, custom renderers, long-lived resources first created during the render) get Node's behaviour; those of
  an element's hooks emit a `SWC_SSR_LATE_REJECTION` process warning. Element constructors run in the element's scope.
- An element with the same tag and static attributes rendered before an existing one in a later pass no longer takes
  over that element's instance and state: adoptions are verified against each pass's output (light-DOM signature);
  a wrong one is reported (`adopted candidate rejected: light DOM differs`) and corrected by another pass.
- `LitElementRenderer.renderOptions` are evaluated once per element and pass, before it is connected: the renderer
  reuses the decision made for a pre-instantiated element instead of asking again after its first update.
- Non-Lit custom elements (e.g. `sp-tooltip-openable` in `sp-tooltip`) no longer leave their host on Lit SSR's host
  stack: elements after an `<sp-tooltip>` lose a spurious `defer-hydration`, `<!--lit-node-->` marker and `__host`.
- `timeoutMs` / `lazyDefinitionWaitMs` of 2^31 ms or more no longer overflow to 1 ms: they mean "no timer".
- Whole-document templates with `<html lang>` and no `lang` option render in that language (from pass 2 on).
- Light-DOM attribute changes in shadow scopes compare the element's content too; with several same-signature
  elements and no unique content match the change is reported instead of applied to the wrong element.
- The client `MatchMediaController` adapter applies to every hydrating element that has controllers, so subclasses
  registered under other tags are pinned too.
- Demo: `HEAD /dist/*` carries the file's `Content-Type` (static handler).

### Changed

- Peer dependency `@lit-labs/ssr` narrowed to `~4.1.0`: the renderers rely on 4.1.0 internals (the element-part marker
  passed as a static attribute, the host-stack behaviour, `lib/render.js` `renderThunked`). `package-lock.json`
  refreshed.
- `setListenerLog` (`swc-ssr/dom-shim`) accepts any `{push(record)}` log (`ListenerLog`); arrays still work. The
  shim logs a `document` listener after adding it.

### Documented

- Deterministic ids: any plain `Uint8Array(4)` `getRandomValues` request made synchronously during a render gets
  deterministic bytes, not only Spectrum's `randomID()`; how to turn it off (`deterministicIds: false`).

## [0.1.0] - unreleased

First version. Targets `@spectrum-web-components/*` 1.12.4 (1st-gen) and `@lit-labs/ssr` 4.1.0.

### Added

- `swc-ssr/server`: `renderSpectrum()`, a two-pass renderer on top of unmodified `@lit-labs/ssr` that gives Spectrum
  elements their light DOM, slots and shadow content on the server, with options `deferHydration`, `lang`, `lifecycle`,
  `lifecycleByTag`, `isManagedClass`, `elementRenderers`, `timeoutMs`, `lazyDefinitionWaitMs`, `deterministicIds` and
  `debug`, and a per-render report (errors, warnings, fallbacks, passes).
- Adapter registry (`registerAdapter`) with built-in adapters for `sp-theme`, `sp-overlay`, `sp-picker`,
  `sp-breadcrumbs`, `sp-split-view` and `sp-color-wheel`, and a language inspector that warns when a locale falls back
  to `navigator.language`.
- `swc-ssr/dom-shim`: the DOM globals Spectrum needs under Node on top of `@lit-labs/ssr-dom-shim`, including
  browser-like attribute reactions, constraint validation, the Popover API, listener `this`-binding and a
  `crypto.getRandomValues` wrapper that is deterministic only for Spectrum's `randomID()` requests
  (`configureRandomSource`).
- `swc-ssr/client`: `hydrateSpectrum()` with a Lit-template path and a framework-agnostic path, `hydrationReport()`,
  `registerHydrationAdapter()`, emulation of the initial `slotchange`, recovery from hydration mismatches and a
  `matchMedia` adapter for phones.
- Packaging: `tsconfig.build.json`, an `exports` map for `./server`, `./client` and `./dom-shim`, the publish manifest
  switch `scripts/prepare-publish.mjs` and the pack-and-consume check `scripts/verify-package.mjs` (repository root).
- Support matrix: 55 of 59 catalog entries fully green (SSR markup, hydration, flicker, fidelity against a client
  render, interaction), the whole-catalog page, the framework-agnostic path, a localized page and three phone checks.

### Known limitations

- picker, breadcrumbs (roving `tabindex`), swatch (`focusable` attribute) and table (runtime checkbox cells) differ from
  a client render after hydration.
- The shim's globals are process-wide and permanent; renders are serialized.
- Layout-dependent state is approximated on the server; phones hydrate the desktop state and then re-render.
- Tested in Chromium only.
