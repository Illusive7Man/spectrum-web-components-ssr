import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'progress-circle',
  packages: ['progress-circle'],
  async load() {
    await import('@spectrum-web-components/progress-circle/sp-progress-circle.js');
  },
  render: () => html`
    <p style=${CAP}>Determinate: 0, 25, 50, 75, 100</p>
    <div style=${ROW}>
      <sp-progress-circle label="Download progress" progress="0"></sp-progress-circle>
      <sp-progress-circle label="Download progress" progress="25"></sp-progress-circle>
      <sp-progress-circle label="Download progress" progress="50"></sp-progress-circle>
      <sp-progress-circle label="Download progress" progress="75"></sp-progress-circle>
      <sp-progress-circle label="Download progress" progress="100"></sp-progress-circle>
    </div>

    <p style=${CAP}>Indeterminate</p>
    <div style=${ROW}>
      <sp-progress-circle label="Connecting to server" indeterminate></sp-progress-circle>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-progress-circle size="s" label="Small" progress="48"></sp-progress-circle>
      <sp-progress-circle size="m" label="Medium" progress="48"></sp-progress-circle>
      <sp-progress-circle size="l" label="Large" progress="48"></sp-progress-circle>
    </div>

    <p style=${CAP}>Static white over a colored background</p>
    <div style="display:inline-flex;padding:16px;background:#2f4f6f;border-radius:8px">
      <sp-progress-circle static-color="white" label="Loading" progress="64"></sp-progress-circle>
    </div>
  `,
  notes: 'The ring is drawn with CSS rotation derived from the progress attribute; the indeterminate animation is CSS only.',
  interactive: false,
};
