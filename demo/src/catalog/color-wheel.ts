import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'color-wheel',
  packages: ['color-wheel', 'color-handle'],
  async load() {
    await import('@spectrum-web-components/color-wheel/sp-color-wheel.js');
  },
  render: () => html`
    <p style=${CAP}>Default, value 180, color from hex, disabled</p>
    <div style=${ROW}>
      <sp-color-wheel></sp-color-wheel>
      <sp-color-wheel value="180"></sp-color-wheel>
      <sp-color-wheel color="#7277b5"></sp-color-wheel>
      <sp-color-wheel disabled value="90"></sp-color-wheel>
    </div>

    <p style=${CAP}>Custom label and step</p>
    <div style=${ROW}>
      <sp-color-wheel label="Select color hue" step="10" value="45"></sp-color-wheel>
      <sp-color-wheel style="width:200px;height:200px" value="300"></sp-color-wheel>
    </div>
  `,
  notes:
    'Wheel geometry is CSS only, but the handle position is computed in JS from value; no layout measurement is required.',
  interactive: false,
};
