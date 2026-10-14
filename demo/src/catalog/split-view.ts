import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

// Horizontal panes fill the height of the view; vertical panes must not set a height (sp-split-view sizes them).
const BOX = 'padding:12px;box-sizing:border-box;height:100%';
const BOX_VERTICAL = 'padding:12px;box-sizing:border-box';

export const entry: CatalogEntry = {
  name: 'split-view',
  packages: ['split-view'],
  async load() {
    await import('@spectrum-web-components/split-view/sp-split-view.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Horizontal, fixed panes</p>
      <sp-split-view style="width:480px;height:120px;border:1px solid var(--spectrum-gray-300)">
        <div style=${BOX}>Left panel</div>
        <div style=${BOX}>Right panel</div>
      </sp-split-view>

      <p style=${CAP}>Horizontal, resizable with a primary size and limits</p>
      <sp-split-view
        resizable
        primary-size="160"
        primary-min="80"
        secondary-min="80"
        label="Resize the horizontal panels"
        style="width:480px;height:120px;border:1px solid var(--spectrum-gray-300)"
      >
        <div style=${BOX}>Sidebar</div>
        <div style=${BOX}>Main content</div>
      </sp-split-view>

      <p style=${CAP}>Vertical, resizable</p>
      <sp-split-view
        vertical
        resizable
        primary-size="100"
        label="Resize the vertical panels"
        style="width:320px;height:200px;border:1px solid var(--spectrum-gray-300)"
      >
        <div style=${BOX_VERTICAL}>Top panel</div>
        <div style=${BOX_VERTICAL}>Bottom panel</div>
      </sp-split-view>
    </div>
  `,
  notes:
    'Pane sizes are computed from primary-size and the host size (offsetWidth/offsetHeight and getBoundingClientRect), which the server cannot measure; expect the splitter position to settle after hydration, especially for percentage sizes.',
  interactive: false,
};
