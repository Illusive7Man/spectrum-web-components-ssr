# Draft: comment for adobe/spectrum-web-components#2675

Nothing here has been posted. The target is [#2675 "[Feat]: Investigate SSR Support"](https://github.com/adobe/spectrum-web-components/issues/2675)
(closed as completed on 2025-05-07, tracked in Jira; the last maintainer comment, 2025-08-26, says SSR is in the backlog).
The order of events (Discussion first, then this comment, then an issue or PR) is in
[CONTRIBUTING-UPSTREAM.md](./CONTRIBUTING-UPSTREAM.md#3-sequence).

## Before posting

- [ ] The repository is public and `<REPO_URL>` below is its address.
- [ ] `npx playwright test` was run on the commit you link to and the numbers below equal its `tests/results/summary.md`
      (they are from the run of 2026-10-15; re-check them after any later change).
- [ ] The GitHub Discussion is open and `<DISCUSSION_URL>` is filled in, or the sentence that mentions it is deleted.
- [ ] You are happy with the first-person wording; edit freely.

## The comment

> Hi all. I know this issue is closed and that SSR is tracked internally, so this is information, not a status request.
>
> I built server-side rendering and hydration for the 1st-gen components (`@spectrum-web-components/*` 1.12.4) as a
> plugin for `@lit-labs/ssr` 4.1.0. It does not change any Spectrum Web Components source and does not patch
> `node_modules`: it uses Lit SSR's `elementRenderers` and `renderOptions`, extends the DOM shim, and adds per-tag
> adapters. Repository: <REPO_URL>. Details and the full matrix: <DISCUSSION_URL>.
>
> **Approach.** `@lit-labs/ssr` renders an element before its light DOM exists, while many components read light DOM,
> slots and their own shadow content during `render()`. The plugin renders twice: pass 1 collects the element tree,
> pass 2 renders every element with light-DOM, slot and shadow facades backed by that tree (a third pass runs when an
> element changes after its markup was emitted). Spectrum elements also get a server lifecycle that includes
> `firstUpdated`/`updated`, so the markup shows the settled state. Components that need special handling (`sp-theme`,
> `sp-overlay`, `sp-picker`, `sp-breadcrumbs`, `sp-split-view`, `sp-color-wheel`) have adapters. In the browser a small
> helper hydrates the declarative shadow DOM, with a Lit template or without one (for example in Angular).
>
> **Measured** (Playwright, Chromium; 59 catalog entries, one showcase per component):
>
> - 55 of 59 entries are fully green.
> - SSR markup 59/59, hydration without console errors 59/59, no visible flicker (under 0.2 % changed pixels, layout
>   shift under 0.01) 58/59, post-hydration DOM equal to a client render 56/59, interaction smoke tests 20/20.
> - A page with all entries (1,378 custom elements), the template-free hydration path, a German-localized page and three
>   phone-sized checks (picker, action menu, contextual help) pass.
> - Repeated renders of the whole catalog: about 110 MB heap after GC, no growth; one render takes 2.3 to 2.9 s for
>   about 19 MB of HTML. 116 unit tests.
>
> **Known limitations.**
>
> - Four entries differ from a client render: picker and breadcrumbs (the roving `tabindex="0"` sits on the selected
>   item after hydration, on the first item in a client render), swatch (an extra `focusable` attribute), table (the
>   checkbox cells are inserted at runtime and appear only after hydration, 1.4 % changed pixels).
> - Layout-dependent state (tabs indicator, color handles, split-view sizes) is approximated on the server and corrected
>   after hydration.
> - On phones the server renders the desktop state (`matchMedia` never matches there); hydration is clean and the mobile
>   state follows on the next update.
> - The DOM shim defines `window` and other globals for the whole Node process, permanently, and renders run one at a
>   time.
> - Tested with 1.12.4 and Chromium only. I have not looked at gen2.
>
> **Question.** Would the team consider this as a tools package in the monorepo, given that 1st-gen is in maintenance
> mode? Or would you prefer a link from the docs to a separate package, or to wait for gen2? I can split it into small
> PRs if it is wanted in the repository. Separately, I found a few import-time accesses to `window` / `document`
> (`defineElement`, the overlay's popover detection, the `:focus-visible` probe) that I could file as bug fixes if that
> is useful.

## Notes

- The wording is deliberately neutral: no comparison with other approaches, no claims about what the team should
  prioritise, no promise about maintenance beyond what exists.
- Where each number comes from: matrix lines in `tests/results/summary.md` (header lines and the Pages table);
  1,378 elements is the hydrated count of the all-components page; memory and timing are from the hardening work recorded
  in `docs/DESIGN.md` ("Hardening", "Memory"); 116 is the `npm run test:unit` count of 2026-10-15 (0.1.1).
- The last sentence offers bug-fix PRs because 1st-gen accepts bug fixes only; check those three spots against current
  `main` before you mention them (the list is in CONTRIBUTING-UPSTREAM.md section 4, marked unverified).
- Do not paste the whole matrix into the issue; link the repository file.
