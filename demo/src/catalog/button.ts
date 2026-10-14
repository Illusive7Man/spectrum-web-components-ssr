import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, ON_DARK, ON_LIGHT, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'button',
  packages: ['button', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/button/sp-button.js'),
      import('@spectrum-web-components/button/sp-clear-button.js'),
      import('@spectrum-web-components/button/sp-close-button.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-add.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-download.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Fill treatment: accent, primary, secondary, negative</p>
    <div style=${ROW}>
      <sp-button variant="accent">Accent</sp-button>
      <sp-button variant="primary">Primary</sp-button>
      <sp-button variant="secondary">Secondary</sp-button>
      <sp-button variant="negative">Negative</sp-button>
    </div>

    <p style=${CAP}>Outline treatment</p>
    <div style=${ROW}>
      <sp-button variant="accent" treatment="outline">Accent</sp-button>
      <sp-button variant="primary" treatment="outline">Primary</sp-button>
      <sp-button variant="secondary" treatment="outline">Secondary</sp-button>
      <sp-button variant="negative" treatment="outline">Negative</sp-button>
    </div>

    <p style=${CAP}>With icon, icon only, disabled, pending, link</p>
    <div style=${ROW}>
      <sp-button variant="accent">
        <sp-icon-add slot="icon"></sp-icon-add>
        Create
      </sp-button>
      <sp-button variant="secondary" aria-label="Download">
        <sp-icon-download slot="icon"></sp-icon-download>
      </sp-button>
      <sp-button variant="primary" disabled>Disabled</sp-button>
      <sp-button variant="primary" pending pending-label="Saving">Pending</sp-button>
      <sp-button variant="secondary" href="#button-link">Visit section</sp-button>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-button size="s" variant="primary">Small</sp-button>
      <sp-button size="m" variant="primary">Medium</sp-button>
      <sp-button size="l" variant="primary">Large</sp-button>
      <sp-button size="xl" variant="primary">Extra large</sp-button>
    </div>

    <p style=${CAP}>Static colors on a colored background</p>
    <div style=${ON_DARK}>
      <sp-button static-color="white" variant="primary">White fill</sp-button>
      <sp-button static-color="white" variant="secondary" treatment="outline">White outline</sp-button>
    </div>
    <div style=${ON_LIGHT}>
      <sp-button static-color="black" variant="primary">Black fill</sp-button>
      <sp-button static-color="black" variant="secondary" treatment="outline">Black outline</sp-button>
    </div>

    <p style=${CAP}>Related buttons from the same package: close and clear</p>
    <div style=${ROW}>
      <sp-close-button label="Close"></sp-close-button>
      <sp-close-button label="Close" size="l"></sp-close-button>
      <sp-clear-button label="Clear"></sp-clear-button>
      <sp-clear-button label="Clear" quiet></sp-clear-button>
    </div>
  `,
  notes:
    'Covers sp-button, sp-clear-button and sp-close-button (the clear-button/close-button packages are CSS-only and contain no custom elements). The pending state renders an internal sp-progress-circle.',
  interactive: true,
};
