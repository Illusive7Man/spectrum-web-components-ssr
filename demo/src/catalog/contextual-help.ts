import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'contextual-help',
  packages: ['contextual-help', 'link', 'popover', 'overlay'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/contextual-help/sp-contextual-help.js'),
      import('@spectrum-web-components/link/sp-link.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Closed: only the trigger button is visible (info, help, custom placement)</p>
    <div style=${ROW}>
      <sp-contextual-help label="Permission required">
        <h2 slot="heading">Permission required</h2>
        Your admin must grant you permission before you can create a segment.
        <sp-link slot="link" href="#contextual-help-permission">Request permission</sp-link>
      </sp-contextual-help>

      <sp-contextual-help variant="help" label="What is a segment?">
        <h2 slot="heading">What is a segment?</h2>
        Segments identify who your visitors are, what devices and services they use, where they
        navigate from, and much more.
        <sp-link slot="link" href="#contextual-help-segments">Learn more about segments</sp-link>
      </sp-contextual-help>

      <sp-contextual-help placement="top-start" label="Top aligned help">
        <h2 slot="heading">Placed above</h2>
        This popover opens above and aligned to the start of its trigger.
      </sp-contextual-help>
    </div>
  `,
  notes:
    'The popover content stays slotted inside a closed internal sp-overlay; only the trigger is rendered visibly.',
  interactive: false,
};
