import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'color-slider',
  packages: ['color-slider', 'color-handle'],
  async load() {
    await import('@spectrum-web-components/color-slider/sp-color-slider.js');
  },
  render: () => html`
    <p style=${CAP}>Horizontal: default, value 120, custom label, disabled</p>
    <div style=${ROW}>
      <sp-color-slider></sp-color-slider>
      <sp-color-slider value="120" label="Green hue"></sp-color-slider>
      <sp-color-slider value="300" label="Color hue" color="#a020f0"></sp-color-slider>
      <sp-color-slider disabled value="200"></sp-color-slider>
    </div>

    <p style=${CAP}>Vertical</p>
    <div style=${ROW}>
      <sp-color-slider vertical value="60" label="Yellow hue"></sp-color-slider>
      <sp-color-slider vertical value="240" label="Blue hue"></sp-color-slider>
    </div>
  `,
  notes:
    'Handle offset is derived from the value property; vertical orientation is purely an attribute.',
  interactive: false,
};
