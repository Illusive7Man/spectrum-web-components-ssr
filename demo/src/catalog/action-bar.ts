import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'action-bar',
  packages: ['action-bar', 'action-button', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/action-bar/sp-action-bar.js'),
      import('@spectrum-web-components/action-button/sp-action-button.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-more.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-delete.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Default variant, shown (not an overlay), with buttons</p>
      <sp-action-bar open>
        2 selected
        <sp-action-button slot="buttons" label="Edit">
          <sp-icon-edit slot="icon"></sp-icon-edit>
        </sp-action-button>
        <sp-action-button slot="buttons" label="More">
          <sp-icon-more slot="icon"></sp-icon-more>
        </sp-action-button>
      </sp-action-bar>

      <p style=${CAP}>Emphasized</p>
      <sp-action-bar open emphasized>
        5 selected
        <sp-action-button slot="buttons" label="Edit">
          <sp-icon-edit slot="icon"></sp-icon-edit>
        </sp-action-button>
        <sp-action-button slot="buttons" label="Delete">
          <sp-icon-delete slot="icon"></sp-icon-delete>
        </sp-action-button>
      </sp-action-bar>

      <p style=${CAP}>Closed (hidden until toggled)</p>
      <sp-action-bar>
        1 selected
        <sp-action-button slot="buttons" label="Edit">
          <sp-icon-edit slot="icon"></sp-icon-edit>
        </sp-action-button>
      </sp-action-bar>
    </div>
  `,
  notes:
    'Default variant is in normal flow (no overlay). Buttons use slot="buttons"; the internal close button is part of the shadow DOM.',
  interactive: false,
};
