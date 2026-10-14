import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'color-field',
  packages: ['color-field', 'field-label'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/color-field/sp-color-field.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>With a label, with the color preview, quiet, read only</p>
    <div style=${ROW}>
      <div>
        <sp-field-label for="color-field-brand">Brand color</sp-field-label>
        <sp-color-field id="color-field-brand" value="#ffff00"></sp-color-field>
      </div>
      <sp-color-field view-color value="#f00" label="Alert color"></sp-color-field>
      <sp-color-field quiet value="#e6e600" label="Quiet color"></sp-color-field>
      <sp-color-field readonly value="#00a4a6" label="Read only color"></sp-color-field>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-color-field size="s" value="#ff7a00" label="Small"></sp-color-field>
      <sp-color-field size="m" value="#ff7a00" label="Medium"></sp-color-field>
      <sp-color-field size="l" value="#ff7a00" label="Large"></sp-color-field>
      <sp-color-field size="xl" value="#ff7a00" label="Extra large"></sp-color-field>
    </div>

    <p style=${CAP}>Different input formats and an invalid value</p>
    <div style=${ROW}>
      <sp-color-field view-color value="rgb(0,128,255)" label="RGB"></sp-color-field>
      <sp-color-field view-color value="hsl(234, 70%, 50%)" label="HSL"></sp-color-field>
      <sp-color-field value="not a color" label="Invalid"></sp-color-field>
    </div>
  `,
  notes:
    'Extends sp-textfield; view-color renders a swatch whose color is derived from the parsed value.',
  interactive: true,
};
