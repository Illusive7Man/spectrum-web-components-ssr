import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'field-label',
  packages: ['field-label', 'textfield'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/field-label/sp-field-label.js'),
      import('@spectrum-web-components/textfield/sp-textfield.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Label above a textfield</p>
      <div>
        <sp-field-label for="field-label-product">Product name</sp-field-label>
        <sp-textfield id="field-label-product" placeholder="Enter a name"></sp-textfield>
      </div>

      <p style=${CAP}>Required</p>
      <div>
        <sp-field-label for="field-label-email" required>Email address</sp-field-label>
        <sp-textfield id="field-label-email" type="email" required placeholder="you@example.com"></sp-textfield>
      </div>

      <p style=${CAP}>Disabled</p>
      <div>
        <sp-field-label for="field-label-disabled" disabled>Account type</sp-field-label>
        <sp-textfield id="field-label-disabled" disabled value="Personal"></sp-textfield>
      </div>

      <p style=${CAP}>Sizes</p>
      <div>
        <sp-field-label for="field-label-s" size="s">Life story (small)</sp-field-label>
        <sp-textfield id="field-label-s" size="s" placeholder="Small"></sp-textfield>
      </div>
      <div>
        <sp-field-label for="field-label-l" size="l">Life story (large)</sp-field-label>
        <sp-textfield id="field-label-l" size="l" placeholder="Large"></sp-textfield>
      </div>

      <p style=${CAP}>Side aligned (start)</p>
      <div style="display:flex;gap:8px;align-items:center">
        <sp-field-label for="field-label-side" side-aligned="start">Nickname</sp-field-label>
        <sp-textfield id="field-label-side" placeholder="Optional"></sp-textfield>
      </div>
    </div>
  `,
  notes: 'The for attribute resolves against sibling ids in the same tree at connect time.',
  interactive: false,
};
