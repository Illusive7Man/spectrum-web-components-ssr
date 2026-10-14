import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {GRID, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'card',
  packages: ['card', 'action-menu', 'menu', 'asset'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/card/sp-card.js'),
      import('@spectrum-web-components/action-menu/sp-action-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/menu/sp-menu-divider.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Standard, horizontal, quiet and file-asset cards</p>
    <div style=${GRID}>
      <sp-card heading="Lakeside sunrise" subheading="JPG photo">
        <img slot="cover-photo" src=${sampleImage(300, 200, 200)} alt="Sunrise over a lake" />
        <div slot="footer">Footer</div>
        <sp-action-menu label="More actions" slot="actions" placement="bottom-end" quiet>
          <sp-menu-item>Deselect</sp-menu-item>
          <sp-menu-item>Select inverse</sp-menu-item>
          <sp-menu-divider></sp-menu-divider>
          <sp-menu-item>Save selection</sp-menu-item>
        </sp-action-menu>
      </sp-card>

      <sp-card horizontal heading="Mountain pass" subheading="JPG photo">
        <img slot="cover-photo" alt="" src=${sampleImage(120, 160, 120)} />
        <div slot="description">10/15/18</div>
      </sp-card>

      <sp-card variant="quiet" heading="Quiet card" subheading="PNG image">
        <img slot="preview" alt="" src=${sampleImage(220, 260, 300)} />
        <div slot="description">02/03/24</div>
        <sp-action-menu label="More actions" slot="actions" placement="bottom-end" quiet>
          <sp-menu-item>Rename</sp-menu-item>
          <sp-menu-item>Delete</sp-menu-item>
        </sp-action-menu>
      </sp-card>

      <sp-card heading="Budget 2025.xlsx" subheading="Spreadsheet" asset="file">
        <div slot="description">Edited 3 hours ago</div>
        <div slot="footer">Footer</div>
      </sp-card>
    </div>

    <p style=${CAP}>Gallery and selected toggle card</p>
    <div style=${GRID}>
      <sp-card variant="gallery" heading="Gallery card" subheading="JPG photo">
        <img slot="preview" alt="" src=${sampleImage(532, 192, 40)} />
        <div slot="description">10/15/18</div>
        <div slot="footer">Footer</div>
      </sp-card>

      <sp-card toggles selected heading="Selected card" subheading="Toggle card">
        <img slot="cover-photo" alt="" src=${sampleImage(300, 160, 330)} />
        <div slot="footer">Selected</div>
      </sp-card>
    </div>
  `,
  notes:
    'Slots (cover-photo/preview/description/footer/actions) are detected through light-DOM presence queries. Images are inline data: URIs.',
  interactive: false,
};
