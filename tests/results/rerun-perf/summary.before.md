# Spectrum SSR support matrix

- Run: 2026-10-16T02:02:51.347Z
- **55/59 components fully green**
- Per check: SSR markup 59/59, hydration 59/59, flicker 58/59, fidelity 56/59, interaction 20/20
- Thresholds: flicker < 0.200 % of pixels, CLS < 0.01, fidelity = post-hydration DOM equals the client-rendered DOM
- Legend: `ok` passed, `FAIL` failed, `-` not run / not applicable. Flicker % = differing pixels between the pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated custom elements (sp-* and others, e.g. overlay-trigger).

| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | CSS KB full -> trimmed (minified) | Notes |
|---|---|---|---|---|---|---|---|---|
| accordion | ok | ok (20) | 0.000 | 0.0000 | ok | ok | 424.7 -> 80.6 (71.2) | known: Items rely on sp-accordion querying its light-DOM sp-accordion-item children; the open state is reflected from the attribute. |
| action-bar | ok | ok (29) | 0.000 | 0.0000 | ok | - | 598.1 -> 153.2 (96.7) | known: Default variant is in normal flow (no overlay). Buttons use slot="buttons"; the internal close button is part of the shadow DOM. |
| action-button | ok | ok (22) | 0.000 | 0.0000 | ok | ok | 770.3 -> 375.6 (222.1) | known: Icon-only buttons rely on ObserveSlotPresence/ObserveSlotText (light-DOM queries) to decide label vs icon-only layout. |
| action-group | ok | ok (32) | 0.000 | 0.0000 | ok | ok | 856.6 -> 277.5 (180.4) | known: The group reads and writes selection state on its light-DOM sp-action-button children (querySelectorAll + slotchange), including the JSON selected attribute. |
| action-menu | ok | ok (50) | 0.000 | 0.0000 | ok | - | 1089.4 -> 273.0 (215.4) | known: Rendered closed: only the trigger button is visible; the sp-menu-item children stay slotted inside the (closed) popover. |
| alert-banner | ok | ok (13) | 0.000 | 0.0000 | ok | - | 443.1 -> 94.6 (57.8) | known: Banners are inline (not overlays) so they are shown with open. Dismissible banners render an internal close button. |
| alert-dialog | ok | ok (16) | 0.000 | 0.0000 | ok | - | 542.1 -> 119.7 (65.6) | known: Shown as static dialog content (the panel only); there is no sp-overlay/sp-underlay involved so nothing opens on load. |
| asset | ok | ok (6) | 0.000 | 0.0000 | ok | - | 320.0 -> 10.1 (6.8) | known: Images are inline data: URIs so the page needs no network access. |
| avatar | ok | ok (8) | 0.000 | 0.0000 | ok | - | 339.9 -> 25.2 (14.1) | known: Images are inline data: URIs. The linked avatar renders as an anchor inside its shadow DOM. |
| badge | ok | ok (27) | 0.000 | 0.0000 | ok | - | 568.5 -> 235.3 (104.4) | known: Icon-only badge relies on the slot-presence observer to drop the label gap. |
| breadcrumbs | ok | ok (66) | 0.000 | 0.0000 | FAIL (-4/+4 lines) | ok | 876.6 -> 245.8 (208.3) | fidelity: post-hydration DOM differs from the client-rendered DOM (-4/+4 lines; full trees in tests/results/fidelity/breadcrumbs.ssr.txt and breadcrumbs.csr.txt); known: SSR difference: the overflow menu (sp-action-menu) starts keyboard focus on the selected item, client-side rendering on the first one (as for sp-picker). Wit... |
| button | ok | ok (33) | 0.000 | 0.0000 | ok | ok | 1230.5 -> 823.6 (454.8) | known: Covers sp-button, sp-clear-button and sp-close-button (the clear-button/close-button packages are CSS-only and contain no custom elements). The pending state... |
| button-group | ok | ok (9) | 0.000 | 0.0000 | ok | ok | 560.3 -> 119.4 (63.7) | known: Pure layout container around light-DOM sp-button children. |
| card | ok | ok (32) | 0.000 | 0.0000 | ok | - | 679.8 -> 181.5 (122.6) | known: Slots (cover-photo/preview/description/footer/actions) are detected through light-DOM presence queries. Images are inline data: URIs. |
| checkbox | ok | ok (32) | 0.000 | 0.0000 | ok | ok | 640.1 -> 278.6 (185.6) | known: Label text is the default slot; invalid group exposes the negative-help-text slot. |
| coachmark | ok | ok (23) | 0.000 | 0.0000 | ok | - | 726.5 -> 197.9 (117.2) | known: sp-coachmark is rendered closed (display:none); only the sp-coach-indicator rings are visible. Coachmark extends sp-popover and uses overlay behaviour when o... |
| color-area | ok | ok (16) | 0.174 | 0.0000 | ok | - | 367.2 -> 57.0 (42.6) | known: The handle position is computed from color/hue/x/y properties; sp-color-handle is rendered inside the shadow root. |
| color-field | ok | ok (30) | 0.000 | 0.0000 | ok | ok | 711.9 -> 308.8 (169.2) | known: Extends sp-textfield; view-color renders a swatch whose color is derived from the parsed value. |
| color-slider | ok | ok (19) | 0.000 | 0.0000 | ok | - | 389.5 -> 78.8 (58.9) | known: Handle offset is derived from the value property; vertical orientation is purely an attribute. |
| color-wheel | ok | ok (19) | 0.000 | 0.0000 | ok | - | 385.5 -> 72.9 (54.9) | known: Wheel geometry is CSS only, but the handle position is computed in JS from value; no layout measurement is required. |
| combobox | ok | ok (53) | 0.000 | 0.0000 | ok | - | 1316.0 -> 420.5 (258.9) | known: Options are light-DOM sp-menu-item elements that the combobox collects into its own (closed) listbox; autocomplete behaviour is driven by the value property. |
| contextual-help | ok | ok (15) | 0.000 | 0.0000 | ok | - | 418.6 -> 52.3 (32.4) | known: The popover content stays slotted inside a closed internal sp-overlay; only the trigger is rendered visibly. |
| dialog | ok | ok (20) | 0.000 | 0.0000 | ok | - | 638.4 -> 165.5 (100.7) | known: sp-dialog is shown as a static panel (it is only the dialog content, no overlay). sp-dialog-wrapper is rendered closed, so its sp-underlay/sp-dialog-base sta... |
| divider | ok | ok (7) | 0.000 | 0.0000 | ok | - | 326.4 -> 12.9 (8.4) | known: Stateless; role="separator" and aria-orientation are applied in firstUpdated. |
| dropzone | ok | ok (6) | 0.000 | 0.0000 | ok | - | 373.5 -> 28.7 (18.0) | known: Idle state only (dragged and filled are false); the drag handlers are attached in the browser. |
| field-group | ok | ok (27) | 0.000 | 0.0000 | ok | - | 592.0 -> 174.1 (113.1) | known: Help text slots (help-text / negative-help-text) are switched on the invalid attribute; the group itself has no JS-driven state. |
| field-label | ok | ok (15) | 0.000 | 0.0000 | ok | - | 536.7 -> 151.4 (81.5) | known: The for attribute resolves against sibling ids in the same tree at connect time. |
| help-text | ok | ok (17) | 0.000 | 0.0000 | ok | - | 440.3 -> 86.4 (44.9) | known: Negative help text uses an sp-icon-alert from icons-workflow, which sp-help-text imports itself. |
| icon | ok | ok (13) | 0.000 | 0.0000 | ok | - | 327.1 -> 13.6 (9.1) | known: Name-based icons (name="ui:Arrow100") need an sp-icons-* iconset and runtime fetching, so slotted SVGs and sp-icon-* workflow elements are used instead. |
| illustrated-message | ok | ok (3) | 0.000 | 0.0000 | ok | - | 398.1 -> 26.1 (15.2) | known: Heading/description are rendered either from attributes or from named light-DOM slots. |
| link | ok | ok (9) | 0.000 | 0.0000 | ok | ok | 331.6 -> 22.5 (17.7) | known: The anchor is rendered inside the shadow root and carries the href/target/download attributes. |
| menu | ok | ok (27) | 0.000 | 0.0000 | ok | ok | 716.7 -> 164.8 (146.1) | known: The menu manages selection by querying its light-DOM items (incl. items nested in sp-menu-group); the selected state of each item must match the menu value. |
| meter | ok | ok (28) | 0.000 | 0.0000 | ok | - | 481.8 -> 129.8 (76.6) | known: Label text is the default slot (observed for presence); the fill width comes from the progress attribute. |
| number-field | ok | ok (73) | 0.000 | 0.0000 | ok | ok | 1527.7 -> 914.2 (545.3) | known: The formatted display value is produced with Intl.NumberFormat from format-options; stepper buttons are part of the shadow DOM. |
| overlay | ok | ok (17) | 0.000 | 0.0000 | ok | - | 578.2 -> 104.8 (63.2) | known: Every sp-overlay is closed (no open attribute). The overlay applies top-layer/popover APIs only when opened, so on the server only the slotted content and th... |
| overlay-trigger | ok | ok (16) | 0.000 | 0.0000 | ok | - | 507.2 -> 81.2 (49.8) | known: Nothing is open on load. overlay-trigger has no sp- prefix: the trigger gets aria-expanded / aria-haspopup / aria-controls (and the click content a generated... |
| picker | ok | ok (68) | 0.000 | 0.0000 | FAIL (-6/+6 lines) | ok | 1310.3 -> 480.6 (349.5) | fidelity: post-hydration DOM differs from the client-rendered DOM (-6/+6 lines; full trees in tests/results/fidelity/picker.ssr.txt and picker.csr.txt); known: SSR difference: the closed menu starts keyboard focus (tabindex="0") on the selected item after SSR + hydration, on the first item with client-side rendering... |
| popover | ok | ok (10) | 0.000 | 0.0000 | ok | - | 453.0 -> 53.8 (34.3) | known: No popover is open on load. The open attribute and the overlay positioning (floating-ui) are skipped entirely. |
| progress-bar | ok | ok (21) | 0.000 | 0.0000 | ok | - | 421.5 -> 101.1 (60.6) | known: Fill width and aria-valuenow come from the progress attribute; no timers are involved. |
| progress-circle | ok | ok (11) | 0.000 | 0.0000 | ok | - | 403.4 -> 93.7 (72.0) | known: The ring is drawn with CSS rotation derived from the progress attribute; the indeterminate animation is CSS only. |
| radio | ok | ok (23) | 0.000 | 0.0000 | ok | ok | 540.5 -> 218.1 (154.9) | known: The group derives each radio checked state from its selected value by querying light-DOM sp-radio children (and vice versa for radios marked checked). |
| search | ok | ok (25) | 0.000 | 0.0000 | ok | ok | 740.2 -> 302.4 (159.8) | known: Renders a form with a textfield; the clear button visibility depends on the value being non-empty at render time. |
| sidenav | ok | ok (22) | 0.000 | 0.0000 | ok | ok | 505.0 -> 180.0 (149.1) | known: Selection and expansion are computed from the value attribute and the nested sp-sidenav-item tree (ancestor queries); nested items live in the default slot o... |
| slider | ok | ok (48) | 0.000 | 0.0000 | ok | ok | 895.2 -> 401.7 (264.9) | known: Handle position is derived from value/min/max; the multi-handle slider collects its sp-slider-handle children from the light DOM (slot="handle"). Editable sl... |
| split-view | ok | ok (4) | 0.057 | 0.0000 | ok | - | 345.3 -> 25.3 (17.8) | known: Pane sizes are computed from primary-size and the host size (offsetWidth/offsetHeight and getBoundingClientRect), which the server cannot measure; expect the... |
| status-light | ok | ok (20) | 0.000 | 0.0000 | ok | - | 494.2 -> 171.3 (76.7) | known: Stateless; aria-disabled is applied in updated() when disabled. |
| swatch | ok | ok (28) | 0.000 | 0.0000 | FAIL (-1/+1 lines) | ok | 556.6 -> 223.3 (171.6) | fidelity: post-hydration DOM differs from the client-rendered DOM (-1/+1 lines; full trees in tests/results/fidelity/swatch.ssr.txt and swatch.csr.txt); known: SSR difference: the selected swatch arrives with its final tabindex="0", so its first client update also sets the focusable attribute (client-side rendering ... |
| switch | ok | ok (13) | 0.000 | 0.0000 | ok | ok | 594.5 -> 287.9 (196.6) | known: The label is the default slot; the checked state is reflected from the attribute. |
| table | ok | ok (77) | 1.443 FAIL | 0.0171 | ok | - | 616.8 -> 158.4 (144.4) | flicker: 12169/843520 px differ between SSR and hydrated paint (max 0.200 %) \| cumulative layout shift (window.__cls) \| section size changed on hydration: 1281x660 -> 1281x770 (tolerance 1px); known: SSR difference: with selects set, sp-table inserts sp-table-checkbox-cell elements into the light DOM of the head and every row at runtime (manageCheckboxes)... |
| tabs | ok | ok (53) | 0.069 | 0.0000 | ok | ok | 572.4 -> 189.6 (158.2) | known: The selection indicator geometry and tab-panel visibility depend on the selected tab; sp-tabs reads its sp-tab children (light DOM) and measures offsets whic... |
| tags | ok | ok (26) | 0.000 | 0.0000 | ok | - | 610.9 -> 172.7 (97.5) | known: Avatar and icon slots are detected through light-DOM presence queries; images are inline data: URIs. |
| textfield | ok | ok (30) | 0.000 | 0.0000 | ok | ok | 879.2 -> 434.8 (235.8) | known: Native input/textarea live in the shadow root; validity (pattern) is evaluated at render time so the correct help-text slot is shown. Growing multiline textf... |
| theme | ok | ok (12) | 0.000 | 0.0036 | ok | - | 1514.0 -> 150.1 (82.1) | known: sp-theme emits its theme fragment styles from static registerThemeFragment data (adoptedStyleSheets in the browser) and needs a dedicated renderer on the ser... |
| thumbnail | ok | ok (9) | 0.000 | 0.0000 | ok | - | 371.0 -> 46.5 (29.4) | known: Images are inline data: URIs; the slotted img is moved into the default slot of the thumbnail. |
| toast | ok | ok (17) | 0.000 | 0.0000 | ok | - | 446.7 -> 104.8 (68.7) | known: Closed on purpose: an open toast with a timeout would start a timer on connect. The icon and variant are rendered in the shadow root even while closed. |
| tooltip | ok | ok (18) | 0.000 | 0.0000 | ok | - | 573.7 -> 132.4 (85.6) | known: No tooltip is open. A self-managed tooltip finds its trigger via parentElement/parentNode at connect time and wires hover/focus listeners in the browser only. |
| top-nav | ok | ok (24) | 0.000 | 0.0000 | ok | - | 552.5 -> 101.3 (84.5) | known: Which item is selected is decided in the browser: sp-top-nav compares the resolved anchor href of each item (set in updated()) with its selected property or ... |
| tray | ok | ok (16) | 0.000 | 0.0000 | ok | - | 496.0 -> 88.9 (55.2) | known: Trays are never opened here. sp-tray is a bottom-anchored modal; rendered closed it contributes only its (hidden) shadow DOM. |
| truncated | ok | ok (11) | 0.000 | 0.0000 | ok | - | 312.8 -> 2.4 (1.8) | known: Whether the text overflows is only known after layout (offsetWidth vs clientWidth, re-checked by a ResizeObserver), so the overflow state and its tooltip are... |

## Styles (optional trimmed CSS, tests/styles.spec.ts)

- **59/59 components green**; page `/`: green
- Oracle = no JavaScript, same viewport and clip, `?styles=trimmed` (`minified`) vs `?styles=full`: 0 differing pixels (pixelmatch threshold 0, anti-aliased pixels counted). States = hover, then focus, of the first interactive control. Hydration / Flicker % = `?styles=trimmed` (`minified`) hydrates cleanly and its pure-SSR paint equals the hydrated paint (`as full`: over the threshold with the full CSS too). Restore = the hydrated trimmed / minified page against the hydrated full-CSS page, 0 differing pixels, in three moments: after every element is defined but none hydrated (`<sp-theme>` has already replaced its server styles), after hydration, and after setting states the server did not render (selected, quiet, invalid, checked, disabled, ...) on every sp-* element; afterwards no marked server `<style>` is left. Post = the same at normal timing (`hydrateSpectrum()` right after the definitions): the hydrated trimmed / minified page equals the hydrated full-CSS page (0 px), no `<style data-swc-styles>` is left in any shadow root, and every hydrated sp-* Lit element runs on adopted sheets. Post states = then hover, focus and click the first control, set `disabled` on it, `size="xl"` on the first button, toggle `quiet`, select the first menu item / tab, set `invalid` on the first text field: every step equals the full-CSS page (0 px). Release = `removeServerStyles`: no `<style>` left in the sp-* shadow roots, and the hydrated paint equals the full-CSS page. Late = tests/styles-late.spec.ts, a definition held back until after hydration (`?late=<tag>`: sp-theme, sp-tab, sp-menu-item, sp-table-cell, and the parents sp-menu, sp-breadcrumbs, sp-table with a state change on their children while they are missing): the trimmed / minified page equals the full-CSS page while it is missing and after it arrived (0 px; late sp-theme on the table page: after it arrived, and the theme-pending warning is reported). App --mod- = an application stylesheet setting the `--mod-*` hooks of Spectrum: trimmed / minified equal full before and after hydration. No CSSOM = the client on its path for browsers without constructable stylesheets: held (theme upgraded, nothing hydrated) and hydrated equal full.
- Sizes are the text of the `<style>` elements of the served page (KiB); gzip is of the whole html document.

Totals over the 59 catalog entries' own pages (each rendered alone):

| | full | trimmed | minified |
|---|---|---|---|
| CSS KiB | 36236.2 | 10679.0 | 6844.4 |
| html KiB | 37253.9 | 11730.4 | 7898.5 |
| gzip KiB | 3471.1 | 853.6 | 606.1 |

Whole-catalog page `/`:

| Mode | html KiB | CSS KiB | CSS share of html | CSS vs full | gzip KiB | gzip vs full |
|---|---|---|---|---|---|---|
| full | 19105.8 | 18121.9 | 94.9 % | 100.0 % | 1488.8 | 100.0 % |
| trimmed | 13632.5 | 12616.6 | 92.5 % | 69.6 % | 997.3 | 67.0 % |
| minified | 9323.9 | 8305.3 | 89.1 % | 45.8 % | 643.6 | 43.2 % |

Page `/` checks: oracle ok, minified ok, hydration ok, restore ok, post ok, release ok, size ok
Page `/` notes: post: 1 capture(s) differed (2330 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 69.6 % of the full CSS (target < 25 %; 18121.9 -> 12616.6 KiB)

| Component | Oracle | Minified | States | Hydration | Flicker % | Restore | Post | Post states | Release | Late | App --mod- | No CSSOM | CSS KiB full -> trimmed (minified) | Trimmed share | gzip KiB full -> trimmed (minified) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accordion | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 424.7 -> 80.6 (71.2) | 19.0 % | 40.0 -> 6.4 (5.0) |  |
| action-bar | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 598.1 -> 153.2 (96.7) | 25.6 % | 61.5 -> 17.8 (13.7) | size: trimmed CSS is 25.6 % of the full CSS (target < 25 %; 598.1 -> 153.2 KiB) |
| action-button | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | ok | - | 770.3 -> 375.6 (222.1) | 48.8 % | 47.4 -> 11.8 (9.0) | size: trimmed CSS is 48.8 % of the full CSS (target < 25 %; 770.3 -> 375.6 KiB) |
| action-group | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 856.6 -> 277.5 (180.4) | 32.4 % | 61.7 -> 11.5 (8.9) | size: trimmed CSS is 32.4 % of the full CSS (target < 25 %; 856.6 -> 277.5 KiB) |
| action-menu | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 1089.4 -> 273.0 (215.4) | 25.1 % | 87.6 -> 29.8 (23.6) | size: trimmed CSS is 25.1 % of the full CSS (target < 25 %; 1089.4 -> 273.0 KiB) |
| alert-banner | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 443.1 -> 94.6 (57.8) | 21.4 % | 48.7 -> 11.6 (7.3) |  |
| alert-dialog | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 542.1 -> 119.7 (65.6) | 22.1 % | 58.3 -> 9.9 (6.4) |  |
| asset | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 320.0 -> 10.1 (6.8) | 3.1 % | 35.8 -> 3.0 (2.9) |  |
| avatar | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 339.9 -> 25.2 (14.1) | 7.4 % | 36.2 -> 3.3 (3.1) |  |
| badge | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 568.5 -> 235.3 (104.4) | 41.4 % | 39.6 -> 7.2 (5.0) | size: trimmed CSS is 41.4 % of the full CSS (target < 25 %; 568.5 -> 235.3 KiB) |
| breadcrumbs | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | ok | - | - | 876.6 -> 245.8 (208.3) | 28.0 % | 63.8 -> 18.5 (17.0) | size: trimmed CSS is 28.0 % of the full CSS (target < 25 %; 876.6 -> 245.8 KiB) |
| button | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | ok | - | ok | 1230.5 -> 823.6 (454.8) | 66.9 % | 120.5 -> 80.0 (15.4) | size: trimmed CSS is 66.9 % of the full CSS (target < 25 %; 1230.5 -> 823.6 KiB) |
| button-group | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 560.3 -> 119.4 (63.7) | 21.3 % | 57.6 -> 6.2 (4.9) |  |
| card | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 679.8 -> 181.5 (122.6) | 26.7 % | 68.6 -> 24.8 (21.6) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 26.7 % of the full CSS (target < 25 %; 679.8 -> 181.5 KiB) |
| checkbox | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 640.1 -> 278.6 (185.6) | 43.5 % | 45.1 -> 11.4 (8.7) | size: trimmed CSS is 43.5 % of the full CSS (target < 25 %; 640.1 -> 278.6 KiB) |
| coachmark | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 726.5 -> 197.9 (117.2) | 27.2 % | 75.1 -> 18.5 (15.2) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 27.2 % of the full CSS (target < 25 %; 726.5 -> 197.9 KiB) |
| color-area | ok | ok | - | ok | 0.174 | ok | ok | - | ok | - | - | - | 367.2 -> 57.0 (42.6) | 15.5 % | 37.9 -> 5.4 (5.0) |  |
| color-field | ok | ok | skip | ok | 0.000 | ok | ok | skip | ok | - | - | - | 711.9 -> 308.8 (169.2) | 43.4 % | 85.2 -> 23.7 (11.3) | post-states: no visible sp-button, sp-action-button, sp-checkbox, sp-switch, sp-tab, sp-menu-item, sp-link, sp-textfield, sp-radio, sp-picker, sp-action-menu, sp-number-field, sp-search, sp-combobox, sp-accordi...; size: trimmed CSS is 43.4 % of the full CSS (target < 25 %; 711.9 -> 308.8 KiB) |
| color-slider | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 389.5 -> 78.8 (58.9) | 20.2 % | 38.1 -> 5.5 (5.1) |  |
| color-wheel | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 385.5 -> 72.9 (54.9) | 18.9 % | 38.3 -> 5.7 (5.4) |  |
| combobox | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 1316.0 -> 420.5 (258.9) | 32.0 % | 126.5 -> 55.8 (47.2) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 32.0 % of the full CSS (target < 25 %; 1316.0 -> 420.5 KiB) |
| contextual-help | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 418.6 -> 52.3 (32.4) | 12.5 % | 48.6 -> 6.5 (5.7) |  |
| dialog | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 638.4 -> 165.5 (100.7) | 25.9 % | 69.3 -> 15.3 (10.7) | size: trimmed CSS is 25.9 % of the full CSS (target < 25 %; 638.4 -> 165.5 KiB) |
| divider | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 326.4 -> 12.9 (8.4) | 3.9 % | 34.9 -> 2.1 (2.0) |  |
| dropzone | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 373.5 -> 28.7 (18.0) | 7.7 % | 40.2 -> 4.6 (4.1) |  |
| field-group | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 592.0 -> 174.1 (113.1) | 29.4 % | 46.3 -> 10.2 (7.3) | size: trimmed CSS is 29.4 % of the full CSS (target < 25 %; 592.0 -> 174.1 KiB) |
| field-label | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 536.7 -> 151.4 (81.5) | 28.2 % | 60.9 -> 8.4 (6.8) | size: trimmed CSS is 28.2 % of the full CSS (target < 25 %; 536.7 -> 151.4 KiB) |
| help-text | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 440.3 -> 86.4 (44.9) | 19.6 % | 46.5 -> 7.6 (6.2) |  |
| icon | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 327.1 -> 13.6 (9.1) | 4.1 % | 36.2 -> 3.3 (3.2) |  |
| illustrated-message | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 398.1 -> 26.1 (15.2) | 6.6 % | 41.0 -> 3.5 (3.1) |  |
| link | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 331.6 -> 22.5 (17.7) | 6.8 % | 35.1 -> 2.5 (2.4) |  |
| menu | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | ok | - | - | 716.7 -> 164.8 (146.1) | 23.0 % | 58.0 -> 11.3 (9.5) |  |
| meter | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 481.8 -> 129.8 (76.6) | 26.9 % | 38.8 -> 5.7 (4.7) | size: trimmed CSS is 26.9 % of the full CSS (target < 25 %; 481.8 -> 129.8 KiB) |
| number-field | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 1527.7 -> 914.2 (545.3) | 59.8 % | 150.1 -> 89.2 (69.1) | size: trimmed CSS is 59.8 % of the full CSS (target < 25 %; 1527.7 -> 914.2 KiB) |
| overlay | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 578.2 -> 104.8 (63.2) | 18.1 % | 64.5 -> 10.4 (9.0) |  |
| overlay-trigger | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 507.2 -> 81.2 (49.8) | 16.0 % | 56.5 -> 11.5 (10.0) |  |
| picker | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 1310.3 -> 480.6 (349.5) | 36.7 % | 119.9 -> 57.3 (47.0) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 36.7 % of the full CSS (target < 25 %; 1310.3 -> 480.6 KiB) |
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
| table | ok | ok | - | ok | 1.443 (as full) | ok | ok | - | ok | ok | - | - | 616.8 -> 158.4 (144.4) | 25.7 % | 49.6 -> 10.8 (9.8) | hydration: trimmed: flicker over the threshold with the full CSS as well (12169/843520 px differ between SSR and hydrated paint (max 0.200 %); cumulative layout shift 0.0171 (max 0.01); size changed on hydrat...; size: trimmed CSS is 25.7 % of the full CSS (target < 25 %; 616.8 -> 158.4 KiB) |
| tabs | ok | ok | ok | ok | 0.069 | ok | ok | ok | ok | ok | - | ok | 572.4 -> 189.6 (158.2) | 33.1 % | 50.5 -> 12.9 (11.2) | restore: 2 capture(s) differed (0 px) on the first attempt and matched after 2 attempt(s): load-to-load variation of the same CSS; size: trimmed CSS is 33.1 % of the full CSS (target < 25 %; 572.4 -> 189.6 KiB) |
| tags | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 610.9 -> 172.7 (97.5) | 28.3 % | 57.8 -> 10.8 (7.3) | size: trimmed CSS is 28.3 % of the full CSS (target < 25 %; 610.9 -> 172.7 KiB) |
| textfield | ok | ok | ok | ok | 0.000 | ok | ok | ok | ok | - | - | - | 879.2 -> 434.8 (235.8) | 49.4 % | 96.0 -> 17.7 (10.9) | size: trimmed CSS is 49.4 % of the full CSS (target < 25 %; 879.2 -> 434.8 KiB) |
| theme | ok | ok | - | ok | 0.000 | ok | ok | - | ok | ok | - | - | 1514.0 -> 150.1 (82.1) | 9.9 % | 160.3 -> 12.6 (8.4) |  |
| thumbnail | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 371.0 -> 46.5 (29.4) | 12.5 % | 37.5 -> 4.4 (3.9) |  |
| toast | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 446.7 -> 104.8 (68.7) | 23.5 % | 45.6 -> 10.6 (7.7) |  |
| tooltip | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 573.7 -> 132.4 (85.6) | 23.1 % | 59.3 -> 9.6 (8.0) |  |
| top-nav | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 552.5 -> 101.3 (84.5) | 18.3 % | 50.7 -> 10.5 (9.5) |  |
| tray | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 496.0 -> 88.9 (55.2) | 17.9 % | 55.5 -> 12.2 (8.2) |  |
| truncated | ok | ok | - | ok | 0.000 | ok | ok | - | ok | - | - | - | 312.8 -> 2.4 (1.8) | 0.8 % | 34.5 -> 1.7 (1.6) |  |

## Style de-duplication (optional `dedupe: 'link'`, tests/styles-dedupe.spec.ts)

- **14/14 components green**
- Static = no client (`nohydrate=1`, both pages repainted once), `?styles=full|trimmed|minified&dedupe=link` equals `?styles=full` (0 px); every server link loaded; the head preloads exactly the linked URLs; every URL is `text/css`, `immutable`. Post = hydrated (normal timing, then the state groups) and held / released linked pages equal full (0 px); no server link or marked style left; every hydrated sp-* Lit element on adopted sheets. Paint = first frames over an emulated 150 ms round trip, cold and warm cache, with and without head hints, without and with the client: no frame paints content without its sheet (Chromium).

| Component | Static | Post | Paint | html KiB trimmed: inline -> link | linked CSS KiB (sheets / links) | cold DCL ms trimmed: inline -> link (preload / none) | warm DCL ms | Notes |
|---|---|---|---|---|---|---|---|---|
| action-button | ok | ok | - | 390.8 -> 20.8 | 33.8 (6 / 40) | - | - |  |
| badge | ok | ok | - | 247.4 -> 14.2 | 17.2 (5 / 29) | - | - |  |
| button | ok | ok | ok | 846.5 -> 28.4 | 77.0 (12 / 62) | 172 -> 503 / 498 | 174 / 172 |  |
| checkbox | ok | ok | - | 300.8 -> 28.0 | 25.8 (8 / 50) | - | - |  |
| divider | ok | ok | - | 16.6 -> 4.9 | 4.0 (3 / 8) | - | - |  |
| link | ok | ok | - | 29.1 -> 8.1 | 5.1 (3 / 10) | - | - |  |
| menu | ok | ok | - | 185.5 -> 25.2 | 33.4 (10 / 33) | - | - |  |
| picker | ok | ok | ok | 538.8 -> 66.5 | 59.4 (13 / 80) | 172 -> 665 / 674 | 183 / 172 |  |
| progress-bar | ok | ok | - | 113.8 -> 15.3 | 17.0 (5 / 23) | - | - |  |
| status-light | ok | ok | - | 177.9 -> 8.4 | 14.3 (4 / 22) | - | - |  |
| switch | ok | ok | - | 295.8 -> 9.9 | 31.7 (5 / 15) | - | - |  |
| tabs | ok | ok | ok | 220.1 -> 36.2 | 35.3 (12 / 59) | 167 -> 490 / 487 | 174 / 176 |  |
| textfield | ok | ok | - | 462.4 -> 32.4 | 40.2 (7 / 32) | - | - |  |
| theme | ok | ok | - | 157.7 -> 10.5 | 40.9 (9 / 26) | - | - |  |

## Pages

- **3/3 pages green** (SSR markup + render report, hydration without errors / deferred elements / console errors, client-rendered reference page)
- Fidelity of all-components is a soft check (not counted for green): the hydrated slider section of `/` vs the hydrated `/component/slider` section; both trees are written to tests/results/fidelity/ when they differ. The locale page compares its hydrated SSR section with the client-rendered one (same language).

| Page | Routes | SSR | Hydration | CSR | Interaction | Fidelity | Notes |
|---|---|---|---|---|---|---|---|
| agnostic: overlay-trigger | `/component/overlay-trigger?agnostic=1` | - | ok (16) | - | ok | - |  |
| all-components | `/`, `/csr` | ok | ok (1378) | ok (1378) | - | slider: ok |  |
| locale: number-field | `/component/number-field?lang=de`, `/csr/number-field?lang=de` | ok | ok (73) | - | - | ok |  |

## Mobile (390x844, touch, tests/mobile.spec.ts)

- **3/3 green**: hydration without errors / mismatch recoveries / deferred elements, components in their mobile state afterwards; flicker % between the pure-SSR and the hydrated paint (screenshots `<name>-mobile-{before,after,diff,open}.png`); tapping a picker / action menu opens an sp-tray

| Component | Hydration | Flicker % | Tap opens tray | Notes |
|---|---|---|---|---|
| action-menu | ok (50) | 0.000 | ok |  |
| contextual-help | ok (15) | 0.000 | - |  |
| picker | ok (69) | 0.000 | ok |  |
