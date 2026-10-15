# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Until 1.0.0 a minor version may contain breaking changes.

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
