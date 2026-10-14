import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'meter',
  packages: ['meter'],
  async load() {
    await import('@spectrum-web-components/meter/sp-meter.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Label as slotted text, and as the label attribute</p>
      <sp-meter progress="71" style="width:240px">Tasks completed</sp-meter>
      <sp-meter progress="15" label="Course progress" style="width:240px"></sp-meter>

      <p style=${CAP}>Variants</p>
      <sp-meter variant="positive" progress="50" style="width:240px">Storage space (positive)</sp-meter>
      <sp-meter variant="notice" progress="73" style="width:240px">Storage space (notice)</sp-meter>
      <sp-meter variant="negative" progress="92" style="width:240px">Storage space (negative)</sp-meter>

      <p style=${CAP}>Side label</p>
      <sp-meter side-label progress="68" style="width:320px">Side label</sp-meter>

      <p style=${CAP}>Sizes</p>
      <sp-meter size="s" progress="25" style="width:240px">Small</sp-meter>
      <sp-meter size="l" progress="25" style="width:240px">Large</sp-meter>
      <sp-meter size="xl" progress="25" style="width:240px">Extra large</sp-meter>
    </div>
  `,
  notes: 'Label text is the default slot (observed for presence); the fill width comes from the progress attribute.',
  interactive: false,
};
