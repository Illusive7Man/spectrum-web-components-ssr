import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'accordion',
  packages: ['accordion'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/accordion/sp-accordion.js'),
      import('@spectrum-web-components/accordion/sp-accordion-item.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Default, first item open, one disabled item</p>
      <sp-accordion style="width:420px">
        <sp-accordion-item label="Account settings" open>
          <div>Manage your profile, password and connected services.</div>
        </sp-accordion-item>
        <sp-accordion-item label="Notifications">
          <div>Choose which events send you an email or a push notification.</div>
        </sp-accordion-item>
        <sp-accordion-item label="Billing" disabled>
          <div>Billing is managed by your organization administrator.</div>
        </sp-accordion-item>
      </sp-accordion>

      <p style=${CAP}>allow-multiple, two items open</p>
      <sp-accordion allow-multiple style="width:420px">
        <sp-accordion-item label="Shipping" open>
          <div>Orders ship within two business days from the nearest warehouse.</div>
        </sp-accordion-item>
        <sp-accordion-item label="Returns">
          <div>Unused items can be returned within 30 days of delivery.</div>
        </sp-accordion-item>
        <sp-accordion-item label="Warranty" open>
          <div>Every product includes a two year limited warranty.</div>
        </sp-accordion-item>
      </sp-accordion>

      <p style=${CAP}>Small size, compact density</p>
      <sp-accordion size="s" density="compact" style="width:420px">
        <sp-accordion-item label="Compact density">
          <div>This accordion is compact.</div>
        </sp-accordion-item>
        <sp-accordion-item label="Small size" open>
          <div>This accordion is also small.</div>
        </sp-accordion-item>
      </sp-accordion>
    </div>
  `,
  notes:
    'Items rely on sp-accordion querying its light-DOM sp-accordion-item children; the open state is reflected from the attribute.',
  interactive: true,
};
