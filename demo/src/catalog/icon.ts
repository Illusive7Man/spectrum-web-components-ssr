import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'icon',
  packages: ['icon', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/icon/sp-icon.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-star.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-home.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-bell.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>sp-icon with a slotted SVG, in the five sizes</p>
    <div style=${ROW}>
      <sp-icon size="s" label="Back arrow">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M19.75,10.04h-15l5.97-5.97a.483.483,0,0,0,0-.7l-.35-.36a.513.513,0,0,0-.71,0L2.24,10.44a.513.513,0,0,0,0,.71l7.39,7.84a.513.513,0,0,0,.71,0l.35-.35a.513.513,0,0,0,0-.71L4.76,11.5H19.75a.25.25,0,0,0,.25-.25v-.96A.25.25,0,0,0,19.75,10.04Z"></path>
        </svg>
      </sp-icon>
      <sp-icon size="m" label="Back arrow">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M19.75,10.04h-15l5.97-5.97a.483.483,0,0,0,0-.7l-.35-.36a.513.513,0,0,0-.71,0L2.24,10.44a.513.513,0,0,0,0,.71l7.39,7.84a.513.513,0,0,0,.71,0l.35-.35a.513.513,0,0,0,0-.71L4.76,11.5H19.75a.25.25,0,0,0,.25-.25v-.96A.25.25,0,0,0,19.75,10.04Z"></path>
        </svg>
      </sp-icon>
      <sp-icon size="l" label="Back arrow">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M19.75,10.04h-15l5.97-5.97a.483.483,0,0,0,0-.7l-.35-.36a.513.513,0,0,0-.71,0L2.24,10.44a.513.513,0,0,0,0,.71l7.39,7.84a.513.513,0,0,0,.71,0l.35-.35a.513.513,0,0,0,0-.71L4.76,11.5H19.75a.25.25,0,0,0,.25-.25v-.96A.25.25,0,0,0,19.75,10.04Z"></path>
        </svg>
      </sp-icon>
      <sp-icon size="xl" label="Back arrow">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M19.75,10.04h-15l5.97-5.97a.483.483,0,0,0,0-.7l-.35-.36a.513.513,0,0,0-.71,0L2.24,10.44a.513.513,0,0,0,0,.71l7.39,7.84a.513.513,0,0,0,.71,0l.35-.35a.513.513,0,0,0,0-.71L4.76,11.5H19.75a.25.25,0,0,0,.25-.25v-.96A.25.25,0,0,0,19.75,10.04Z"></path>
        </svg>
      </sp-icon>
      <sp-icon size="xxl" label="Back arrow">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M19.75,10.04h-15l5.97-5.97a.483.483,0,0,0,0-.7l-.35-.36a.513.513,0,0,0-.71,0L2.24,10.44a.513.513,0,0,0,0,.71l7.39,7.84a.513.513,0,0,0,.71,0l.35-.35a.513.513,0,0,0,0-.71L4.76,11.5H19.75a.25.25,0,0,0,.25-.25v-.96A.25.25,0,0,0,19.75,10.04Z"></path>
        </svg>
      </sp-icon>
    </div>

    <p style=${CAP}>Colored through the CSS color property</p>
    <div style=${ROW}>
      <sp-icon size="l" style="color:#d7373f" label="Alert">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <circle cx="11" cy="11" r="9"></circle>
        </svg>
      </sp-icon>
      <sp-icon size="l" style="color:#2d9d78" label="Success">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="16" height="16" rx="3"></rect>
        </svg>
      </sp-icon>
    </div>

    <p style=${CAP}>Workflow icon elements (sp-icon-*) in the supported sizes</p>
    <div style=${ROW}>
      <sp-icon-edit size="s" label="Edit"></sp-icon-edit>
      <sp-icon-star size="m" label="Favorite"></sp-icon-star>
      <sp-icon-home size="l" label="Home"></sp-icon-home>
      <sp-icon-settings size="xl" label="Settings"></sp-icon-settings>
      <sp-icon-bell size="xxl" label="Notifications"></sp-icon-bell>
    </div>
  `,
  notes:
    'Name-based icons (name="ui:Arrow100") need an sp-icons-* iconset and runtime fetching, so slotted SVGs and sp-icon-* workflow elements are used instead.',
  interactive: false,
};
