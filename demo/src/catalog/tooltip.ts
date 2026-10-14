import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'tooltip',
  packages: ['tooltip', 'action-button', 'button', 'overlay', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/tooltip/sp-tooltip.js'),
      import('@spectrum-web-components/action-button/sp-action-button.js'),
      import('@spectrum-web-components/button/sp-button.js'),
      import('@spectrum-web-components/overlay/sp-overlay.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-info.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-book.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Self-managed tooltips: the trigger is shown, the tooltip stays closed</p>
    <div style=${ROW}>
      <sp-action-button>
        Items
        <sp-tooltip self-managed>Use items during battle.</sp-tooltip>
      </sp-action-button>

      <sp-action-button>
        Delayed
        <sp-tooltip self-managed delayed>This tooltip shows up after a delay.</sp-tooltip>
      </sp-action-button>

      <sp-action-button size="s" label="Save progress">
        <sp-icon-book slot="icon"></sp-icon-book>
        <sp-tooltip self-managed placement="right">Save progress.</sp-tooltip>
      </sp-action-button>
    </div>

    <p style=${CAP}>Tooltip inside a hover overlay bound to a button</p>
    <div style=${ROW}>
      <sp-button id="tooltip-trigger" variant="secondary">Hover me</sp-button>
      <sp-overlay trigger="tooltip-trigger@hover" placement="bottom">
        <sp-tooltip>
          <sp-icon-info slot="icon"></sp-icon-info>
          Tooltip message with an icon
        </sp-tooltip>
      </sp-overlay>
    </div>

    <p style=${CAP}>Variants, closed</p>
    <div style=${ROW}>
      <sp-tooltip placement="top" variant="info">Info tooltip</sp-tooltip>
      <sp-tooltip placement="top" variant="positive">Positive tooltip</sp-tooltip>
      <sp-tooltip placement="top" variant="negative">Negative tooltip</sp-tooltip>
    </div>
  `,
  notes:
    'No tooltip is open. A self-managed tooltip finds its trigger via parentElement/parentNode at connect time and wires hover/focus listeners in the browser only.',
  interactive: false,
};
