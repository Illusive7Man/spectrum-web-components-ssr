import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'alert-dialog',
  packages: ['alert-dialog', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/alert-dialog/sp-alert-dialog.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Confirmation (static dialog content, not inside an overlay)</p>
      <sp-alert-dialog
        role="alertdialog"
        aria-labelledby="alert-dialog-confirm-heading"
        aria-describedby="alert-dialog-confirm-message"
        variant="confirmation"
      >
        <h2 id="alert-dialog-confirm-heading" slot="heading">Enable smart filters</h2>
        <p id="alert-dialog-confirm-message">
          Smart filters are nondestructive and will preserve your original images.
        </p>
        <sp-button slot="button" variant="secondary" treatment="outline">Cancel</sp-button>
        <sp-button slot="button" variant="accent" treatment="fill">Enable</sp-button>
      </sp-alert-dialog>

      <p style=${CAP}>Destructive</p>
      <sp-alert-dialog
        role="alertdialog"
        aria-labelledby="alert-dialog-destructive-heading"
        aria-describedby="alert-dialog-destructive-message"
        variant="destructive"
      >
        <h2 id="alert-dialog-destructive-heading" slot="heading">Delete 3 documents?</h2>
        <p id="alert-dialog-destructive-message">
          Are you sure you want to delete the 3 selected documents?
        </p>
        <sp-button slot="button" variant="secondary" treatment="outline">Cancel</sp-button>
        <sp-button slot="button" variant="negative" treatment="fill">Delete</sp-button>
      </sp-alert-dialog>

      <p style=${CAP}>Error</p>
      <sp-alert-dialog
        role="alertdialog"
        aria-labelledby="alert-dialog-error-heading"
        aria-describedby="alert-dialog-error-message"
        variant="error"
      >
        <h2 id="alert-dialog-error-heading" slot="heading">Unable to share</h2>
        <p id="alert-dialog-error-message">
          An error occurred while sharing your project. Please verify the email address and
          try again.
        </p>
        <sp-button slot="button" variant="primary" treatment="outline">Continue</sp-button>
      </sp-alert-dialog>
    </div>
  `,
  notes:
    'Shown as static dialog content (the panel only); there is no sp-overlay/sp-underlay involved so nothing opens on load.',
  interactive: false,
};
