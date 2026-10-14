import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'button-group',
  packages: ['button-group', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/button-group/sp-button-group.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Horizontal</p>
      <sp-button-group>
        <sp-button variant="secondary" treatment="outline">Cancel</sp-button>
        <sp-button variant="accent">Save changes</sp-button>
        <sp-button variant="negative" treatment="outline">Delete</sp-button>
      </sp-button-group>

      <p style=${CAP}>Vertical</p>
      <sp-button-group vertical>
        <sp-button variant="primary">Button 1</sp-button>
        <sp-button variant="primary">Longer Button 2</sp-button>
        <sp-button variant="primary">Short 3</sp-button>
      </sp-button-group>
    </div>
  `,
  notes: 'Pure layout container around light-DOM sp-button children.',
  interactive: true,
};
