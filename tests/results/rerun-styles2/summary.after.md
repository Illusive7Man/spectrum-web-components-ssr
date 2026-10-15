# Spectrum SSR support matrix

- Run: 2026-10-15T20:56:27.045Z
- **0/36 components fully green**
- Per check: SSR markup 0/0, hydration 0/0, flicker 0/0, fidelity 0/0, interaction 0/0
- Thresholds: flicker < 0.200 % of pixels, CLS < 0.01, fidelity = post-hydration DOM equals the client-rendered DOM
- Legend: `ok` passed, `FAIL` failed, `-` not run / not applicable. Flicker % = differing pixels between the pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated custom elements (sp-* and others, e.g. overlay-trigger).

| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | CSS KB full -> trimmed (minified) | Notes |
|---|---|---|---|---|---|---|---|---|
| field-group | - | - | - | - | - | - | 592.0 -> 174.1 (113.1) |  |
| button | - | - | - | - | - | - | - |  |
| field-label | - | - | - | - | - | - | 536.7 -> 151.4 (81.5) |  |
| theme | - | - | - | - | - | - | 1514.0 -> 150.1 (82.1) |  |
| help-text | - | - | - | - | - | - | 440.3 -> 86.4 (44.9) |  |
| tabs | - | - | - | - | - | - | 572.4 -> 189.6 (156.4) |  |
| icon | - | - | - | - | - | - | 327.1 -> 13.6 (9.1) |  |
| illustrated-message | - | - | - | - | - | - | 398.1 -> 26.1 (15.2) |  |
| menu | - | - | - | - | - | - | 716.7 -> 164.8 (142.5) |  |
| link | - | - | - | - | - | - | 331.6 -> 22.5 (17.7) |  |
| table | - | - | - | - | - | - | 616.8 -> 158.4 (142.2) |  |
| action-button | - | - | - | - | - | - | - |  |
| meter | - | - | - | - | - | - | 481.8 -> 129.8 (76.6) |  |
| number-field | - | - | - | - | - | - | 1527.7 -> 914.2 (545.3) |  |
| overlay | - | - | - | - | - | - | 578.2 -> 104.8 (63.2) |  |
| overlay-trigger | - | - | - | - | - | - | 507.2 -> 81.2 (49.8) |  |
| picker | - | - | - | - | - | - | 1310.3 -> 480.6 (334.3) |  |
| popover | - | - | - | - | - | - | 453.0 -> 53.8 (34.3) |  |
| progress-bar | - | - | - | - | - | - | 421.5 -> 101.1 (60.6) |  |
| progress-circle | - | - | - | - | - | - | 403.4 -> 93.7 (72.0) |  |
| radio | - | - | - | - | - | - | 540.5 -> 218.1 (154.9) |  |
| search | - | - | - | - | - | - | 740.2 -> 302.4 (159.8) |  |
| sidenav | - | - | - | - | - | - | 505.0 -> 180.0 (149.1) |  |
| slider | - | - | - | - | - | - | 895.2 -> 401.7 (264.9) |  |
| split-view | - | - | - | - | - | - | 345.3 -> 25.3 (17.8) |  |
| status-light | - | - | - | - | - | - | 494.2 -> 171.3 (76.7) |  |
| swatch | - | - | - | - | - | - | 556.6 -> 223.3 (171.6) |  |
| switch | - | - | - | - | - | - | 594.5 -> 287.9 (196.6) |  |
| tags | - | - | - | - | - | - | 610.9 -> 172.7 (97.5) |  |
| textfield | - | - | - | - | - | - | 879.2 -> 434.8 (235.8) |  |
| thumbnail | - | - | - | - | - | - | 371.0 -> 46.5 (29.4) |  |
| toast | - | - | - | - | - | - | 446.7 -> 104.8 (68.4) |  |
| tooltip | - | - | - | - | - | - | 573.7 -> 132.4 (85.5) |  |
| top-nav | - | - | - | - | - | - | 552.5 -> 101.3 (82.2) |  |
| tray | - | - | - | - | - | - | 496.0 -> 88.9 (55.2) |  |
| truncated | - | - | - | - | - | - | 312.8 -> 2.4 (1.8) |  |

## Styles (optional trimmed CSS, tests/styles.spec.ts)

- **36/36 components green**; page `/`: green
- Oracle = no JavaScript, same viewport and clip, `?styles=trimmed` (`minified`) vs `?styles=full`: 0 differing pixels (pixelmatch threshold 0, anti-aliased pixels counted). States = hover, then focus, of the first interactive control. Hydration / Flicker % = `?styles=trimmed` (`minified`) hydrates cleanly and its pure-SSR paint equals the hydrated paint (`as full`: over the threshold with the full CSS too). Restore = the hydrated trimmed / minified page against the hydrated full-CSS page, 0 differing pixels, in three moments: after every element is defined but none hydrated (`<sp-theme>` has already replaced its server styles), after hydration, and after setting states the server did not render (selected, quiet, invalid, checked, disabled, ...) on every sp-* element; afterwards no marked server `<style>` is left. Post = the same at normal timing (`hydrateSpectrum()` right after the definitions): the hydrated trimmed / minified page equals the hydrated full-CSS page (0 px), no `<style data-swc-styles>` is left in any shadow root, and every hydrated sp-* Lit element runs on adopted sheets. Post states = then hover, focus and click the first control, set `disabled` on it, `size="xl"` on the first button, toggle `quiet`, select the first menu item / tab, set `invalid` on the first text field: every step equals the full-CSS page (0 px). Release = `removeServerStyles`: no `<style>` left in the sp-* shadow roots, and the hydrated paint equals the full-CSS page. Late = tests/styles-late.spec.ts, a definition held back until after hydration (`?late=<tag>`: sp-theme, sp-tab, sp-menu-item, sp-table-cell): the trimmed / minified page equals the full-CSS page while it is missing and after it arrived (0 px). App --mod- = an application stylesheet setting the `--mod-*` hooks of Spectrum: trimmed / minified equal full before and after hydration. No CSSOM = the client on its path for browsers without constructable stylesheets: held (theme upgraded, nothing hydrated) and hydrated equal full.
- Sizes are the text of the `<style>` elements of the served page (KiB); gzip is of the whole html document.

Totals over the 34 catalog entries' own pages (each rendered alone):

| | full | trimmed | minified |
|---|---|---|---|
| CSS KiB | 20642.9 | 5989.9 | 3888.0 |
| html KiB | 21204.0 | 6570.2 | 4469.7 |
| gzip KiB | 2004.8 | 457.2 | 338.8 |

Whole-catalog page `/`:

| Mode | html KiB | CSS KiB | CSS share of html | CSS vs full | gzip KiB | gzip vs full |
|---|---|---|---|---|---|---|
| full | 19105.8 | 18121.9 | 94.9 % | 100.0 % | 1488.8 | 100.0 % |
| trimmed | 13632.5 | 12616.6 | 92.5 % | 69.6 % | 997.3 | 67.0 % |
| minified | 9243.4 | 8224.8 | 89.0 % | 45.4 % | 640.7 | 43.0 % |

Page `/` checks: oracle ok, minified ok, hydration ok, restore ok, post ok, release ok, size ok
Page `/` notes: size: trimmed CSS is 69.6 % of the full CSS (target < 25 %; 18121.9 -> 12616.6 KiB)

| Component | Oracle | Minified | States | Hydration | Flicker % | Restore | Post | Post states | Release | Late | App --mod- | No CSSOM | CSS KiB full -> trimmed (minified) | Trimmed share | gzip KiB full -> trimmed (minified) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| field-group | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 592.0 -> 174.1 (113.1) | 29.4 % | 46.3 -> 10.2 (7.3) | size: trimmed CSS is 29.4 % of the full CSS (target < 25 %; 592.0 -> 174.1 KiB) |
| button | - | - | - | - | - | - | - | - | - | ok | - | ok | - | - | - |  |
| field-label | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 536.7 -> 151.4 (81.5) | 28.2 % | 60.9 -> 8.4 (6.8) | size: trimmed CSS is 28.2 % of the full CSS (target < 25 %; 536.7 -> 151.4 KiB) |
| theme | ok | ok | - | ok | 0.000 | ok | ok | - | ok | ok | - | - | 1514.0 -> 150.1 (82.1) | 9.9 % | 160.3 -> 12.6 (8.4) |  |
| help-text | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 440.3 -> 86.4 (44.9) | 19.6 % | 46.5 -> 7.6 (6.2) |  |
| tabs | ok | ok | ok | ok | 0.069 | ok | ok | ok | ok | ok | - | ok | 572.4 -> 189.6 (156.4) | 33.1 % | 50.5 -> 12.9 (11.2) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 33.1 % of the full CSS (target < 25 %; 572.4 -> 189.6 KiB) |
| icon | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 327.1 -> 13.6 (9.1) | 4.1 % | 36.2 -> 3.3 (3.2) |  |
| illustrated-message | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 398.1 -> 26.1 (15.2) | 6.6 % | 41.0 -> 3.5 (3.1) |  |
| menu | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | ok | - | - | 716.7 -> 164.8 (142.5) | 23.0 % | 58.0 -> 11.3 (9.4) |  |
| link | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 331.6 -> 22.5 (17.7) | 6.8 % | 35.1 -> 2.5 (2.4) |  |
| table | ok | ok | - | ok | 1.443 (as full) | ok | ok | - | ok | ok | - | - | 616.8 -> 158.4 (142.2) | 25.7 % | 49.6 -> 10.8 (9.7) | hydration: trimmed: flicker over the threshold with the full CSS as well (12169/843520 px differ between SSR and hydrated paint (max 0.200 %); size changed on hydration: 1281x660 -> 1281x770 (tolerance 1px));...; size: trimmed CSS is 25.7 % of the full CSS (target < 25 %; 616.8 -> 158.4 KiB) |
| action-button | - | - | - | - | - | - | - | - | - | - | ok | - | - | - | - |  |
| meter | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 481.8 -> 129.8 (76.6) | 26.9 % | 38.8 -> 5.7 (4.7) | size: trimmed CSS is 26.9 % of the full CSS (target < 25 %; 481.8 -> 129.8 KiB) |
| number-field | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 1527.7 -> 914.2 (545.3) | 59.8 % | 150.1 -> 89.2 (69.1) | size: trimmed CSS is 59.8 % of the full CSS (target < 25 %; 1527.7 -> 914.2 KiB) |
| overlay | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 578.2 -> 104.8 (63.2) | 18.1 % | 64.5 -> 10.4 (9.0) |  |
| overlay-trigger | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 507.2 -> 81.2 (49.8) | 16.0 % | 56.5 -> 11.5 (10.0) |  |
| picker | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 1310.3 -> 480.6 (334.3) | 36.7 % | 119.9 -> 57.3 (44.2) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 36.7 % of the full CSS (target < 25 %; 1310.3 -> 480.6 KiB) |
| popover | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 453.0 -> 53.8 (34.3) | 11.9 % | 49.3 -> 7.4 (6.5) |  |
| progress-bar | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 421.5 -> 101.1 (60.6) | 24.0 % | 37.8 -> 5.3 (4.5) |  |
| progress-circle | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 403.4 -> 93.7 (72.0) | 23.2 % | 37.1 -> 4.5 (4.1) |  |
| radio | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 540.5 -> 218.1 (154.9) | 40.3 % | 41.4 -> 8.4 (6.4) | size: trimmed CSS is 40.3 % of the full CSS (target < 25 %; 540.5 -> 218.1 KiB) |
| search | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 740.2 -> 302.4 (159.8) | 40.9 % | 85.2 -> 37.1 (10.0) | size: trimmed CSS is 40.9 % of the full CSS (target < 25 %; 740.2 -> 302.4 KiB) |
| sidenav | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 505.0 -> 180.0 (149.1) | 35.6 % | 40.8 -> 7.8 (7.0) | size: trimmed CSS is 35.6 % of the full CSS (target < 25 %; 505.0 -> 180.0 KiB) |
| slider | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 895.2 -> 401.7 (264.9) | 44.9 % | 104.9 -> 25.8 (17.5) | size: trimmed CSS is 44.9 % of the full CSS (target < 25 %; 895.2 -> 401.7 KiB) |
| split-view | ok | ok | - | ok | 0.057 | ok | ok | - | ok | - | - | - | 345.3 -> 25.3 (17.8) | 7.3 % | 36.0 -> 3.0 (2.8) |  |
| status-light | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 494.2 -> 171.3 (76.7) | 34.7 % | 38.0 -> 5.5 (3.6) | size: trimmed CSS is 34.7 % of the full CSS (target < 25 %; 494.2 -> 171.3 KiB) |
| swatch | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 556.6 -> 223.3 (171.6) | 40.1 % | 41.9 -> 8.9 (8.0) | size: trimmed CSS is 40.1 % of the full CSS (target < 25 %; 556.6 -> 223.3 KiB) |
| switch | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 594.5 -> 287.9 (196.6) | 48.4 % | 41.0 -> 8.7 (6.8) | size: trimmed CSS is 48.4 % of the full CSS (target < 25 %; 594.5 -> 287.9 KiB) |
| tags | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 610.9 -> 172.7 (97.5) | 28.3 % | 57.8 -> 10.8 (7.3) | size: trimmed CSS is 28.3 % of the full CSS (target < 25 %; 610.9 -> 172.7 KiB) |
| textfield | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 879.2 -> 434.8 (235.8) | 49.4 % | 96.0 -> 17.7 (10.9) | size: trimmed CSS is 49.4 % of the full CSS (target < 25 %; 879.2 -> 434.8 KiB) |
| thumbnail | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 371.0 -> 46.5 (29.4) | 12.5 % | 37.5 -> 4.4 (3.9) |  |
| toast | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 446.7 -> 104.8 (68.4) | 23.5 % | 45.6 -> 10.6 (7.7) |  |
| tooltip | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 573.7 -> 132.4 (85.5) | 23.1 % | 59.3 -> 9.6 (8.0) |  |
| top-nav | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 552.5 -> 101.3 (82.2) | 18.3 % | 50.7 -> 10.5 (9.4) |  |
| tray | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 496.0 -> 88.9 (55.2) | 17.9 % | 55.5 -> 12.2 (8.2) |  |
| truncated | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 312.8 -> 2.4 (1.8) | 0.8 % | 34.5 -> 1.7 (1.6) |  |
