import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'avatar',
  packages: ['avatar'],
  async load() {
    await import('@spectrum-web-components/avatar/sp-avatar.js');
  },
  render: () => html`
    <p style=${CAP}>Sizes 50, 100, 200, 400, 600</p>
    <div style=${ROW}>
      <sp-avatar size="50" label="Dana Okafor" src=${sampleImage(120, 120, 10)}></sp-avatar>
      <sp-avatar size="100" label="Dana Okafor" src=${sampleImage(120, 120, 60)}></sp-avatar>
      <sp-avatar size="200" label="Dana Okafor" src=${sampleImage(120, 120, 120)}></sp-avatar>
      <sp-avatar size="400" label="Dana Okafor" src=${sampleImage(120, 120, 200)}></sp-avatar>
      <sp-avatar size="600" label="Dana Okafor" src=${sampleImage(120, 120, 280)}></sp-avatar>
    </div>

    <p style=${CAP}>Decorative (no accessible name) and linked</p>
    <div style=${ROW}>
      <sp-avatar is-decorative src=${sampleImage(120, 120, 320)}></sp-avatar>
      <sp-avatar
        label="View Dana Okafor's profile"
        href="#avatar-profile"
        src=${sampleImage(120, 120, 150)}
      ></sp-avatar>
    </div>
  `,
  notes: 'Images are inline data: URIs. The linked avatar renders as an anchor inside its shadow DOM.',
  interactive: false,
};
