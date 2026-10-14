import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'tray',
  packages: ['tray', 'overlay', 'dialog', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/tray/sp-tray.js'),
      import('@spectrum-web-components/overlay/sp-overlay.js'),
      import('@spectrum-web-components/dialog/sp-dialog.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Trays inside closed modal overlays: only the trigger buttons are visible</p>
    <div style=${ROW}>
      <sp-button id="tray-trigger-dialog" variant="secondary">Open tray with a dialog</sp-button>
      <sp-overlay trigger="tray-trigger-dialog@click" type="modal">
        <sp-tray>
          <sp-dialog size="s" dismissable>
            <h2 slot="heading">New messages</h2>
            You have 5 new messages.
          </sp-dialog>
        </sp-tray>
      </sp-overlay>

      <sp-button id="tray-trigger-custom" variant="secondary">Open tray with custom content</sp-button>
      <sp-overlay trigger="tray-trigger-custom@click" type="modal">
        <sp-tray>
          <div style="display:flex;flex-direction:column;margin:16px">
            <p style="margin-block-start:0">
              Custom content without its own dismiss control, so the tray adds visually hidden
              dismiss buttons.
            </p>
            <sp-button variant="accent">Confirm</sp-button>
          </div>
        </sp-tray>
      </sp-overlay>
    </div>

    <p style=${CAP}>Standalone tray without the open attribute (hidden)</p>
    <sp-tray>
      <p style="margin:16px">This tray is closed.</p>
    </sp-tray>
  `,
  notes:
    'Trays are never opened here. sp-tray is a bottom-anchored modal; rendered closed it contributes only its (hidden) shadow DOM.',
  interactive: false,
};
