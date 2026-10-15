# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Until 1.0.0 a minor version may contain breaking changes.

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
- Adapter registry (`registerAdapter`) with built-in adapters for `sp-theme`, `sp-overlay`, `sp-picker`, `sp-breadcrumbs`,
  `sp-split-view` and `sp-color-wheel`, and a language inspector that warns when a locale falls back to
  `navigator.language`.
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
