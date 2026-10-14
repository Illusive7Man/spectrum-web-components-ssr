import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'switch',
  packages: ['switch', 'field-group'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/switch/sp-switch.js'),
      import('@spectrum-web-components/field-group/sp-field-group.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Off, on, disabled, disabled and on, read only</p>
    <div style=${ROW}>
      <sp-switch>Email notifications</sp-switch>
      <sp-switch checked>Push notifications</sp-switch>
      <sp-switch disabled>Disabled</sp-switch>
      <sp-switch disabled checked>Disabled on</sp-switch>
      <sp-switch readonly checked>Read only</sp-switch>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-switch size="s">Small</sp-switch>
      <sp-switch size="m">Medium</sp-switch>
      <sp-switch size="l">Large</sp-switch>
      <sp-switch size="xl">Extra large</sp-switch>
    </div>

    <div style=${COL}>
      <p style=${CAP}>Emphasized, inside a field group</p>
      <sp-field-group vertical label="Privacy settings">
        <sp-switch emphasized>Share usage data</sp-switch>
        <sp-switch emphasized checked>Allow personalised ads</sp-switch>
      </sp-field-group>
    </div>
  `,
  notes: 'The label is the default slot; the checked state is reflected from the attribute.',
  interactive: true,
};
