import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'top-nav',
  packages: ['top-nav', 'action-menu', 'menu'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/top-nav/sp-top-nav.js'),
      import('@spectrum-web-components/top-nav/sp-top-nav-item.js'),
      import('@spectrum-web-components/action-menu/sp-action-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/menu/sp-menu-divider.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Site navigation</p>
      <sp-top-nav label="Main navigation" style="width:640px">
        <sp-top-nav-item href="#top-nav-home">Site name</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-products" style="margin-inline-start:auto">Products</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-pricing">Pricing</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-support">Support</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-about">Page with a really long name</sp-top-nav-item>
      </sp-top-nav>

      <p style=${CAP}>With an account menu at the end (menu closed)</p>
      <sp-top-nav label="Account navigation" style="width:640px">
        <sp-top-nav-item href="#top-nav-account-home">Site name</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-account-docs" style="margin-inline-start:auto">Docs</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-account-blog">Blog</sp-top-nav-item>
        <sp-action-menu label="Account" placement="bottom-end" style="margin-inline-start:auto" quiet>
          <sp-menu-item>Account settings</sp-menu-item>
          <sp-menu-item>My profile</sp-menu-item>
          <sp-menu-divider></sp-menu-divider>
          <sp-menu-item>Help</sp-menu-item>
          <sp-menu-item>Sign out</sp-menu-item>
        </sp-action-menu>
      </sp-top-nav>

      <p style=${CAP}>Compact and quiet</p>
      <sp-top-nav compact quiet label="Compact navigation" style="width:640px">
        <sp-top-nav-item href="#top-nav-compact-a">Overview</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-compact-b">Reports</sp-top-nav-item>
        <sp-top-nav-item href="#top-nav-compact-c">Settings</sp-top-nav-item>
      </sp-top-nav>
    </div>
  `,
  notes:
    'Which item is selected is decided in the browser: sp-top-nav compares the resolved anchor href of each item (set in updated()) with its selected property or window.location.href, and clears any selected attribute on the items on the first slotchange. The selection indicator position is also measured (getBoundingClientRect), so none of it is known on the server and no item is marked selected here.',
  interactive: false,
};
