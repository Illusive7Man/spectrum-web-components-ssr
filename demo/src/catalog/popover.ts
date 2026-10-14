import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'popover',
  packages: ['popover', 'overlay', 'button', 'dialog'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/popover/sp-popover.js'),
      import('@spectrum-web-components/overlay/sp-overlay.js'),
      import('@spectrum-web-components/button/sp-button.js'),
      import('@spectrum-web-components/dialog/sp-dialog.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Popovers inside closed overlays: only the trigger buttons are visible</p>
    <div style=${ROW}>
      <sp-button id="popover-trigger-text" variant="secondary">Text popover</sp-button>
      <sp-overlay trigger="popover-trigger-text@click" placement="bottom">
        <sp-popover tip>
          Cupcake ipsum dolor sit amet jelly beans. Chocolate jelly caramels.
        </sp-popover>
      </sp-overlay>

      <sp-button id="popover-trigger-dialog" variant="secondary">Dialog popover</sp-button>
      <sp-overlay trigger="popover-trigger-dialog@click" placement="bottom-start">
        <sp-popover>
          <sp-dialog size="s">
            <h3 slot="heading">Popover title</h3>
            Cupcake ipsum dolor sit amet jelly beans. Chocolate jelly caramels. Icing souffle
            chupa chups donut cheesecake.
          </sp-dialog>
        </sp-popover>
      </sp-overlay>
    </div>

    <p style=${CAP}>Standalone popovers without the open attribute (hidden)</p>
    <div style=${ROW}>
      <sp-popover placement="bottom">
        <p style="margin:12px">A closed popover keeps its content in the DOM but is not displayed.</p>
      </sp-popover>
    </div>
  `,
  notes:
    'No popover is open on load. The open attribute and the overlay positioning (floating-ui) are skipped entirely.',
  interactive: false,
};
