import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {CAP} from './_shared.ts';

const SURFACE =
  'display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:16px;margin-block-end:16px;border-radius:8px;background:var(--spectrum-gray-100);color:var(--spectrum-gray-800)';

export const entry: CatalogEntry = {
  name: 'theme',
  packages: ['theme', 'button', 'checkbox'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/theme/sp-theme.js'),
      import('@spectrum-web-components/theme/theme-light.js'),
      import('@spectrum-web-components/theme/theme-dark.js'),
      import('@spectrum-web-components/theme/scale-medium.js'),
      import('@spectrum-web-components/theme/scale-large.js'),
      import('@spectrum-web-components/button/sp-button.js'),
      import('@spectrum-web-components/checkbox/sp-checkbox.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Nested dark theme (the page itself uses the light theme)</p>
    <sp-theme system="spectrum" color="dark" scale="medium" style="display:block">
      <div style=${SURFACE}>
        <span>Dark surface</span>
        <sp-button variant="accent">Accent</sp-button>
        <sp-button variant="secondary" treatment="outline">Outline</sp-button>
        <sp-checkbox checked>Remember me</sp-checkbox>
      </div>
    </sp-theme>

    <p style=${CAP}>Nested light theme, large scale</p>
    <sp-theme system="spectrum" color="light" scale="large" style="display:block">
      <div style=${SURFACE}>
        <span>Large scale</span>
        <sp-button variant="primary">Primary</sp-button>
        <sp-button variant="negative">Negative</sp-button>
      </div>
    </sp-theme>

    <p style=${CAP}>Nested dark theme with right-to-left direction</p>
    <sp-theme system="spectrum" color="dark" scale="medium" dir="rtl" style="display:block">
      <div style=${SURFACE}>
        <span>RTL surface</span>
        <sp-button variant="accent">Continue</sp-button>
        <sp-button variant="secondary">Back</sp-button>
      </div>
    </sp-theme>
  `,
  notes:
    'sp-theme emits its theme fragment styles from static registerThemeFragment data (adoptedStyleSheets in the browser) and needs a dedicated renderer on the server. This entry also registers the light, dark, medium and large fragments used by the page shell.',
  interactive: false,
};
