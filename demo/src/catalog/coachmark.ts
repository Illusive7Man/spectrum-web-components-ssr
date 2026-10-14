import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, ON_DARK, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'coachmark',
  packages: ['coachmark', 'action-menu', 'menu', 'button', 'button-group', 'asset'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/coachmark/sp-coachmark.js'),
      import('@spectrum-web-components/coachmark/sp-coach-indicator.js'),
      import('@spectrum-web-components/action-menu/sp-action-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Coach indicators (static pulsing rings)</p>
    <div style=${ROW}>
      <div style="width:64px;height:64px;position:relative">
        <sp-coach-indicator style="position:absolute;inset:0;margin:auto" aria-label="New feature"></sp-coach-indicator>
      </div>
      <div style="width:64px;height:64px;position:relative">
        <sp-coach-indicator quiet style="position:absolute;inset:0;margin:auto" aria-label="New feature, quiet"></sp-coach-indicator>
      </div>
      <div style=${ON_DARK}>
        <sp-coach-indicator static-color="white" aria-label="New feature on dark"></sp-coach-indicator>
      </div>
    </div>

    <p style=${CAP}>Coachmarks, closed (no open attribute)</p>
    <div style=${ROW}>
      <sp-coachmark
        current-step="2"
        total-steps="8"
        primary-cta="Next"
        secondary-cta="Previous"
      >
        <div slot="title">Welcome to the tour</div>
        <div slot="content">
          This coachmark demonstrates the various parts that make up the component.
        </div>
        <img slot="asset" src=${sampleImage(200, 120, 220)} alt="Feature preview" />
        <sp-action-menu slot="actions" label="More actions" placement="bottom-end" quiet>
          <sp-menu-item>Skip tour</sp-menu-item>
          <sp-menu-item>Restart tour</sp-menu-item>
        </sp-action-menu>
      </sp-coachmark>

      <sp-coachmark primary-cta="Got it">
        <div slot="title">Simple coachmark</div>
        <div slot="content">A coachmark without media or progress information.</div>
      </sp-coachmark>
    </div>
  `,
  notes:
    'sp-coachmark is rendered closed (display:none); only the sp-coach-indicator rings are visible. Coachmark extends sp-popover and uses overlay behaviour when opened.',
  interactive: false,
};
