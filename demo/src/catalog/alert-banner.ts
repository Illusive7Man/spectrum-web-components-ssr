import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'alert-banner',
  packages: ['alert-banner', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/alert-banner/sp-alert-banner.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Default (neutral)</p>
      <sp-alert-banner open>All documents in this folder have been archived</sp-alert-banner>

      <p style=${CAP}>With an action button</p>
      <sp-alert-banner open>
        Your trial has expired
        <sp-button
          treatment="outline"
          static-color="white"
          variant="secondary"
          slot="action"
        >
          Buy now
        </sp-button>
      </sp-alert-banner>

      <p style=${CAP}>Info, dismissible, with an action</p>
      <sp-alert-banner open variant="info" dismissible>
        Your trial will expire in 3 days
        <sp-button treatment="outline" static-color="white" slot="action">Buy now</sp-button>
      </sp-alert-banner>

      <p style=${CAP}>Negative, dismissible</p>
      <sp-alert-banner open variant="negative" dismissible>
        Connection interrupted. Check your network to continue
      </sp-alert-banner>
    </div>
  `,
  notes:
    'Banners are inline (not overlays) so they are shown with open. Dismissible banners render an internal close button.',
  interactive: false,
};
