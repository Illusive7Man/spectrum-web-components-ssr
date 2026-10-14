import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'swatch',
  packages: ['swatch'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/swatch/sp-swatch.js'),
      import('@spectrum-web-components/swatch/sp-swatch-group.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Single selection group (the third swatch selected)</p>
      <sp-swatch-group selects="single" selected='["#2d9d78"]' label="Brand colors">
        <sp-swatch color="#d7373f" value="#d7373f" label="Red"></sp-swatch>
        <sp-swatch color="#e68619" value="#e68619" label="Orange"></sp-swatch>
        <sp-swatch color="#2d9d78" value="#2d9d78" label="Green"></sp-swatch>
        <sp-swatch color="#2680eb" value="#2680eb" label="Blue"></sp-swatch>
        <sp-swatch color="#9256d9" value="#9256d9" label="Purple"></sp-swatch>
      </sp-swatch-group>

      <p style=${CAP}>Multiple selection group, sizes and shapes</p>
      <sp-swatch-group selects="multiple" selected='["#d7373f","#2680eb"]' size="s" label="Multi">
        <sp-swatch color="#d7373f" value="#d7373f" label="Red"></sp-swatch>
        <sp-swatch color="#e68619" value="#e68619" label="Orange"></sp-swatch>
        <sp-swatch color="#2680eb" value="#2680eb" label="Blue"></sp-swatch>
        <sp-swatch color="#9256d9" value="#9256d9" label="Purple" shape="rectangle"></sp-swatch>
        <sp-swatch color="#2d9d78" value="#2d9d78" label="Green" shape="rectangle"></sp-swatch>
      </sp-swatch-group>

      <p style=${CAP}>Rounding, borders, transparency, nothing and mixed value</p>
      <sp-swatch-group label="Variants">
        <sp-swatch color="rgb(255 0 0 / 0.7)" size="m" label="Translucent red"></sp-swatch>
        <sp-swatch color="#2680eb" size="m" rounding="none" label="Square corners"></sp-swatch>
        <sp-swatch color="#2680eb" size="m" rounding="full" label="Fully round"></sp-swatch>
        <sp-swatch color="#ffffff" size="m" border="light" label="White with border"></sp-swatch>
        <sp-swatch color="#2680eb" size="m" border="none" label="No border"></sp-swatch>
        <sp-swatch nothing size="m" label="No color"></sp-swatch>
        <sp-swatch mixed-value size="m" rounding="full" label="Mixed values"></sp-swatch>
        <sp-swatch color="#2680eb" size="m" disabled label="Disabled"></sp-swatch>
      </sp-swatch-group>

      <p style=${CAP}>Sizes (xs to l)</p>
      <sp-swatch-group label="Sizes">
        <sp-swatch color="#9256d9" size="xs" label="Extra small"></sp-swatch>
        <sp-swatch color="#9256d9" size="s" label="Small"></sp-swatch>
        <sp-swatch color="#9256d9" size="m" label="Medium"></sp-swatch>
        <sp-swatch color="#9256d9" size="l" label="Large"></sp-swatch>
      </sp-swatch-group>
    </div>
  `,
  notes:
    'SSR difference: the selected swatch arrives with its final tabindex="0", so its first client update also sets the focusable attribute (client-side rendering sets it on the first swatch only). The group maps its selected JSON array onto child swatches by value (light-DOM querySelectorAll); the swatch fill is an inline CSS custom property computed from color.',
  interactive: true,
};
