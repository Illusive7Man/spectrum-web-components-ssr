import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'textfield',
  packages: ['textfield', 'field-label', 'help-text'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/textfield/sp-textfield.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
      import('@spectrum-web-components/help-text/sp-help-text.js'),
    ]);
  },
  render: () => html`
    <div style=${ROW}>
      <div>
        <sp-field-label for="textfield-name">Name</sp-field-label>
        <sp-textfield id="textfield-name" placeholder="ex., Jane Doe"></sp-textfield>
      </div>
      <div>
        <sp-field-label for="textfield-filled">Filled</sp-field-label>
        <sp-textfield id="textfield-filled" value="Jane Doe"></sp-textfield>
      </div>
      <div>
        <sp-field-label for="textfield-quiet">Quiet</sp-field-label>
        <sp-textfield id="textfield-quiet" quiet value="Quiet text"></sp-textfield>
      </div>
      <sp-textfield label="Accessible label only" placeholder="Label via attribute"></sp-textfield>
    </div>

    <p style=${CAP}>Disabled, read only, required, valid</p>
    <div style=${ROW}>
      <sp-textfield label="Disabled" disabled value="Disabled value"></sp-textfield>
      <sp-textfield label="Read only" readonly value="Read only value"></sp-textfield>
      <sp-textfield label="Required" required placeholder="Required"></sp-textfield>
      <sp-textfield label="Valid" valid value="Looks good"></sp-textfield>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-textfield label="Small" size="s" placeholder="Small"></sp-textfield>
      <sp-textfield label="Medium" size="m" placeholder="Medium"></sp-textfield>
      <sp-textfield label="Large" size="l" placeholder="Large"></sp-textfield>
      <sp-textfield label="Extra large" size="xl" placeholder="Extra large"></sp-textfield>
    </div>

    <p style=${CAP}>Multiline, growing multiline</p>
    <div style=${ROW}>
      <sp-textfield
        label="Comments"
        multiline
        rows="3"
        value="This is a multiline textfield with some initial text."
      ></sp-textfield>
      <sp-textfield label="Notes" multiline grows placeholder="Grows with its content"></sp-textfield>
    </div>

    <div style=${COL}>
      <p style=${CAP}>Help text, and invalid with negative help text</p>
      <div>
        <sp-field-label for="textfield-feeling">Stay "Positive"</sp-field-label>
        <sp-textfield id="textfield-feeling" pattern="[P][o][s][i][t][i][v][e]" value="Positive">
          <sp-help-text slot="help-text">Tell us how you are feeling today.</sp-help-text>
          <sp-help-text slot="negative-help-text">Please be "Positive".</sp-help-text>
        </sp-textfield>
      </div>
      <div>
        <sp-field-label for="textfield-negative">Stay "Positive"</sp-field-label>
        <sp-textfield id="textfield-negative" pattern="[P][o][s][i][t][i][v][e]" value="Negative" invalid>
          <sp-help-text slot="help-text">Tell us how you are feeling today.</sp-help-text>
          <sp-help-text slot="negative-help-text">Please be "Positive".</sp-help-text>
        </sp-textfield>
      </div>
    </div>
  `,
  notes:
    'Native input/textarea live in the shadow root; validity (pattern) is evaluated at render time so the correct help-text slot is shown. Growing multiline textfields mirror their value into a hidden sizer.',
  interactive: true,
};
