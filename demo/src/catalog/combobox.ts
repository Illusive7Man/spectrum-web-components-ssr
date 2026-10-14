import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'combobox',
  packages: ['combobox', 'menu', 'field-label'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/combobox/sp-combobox.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>With a visible label, with a value, quiet, disabled</p>
    <div style=${ROW}>
      <div>
        <sp-field-label for="combobox-color">Favorite color</sp-field-label>
        <sp-combobox id="combobox-color" label="Favorite color">
          <sp-menu-item value="red">Red</sp-menu-item>
          <sp-menu-item value="green">Green</sp-menu-item>
          <sp-menu-item value="blue">Blue</sp-menu-item>
        </sp-combobox>
      </div>

      <sp-combobox label="Color with value" value="Green">
        <sp-menu-item value="red">Red</sp-menu-item>
        <sp-menu-item value="green">Green</sp-menu-item>
        <sp-menu-item value="blue">Blue</sp-menu-item>
      </sp-combobox>

      <sp-combobox quiet label="Quiet color">
        <sp-menu-item value="red">Red</sp-menu-item>
        <sp-menu-item value="green">Green</sp-menu-item>
        <sp-menu-item value="blue">Blue</sp-menu-item>
      </sp-combobox>

      <sp-combobox disabled label="Disabled color">
        <sp-menu-item value="red">Red</sp-menu-item>
        <sp-menu-item value="green">Green</sp-menu-item>
      </sp-combobox>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-combobox size="s" label="Small">
        <sp-menu-item value="one">One</sp-menu-item>
        <sp-menu-item value="two">Two</sp-menu-item>
      </sp-combobox>
      <sp-combobox size="l" label="Large">
        <sp-menu-item value="one">One</sp-menu-item>
        <sp-menu-item value="two">Two</sp-menu-item>
      </sp-combobox>
    </div>
  `,
  notes:
    'Options are light-DOM sp-menu-item elements that the combobox collects into its own (closed) listbox; autocomplete behaviour is driven by the value property.',
  interactive: false,
};
