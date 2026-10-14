import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'overlay',
  packages: ['overlay', 'popover', 'dialog', 'tooltip', 'button'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/overlay/sp-overlay.js'),
      import('@spectrum-web-components/popover/sp-popover.js'),
      import('@spectrum-web-components/dialog/sp-dialog.js'),
      import('@spectrum-web-components/tooltip/sp-tooltip.js'),
      import('@spectrum-web-components/button/sp-button.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Overlays are closed: only the triggers are visible</p>
    <div style=${ROW}>
      <sp-button id="overlay-trigger-click" variant="secondary">Click for a popover</sp-button>
      <sp-overlay trigger="overlay-trigger-click@click" placement="bottom">
        <sp-popover>
          <sp-dialog size="s">
            <h2 slot="heading">Clicking opens this popover</h2>
            <p>It could contain anything: forms, menus or plain text.</p>
          </sp-dialog>
        </sp-popover>
      </sp-overlay>

      <sp-button id="overlay-trigger-hover" variant="secondary">Hover for a tooltip</sp-button>
      <sp-overlay trigger="overlay-trigger-hover@hover" placement="bottom">
        <sp-tooltip>This tooltip is triggered by hovering over the button.</sp-tooltip>
      </sp-overlay>

      <sp-button id="overlay-trigger-delayed" variant="secondary">Delayed tooltip</sp-button>
      <sp-overlay trigger="overlay-trigger-delayed@hover" placement="right" delayed>
        <sp-tooltip>I show up after a short delay.</sp-tooltip>
      </sp-overlay>
    </div>

    <p style=${CAP}>Offset placement, click</p>
    <div style=${ROW}>
      <sp-button id="overlay-trigger-offset" variant="primary" treatment="outline">Offset popover</sp-button>
      <sp-overlay trigger="overlay-trigger-offset@click" placement="right-start" offset="24">
        <sp-popover>
          <sp-dialog size="s">
            <h2 slot="heading">Offset</h2>
            <p>An offset of 24px is applied between the trigger and the popover.</p>
          </sp-dialog>
        </sp-popover>
      </sp-overlay>
    </div>
  `,
  notes:
    'Every sp-overlay is closed (no open attribute). The overlay applies top-layer/popover APIs only when opened, so on the server only the slotted content and the trigger buttons are present.',
  interactive: false,
};
