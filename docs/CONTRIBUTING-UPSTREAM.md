# Proposing swc-ssr upstream

How this project could be proposed to Adobe (Spectrum Web Components) and to Lit, in what order, and what has to change
for each. Everything about the upstream repositories was read from their `main` branches on 2026-10-15 (sources are
listed at the end); items I could not confirm are marked **unverified**.

## 1. Where does it belong?

| Home | What goes there | Status |
|---|---|---|
| **Standalone package** (this repository, published to npm) | Everything: the renderer, the adapters, the client hooks, the DOM shim extras. | Works today, needs nobody's approval. **Recommended default.** |
| **adobe/spectrum-web-components** | The whole package, as a 1st-gen tool package (`1st-gen/tools/ssr`, published as `@spectrum-web-components/ssr`). | Needs a maintainer decision first, see the policy problem below. |
| **lit/lit** (`@lit-labs/ssr-dom-shim`) | Only the generic DOM-shim pieces (section 6). | Possible, independent of Adobe, small. |
| `@lit-labs/ssr` itself | Nothing. The package uses `@lit-labs/ssr` 4.1.0 unmodified through `elementRenderers`, `renderOptions` and the shim globals. The two-pass renderer and all Spectrum knowledge stay a plugin. | n/a |

So: it is **not** part of Lit Labs and it is **not** part of Spectrum Web Components today. It is a standalone project that
extends `@lit-labs/ssr` and targets Spectrum Web Components; pieces of it could move to either of them if their
maintainers want that.

### The policy problem with `1st-gen/tools/ssr`

The earlier plan (`docs/DESIGN.md`: "e.g. as `1st-gen/tools/ssr`") assumed 1st-gen takes new packages. Their current
rules say otherwise:

* `1st-gen/AGENTS.md`: 1st-gen is being migrated to gen2 and will be deprecated afterwards; it takes bug fixes and
  migration work only, no new features. Changes that belong in both generations go to `gen2/packages/core/`.
* `CONTRIBUTOR-DOCS/01_contributor-guides/12_tools-vs-packages.md`: gen2 does not get new top-level `tools` packages in
  the 1st-gen style (UI-less code goes to `gen2/packages/core/`).
* The two generations are independent (no runtime dependency between them), so a gen2 home cannot host code that
  targets 1st-gen components.

A new `1st-gen/tools/ssr` package is a new feature in a frozen generation. A maintainer can grant an exception, but
a PR that arrives without that agreement is likely to be closed. That is why the sequence in section 3 starts with a
question, and why standalone publication is the default outcome rather than the fallback.

What the policy does allow: **bug fixes** to 1st-gen. Section 4 lists small upstream fixes that would make components
less SSR-hostile and fit that rule on their own.

## 2. Upstream conventions that apply (adobe/spectrum-web-components)

| Topic | Convention |
|---|---|
| Workspace | Yarn 4.9.2 workspaces (`packageManager: yarn@4.9.2`); root workspaces `1st-gen`, `1st-gen/packages/*`, `1st-gen/projects/*`, `1st-gen/tools/*`, `gen2`, `gen2/packages/*`, `linters/*`. Root `engines`: Node `>=24.11.1`, Yarn `>=4.6.0` (the contributor guide still says Node 20.10 or newer). |
| Setup | `yarn install`; `yarn build` (`yarn build:1st-gen` for one generation); husky is installed by `postinstall`. |
| Commits | Conventional commits enforced by commitlint (`@commitlint/config-conventional`) in the `commit-msg` hook; format `type(scope?): subject`, subject starts lowercase, `!` for breaking changes. Example: `feat(ssr): add server renderer`. |
| Branches | `<username>/<type>-<description>[-swc-<issue>]`, lowercase letters, digits and dashes. |
| Changesets | `yarn changeset:1st-gen` (files in `1st-gen/.changeset/`). Frontmatter names the package and bump (`patch`/`minor`/`major`); body: backticked name, an em dash, a past-tense consumer-facing sentence; `Consumer action:` only if consumers must change something. `@changesets/changelog-github` adds the PR link at release. |
| Tests | 1st-gen tests run in the browser with web-test-runner (`@web/test-runner`; `yarn test:1st-gen`). Accessibility tests use Playwright (`yarn test:a11y:1st`, `playwright.a11y.config.ts`). A fix or feature PR must include tests. |
| Lint and format | `yarn lint` runs ESLint, Stylelint, Prettier and `lint:ai`. Run it before pushing; formatting follows their Prettier config, so this repository's code will be reformatted on port. |
| AI tooling | `.ai/` is the source of truth for agent rules; `yarn ai:sync` regenerates copies, `yarn lint:ai` validates them. Not relevant to a package, but the hook runs on every commit. |
| License header | Source files start with an Adobe copyright line and the Apache-2.0 notice (seen in `1st-gen/tools/base/src/Base.ts`). This repository's files have none; a port adds the header the maintainers ask for. |
| CLA | External contributors must sign the Contributor License Agreement before their first change can be merged. Code of conduct: the Adobe Code of Conduct. |
| Proposals | Start with a discussion in GitHub Discussions; after positive feedback, open an issue from the Feature Request (or New Component) template. The guide mentions no RFC process. Discussions are enabled on the repository. |
| PR template | description, related issues (`fixes #...`), type of change in the title, test steps, accessibility checklist (state that this is not an interactive component), screenshots for visual changes. Labels such as `Status: Ready for review`. |
| Docs | Per-package README plus JSDoc on public APIs; public docs live in the docs workspace under `1st-gen/projects/` (**unverified** which one). |

### What a 1st-gen tool package looks like

From `1st-gen/tools/reactive-controllers/package.json` (the shape to copy):

```jsonc
{
  "name": "@spectrum-web-components/ssr",
  "version": "<lockstep with the other 1.x packages, maintainers decide>",
  "description": "Server-side rendering and hydration for Spectrum Web Components",
  "license": "Apache-2.0",
  "author": "Adobe",
  "type": "module",
  "exports": {
    "./server": {"types": "./src/server/index.d.ts", "default": "./src/server/index.js"},
    "./client": {"types": "./src/client/index.d.ts", "default": "./src/client/index.js"},
    "./dom-shim": {"types": "./src/dom-shim/index.d.ts", "default": "./src/dom-shim/index.js"},
    "./package.json": "./package.json"
  },
  "sideEffects": ["./src/dom-shim/*", "./src/client/*", "./src/server/**"],
  "files": ["**/*.d.ts", "**/*.js", "**/*.js.map", "!stories/", "!test/"],
  "scripts": {"test": "echo \"Error: run tests from mono-repo root.\" && exit 1"},
  "dependencies": {"css-select": "...", "domhandler": "...", "parse5": "...", "parse5-htmlparser2-tree-adapter": "...", "@webcomponents/template-shadowroot": "..."},
  "peerDependencies": {"@lit-labs/ssr": "...", "lit": "^3.3.0"},
  "publishConfig": {"access": "public"},
  "repository": {"type": "git", "url": "https://github.com/adobe/spectrum-web-components.git", "directory": "1st-gen/tools/ssr"},
  "bugs": {"url": "https://github.com/adobe/spectrum-web-components/issues"},
  "homepage": "https://opensource.adobe.com/spectrum-web-components/tools/ssr",
  "keywords": ["design-system", "spectrum", "adobe", "adobe-spectrum", "web components", "lit-element", "lit-html", "ssr"]
}
```

Differences that matter:

* Their packages compile `.ts` to `.js` / `.d.ts` / `.js.map` **next to the sources** with their own build (`wireit`,
  `build:ts` and `build:types`) and also emit `.dev.js` variants selected through a `development` export condition. This
  repository emits to `dist/` with plain `tsc`; the port drops `tsconfig.build.json` and `scripts/` and adopts their build.
* Their `dependencies` allow `lit` `^2.5.0 || ^3.1.3`. `@lit-labs/ssr` 4.x needs Lit 3, so this package would declare
  `^3`. Lit and `@lit-labs/*` stay peers (one copy per application is required).
* New runtime dependencies for the monorepo: `css-select`, `domhandler`, `parse5-htmlparser2-tree-adapter`,
  `@webcomponents/template-shadowroot` (`parse5` already arrives through `@lit-labs/ssr`). Maintainers may want fewer.

## 3. Sequence

0. **Prepare the standalone repository first** (nothing upstream depends on it, but every later step links to it):
   fill in `REPLACE_WITH_OWNER` in `packages/swc-ssr/package.json`, run `npm run pkg:verify`, regenerate the matrix
   (`npx playwright test`), push the repository, publish `spectrum-web-components-ssr` (suggested name; it, `swc-ssr`
   and `@spectrum-web-components/ssr` were all unregistered on npm on 2026-10-15; `swc-ssr` is also easily mistaken for
   the Rust compiler SWC, and the `@spectrum-web-components` scope belongs to Adobe). Keep the "not affiliated with
   Adobe" line in the README.
1. **GitHub Discussion** in adobe/spectrum-web-components (their documented first step). Title along the lines of
   "SSR for 1st-gen via @lit-labs/ssr: working plugin and support matrix". Content: the text of
   [ISSUE-DRAFT.md](./ISSUE-DRAFT.md), expanded by two sections: why a plugin and not changes to components, and the
   list of small component fixes in section 4. Ask the one question that decides everything: **would you accept this as
   a tool package in 1st-gen, link to it from the docs, or prefer it stays separate until gen2?**
2. **Comment on [#2675](https://github.com/adobe/spectrum-web-components/issues/2675)** the same day: a short version of
   the draft with the link to the Discussion. The issue is closed (completed, 2025-05-07; tracked in Jira; last
   maintainer comment 2025-08-26: SSR is in the backlog, with Spectrum 2 design fidelity and core infrastructure first), so do not reopen it; the comment notifies the people who
   asked for SSR and the maintainer who closed it.
3. **Wait for an answer** (suggest two to three weeks) and act on it:
   * *Yes, in 1st-gen* -> a Feature Request issue (their template), agree on package name, version policy and test
     location in it, then the port PR (section 5).
   * *Link only / stay separate* -> ask for a pointer in the docs ("community integrations"), keep the package
     standalone, and keep the compatibility matrix per Spectrum release. Done.
   * *Wait for gen2* -> offer the findings (the root-cause list in section 4) as an issue for the gen2 SSR work and
     keep the 1st-gen plugin standalone. Whether the approach transfers to gen2 components is **unverified**.
4. **PR** only after step 3 says yes: branch `<username>/feat-ssr-tool-package-swc-<issue>` (their pattern), conventional
   commits, a `yarn changeset:1st-gen` changeset, the CLA signed beforehand, `yarn lint` and `yarn test:1st-gen` green,
   the PR template filled in. Split it for review: (a) package skeleton + `dom-shim`, (b) `server`, (c) `client`,
   (d) tests, (e) docs. About 8,900 lines of source and 9,100 lines of tests and demo exist today; a single PR of that
   size will not be reviewed.

Independent of all of this, the Lit pieces in section 6 can be proposed any time.

## 4. Small upstream fixes that fit the "bug fixes only" rule

These are workarounds this project carries that a component fix would remove. Each one is **unverified against current
`main`** (written from 1.12.4 as installed here); check before filing.

| Where (1.12.4) | What this project works around | Possible fix |
|---|---|---|
| `base/src/define-element.js` | writes `window.__swc` at import time, which throws under Node without a `window` (the shim defines `window` process-wide for this) | guard with `typeof window !== 'undefined'` |
| `overlay/src/Overlay.js`, `OverlayStack.js` | `"showPopover" in document.createElement("div")` at import time (checked in the installed `.dev.js` files) | feature-detect lazily or guard for non-DOM environments |
| `shared/src/focus-visible.js` | at import, inside a `try`, calls `document.body.querySelector(":focus-visible")`; without a DOM the `catch` branch loads the `focus-visible` polyfill, which reads `Node.DOCUMENT_FRAGMENT_NODE` | skip the probe when `document.body` is missing |
| `overlay/src/Overlay.js` | opening mutates module state (`Overlay.openCount`, `overlayStack`), leaking across renders | none needed if overlays are never opened on the server (the adapter keeps them closed) |
| `reactive-controllers/src/AttributeObserver.js` and similar | listeners registered in module-level maps keep elements alive until `disconnectedCallback` | already fine if hosts disconnect (this project disconnects every element it connects) |

The failures reported in #2675 (`MutationObserver is not defined` in SvelteKit, Next.js, Astro) are import-time errors
of this kind: browser globals read while a module is evaluated. `docs/DESIGN.md` records that 1.12 no longer has the
module-level `MutationObserver` for `dir`, but the three modules above still read `window` / `document` at import, so
guards there would remove the need for a global `window` for part of the surface. They would not remove it entirely.

## 5. Port plan: standalone -> `1st-gen/tools/ssr` (only if maintainers agree)

| Here | Upstream | Notes |
|---|---|---|
| `packages/swc-ssr/src/server/**` | `1st-gen/tools/ssr/src/server/**` | add Adobe license headers, Prettier/ESLint pass |
| `packages/swc-ssr/src/dom-shim/**` | `1st-gen/tools/ssr/src/dom-shim/**` | shrinks as Lit takes pieces (section 6) |
| `packages/swc-ssr/src/client/**`, `src/shared/**` | `1st-gen/tools/ssr/src/client/**`, `src/shared/**` | |
| `packages/swc-ssr/package.json` | `1st-gen/tools/ssr/package.json` | re-shaped as in section 2; drop `build:pkg` scripts and `scripts/` |
| `packages/swc-ssr/README.md`, `CHANGELOG.md` | package README; changelog is generated from changesets | their changelog tooling replaces `CHANGELOG.md` |
| `docs/DESIGN.md`, `docs/API.md` | package README and a docs page | trim to what users need; keep DESIGN.md as the maintainer-facing document |
| `packages/swc-ssr/test/*.test.ts` (Node, `tsx --test`) | `1st-gen/tools/ssr/test/` | **runner question**: web-test-runner is a browser runner and cannot run Node SSR tests. These need a Node test script next to it (`node --test`, wired into `yarn test:1st-gen`) or maintainers' preferred alternative |
| `tests/*.spec.ts`, `tests/helpers/**` (Playwright matrix) | `1st-gen/tools/ssr/test/e2e/` with its own Playwright config | they already use Playwright for a11y; the matrix needs a server, so a small fixture server |
| `demo/` | stays out of the package | the catalog (one showcase per component) is the matrix' input and could become the fixture; the express app itself is a demo |
| `tests/results/summary.md` | not committed upstream; produced in CI | linked from the PR instead |
| `.probe/`, `scripts/`, root `LICENSE` | stay out | |

### How the adapters map to component packages

The adapters live in `src/server/adapters/` (one file per tag) and `src/client/hooks.ts`. In a monorepo each belongs to
one component package, and an end state where the package ships its own SSR adapter would be cleaner than a central tool
package that knows every component's internals. That needs changes in many packages, so it is a second phase, never the
first PR.

| Adapter (tag) | Component package (1st-gen) | Reason |
|---|---|---|
| `sp-theme` (`ThemeRenderer`) | `tools/theme` | emits theme fragments as `<style>` instead of `adoptedStyleSheets`; keeps `Theme.instances` from leaking |
| `sp-overlay` | `packages/overlay` | stays closed; no module state, no document listeners |
| `sp-picker` + client hydration adapter | `packages/picker`, `packages/menu` | selection resolved without the animation-frame chain; client restores server state |
| `sp-breadcrumbs` + client adapter | `packages/breadcrumbs` | overflow decided without layout |
| `sp-split-view` | `packages/split-view` | start position without measured sizes |
| `sp-color-wheel` | `packages/color-wheel` | track geometry from tokens instead of measured size |
| language inspector | `tools/reactive-controllers` (`LanguageResolutionController`) | warns when the locale falls back to `navigator.language` |
| client: `sp-slider`, `sp-checkbox`, `matchMedia` adapter | `packages/slider`, `packages/checkbox`, `packages/picker` / `action-menu` / `contextual-help` | hydration details |

## 6. What belongs to Lit instead

Generic pieces of `packages/swc-ssr/src/dom-shim/` that are not Spectrum-specific and could be offered to
`@lit-labs/ssr-dom-shim` (`packages/labs/ssr-dom-shim` in lit/lit). The shim 1.6.0 exports `Event` and `CustomEvent`
only, and no `Node` global.

| Piece | Why it is generic |
|---|---|
| `Node` global with the `*_NODE` constants (and `Text`, `Comment`, `DocumentFragment`, `NodeFilter`) | libraries read `Node.DOCUMENT_FRAGMENT_NODE` at import time |
| `this` binding of event listeners | DOM calls function listeners with `this` = current target; the shim's `EventTarget` calls them unbound (measured by `installListenerThisBinding()`), which breaks `addEventListener('x', this.handler)` patterns |
| `UIEvent`, `FocusEvent`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `InputEvent`, `AnimationEvent`, `TransitionEvent` | components reference them at import or in handlers |
| `getComputedStyle()`, `matchMedia()`, `requestAnimationFrame` / `cancelAnimationFrame` / `requestIdleCallback`, `CSS.supports` / `CSS.escape` | stubs with deterministic answers |

How: Lit's contributor guide (`lit/lit` `CONTRIBUTING.md`) asks for an issue first; features of medium or larger size go
through an RFC in `lit/rfcs` (file an RRFC issue to test interest); small, focused additions are a normal PR. Every PR
needs a changeset (`npm run changeset`), tests (`npm test`, Playwright in Chromium, Firefox and WebKit), `npm run lint`
and `npm run format`, and commits signed off with `git commit -s` (Developer Certificate of Origin, no CLA mentioned).
Lit is BSD-3-Clause, so contributions to it carry that license rather than this repository's Apache-2.0.

Not proposed to Lit: `window = globalThis` and the other process-wide globals (the shim deliberately avoids defining
browser-detection globals), the light-DOM facades, the lifecycle driver and everything Spectrum-specific. A Lit-level
way to give custom element renderers access to the light DOM would remove the need for pass 1, but it is a design change
for an RFC, not a PR, and is not proposed now.

## 7. Questions for the maintainers

1. 1st-gen package, link from the docs, or separate until gen2?
2. If in-repo: version policy (lockstep), docs location, and a test runner for Node-side tests.
3. Are the four new runtime dependencies acceptable?
4. Is a per-component adapter hook (an optional `ssr` export per package) a direction they would want later?
5. Does the Jira ticket behind #2675 define SSR requirements this should be measured against?

## Sources read (2026-10-15)

* `adobe/spectrum-web-components` on `main`: `CONTRIBUTING.md` (a stub pointing to `CONTRIBUTOR-DOCS/`), `AGENTS.md`,
  `1st-gen/AGENTS.md`, `1st-gen/tools/AGENTS.md`, `1st-gen/package.json`, `package.json`,
  `1st-gen/tools/reactive-controllers/package.json`, `1st-gen/tools/base/src/Base.ts` (header),
  `CONTRIBUTOR-DOCS/01_contributor-guides/` (`01`, `02`, `03`, `04`, `12`, `15`), issue #2675, repository metadata
  (Discussions enabled, Apache-2.0).
* `lit/lit` `CONTRIBUTING.md` and the `packages/labs` directory listing.
* `registry.npmjs.org` for the three candidate package names (all 404).
* Not read: `1st-gen/packages/AGENTS.md` details beyond the layout, the `.ai/` rules, the test configuration files, the
  documentation workspace. Check them before the port.
