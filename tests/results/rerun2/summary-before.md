# Spectrum SSR support matrix

- Run: 2026-10-15T00:19:20.860Z
- **55/59 components fully green**
- Per check: SSR markup 59/59, hydration 59/59, flicker 58/59, fidelity 56/59, interaction 20/20
- Thresholds: flicker < 0.200 % of pixels, CLS < 0.01, fidelity = post-hydration DOM equals the client-rendered DOM
- Legend: `ok` passed, `FAIL` failed, `-` not run / not applicable. Flicker % = differing pixels between the pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated custom elements (sp-* and others, e.g. overlay-trigger).

| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | Notes |
|---|---|---|---|---|---|---|---|
| accordion | ok | ok (20) | 0.000 | 0.0000 | ok | ok | known: Items rely on sp-accordion querying its light-DOM sp-accordion-item children; the open state is reflected from the attribute. |
| action-bar | ok | ok (29) | 0.000 | 0.0000 | ok | - | known: Default variant is in normal flow (no overlay). Buttons use slot="buttons"; the internal close button is part of the shadow DOM. |
| action-button | ok | ok (22) | 0.000 | 0.0000 | ok | ok | known: Icon-only buttons rely on ObserveSlotPresence/ObserveSlotText (light-DOM queries) to decide label vs icon-only layout. |
| action-group | ok | ok (32) | 0.000 | 0.0000 | ok | ok | known: The group reads and writes selection state on its light-DOM sp-action-button children (querySelectorAll + slotchange), including the JSON selected attribute. |
| action-menu | ok | ok (50) | 0.000 | 0.0000 | ok | - | known: Rendered closed: only the trigger button is visible; the sp-menu-item children stay slotted inside the (closed) popover. |
| alert-banner | ok | ok (13) | 0.000 | 0.0000 | ok | - | known: Banners are inline (not overlays) so they are shown with open. Dismissible banners render an internal close button. |
| alert-dialog | ok | ok (16) | 0.000 | 0.0000 | ok | - | known: Shown as static dialog content (the panel only); there is no sp-overlay/sp-underlay involved so nothing opens on load. |
| asset | ok | ok (6) | 0.000 | 0.0000 | ok | - | known: Images are inline data: URIs so the page needs no network access. |
| avatar | ok | ok (8) | 0.000 | 0.0000 | ok | - | known: Images are inline data: URIs. The linked avatar renders as an anchor inside its shadow DOM. |
| badge | ok | ok (27) | 0.000 | 0.0000 | ok | - | known: Icon-only badge relies on the slot-presence observer to drop the label gap. |
| breadcrumbs | ok | ok (66) | 0.000 | 0.0000 | FAIL (-4/+4 lines) | ok | fidelity: post-hydration DOM differs from the client-rendered DOM (-4/+4 lines; full trees in tests/results/fidelity/breadcrumbs.ssr.txt and breadcrumbs.csr.txt); known: SSR difference: the overflow menu (sp-action-menu) starts keyboard focus on the selected item, client-side rendering on the first one (as for sp-picker). Wit... |
| button | ok | ok (33) | 0.000 | 0.0000 | ok | ok | known: Covers sp-button, sp-clear-button and sp-close-button (the clear-button/close-button packages are CSS-only and contain no custom elements). The pending state... |
| button-group | ok | ok (9) | 0.000 | 0.0000 | ok | ok | known: Pure layout container around light-DOM sp-button children. |
| card | ok | ok (32) | 0.000 | 0.0000 | ok | - | known: Slots (cover-photo/preview/description/footer/actions) are detected through light-DOM presence queries. Images are inline data: URIs. |
| checkbox | ok | ok (32) | 0.000 | 0.0000 | ok | ok | known: Label text is the default slot; invalid group exposes the negative-help-text slot. |
| coachmark | ok | ok (23) | 0.000 | 0.0000 | ok | - | known: sp-coachmark is rendered closed (display:none); only the sp-coach-indicator rings are visible. Coachmark extends sp-popover and uses overlay behaviour when o... |
| color-area | ok | ok (16) | 0.174 | 0.0000 | ok | - | known: The handle position is computed from color/hue/x/y properties; sp-color-handle is rendered inside the shadow root. |
| color-field | ok | ok (30) | 0.000 | 0.0000 | ok | ok | known: Extends sp-textfield; view-color renders a swatch whose color is derived from the parsed value. |
| color-slider | ok | ok (19) | 0.000 | 0.0000 | ok | - | known: Handle offset is derived from the value property; vertical orientation is purely an attribute. |
| color-wheel | ok | ok (19) | 0.000 | 0.0000 | ok | - | known: Wheel geometry is CSS only, but the handle position is computed in JS from value; no layout measurement is required. |
| combobox | ok | ok (53) | 0.000 | 0.0000 | ok | - | known: Options are light-DOM sp-menu-item elements that the combobox collects into its own (closed) listbox; autocomplete behaviour is driven by the value property. |
| contextual-help | ok | ok (15) | 0.000 | 0.0000 | ok | - | known: The popover content stays slotted inside a closed internal sp-overlay; only the trigger is rendered visibly. |
| dialog | ok | ok (20) | 0.000 | 0.0000 | ok | - | known: sp-dialog is shown as a static panel (it is only the dialog content, no overlay). sp-dialog-wrapper is rendered closed, so its sp-underlay/sp-dialog-base sta... |
| divider | ok | ok (7) | 0.000 | 0.0000 | ok | - | known: Stateless; role="separator" and aria-orientation are applied in firstUpdated. |
| dropzone | ok | ok (6) | 0.000 | 0.0000 | ok | - | known: Idle state only (dragged and filled are false); the drag handlers are attached in the browser. |
| field-group | ok | ok (27) | 0.000 | 0.0000 | ok | - | known: Help text slots (help-text / negative-help-text) are switched on the invalid attribute; the group itself has no JS-driven state. |
| field-label | ok | ok (15) | 0.000 | 0.0000 | ok | - | known: The for attribute resolves against sibling ids in the same tree at connect time. |
| help-text | ok | ok (17) | 0.000 | 0.0000 | ok | - | known: Negative help text uses an sp-icon-alert from icons-workflow, which sp-help-text imports itself. |
| icon | ok | ok (13) | 0.000 | 0.0000 | ok | - | known: Name-based icons (name="ui:Arrow100") need an sp-icons-* iconset and runtime fetching, so slotted SVGs and sp-icon-* workflow elements are used instead. |
| illustrated-message | ok | ok (3) | 0.000 | 0.0000 | ok | - | known: Heading/description are rendered either from attributes or from named light-DOM slots. |
| link | ok | ok (9) | 0.000 | 0.0000 | ok | ok | known: The anchor is rendered inside the shadow root and carries the href/target/download attributes. |
| menu | ok | ok (27) | 0.000 | 0.0000 | ok | ok | known: The menu manages selection by querying its light-DOM items (incl. items nested in sp-menu-group); the selected state of each item must match the menu value. |
| meter | ok | ok (28) | 0.000 | 0.0000 | ok | - | known: Label text is the default slot (observed for presence); the fill width comes from the progress attribute. |
| number-field | ok | ok (75) | 0.000 | 0.0000 | ok | ok | known: The formatted display value is produced with Intl.NumberFormat from format-options; stepper buttons are part of the shadow DOM. |
| overlay | ok | ok (17) | 0.000 | 0.0000 | ok | - | known: Every sp-overlay is closed (no open attribute). The overlay applies top-layer/popover APIs only when opened, so on the server only the slotted content and th... |
| overlay-trigger | ok | ok (16) | 0.000 | 0.0000 | ok | - | known: Nothing is open on load. overlay-trigger has no sp- prefix: the trigger gets aria-expanded / aria-haspopup / aria-controls (and the click content a generated... |
| picker | ok | ok (68) | 0.000 | 0.0000 | FAIL (-6/+6 lines) | ok | fidelity: post-hydration DOM differs from the client-rendered DOM (-6/+6 lines; full trees in tests/results/fidelity/picker.ssr.txt and picker.csr.txt); known: SSR difference: the closed menu starts keyboard focus (tabindex="0") on the selected item after SSR + hydration, on the first item with client-side rendering... |
| popover | ok | ok (10) | 0.000 | 0.0000 | ok | - | known: No popover is open on load. The open attribute and the overlay positioning (floating-ui) are skipped entirely. |
| progress-bar | ok | ok (21) | 0.000 | 0.0000 | ok | - | known: Fill width and aria-valuenow come from the progress attribute; no timers are involved. |
| progress-circle | ok | ok (11) | 0.000 | 0.0000 | ok | - | known: The ring is drawn with CSS rotation derived from the progress attribute; the indeterminate animation is CSS only. |
| radio | ok | ok (23) | 0.000 | 0.0000 | ok | ok | known: The group derives each radio checked state from its selected value by querying light-DOM sp-radio children (and vice versa for radios marked checked). |
| search | ok | ok (25) | 0.000 | 0.0000 | ok | ok | known: Renders a form with a textfield; the clear button visibility depends on the value being non-empty at render time. |
| sidenav | ok | ok (22) | 0.000 | 0.0000 | ok | ok | known: Selection and expansion are computed from the value attribute and the nested sp-sidenav-item tree (ancestor queries); nested items live in the default slot o... |
| slider | ok | ok (48) | 0.000 | 0.0000 | ok | ok | known: Handle position is derived from value/min/max; the multi-handle slider collects its sp-slider-handle children from the light DOM (slot="handle"). Editable sl... |
| split-view | ok | ok (4) | 0.057 | 0.0000 | ok | - | known: Pane sizes are computed from primary-size and the host size (offsetWidth/offsetHeight and getBoundingClientRect), which the server cannot measure; expect the... |
| status-light | ok | ok (20) | 0.000 | 0.0000 | ok | - | known: Stateless; aria-disabled is applied in updated() when disabled. |
| swatch | ok | ok (28) | 0.000 | 0.0000 | FAIL (-1/+1 lines) | ok | fidelity: post-hydration DOM differs from the client-rendered DOM (-1/+1 lines; full trees in tests/results/fidelity/swatch.ssr.txt and swatch.csr.txt); known: SSR difference: the selected swatch arrives with its final tabindex="0", so its first client update also sets the focusable attribute (client-side rendering ... |
| switch | ok | ok (13) | 0.000 | 0.0000 | ok | ok | known: The label is the default slot; the checked state is reflected from the attribute. |
| table | ok | ok (77) | 1.443 FAIL | 0.0000 | ok | - | flicker: 12169/843520 px differ between SSR and hydrated paint (max 0.200 %) \| section size changed on hydration: 1281x660 -> 1281x770 (tolerance 1px); known: SSR difference: with selects set, sp-table inserts sp-table-checkbox-cell elements into the light DOM of the head and every row at runtime (manageCheckboxes)... |
| tabs | ok | ok (53) | 0.069 | 0.0000 | ok | ok | known: The selection indicator geometry and tab-panel visibility depend on the selected tab; sp-tabs reads its sp-tab children (light DOM) and measures offsets whic... |
| tags | ok | ok (26) | 0.000 | 0.0000 | ok | - | known: Avatar and icon slots are detected through light-DOM presence queries; images are inline data: URIs. |
| textfield | ok | ok (30) | 0.000 | 0.0000 | ok | ok | known: Native input/textarea live in the shadow root; validity (pattern) is evaluated at render time so the correct help-text slot is shown. Growing multiline textf... |
| theme | ok | ok (12) | 0.000 | 0.0000 | ok | - | known: sp-theme emits its theme fragment styles from static registerThemeFragment data (adoptedStyleSheets in the browser) and needs a dedicated renderer on the ser... |
| thumbnail | ok | ok (9) | 0.000 | 0.0000 | ok | - | known: Images are inline data: URIs; the slotted img is moved into the default slot of the thumbnail. |
| toast | ok | ok (17) | 0.000 | 0.0000 | ok | - | known: Closed on purpose: an open toast with a timeout would start a timer on connect. The icon and variant are rendered in the shadow root even while closed. |
| tooltip | ok | ok (18) | 0.000 | 0.0000 | ok | - | known: No tooltip is open. A self-managed tooltip finds its trigger via parentElement/parentNode at connect time and wires hover/focus listeners in the browser only. |
| top-nav | ok | ok (24) | 0.000 | 0.0000 | ok | - | known: Which item is selected is decided in the browser: sp-top-nav compares the resolved anchor href of each item (set in updated()) with its selected property or ... |
| tray | ok | ok (16) | 0.000 | 0.0000 | ok | - | known: Trays are never opened here. sp-tray is a bottom-anchored modal; rendered closed it contributes only its (hidden) shadow DOM. |
| truncated | ok | ok (11) | 0.000 | 0.0000 | ok | - | known: Whether the text overflows is only known after layout (offsetWidth vs clientWidth, re-checked by a ResizeObserver), so the overflow state and its tooltip are... |

## Pages

- **3/3 pages green** (SSR markup + render report, hydration without errors / deferred elements / console errors, client-rendered reference page)
- Fidelity of all-components is a soft check (not counted for green): the hydrated slider section of `/` vs the hydrated `/component/slider` section; both trees are written to tests/results/fidelity/ when they differ. The locale page compares its hydrated SSR section with the client-rendered one (same language).

| Page | Routes | SSR | Hydration | CSR | Interaction | Fidelity | Notes |
|---|---|---|---|---|---|---|---|
| agnostic: overlay-trigger | `/component/overlay-trigger?agnostic=1` | - | ok (16) | - | ok | - |  |
| all-components | `/`, `/csr` | ok | ok (1378) | ok (1378) | - | slider: ok |  |
| locale: number-field | `/component/number-field?lang=de`, `/csr/number-field?lang=de` | ok | ok (75) | - | - | ok |  |

## Mobile (390x844, touch, tests/mobile.spec.ts)

- **3/3 green**: hydration without errors / mismatch recoveries / deferred elements, components in their mobile state afterwards; flicker % between the pure-SSR and the hydrated paint (screenshots `<name>-mobile-{before,after,diff,open}.png`); tapping a picker / action menu opens an sp-tray

| Component | Hydration | Flicker % | Tap opens tray | Notes |
|---|---|---|---|---|
| action-menu | ok (50) | 0.000 | ok |  |
| contextual-help | ok (15) | 0.000 | - |  |
| picker | ok (69) | 0.000 | ok |  |
