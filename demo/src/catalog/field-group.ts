import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'field-group',
  packages: ['field-group', 'checkbox', 'help-text', 'field-label'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/field-group/sp-field-group.js'),
      import('@spectrum-web-components/checkbox/sp-checkbox.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Horizontal, labelled through the label attribute</p>
      <sp-field-group horizontal label="Choose from horizontally placed options">
        <sp-checkbox>Checkbox 1</sp-checkbox>
        <sp-checkbox>Checkbox 2</sp-checkbox>
        <sp-checkbox checked>Checkbox 3</sp-checkbox>
        <sp-checkbox>Checkbox 4</sp-checkbox>
      </sp-field-group>

      <p style=${CAP}>Labelled by an sp-field-label</p>
      <div>
        <sp-field-label for="field-group-vertical">What are your favorite fruits?</sp-field-label>
        <sp-field-group vertical id="field-group-vertical">
          <sp-checkbox value="apple">Apple</sp-checkbox>
          <sp-checkbox value="strawberry" checked>Strawberry</sp-checkbox>
          <sp-checkbox value="pear">Pear</sp-checkbox>
        </sp-field-group>
      </div>

      <p style=${CAP}>With help text</p>
      <sp-field-group horizontal label="What are your favorite fruits?">
        <sp-checkbox value="apple">Apple</sp-checkbox>
        <sp-checkbox value="not-a-fruit">Lettuce</sp-checkbox>
        <sp-checkbox value="strawberry" checked>Strawberry</sp-checkbox>
        <sp-help-text slot="help-text">One of these is not a fruit.</sp-help-text>
      </sp-field-group>

      <p style=${CAP}>Invalid, showing the negative help text</p>
      <sp-field-group horizontal invalid label="What are your favorite fruits?">
        <sp-checkbox value="apple">Apple</sp-checkbox>
        <sp-checkbox value="not-a-fruit" checked invalid>Lettuce</sp-checkbox>
        <sp-checkbox value="strawberry">Strawberry</sp-checkbox>
        <sp-help-text slot="help-text">One of these is not a fruit.</sp-help-text>
        <sp-help-text slot="negative-help-text" icon>Choose actual fruit(s).</sp-help-text>
      </sp-field-group>
    </div>
  `,
  notes:
    'Help text slots (help-text / negative-help-text) are switched on the invalid attribute; the group itself has no JS-driven state.',
  interactive: false,
};
