/**
 * `<sp-picker>` (`picker/src/Picker.js`): the selected item's content is rendered into the picker button.
 *
 * In the browser the selection is resolved asynchronously (`update()` schedules `manageSelection()` two
 * animation frames later; it waits for the internal `<sp-menu>` to know its items, which announce themselves
 * from a rAF callback). The generic `full` lifecycle reproduces that. This adapter is the deterministic safety
 * net when that chain did not complete (other lifecycle modes, unusual markup): if a value is set but no item
 * was selected, it selects the matching enabled item directly, using the light-DOM facade.
 */
import type {ElementAdapter} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function menuItemsOf(picker: any): any[] {
  try {
    const fromMenu = picker.optionsMenu?.childItems;
    if (Array.isArray(fromMenu) && fromMenu.length > 0) {
      return fromMenu;
    }
  } catch {
    // fall back to the light DOM
  }
  return [...(picker.querySelectorAll?.('sp-menu-item') ?? [])];
}

export function ensurePickerSelection(element: HTMLElement): void {
  const picker = element as any;
  if (!picker.value || picker.selectedItem || picker.selects == null) {
    return;
  }
  const item = menuItemsOf(picker).find((candidate) => candidate.value === picker.value && !candidate.disabled);
  if (!item) {
    return;
  }
  for (const other of menuItemsOf(picker)) {
    if (other !== item && other.selected) {
      other.selected = false;
    }
  }
  item.selected = true;
  picker.selectedItem = item;
}

export const pickerAdapter: ElementAdapter = {
  tag: 'sp-picker',
  beforeRender: ensurePickerSelection,
};
