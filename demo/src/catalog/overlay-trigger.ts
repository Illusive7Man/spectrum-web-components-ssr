import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

/**
 * `<overlay-trigger>` (`overlay/overlay-trigger.js`, `overlay/src/OverlayTrigger.js`): a Spectrum custom element
 * WITHOUT the `sp-` prefix. It exercises the client's handling of non-`sp-*` custom elements (the framework-agnostic
 * hydration path must enable it, `?agnostic=1`; see tests/agnostic.spec.ts). Everything stays closed on load.
 */
export const entry: CatalogEntry = {
  name: 'overlay-trigger',
  packages: ['overlay', 'popover', 'tooltip', 'button', 'action-button', 'dialog'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/overlay/overlay-trigger.js'),
      import('@spectrum-web-components/popover/sp-popover.js'),
      import('@spectrum-web-components/tooltip/sp-tooltip.js'),
      import('@spectrum-web-components/button/sp-button.js'),
      import('@spectrum-web-components/action-button/sp-action-button.js'),
      import('@spectrum-web-components/dialog/sp-dialog.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Closed overlay triggers: only the trigger buttons are visible</p>
    <div style=${ROW}>
      <overlay-trigger triggered-by="click" placement="bottom">
        <sp-button slot="trigger" variant="secondary">Click for a popover</sp-button>
        <sp-popover slot="click-content" tip>
          <sp-dialog size="s" no-divider>
            <h2 slot="heading">Popover from an overlay-trigger</h2>
            <p>Click content is slotted into the trigger's click overlay.</p>
          </sp-dialog>
        </sp-popover>
      </overlay-trigger>

      <overlay-trigger triggered-by="hover" placement="top">
        <sp-action-button slot="trigger">Hover for a tooltip</sp-action-button>
        <sp-tooltip slot="hover-content">Hover content is slotted into the hover overlay.</sp-tooltip>
      </overlay-trigger>

      <overlay-trigger triggered-by="click hover" placement="right">
        <sp-button slot="trigger" variant="primary" treatment="outline">Click or hover</sp-button>
        <sp-popover slot="click-content">
          <p style="margin:12px">A popover for clicks.</p>
        </sp-popover>
        <sp-tooltip slot="hover-content">And a tooltip for hovering.</sp-tooltip>
      </overlay-trigger>
    </div>
  `,
  notes:
    'Nothing is open on load. overlay-trigger has no sp- prefix: the trigger gets aria-expanded / aria-haspopup / aria-controls (and the click content a generated id) from the server-side slotchange.',
  interactive: false,
};
