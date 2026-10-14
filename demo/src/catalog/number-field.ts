import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'number-field',
  packages: ['number-field', 'field-label', 'help-text'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/number-field/sp-number-field.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
    ]);
  },
  render: () => html`
    <div style=${ROW}>
      <div>
        <sp-field-label for="number-field-quantity">Quantity</sp-field-label>
        <sp-number-field id="number-field-quantity" value="3" min="0" max="20"></sp-number-field>
      </div>

      <div>
        <sp-field-label for="number-field-exposure">Adjust exposure</sp-field-label>
        <sp-number-field
          id="number-field-exposure"
          value="0.5"
          format-options='{"signDisplay":"exceptZero","minimumFractionDigits":1,"maximumFractionDigits":2}'
        ></sp-number-field>
      </div>

      <div>
        <sp-field-label for="number-field-tax">Sales tax</sp-field-label>
        <sp-number-field
          id="number-field-tax"
          value="0.05"
          format-options='{"style":"percent"}'
        ></sp-number-field>
      </div>

      <div>
        <sp-field-label for="number-field-amount">Transaction amount</sp-field-label>
        <sp-number-field
          id="number-field-amount"
          value="45"
          format-options='{"style":"currency","currency":"EUR","currencyDisplay":"code","currencySign":"accounting"}'
        ></sp-number-field>
      </div>

      <div>
        <sp-field-label for="number-field-width">Package width</sp-field-label>
        <sp-number-field
          id="number-field-width"
          value="4"
          format-options='{"style":"unit","unit":"inch"}'
        ></sp-number-field>
      </div>
    </div>

    <p style=${CAP}>No stepper, quiet, disabled, read only</p>
    <div style=${ROW}>
      <sp-number-field label="No stepper" value="1024" hide-stepper></sp-number-field>
      <sp-number-field label="Quiet" value="64" quiet></sp-number-field>
      <sp-number-field label="Disabled" value="12" disabled></sp-number-field>
      <sp-number-field label="Read only" value="7" readonly></sp-number-field>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-number-field label="Small" size="s" value="1024"></sp-number-field>
      <sp-number-field label="Medium" size="m" value="1024"></sp-number-field>
      <sp-number-field label="Large" size="l" value="1024"></sp-number-field>
      <sp-number-field label="Extra large" size="xl" value="1024"></sp-number-field>
    </div>

    <div style=${COL}>
      <p style=${CAP}>With help text</p>
      <sp-number-field label="Seats" value="5" min="1">
        <sp-help-text slot="help-text">Enter the number of seats you need.</sp-help-text>
      </sp-number-field>
    </div>
  `,
  notes:
    'The formatted display value is produced with Intl.NumberFormat from format-options; stepper buttons are part of the shadow DOM.',
  interactive: true,
};
