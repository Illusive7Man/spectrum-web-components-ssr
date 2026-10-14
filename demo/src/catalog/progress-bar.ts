import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'progress-bar',
  packages: ['progress-bar'],
  async load() {
    await import('@spectrum-web-components/progress-bar/sp-progress-bar.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Determinate with a label</p>
      <sp-progress-bar label="Generating images" progress="58" style="width:280px"></sp-progress-bar>

      <p style=${CAP}>Indeterminate</p>
      <sp-progress-bar label="Connecting to server" indeterminate style="width:280px"></sp-progress-bar>

      <p style=${CAP}>Side label</p>
      <sp-progress-bar label="Uploading" side-label progress="35" style="width:360px"></sp-progress-bar>

      <p style=${CAP}>Sizes</p>
      <sp-progress-bar size="s" label="Small" progress="22" style="width:280px"></sp-progress-bar>
      <sp-progress-bar size="l" label="Large" progress="22" style="width:280px"></sp-progress-bar>
      <sp-progress-bar size="xl" label="Extra large" progress="22" style="width:280px"></sp-progress-bar>

      <p style=${CAP}>Static white over a colored background</p>
      <div style="padding:16px;background:#2f4f6f;border-radius:8px">
        <sp-progress-bar static-color="white" label="Loaded a large amount" progress="77" style="width:280px"></sp-progress-bar>
      </div>
    </div>
  `,
  notes: 'Fill width and aria-valuenow come from the progress attribute; no timers are involved.',
  interactive: false,
};
