import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'action-menu',
  packages: ['action-menu', 'menu', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/action-menu/sp-action-menu.js'),
      import('@spectrum-web-components/menu/sp-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/menu/sp-menu-divider.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Closed menus: visible label, icon + label, icon only, quiet, single selection, small</p>
    <div style=${ROW}>
      <sp-action-menu>
        <span slot="label">More actions</span>
        <sp-menu-item>Deselect</sp-menu-item>
        <sp-menu-item>Select inverse</sp-menu-item>
        <sp-menu-item>Feather...</sp-menu-item>
        <sp-menu-item>Select and mask...</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item>Save selection</sp-menu-item>
        <sp-menu-item disabled>Make work path</sp-menu-item>
      </sp-action-menu>

      <sp-action-menu>
        <sp-icon-settings slot="icon"></sp-icon-settings>
        <span slot="label">Actions under the gear</span>
        <sp-menu-item>Preferences</sp-menu-item>
        <sp-menu-item>Keyboard shortcuts</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item>Sign out</sp-menu-item>
      </sp-action-menu>

      <sp-action-menu label="Open the actions menu">
        <sp-menu-item>Duplicate</sp-menu-item>
        <sp-menu-item>Rename</sp-menu-item>
        <sp-menu-item>Move to...</sp-menu-item>
      </sp-action-menu>

      <sp-action-menu quiet label="Quiet actions menu">
        <sp-menu-item>Duplicate</sp-menu-item>
        <sp-menu-item>Rename</sp-menu-item>
        <sp-menu-item>Move to...</sp-menu-item>
      </sp-action-menu>

      <sp-action-menu selects="single" value="triangle">
        <span slot="label">Available shapes</span>
        <sp-menu-item value="square">Square</sp-menu-item>
        <sp-menu-item value="triangle" selected>Triangle</sp-menu-item>
        <sp-menu-item value="parallelogram">Parallelogram</sp-menu-item>
        <sp-menu-item value="circle" disabled>Circle</sp-menu-item>
      </sp-action-menu>

      <sp-action-menu size="s">
        <span slot="label">Small</span>
        <sp-menu-item>Deselect</sp-menu-item>
        <sp-menu-item>Select inverse</sp-menu-item>
      </sp-action-menu>
    </div>
  `,
  notes:
    'Rendered closed: only the trigger button is visible; the sp-menu-item children stay slotted inside the (closed) popover.',
  interactive: false,
};
