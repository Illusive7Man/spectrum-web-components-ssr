import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'breadcrumbs',
  packages: ['breadcrumbs', 'action-menu', 'menu'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/breadcrumbs/sp-breadcrumbs.js'),
      import('@spectrum-web-components/breadcrumbs/sp-breadcrumb-item.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Default</p>
      <sp-breadcrumbs>
        <sp-breadcrumb-item value="home">Home</sp-breadcrumb-item>
        <sp-breadcrumb-item value="trend">Trend</sp-breadcrumb-item>
        <sp-breadcrumb-item value="assets">March 2019 Assets</sp-breadcrumb-item>
      </sp-breadcrumbs>

      <p style=${CAP}>Compact</p>
      <sp-breadcrumbs compact>
        <sp-breadcrumb-item value="1">Home</sp-breadcrumb-item>
        <sp-breadcrumb-item value="2">Trend</sp-breadcrumb-item>
        <sp-breadcrumb-item value="3">March 2019 Assets</sp-breadcrumb-item>
      </sp-breadcrumbs>

      <p style=${CAP}>Eight items, overflow collapsed into a menu (max-visible-items=4)</p>
      <sp-breadcrumbs max-visible-items="4">
        <sp-breadcrumb-item value="your_stuff">Your stuff</sp-breadcrumb-item>
        <sp-breadcrumb-item value="team">Team</sp-breadcrumb-item>
        <sp-breadcrumb-item value="in_progress">In progress</sp-breadcrumb-item>
        <sp-breadcrumb-item value="files">Files</sp-breadcrumb-item>
        <sp-breadcrumb-item value="trend">Trend</sp-breadcrumb-item>
        <sp-breadcrumb-item value="winter">Winter</sp-breadcrumb-item>
        <sp-breadcrumb-item value="assets">Assets</sp-breadcrumb-item>
        <sp-breadcrumb-item value="18x24">18x24</sp-breadcrumb-item>
      </sp-breadcrumbs>

      <p style=${CAP}>Only the current page and its root visible (max-visible-items=1)</p>
      <sp-breadcrumbs max-visible-items="1">
        <sp-breadcrumb-item value="docs">Docs</sp-breadcrumb-item>
        <sp-breadcrumb-item value="components">Components</sp-breadcrumb-item>
        <sp-breadcrumb-item value="breadcrumbs">Breadcrumbs</sp-breadcrumb-item>
      </sp-breadcrumbs>
    </div>
  `,
  notes:
    'SSR difference: the overflow menu (sp-action-menu) starts keyboard focus on the selected item, client-side rendering on the first one (as for sp-picker). Without layout the server shows max-visible-items items. Overflow handling queries the sp-breadcrumb-item children and renders an sp-action-menu in the shadow root (closed).',
  interactive: true,
};
