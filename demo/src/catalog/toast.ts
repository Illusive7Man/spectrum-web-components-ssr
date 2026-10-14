import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'toast',
  packages: ['toast', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/toast/sp-toast.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Toasts are closed (no open attribute), so nothing is displayed and no timeout starts</p>
      <sp-toast>This is important information that you should read, soon.</sp-toast>

      <sp-toast variant="positive">Your changes have been saved.</sp-toast>

      <sp-toast variant="negative" icon-label="Warning">
        The upload failed because the connection was lost.
        <sp-button
          slot="action"
          static-color="white"
          variant="secondary"
          treatment="outline"
        >
          Retry
        </sp-button>
      </sp-toast>

      <sp-toast variant="info" timeout="6000">This message would disappear after six seconds.</sp-toast>
    </div>
  `,
  notes:
    'Closed on purpose: an open toast with a timeout would start a timer on connect. The icon and variant are rendered in the shadow root even while closed.',
  interactive: false,
};
