import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'tabs',
  packages: ['tabs', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/tabs/sp-tabs.js'),
      import('@spectrum-web-components/tabs/sp-tab.js'),
      import('@spectrum-web-components/tabs/sp-tab-panel.js'),
      import('@spectrum-web-components/tabs/sp-tabs-overflow.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-home.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-folder.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Horizontal tabs with panels, second tab selected</p>
      <sp-tabs selected="details" label="Project sections" style="width:480px">
        <sp-tab label="Overview" value="overview"></sp-tab>
        <sp-tab label="Details" value="details"></sp-tab>
        <sp-tab label="Activity" value="activity"></sp-tab>
        <sp-tab label="Archived" value="archived" disabled></sp-tab>
        <sp-tab-panel value="overview">A summary of the project, its goals and owners.</sp-tab-panel>
        <sp-tab-panel value="details">Detailed settings, budget and schedule information.</sp-tab-panel>
        <sp-tab-panel value="activity">Recent changes made by you and your teammates.</sp-tab-panel>
        <sp-tab-panel value="archived">Archived items are listed here.</sp-tab-panel>
      </sp-tabs>

      <p style=${CAP}>Quiet, with icons</p>
      <sp-tabs selected="projects" quiet label="Workspace" style="width:480px">
        <sp-tab label="Home" value="home">
          <sp-icon-home slot="icon"></sp-icon-home>
        </sp-tab>
        <sp-tab label="Projects" value="projects">
          <sp-icon-folder slot="icon"></sp-icon-folder>
        </sp-tab>
        <sp-tab label="Settings" value="settings">
          <sp-icon-settings slot="icon"></sp-icon-settings>
        </sp-tab>
        <sp-tab-panel value="home">Your home feed.</sp-tab-panel>
        <sp-tab-panel value="projects">Your projects.</sp-tab-panel>
        <sp-tab-panel value="settings">Workspace settings.</sp-tab-panel>
      </sp-tabs>

      <p style=${CAP}>Compact and emphasized</p>
      <sp-tabs selected="b" compact emphasized label="Compact emphasized tabs" style="width:480px">
        <sp-tab label="Tab A" value="a"></sp-tab>
        <sp-tab label="Tab B" value="b"></sp-tab>
        <sp-tab label="Tab C" value="c"></sp-tab>
        <sp-tab-panel value="a">Content for tab A</sp-tab-panel>
        <sp-tab-panel value="b">Content for tab B</sp-tab-panel>
        <sp-tab-panel value="c">Content for tab C</sp-tab-panel>
      </sp-tabs>

      <p style=${CAP}>Vertical</p>
      <sp-tabs selected="2" direction="vertical" label="Vertical tabs" style="width:480px">
        <sp-tab label="First" value="1"></sp-tab>
        <sp-tab label="Second" value="2"></sp-tab>
        <sp-tab label="Third" value="3"></sp-tab>
        <sp-tab-panel value="1">Content for the first tab</sp-tab-panel>
        <sp-tab-panel value="2">Content for the second tab</sp-tab-panel>
        <sp-tab-panel value="3">Content for the third tab</sp-tab-panel>
      </sp-tabs>

      <p style=${CAP}>Sizes</p>
      <sp-tabs selected="1" size="s" label="Small tabs" style="width:480px">
        <sp-tab label="Small 1" value="1"></sp-tab>
        <sp-tab label="Small 2" value="2"></sp-tab>
      </sp-tabs>
      <sp-tabs selected="1" size="xl" label="Extra large tabs" style="width:480px">
        <sp-tab label="XL 1" value="1"></sp-tab>
        <sp-tab label="XL 2" value="2"></sp-tab>
      </sp-tabs>

      <p style=${CAP}>Overflowing tabs wrapped in sp-tabs-overflow (narrow container)</p>
      <div style="width:320px">
        <sp-tabs-overflow>
          <sp-tabs selected="t3" label="Many tabs">
            <sp-tab label="Tab one" value="t1"></sp-tab>
            <sp-tab label="Tab two" value="t2"></sp-tab>
            <sp-tab label="Tab three" value="t3"></sp-tab>
            <sp-tab label="Tab four" value="t4"></sp-tab>
            <sp-tab label="Tab five" value="t5"></sp-tab>
            <sp-tab label="Tab six" value="t6"></sp-tab>
            <sp-tab label="Tab seven" value="t7"></sp-tab>
          </sp-tabs>
        </sp-tabs-overflow>
      </div>
    </div>
  `,
  notes:
    'The selection indicator geometry and tab-panel visibility depend on the selected tab; sp-tabs reads its sp-tab children (light DOM) and measures offsets which the server cannot. sp-tabs-overflow measures clientWidth through a ResizeController to decide whether its scroll buttons are shown.',
  interactive: true,
};
