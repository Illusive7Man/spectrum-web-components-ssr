import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'action-group',
  packages: ['action-group', 'action-button', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/action-group/sp-action-group.js'),
      import('@spectrum-web-components/action-button/sp-action-button.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-magnify.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Single selection, emphasized (second button selected)</p>
      <sp-action-group selects="single" emphasized label="Single selection demo group">
        <sp-action-button>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Button 1
        </sp-action-button>
        <sp-action-button selected>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Longer Button 2
        </sp-action-button>
        <sp-action-button>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Short 3
        </sp-action-button>
      </sp-action-group>

      <p style=${CAP}>Multiple selection (first and third selected)</p>
      <sp-action-group selects="multiple" label="Multiple selection demo group">
        <sp-action-button selected>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Button 1
        </sp-action-button>
        <sp-action-button>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Longer Button 2
        </sp-action-button>
        <sp-action-button selected>
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
          Short 3
        </sp-action-button>
      </sp-action-group>

      <p style=${CAP}>Selection driven by the group's selected attribute</p>
      <sp-action-group selects="single" selected='["second"]' label="Selection by value">
        <sp-action-button value="first">First</sp-action-button>
        <sp-action-button value="second">Second</sp-action-button>
        <sp-action-button value="third">Third</sp-action-button>
      </sp-action-group>

      <p style=${CAP}>Compact</p>
      <sp-action-group compact label="Compact group">
        <sp-action-button>Left</sp-action-button>
        <sp-action-button>Center</sp-action-button>
        <sp-action-button>Right</sp-action-button>
      </sp-action-group>

      <p style=${CAP}>Quiet, icon only</p>
      <sp-action-group quiet label="Quiet group">
        <sp-action-button label="Zoom in">
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
        </sp-action-button>
        <sp-action-button label="Zoom out">
          <sp-icon-magnify slot="icon"></sp-icon-magnify>
        </sp-action-button>
      </sp-action-group>

      <p style=${CAP}>Vertical</p>
      <sp-action-group vertical label="Vertical group">
        <sp-action-button>Top</sp-action-button>
        <sp-action-button>Middle</sp-action-button>
        <sp-action-button>Bottom</sp-action-button>
      </sp-action-group>
    </div>
  `,
  notes:
    'The group reads and writes selection state on its light-DOM sp-action-button children (querySelectorAll + slotchange), including the JSON selected attribute.',
  interactive: true,
};
