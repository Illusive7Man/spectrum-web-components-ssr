import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'search',
  packages: ['search', 'help-text'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/search/sp-search.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Empty, with a placeholder, with a value (clear button shown)</p>
    <div style=${ROW}>
      <sp-search label="Search the docs"></sp-search>
      <sp-search label="Search flights" placeholder="Enter a search term"></sp-search>
      <sp-search label="Search flights" value="Flights to Hawaii"></sp-search>
    </div>

    <p style=${CAP}>Quiet, disabled</p>
    <div style=${ROW}>
      <sp-search quiet label="Quiet search" placeholder="Quiet"></sp-search>
      <sp-search disabled label="Disabled search" value="Disabled"></sp-search>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-search size="s" label="Small search"></sp-search>
      <sp-search size="l" label="Large search"></sp-search>
      <sp-search size="xl" label="Extra large search"></sp-search>
    </div>

    <p style=${CAP}>With help text</p>
    <div style=${ROW}>
      <sp-search label="Search with help">
        <sp-help-text slot="help-text">Enter a search term.</sp-help-text>
        <sp-help-text slot="negative-help-text">Invalid search term.</sp-help-text>
      </sp-search>
    </div>
  `,
  notes:
    'Renders a form with a textfield; the clear button visibility depends on the value being non-empty at render time.',
  interactive: true,
};
