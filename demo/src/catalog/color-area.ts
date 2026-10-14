import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'color-area',
  packages: ['color-area', 'color-handle'],
  async load() {
    await import('@spectrum-web-components/color-area/sp-color-area.js');
  },
  render: () => html`
    <p style=${CAP}>Default, hue 240, color from hex, disabled</p>
    <div style=${ROW}>
      <sp-color-area></sp-color-area>
      <sp-color-area hue="240"></sp-color-area>
      <sp-color-area color="#2f80ed"></sp-color-area>
      <sp-color-area disabled color="#eb5757"></sp-color-area>
    </div>

    <p style=${CAP}>Custom axis labels</p>
    <div style=${ROW}>
      <sp-color-area
        label-x="Saturation"
        label-y="Brightness"
        color="hsv(150, 60%, 80%)"
      ></sp-color-area>
    </div>
  `,
  notes:
    'The handle position is computed from color/hue/x/y properties; sp-color-handle is rendered inside the shadow root.',
  interactive: false,
};
