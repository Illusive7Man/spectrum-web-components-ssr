import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'thumbnail',
  packages: ['thumbnail'],
  async load() {
    await import('@spectrum-web-components/thumbnail/sp-thumbnail.js');
  },
  render: () => html`
    <p style=${CAP}>Sizes 50, 100, 200, 300, 500</p>
    <div style=${ROW}>
      <sp-thumbnail size="50"><img src=${sampleImage(100, 100, 30)} alt="Sunrise" /></sp-thumbnail>
      <sp-thumbnail size="100"><img src=${sampleImage(100, 100, 90)} alt="Forest" /></sp-thumbnail>
      <sp-thumbnail size="200"><img src=${sampleImage(100, 100, 160)} alt="Lake" /></sp-thumbnail>
      <sp-thumbnail size="300"><img src=${sampleImage(100, 100, 220)} alt="Mountains" /></sp-thumbnail>
      <sp-thumbnail size="500"><img src=${sampleImage(100, 100, 290)} alt="Sunset" /></sp-thumbnail>
    </div>

    <p style=${CAP}>Cover fit, layered, and a custom background</p>
    <div style=${ROW}>
      <sp-thumbnail size="300" cover><img src=${sampleImage(300, 120, 10)} alt="Wide landscape" /></sp-thumbnail>
      <sp-thumbnail size="300" layer><img src=${sampleImage(120, 120, 250)} alt="Layered picture" /></sp-thumbnail>
      <sp-thumbnail size="300" background="#f5d76e"><img src=${sampleImage(60, 60, 330)} alt="Small picture" /></sp-thumbnail>
    </div>
  `,
  notes: 'Images are inline data: URIs; the slotted img is moved into the default slot of the thumbnail.',
  interactive: false,
};
