/**
 * Demo catalog: one CatalogEntry per Spectrum Web Components (1st-gen) component package.
 *
 * Every entry module is imported statically here, but none of them imports a Spectrum
 * registration module at module top level - registration happens only inside entry.load().
 * To add a component: create <name>.ts exporting `entry`, then import it below and add it to `entries`.
 */
import type {CatalogEntry} from './types.ts';
import {loadPageTheme} from './page-theme.ts';

import {entry as accordion} from './accordion.ts';
import {entry as actionBar} from './action-bar.ts';
import {entry as actionButton} from './action-button.ts';
import {entry as actionGroup} from './action-group.ts';
import {entry as actionMenu} from './action-menu.ts';
import {entry as alertBanner} from './alert-banner.ts';
import {entry as alertDialog} from './alert-dialog.ts';
import {entry as asset} from './asset.ts';
import {entry as avatar} from './avatar.ts';
import {entry as badge} from './badge.ts';
import {entry as breadcrumbs} from './breadcrumbs.ts';
import {entry as buttonGroup} from './button-group.ts';
import {entry as button} from './button.ts';
import {entry as card} from './card.ts';
import {entry as checkbox} from './checkbox.ts';
import {entry as coachmark} from './coachmark.ts';
import {entry as colorArea} from './color-area.ts';
import {entry as colorField} from './color-field.ts';
import {entry as colorSlider} from './color-slider.ts';
import {entry as colorWheel} from './color-wheel.ts';
import {entry as combobox} from './combobox.ts';
import {entry as contextualHelp} from './contextual-help.ts';
import {entry as dialog} from './dialog.ts';
import {entry as divider} from './divider.ts';
import {entry as dropzone} from './dropzone.ts';
import {entry as fieldGroup} from './field-group.ts';
import {entry as fieldLabel} from './field-label.ts';
import {entry as helpText} from './help-text.ts';
import {entry as iconEntry} from './icon.ts';
import {entry as illustratedMessage} from './illustrated-message.ts';
import {entry as linkEntry} from './link.ts';
import {entry as menu} from './menu.ts';
import {entry as meter} from './meter.ts';
import {entry as numberField} from './number-field.ts';
import {entry as overlay} from './overlay.ts';
import {entry as picker} from './picker.ts';
import {entry as popover} from './popover.ts';
import {entry as progressBar} from './progress-bar.ts';
import {entry as progressCircle} from './progress-circle.ts';
import {entry as radio} from './radio.ts';
import {entry as search} from './search.ts';
import {entry as sidenav} from './sidenav.ts';
import {entry as slider} from './slider.ts';
import {entry as splitView} from './split-view.ts';
import {entry as statusLight} from './status-light.ts';
import {entry as swatch} from './swatch.ts';
import {entry as switchEntry} from './switch.ts';
import {entry as table} from './table.ts';
import {entry as tabs} from './tabs.ts';
import {entry as tags} from './tags.ts';
import {entry as textfield} from './textfield.ts';
import {entry as theme} from './theme.ts';
import {entry as thumbnail} from './thumbnail.ts';
import {entry as toast} from './toast.ts';
import {entry as tooltip} from './tooltip.ts';
import {entry as topNav} from './top-nav.ts';
import {entry as tray} from './tray.ts';
import {entry as truncated} from './truncated.ts';

const entries: CatalogEntry[] = [
  accordion,
  actionBar,
  actionButton,
  actionGroup,
  actionMenu,
  alertBanner,
  alertDialog,
  asset,
  avatar,
  badge,
  breadcrumbs,
  buttonGroup,
  button,
  card,
  checkbox,
  coachmark,
  colorArea,
  colorField,
  colorSlider,
  colorWheel,
  combobox,
  contextualHelp,
  dialog,
  divider,
  dropzone,
  fieldGroup,
  fieldLabel,
  helpText,
  iconEntry,
  illustratedMessage,
  linkEntry,
  menu,
  meter,
  numberField,
  overlay,
  picker,
  popover,
  progressBar,
  progressCircle,
  radio,
  search,
  sidenav,
  slider,
  splitView,
  statusLight,
  swatch,
  switchEntry,
  table,
  tabs,
  tags,
  textfield,
  theme,
  thumbnail,
  toast,
  tooltip,
  topNav,
  tray,
  truncated,
];

/**
 * The page shell wraps every entry in <sp-theme>, so each catalog entry's load() also registers the
 * page theme (sp-theme + the light and medium fragments) before the entry's own modules. The raw
 * entry modules ('./<name>.ts') export the unwrapped entry.
 */
function withPageTheme(entry: CatalogEntry): CatalogEntry {
  return {
    ...entry,
    async load() {
      await loadPageTheme();
      await entry.load();
    },
  };
}

/** All catalog entries, sorted by name. */
export const catalog: CatalogEntry[] = entries
  .map(withPageTheme)
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const byName = new Map<string, CatalogEntry>(catalog.map((entry) => [entry.name, entry]));

/** Look up an entry by its kebab-case name (as used in /component/:name and data-component). */
export function findEntry(name: string): CatalogEntry | undefined {
  return byName.get(name);
}

/**
 * Names of the entries the quick smoke run renders (one entry per rendering mechanism:
 * theme fragments, buttons, form controls, slot-driven lists, overlays' triggers, simple leaf elements).
 */
export const smokeSet: string[] = [
  'theme',
  'button',
  'action-button',
  'checkbox',
  'switch',
  'textfield',
  'picker',
  'menu',
  'tabs',
  'link',
  'divider',
  'progress-bar',
  'badge',
  'status-light',
];

/**
 * Convenience for server and client: run load() for the given entries (default: the whole catalog).
 * Loads sequentially so custom element definitions happen in a deterministic order.
 */
export async function loadEntries(selected: readonly CatalogEntry[] = catalog): Promise<void> {
  for (const entry of selected) {
    await entry.load();
  }
}
