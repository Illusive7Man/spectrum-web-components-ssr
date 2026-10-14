import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'slider',
  packages: ['slider'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/slider/sp-slider.js'),
      import('@spectrum-web-components/slider/sp-slider-handle.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Default, with a value, disabled</p>
      <sp-slider label="Volume" value="40" style="width:320px"></sp-slider>
      <sp-slider label="Brightness" value="75" min="0" max="100" style="width:320px"></sp-slider>
      <sp-slider label="Disabled" value="30" disabled style="width:320px"></sp-slider>

      <p style=${CAP}>Label visibility: text only, value only, none</p>
      <sp-slider label="Text only" label-visibility="text" value="50" style="width:320px"></sp-slider>
      <sp-slider label="Value only" label-visibility="value" value="50" style="width:320px"></sp-slider>
      <sp-slider label="Hidden labels" label-visibility="none" value="50" style="width:320px"></sp-slider>

      <p style=${CAP}>Ticks with labels and step</p>
      <sp-slider
        label="Opacity"
        variant="tick"
        min="0"
        max="100"
        step="10"
        value="60"
        tick-step="10"
        tick-labels
        style="width:360px"
      ></sp-slider>

      <p style=${CAP}>Editable (number field), fill start, formatted value</p>
      <sp-slider label="Editable" editable value="25" style="width:360px"></sp-slider>
      <sp-slider
        label="Adjustment"
        min="-50"
        max="50"
        value="20"
        fill-start="0"
        style="width:320px"
      ></sp-slider>
      <sp-slider
        label="Discount"
        min="0"
        max="1"
        step="0.01"
        value="0.35"
        format-options='{"style":"percent"}'
        style="width:320px"
      ></sp-slider>

      <p style=${CAP}>Multiple handles</p>
      <sp-slider step="1" min="0" max="255" style="width:360px">
        Output levels
        <sp-slider-handle slot="handle" name="low" label="Low" value="20" max="next"></sp-slider-handle>
        <sp-slider-handle slot="handle" name="mid" label="Mid" value="120" min="previous" max="next"></sp-slider-handle>
        <sp-slider-handle slot="handle" name="high" label="High" value="230" min="previous"></sp-slider-handle>
      </sp-slider>

      <p style=${CAP}>Sizes</p>
      <sp-slider size="s" label="Small" value="40" style="width:320px"></sp-slider>
      <sp-slider size="l" label="Large" value="40" style="width:320px"></sp-slider>
    </div>
  `,
  notes:
    'Handle position is derived from value/min/max; the multi-handle slider collects its sp-slider-handle children from the light DOM (slot="handle"). Editable sliders render an sp-number-field in the shadow root.',
  interactive: true,
};
