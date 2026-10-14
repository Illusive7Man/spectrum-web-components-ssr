import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'sidenav',
  packages: ['sidenav', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/sidenav/sp-sidenav.js'),
      import('@spectrum-web-components/sidenav/sp-sidenav-item.js'),
      import('@spectrum-web-components/sidenav/sp-sidenav-heading.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-home.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-folder.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-star.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js'),
    ]);
  },
  render: () => html`
    <div style=${ROW}>
      <div style="width:240px">
        <p style=${CAP}>Flat list, selected item, disabled item</p>
        <sp-sidenav value="guides" label="Documentation">
          <sp-sidenav-item value="docs" label="Docs" href="#sidenav-docs"></sp-sidenav-item>
          <sp-sidenav-item value="guides" label="Guides" href="#sidenav-guides" selected></sp-sidenav-item>
          <sp-sidenav-item value="community" label="Community" href="#sidenav-community"></sp-sidenav-item>
          <sp-sidenav-item value="releases" label="Releases" href="#sidenav-releases" disabled></sp-sidenav-item>
        </sp-sidenav>
      </div>

      <div style="width:240px">
        <p style=${CAP}>With icons</p>
        <sp-sidenav value="projects" label="Workspace">
          <sp-sidenav-item value="home" label="Home" href="#sidenav-home">
            <sp-icon-home slot="icon"></sp-icon-home>
          </sp-sidenav-item>
          <sp-sidenav-item value="projects" label="Projects" href="#sidenav-projects" selected>
            <sp-icon-folder slot="icon"></sp-icon-folder>
          </sp-sidenav-item>
          <sp-sidenav-item value="favorites" label="Favorites" href="#sidenav-favorites">
            <sp-icon-star slot="icon"></sp-icon-star>
          </sp-sidenav-item>
          <sp-sidenav-item value="settings" label="Settings" href="#sidenav-settings">
            <sp-icon-settings slot="icon"></sp-icon-settings>
          </sp-sidenav-item>
        </sp-sidenav>
      </div>

      <div style="width:260px">
        <p style=${CAP}>Headings and a multilevel tree (expanded parent, selected child)</p>
        <sp-sidenav variant="multilevel" value="buttons" label="Components">
          <sp-sidenav-heading label="Components">
            <sp-sidenav-item value="inputs" label="Inputs" expanded>
              <sp-sidenav-item value="buttons" label="Buttons" href="#sidenav-buttons" selected></sp-sidenav-item>
              <sp-sidenav-item value="checkboxes" label="Checkboxes" href="#sidenav-checkboxes"></sp-sidenav-item>
            </sp-sidenav-item>
            <sp-sidenav-item value="navigation" label="Navigation">
              <sp-sidenav-item value="tabs" label="Tabs" href="#sidenav-tabs"></sp-sidenav-item>
            </sp-sidenav-item>
          </sp-sidenav-heading>
        </sp-sidenav>
      </div>
    </div>
  `,
  notes:
    'Selection and expansion are computed from the value attribute and the nested sp-sidenav-item tree (ancestor queries); nested items live in the default slot of their parent item.',
  interactive: true,
};
