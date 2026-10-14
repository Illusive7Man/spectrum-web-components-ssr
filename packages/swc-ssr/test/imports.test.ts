/**
 * (b) All registration modules (`sp-*.js`) of the smoke-set packages import under the shim (bare specifiers),
 * plus theme fragments and a couple of workflow icons.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {installSpectrumSsr} from '../src/server/index.ts';

installSpectrumSsr();

const PACKAGES = [
  'theme',
  'button',
  'action-button',
  'checkbox',
  'switch',
  'textfield',
  'picker',
  'menu',
  'tabs',
  'link',
  'divider',
  'progress-bar',
  'badge',
  'status-light',
  'field-label',
  'icon',
];
const ICONS = [
  '@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js',
  '@spectrum-web-components/icons-workflow/icons/sp-icon-checkmark-circle.js',
  '@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js',
];

const require = createRequire(import.meta.url);

function registrationModules(pkg: string): string[] {
  const dir = path.dirname(require.resolve(`@spectrum-web-components/${pkg}/package.json`));
  return readdirSync(dir)
    .filter((file) => /^sp-.*\.js$/.test(file) && !file.endsWith('.dev.js'))
    .map((file) => `@spectrum-web-components/${pkg}/${file}`);
}

test('registration modules of the smoke-set packages import', async () => {
  const failures: string[] = [];
  const imported: string[] = [];
  for (const pkg of PACKAGES) {
    const modules = registrationModules(pkg);
    assert.ok(modules.length > 0, `no registration modules found for ${pkg}`);
    for (const specifier of modules) {
      try {
        await import(specifier);
        imported.push(specifier);
      } catch (error) {
        failures.push(`${specifier}: ${(error as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(imported.length >= PACKAGES.length);
  for (const tag of ['sp-theme', 'sp-button', 'sp-action-button', 'sp-checkbox', 'sp-switch', 'sp-textfield',
    'sp-picker', 'sp-menu', 'sp-menu-item', 'sp-tabs', 'sp-tab', 'sp-tab-panel', 'sp-link', 'sp-divider',
    'sp-progress-bar', 'sp-badge', 'sp-status-light', 'sp-field-label', 'sp-icon']) {
    assert.ok(customElements.get(tag), `${tag} is defined`);
  }
});

test('theme fragments and workflow icons import', async () => {
  await import('@spectrum-web-components/theme/src/themes.js');
  const Theme = customElements.get('sp-theme') as unknown as {themeFragmentsByKind: Map<string, Map<string, unknown>>};
  assert.ok(Theme.themeFragmentsByKind.get('color')?.has('light'));
  assert.ok(Theme.themeFragmentsByKind.get('scale')?.has('medium'));
  assert.ok(Theme.themeFragmentsByKind.get('system')?.has('spectrum'));
  for (const specifier of ICONS) {
    await import(specifier);
  }
  for (const tag of ['sp-icon-edit', 'sp-icon-checkmark-circle', 'sp-icon-settings']) {
    assert.ok(customElements.get(tag), `${tag} is defined`);
  }
});
