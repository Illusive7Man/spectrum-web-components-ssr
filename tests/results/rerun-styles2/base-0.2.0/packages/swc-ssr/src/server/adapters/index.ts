/**
 * Built-in adapters (Spectrum-specific behaviour). Registered on import; applications can override them with
 * `registerAdapter()` (the last registration for a tag wins).
 *
 * Reviewed but deliberately without an adapter (the generic `full` lifecycle is safe for them):
 *  - `sp-popover` (`popover/src/Popover.js`): no lifecycle side effects; `open` only styles it.
 *  - `sp-tooltip` (`tooltip/src/Tooltip.js`): self-managed tooltips render an `<sp-overlay>` (kept closed by the
 *    overlay adapter); `connectedCallback` only wires the trigger element.
 *  - `sp-tray` (`tray/src/Tray.js`), `sp-dialog-wrapper` (`dialog/src/DialogWrapper.js`): opening transitions
 *    only start on `open` *changes* and their promises simply never resolve on the server; no global state.
 */
import {registerAdapter, registerInspector} from './registry.js';
import {themeAdapter} from './theme.js';
import {overlayAdapter} from './overlay.js';
import {pickerAdapter} from './picker.js';
import {breadcrumbsAdapter} from './breadcrumbs.js';
import {colorWheelAdapter} from './color-wheel.js';
import {splitViewAdapter} from './split-view.js';
import {languageInspector} from './language.js';

const builtIn = [themeAdapter, overlayAdapter, pickerAdapter, breadcrumbsAdapter, colorWheelAdapter, splitViewAdapter];
for (const adapter of builtIn) {
  registerAdapter(adapter);
}
registerInspector(languageInspector);

export {registerAdapter, findAdapter, registerInspector, inspectors} from './registry.js';
export {isSpectrumClass} from './spectrum-class.js';
