import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'dialog',
  packages: ['dialog', 'button', 'underlay'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/dialog/sp-dialog.js'),
      import('@spectrum-web-components/dialog/sp-dialog-base.js'),
      import('@spectrum-web-components/dialog/sp-dialog-wrapper.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Static sp-dialog panel with hero, heading, footer and a button</p>
      <sp-dialog size="s">
        <div slot="hero" style="height:96px;background:linear-gradient(135deg,#4b6cb7,#182848)"></div>
        <h2 slot="heading">Disclaimer</h2>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt
        ut labore et dolore magna aliqua.
        <div slot="footer">Footer information</div>
        <sp-button slot="button" variant="accent">Continue</sp-button>
      </sp-dialog>

      <p style=${CAP}>Dismissable sp-dialog (shows a close button; the button slot is hidden by design)</p>
      <sp-dialog dismissable>
        <h2 slot="heading">Share project</h2>
        Anyone with the link will be able to view this project. You can stop sharing at any time
        from the project settings.
      </sp-dialog>

      <p style=${CAP}>Two buttons and no divider</p>
      <sp-dialog no-divider>
        <h2 slot="heading">Terms of use</h2>
        Please review the terms before you continue using the service.
        <sp-button slot="button" variant="secondary" treatment="outline">Decline</sp-button>
        <sp-button slot="button" variant="accent">Accept</sp-button>
      </sp-dialog>

      <p style=${CAP}>sp-dialog-wrapper, closed (no open attribute): nothing is displayed</p>
      <sp-dialog-wrapper
        headline="Unsaved changes"
        confirm-label="Save"
        secondary-label="Discard"
        cancel-label="Cancel"
        size="s"
      >
        You have unsaved changes. Do you want to save them before leaving?
      </sp-dialog-wrapper>
    </div>
  `,
  notes:
    'sp-dialog is shown as a static panel (it is only the dialog content, no overlay). sp-dialog-wrapper is rendered closed, so its sp-underlay/sp-dialog-base stay hidden.',
  interactive: false,
};
