import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'radio',
  packages: ['radio', 'help-text'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/radio/sp-radio.js'),
      import('@spectrum-web-components/radio/sp-radio-group.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
    ]);
  },
  render: () => html`
    <div style=${ROW}>
      <div>
        <p style=${CAP}>Vertical group, selected through the group's selected attribute</p>
        <sp-radio-group label="Delivery speed" name="radio-delivery" selected="express">
          <sp-radio value="standard">Standard (5 days)</sp-radio>
          <sp-radio value="express">Express (2 days)</sp-radio>
          <sp-radio value="overnight">Overnight</sp-radio>
        </sp-radio-group>
      </div>

      <div>
        <p style=${CAP}>Horizontal group, radio marked checked</p>
        <sp-radio-group horizontal label="Favorite pet" name="radio-pets">
          <sp-radio value="puppies" checked>Puppies</sp-radio>
          <sp-radio value="kittens">Kittens</sp-radio>
          <sp-radio value="birds">Birds</sp-radio>
        </sp-radio-group>
      </div>
    </div>

    <div style=${ROW}>
      <div>
        <p style=${CAP}>Emphasized, one option disabled</p>
        <sp-radio-group label="Plan" name="radio-plan" selected="team">
          <sp-radio emphasized value="solo">Solo</sp-radio>
          <sp-radio emphasized value="team">Team</sp-radio>
          <sp-radio emphasized value="enterprise" disabled>Enterprise</sp-radio>
        </sp-radio-group>
      </div>

      <div>
        <p style=${CAP}>Invalid, with negative help text</p>
        <sp-radio-group label="Choose one" name="radio-invalid" invalid>
          <sp-radio invalid value="a">Option A</sp-radio>
          <sp-radio invalid value="b">Option B</sp-radio>
          <sp-help-text slot="negative-help-text">Select an option to continue.</sp-help-text>
        </sp-radio-group>
      </div>

      <div>
        <p style=${CAP}>Small and large radios</p>
        <sp-radio-group label="Small" name="radio-small" selected="one">
          <sp-radio size="s" value="one">Option 1</sp-radio>
          <sp-radio size="s" value="two">Option 2</sp-radio>
        </sp-radio-group>
        <sp-radio-group label="Large" name="radio-large" selected="one">
          <sp-radio size="l" value="one">Option 1</sp-radio>
          <sp-radio size="l" value="two">Option 2</sp-radio>
        </sp-radio-group>
      </div>
    </div>
  `,
  notes:
    'The group derives each radio checked state from its selected value by querying light-DOM sp-radio children (and vice versa for radios marked checked).',
  interactive: true,
};
