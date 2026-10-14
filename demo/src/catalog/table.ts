import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'table',
  packages: ['table', 'checkbox'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/table/sp-table.js'),
      import('@spectrum-web-components/table/sp-table-head.js'),
      import('@spectrum-web-components/table/sp-table-head-cell.js'),
      import('@spectrum-web-components/table/sp-table-body.js'),
      import('@spectrum-web-components/table/sp-table-row.js'),
      import('@spectrum-web-components/table/sp-table-cell.js'),
      import('@spectrum-web-components/table/sp-table-checkbox-cell.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Basic table</p>
      <sp-table style="width:520px">
        <sp-table-head>
          <sp-table-head-cell>File name</sp-table-head-cell>
          <sp-table-head-cell>Type</sp-table-head-cell>
          <sp-table-head-cell>Size</sp-table-head-cell>
          <sp-table-head-cell>Status</sp-table-head-cell>
        </sp-table-head>
        <sp-table-body>
          <sp-table-row>
            <sp-table-cell>Budget</sp-table-cell>
            <sp-table-cell>PDF</sp-table-cell>
            <sp-table-cell>89 KB</sp-table-cell>
            <sp-table-cell>Reviewed</sp-table-cell>
          </sp-table-row>
          <sp-table-row>
            <sp-table-cell>Onboarding</sp-table-cell>
            <sp-table-cell>XLS</sp-table-cell>
            <sp-table-cell>120 KB</sp-table-cell>
            <sp-table-cell>Draft</sp-table-cell>
          </sp-table-row>
          <sp-table-row>
            <sp-table-cell>Proposal</sp-table-cell>
            <sp-table-cell>PDF</sp-table-cell>
            <sp-table-cell>139 KB</sp-table-cell>
            <sp-table-cell>Published</sp-table-cell>
          </sp-table-row>
        </sp-table-body>
      </sp-table>

      <p style=${CAP}>Multiple selection, two rows selected, sortable header</p>
      <sp-table
        selects="multiple"
        select-all-label="Select all files"
        selected='["row1","row3"]'
        style="width:520px"
      >
        <sp-table-head>
          <sp-table-head-cell sortable sort-direction="asc" sort-key="name">File name</sp-table-head-cell>
          <sp-table-head-cell sortable sort-key="type">Type</sp-table-head-cell>
          <sp-table-head-cell>Size</sp-table-head-cell>
        </sp-table-head>
        <sp-table-body>
          <sp-table-row value="row1">
            <sp-table-cell>Budget</sp-table-cell>
            <sp-table-cell>PDF</sp-table-cell>
            <sp-table-cell>89 KB</sp-table-cell>
          </sp-table-row>
          <sp-table-row value="row2">
            <sp-table-cell>Onboarding</sp-table-cell>
            <sp-table-cell>XLS</sp-table-cell>
            <sp-table-cell>120 KB</sp-table-cell>
          </sp-table-row>
          <sp-table-row value="row3">
            <sp-table-cell>Proposal</sp-table-cell>
            <sp-table-cell>PDF</sp-table-cell>
            <sp-table-cell>139 KB</sp-table-cell>
          </sp-table-row>
        </sp-table-body>
      </sp-table>

      <p style=${CAP}>Single selection, quiet, compact density</p>
      <sp-table
        selects="single"
        selected='["b"]'
        quiet
        density="compact"
        style="width:520px"
      >
        <sp-table-head>
          <sp-table-head-cell>Region</sp-table-head-cell>
          <sp-table-head-cell>Orders</sp-table-head-cell>
        </sp-table-head>
        <sp-table-body>
          <sp-table-row value="a">
            <sp-table-cell>North</sp-table-cell>
            <sp-table-cell>1,204</sp-table-cell>
          </sp-table-row>
          <sp-table-row value="b">
            <sp-table-cell>South</sp-table-cell>
            <sp-table-cell>987</sp-table-cell>
          </sp-table-row>
          <sp-table-row value="c">
            <sp-table-cell>East</sp-table-cell>
            <sp-table-cell>1,562</sp-table-cell>
          </sp-table-row>
        </sp-table-body>
      </sp-table>
    </div>
  `,
  notes:
    'SSR difference: with selects set, sp-table inserts sp-table-checkbox-cell elements into the light DOM of the head and every row at runtime (manageCheckboxes); the server does not render light-DOM insertions, so the checkbox column appears on hydration (flicker).',
  interactive: false,
};
