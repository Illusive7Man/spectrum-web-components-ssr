import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'asset',
  packages: ['asset'],
  async load() {
    await import('@spectrum-web-components/asset/sp-asset.js');
  },
  render: () => html`
    <p style=${CAP}>Image asset</p>
    <div style=${ROW}>
      <sp-asset style="height:128px">
        <img src=${sampleImage(256, 256, 200)} alt="Abstract blue landscape" />
      </sp-asset>
    </div>

    <p style=${CAP}>File assets (without and with a label)</p>
    <div style=${ROW}>
      <sp-asset variant="file"></sp-asset>
      <sp-asset variant="file" label="Quarterly report.pdf"></sp-asset>
    </div>

    <p style=${CAP}>Folder assets (without and with a label)</p>
    <div style=${ROW}>
      <sp-asset variant="folder"></sp-asset>
      <sp-asset variant="folder" label="Project files"></sp-asset>
    </div>
  `,
  notes: 'Images are inline data: URIs so the page needs no network access.',
  interactive: false,
};
