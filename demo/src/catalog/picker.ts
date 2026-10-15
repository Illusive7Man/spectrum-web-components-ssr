import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'picker',
  packages: ['picker', 'menu', 'field-label', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/picker/sp-picker.js'),
      import('@spectrum-web-components/menu/sp-menu.js'),
      import('@spectrum-web-components/menu/sp-menu-item.js'),
      import('@spectrum-web-components/menu/sp-menu-divider.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-save-floppy.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-stopwatch.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-user-activity.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Selected value with icons, and nothing selected</p>
    <div style=${ROW}>
      <div>
        <sp-field-label for="picker-action">Choose an action</sp-field-label>
        <sp-picker id="picker-action" label="What would you like to do?" value="finish">
          <sp-menu-item value="save">
            <sp-icon-save-floppy slot="icon"></sp-icon-save-floppy>
            Save
          </sp-menu-item>
          <sp-menu-item value="finish">
            <sp-icon-stopwatch slot="icon"></sp-icon-stopwatch>
            Finish
          </sp-menu-item>
          <sp-menu-item value="review">
            <sp-icon-user-activity slot="icon"></sp-icon-user-activity>
            Review
          </sp-menu-item>
        </sp-picker>
      </div>

      <div>
        <sp-field-label for="picker-country">Country</sp-field-label>
        <sp-picker id="picker-country" label="Select a country">
          <sp-menu-item value="de">Germany</sp-menu-item>
          <sp-menu-item value="fr">France</sp-menu-item>
          <sp-menu-item value="hr">Croatia</sp-menu-item>
          <sp-menu-divider></sp-menu-divider>
          <sp-menu-item value="other" disabled>Other (unavailable)</sp-menu-item>
        </sp-picker>
      </div>
    </div>

    <p style=${CAP}>Quiet, disabled, invalid, readonly</p>
    <div style=${ROW}>
      <sp-picker quiet label="Quiet picker" value="b">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
        <sp-menu-item value="c">Option C</sp-menu-item>
      </sp-picker>
      <sp-picker disabled label="Disabled picker" value="a">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
      </sp-picker>
      <sp-picker invalid label="Invalid picker">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
      </sp-picker>
      <sp-picker readonly label="Read only picker" value="b">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
      </sp-picker>
    </div>

    <p style=${CAP}>Deprecated markup: an sp-menu child (the closed overlay is rendered right away)</p>
    <div style=${ROW}>
      <sp-picker id="picker-legacy" label="Legacy markup" value="b">
        <sp-menu>
          <sp-menu-item value="a">Option A</sp-menu-item>
          <sp-menu-item value="b">Option B</sp-menu-item>
        </sp-menu>
      </sp-picker>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-picker size="s" label="Small" value="a">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
      </sp-picker>
      <sp-picker size="l" label="Large" value="a">
        <sp-menu-item value="a">Option A</sp-menu-item>
        <sp-menu-item value="b">Option B</sp-menu-item>
      </sp-picker>
    </div>
  `,
  notes:
    'SSR difference: the closed menu starts keyboard focus (tabindex="0") on the selected item after SSR + hydration, on the first item with client-side rendering (there the items are selected only after sp-menu cached them). Closed pickers: the button label is taken from the selected sp-menu-item (found by value in the light DOM and, for sp-picker, via @query(sp-menu) in its own shadow root). The popover stays closed. The deprecated sp-menu child (#picker-legacy) makes the picker render its closed overlay at once: sp-popover on the server and on desktops, sp-tray on phones (tests/mobile.spec.ts).',
  interactive: true,
};
