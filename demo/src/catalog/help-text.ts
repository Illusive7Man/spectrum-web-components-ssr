import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'help-text',
  packages: ['help-text', 'textfield', 'field-label'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/help-text/sp-help-text.js'),
      import('@spectrum-web-components/textfield/sp-textfield.js'),
      import('@spectrum-web-components/field-label/sp-field-label.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Standalone: neutral, negative, negative with icon, sizes</p>
      <sp-help-text>Create a password with at least 8 characters.</sp-help-text>
      <sp-help-text variant="negative">Passwords must be at least 8 characters.</sp-help-text>
      <sp-help-text variant="negative" icon>Passwords must be at least 8 characters.</sp-help-text>
      <sp-help-text size="s">Small help text</sp-help-text>
      <sp-help-text size="l">Large help text</sp-help-text>
      <sp-help-text size="xl">Extra large help text</sp-help-text>

      <p style=${CAP}>Inside a textfield (help-text slot)</p>
      <div>
        <sp-field-label for="help-text-password">Password</sp-field-label>
        <sp-textfield id="help-text-password" type="password" placeholder="Enter a password">
          <sp-help-text slot="help-text">Create a password with at least 8 characters.</sp-help-text>
        </sp-textfield>
      </div>

      <p style=${CAP}>Invalid textfield with negative help text</p>
      <div>
        <sp-field-label for="help-text-invalid">Repeat password</sp-field-label>
        <sp-textfield id="help-text-invalid" type="password" required invalid value="abc">
          <sp-help-text slot="help-text">Re-enter the same password.</sp-help-text>
          <sp-help-text slot="negative-help-text" variant="negative" icon>
            Passwords do not match.
          </sp-help-text>
        </sp-textfield>
      </div>
    </div>
  `,
  notes:
    'Negative help text uses an sp-icon-alert from icons-workflow, which sp-help-text imports itself.',
  interactive: false,
};
