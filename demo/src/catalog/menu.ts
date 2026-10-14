import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

const PANEL =
  'width:260px;padding:4px 0;border:1px solid var(--spectrum-gray-300);border-radius:8px;background:var(--spectrum-gray-50)';

export const entry: CatalogEntry = {
  name: 'menu',
  packages: ['menu', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/menu/sp-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/menu/sp-menu-group.js'),
      import('@spectrum-web-components/menu/sp-menu-divider.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-copy.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-delete.js'),
    ]);
  },
  render: () => html`
    <div style=${ROW}>
      <div>
        <p style=${CAP}>Single selection (second item selected), one disabled item</p>
        <div style=${PANEL}>
          <sp-menu label="Selection type" selects="single" value="inverse">
            <sp-menu-item value="deselect">Deselect</sp-menu-item>
            <sp-menu-item value="inverse" selected>Select inverse</sp-menu-item>
            <sp-menu-item value="feather">Feather...</sp-menu-item>
            <sp-menu-item value="mask">Select and mask...</sp-menu-item>
            <sp-menu-divider></sp-menu-divider>
            <sp-menu-item value="save">Save selection</sp-menu-item>
            <sp-menu-item value="path" disabled>Make work path</sp-menu-item>
          </sp-menu>
        </div>
      </div>

      <div>
        <p style=${CAP}>Groups with headers, icons and shortcut values</p>
        <div style=${PANEL}>
          <sp-menu label="Edit actions">
            <sp-menu-group>
              <span slot="header">Edit</span>
              <sp-menu-item>
                <sp-icon-edit slot="icon"></sp-icon-edit>
                Edit
                <kbd slot="value">Ctrl+E</kbd>
              </sp-menu-item>
              <sp-menu-item>
                <sp-icon-copy slot="icon"></sp-icon-copy>
                Duplicate
                <kbd slot="value">Ctrl+D</kbd>
              </sp-menu-item>
            </sp-menu-group>
            <sp-menu-divider></sp-menu-divider>
            <sp-menu-group>
              <span slot="header">Danger zone</span>
              <sp-menu-item>
                <sp-icon-delete slot="icon"></sp-icon-delete>
                Delete
                <span slot="description">Moves the item to the trash</span>
              </sp-menu-item>
            </sp-menu-group>
          </sp-menu>
        </div>
      </div>

      <div>
        <p style=${CAP}>Multiple selection (two items selected)</p>
        <div style=${PANEL}>
          <sp-menu label="Visible panels" selects="multiple">
            <sp-menu-item value="layers" selected>Layers</sp-menu-item>
            <sp-menu-item value="properties">Properties</sp-menu-item>
            <sp-menu-item value="history" selected>History</sp-menu-item>
            <sp-menu-item value="swatches">Swatches</sp-menu-item>
          </sp-menu>
        </div>
      </div>
    </div>
  `,
  notes:
    'The menu manages selection by querying its light-DOM items (incl. items nested in sp-menu-group); the selected state of each item must match the menu value.',
  interactive: true,
};
