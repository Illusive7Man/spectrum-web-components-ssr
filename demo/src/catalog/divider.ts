import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ON_DARK, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'divider',
  packages: ['divider'],
  async load() {
    await import('@spectrum-web-components/divider/sp-divider.js');
  },
  render: () => html`
    <div style="max-width:480px">
      <p style=${CAP}>Small</p>
      <sp-divider size="s"></sp-divider>
      <p>Small dividers separate similar items such as table rows or action buttons in a group.</p>

      <p style=${CAP}>Medium (default)</p>
      <sp-divider size="m"></sp-divider>
      <p>Medium dividers separate subsections on a page or groups of components such as panels.</p>

      <p style=${CAP}>Large</p>
      <sp-divider size="l"></sp-divider>
      <p>Large dividers are used only for page titles or section titles.</p>
    </div>

    <p style=${CAP}>Vertical</p>
    <div style="display:flex;align-items:center;height:32px;gap:12px;margin-block-end:16px">
      <span>Cut</span>
      <sp-divider size="s" vertical style="align-self:stretch;height:auto"></sp-divider>
      <span>Copy</span>
      <sp-divider size="m" vertical style="align-self:stretch;height:auto"></sp-divider>
      <span>Paste</span>
    </div>

    <p style=${CAP}>Static white on a colored background</p>
    <div style=${ON_DARK}>
      <div style="width:240px">
        <span>Above</span>
        <sp-divider size="s" static-color="white"></sp-divider>
        <span>Below</span>
      </div>
    </div>
  `,
  notes: 'Stateless; role="separator" and aria-orientation are applied in firstUpdated.',
  interactive: false,
};
