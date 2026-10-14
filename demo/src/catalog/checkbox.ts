import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'checkbox',
  packages: ['checkbox', 'field-group', 'help-text'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/checkbox/sp-checkbox.js'),
      import('@spectrum-web-components/field-group/sp-field-group.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Unchecked, checked, indeterminate</p>
    <div style=${ROW}>
      <sp-checkbox>Subscribe to updates</sp-checkbox>
      <sp-checkbox checked>Accept terms</sp-checkbox>
      <sp-checkbox indeterminate>Select all</sp-checkbox>
    </div>

    <p style=${CAP}>Emphasized, disabled, readonly</p>
    <div style=${ROW}>
      <sp-checkbox emphasized checked>Emphasized</sp-checkbox>
      <sp-checkbox disabled>Disabled</sp-checkbox>
      <sp-checkbox disabled checked>Disabled checked</sp-checkbox>
      <sp-checkbox readonly checked>Read only</sp-checkbox>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-checkbox size="s" checked>Small</sp-checkbox>
      <sp-checkbox size="m" checked>Medium</sp-checkbox>
      <sp-checkbox size="l" checked>Large</sp-checkbox>
      <sp-checkbox size="xl" checked>Extra large</sp-checkbox>
    </div>

    <div style=${COL}>
      <sp-field-group horizontal label="Preferred contact methods">
        <sp-checkbox value="email" checked>Email</sp-checkbox>
        <sp-checkbox value="sms">Text message</sp-checkbox>
        <sp-checkbox value="phone">Phone call</sp-checkbox>
      </sp-field-group>

      <sp-field-group vertical label="Select an option" invalid>
        <sp-checkbox invalid>Web component</sp-checkbox>
        <sp-checkbox checked invalid>Another web component</sp-checkbox>
        <sp-help-text slot="negative-help-text" icon>This selection is invalid.</sp-help-text>
      </sp-field-group>
    </div>
  `,
  notes: 'Label text is the default slot; invalid group exposes the negative-help-text slot.',
  interactive: true,
};
