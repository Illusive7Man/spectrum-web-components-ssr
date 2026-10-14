import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, ON_DARK, ON_LIGHT, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'link',
  packages: ['link'],
  async load() {
    await import('@spectrum-web-components/link/sp-link.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Primary and secondary</p>
      <p>This is a <sp-link href="#link-primary">primary link</sp-link>.</p>
      <p>This is a <sp-link href="#link-secondary" variant="secondary">secondary link</sp-link>.</p>

      <p style=${CAP}>Quiet</p>
      <p>This is a <sp-link quiet href="#link-quiet">quiet primary link</sp-link>.</p>
      <p>This is a <sp-link quiet variant="secondary" href="#link-quiet-secondary">quiet secondary link</sp-link>.</p>

      <p style=${CAP}>Disabled and download</p>
      <p>This is a <sp-link disabled href="#link-disabled">disabled link</sp-link>.</p>
      <p>This is a <sp-link download="notes.txt" href="#link-download">download link</sp-link>.</p>

      <p style=${CAP}>Static colors</p>
      <div style=${ON_DARK}>
        <span>This <sp-link static-color="white" href="#link-white">link</sp-link> is over a dark background.</span>
      </div>
      <div style=${ON_LIGHT}>
        <span>This <sp-link static-color="black" href="#link-black">link</sp-link> is over a light background.</span>
      </div>
    </div>
  `,
  notes: 'The anchor is rendered inside the shadow root and carries the href/target/download attributes.',
  interactive: true,
};
