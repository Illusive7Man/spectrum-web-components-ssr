import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, ON_DARK, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'action-button',
  packages: ['action-button', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/action-button/sp-action-button.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-magnify.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Default, with icon, icon only, quiet, emphasized</p>
    <div style=${ROW}>
      <sp-action-button>Edit</sp-action-button>
      <sp-action-button>
        <sp-icon-edit slot="icon"></sp-icon-edit>
        Edit
      </sp-action-button>
      <sp-action-button label="Settings">
        <sp-icon-settings slot="icon"></sp-icon-settings>
      </sp-action-button>
      <sp-action-button quiet>Quiet</sp-action-button>
      <sp-action-button emphasized>Emphasized</sp-action-button>
    </div>

    <p style=${CAP}>Selected, toggles, disabled, hold affordance, link</p>
    <div style=${ROW}>
      <sp-action-button selected>
        <sp-icon-magnify slot="icon"></sp-icon-magnify>
        Selected
      </sp-action-button>
      <sp-action-button toggles>Toggle me</sp-action-button>
      <sp-action-button disabled>Disabled</sp-action-button>
      <sp-action-button hold-affordance label="Zoom">
        <sp-icon-magnify slot="icon"></sp-icon-magnify>
      </sp-action-button>
      <sp-action-button href="#action-button-link">Visit section</sp-action-button>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-action-button size="s">Small</sp-action-button>
      <sp-action-button size="m">Medium</sp-action-button>
      <sp-action-button size="l">Large</sp-action-button>
      <sp-action-button size="xl">Extra large</sp-action-button>
    </div>

    <p style=${CAP}>Static color on a dark background</p>
    <div style=${ON_DARK}>
      <sp-action-button static-color="white">White</sp-action-button>
      <sp-action-button static-color="white" quiet>Quiet white</sp-action-button>
    </div>
  `,
  notes:
    'Icon-only buttons rely on ObserveSlotPresence/ObserveSlotText (light-DOM queries) to decide label vs icon-only layout.',
  interactive: true,
};
