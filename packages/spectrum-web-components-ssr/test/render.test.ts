/**
 * (c) renderSpectrum() smoke test: declarative shadow roots for every sp-* element, no errors, light-DOM-aware
 * rendering (picker label = selected item, button label detection, tabs selection), no marker leftovers.
 * (d) Determinism, context cleanup, serialized/nested-safe renders, no global state leaks.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum, getCurrentRenderContext} from '../src/server/index.ts';
import {getActiveSession} from '../src/server/context.ts';
import {
  findElement,
  formatReport,
  isElement,
  parseHtml,
  shadowTemplateOf,
  templateContent,
  textOf,
  walkElements,
} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');
await import('@spectrum-web-components/checkbox/sp-checkbox.js');
await import('@spectrum-web-components/picker/sp-picker.js');
await import('@spectrum-web-components/menu/sp-menu-item.js');
await import('@spectrum-web-components/tabs/sp-tabs.js');
await import('@spectrum-web-components/tabs/sp-tab.js');
await import('@spectrum-web-components/tabs/sp-tab-panel.js');
await import('@spectrum-web-components/textfield/sp-textfield.js');
await import('@spectrum-web-components/overlay/sp-overlay.js');
await import('@spectrum-web-components/popover/sp-popover.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const smokeTemplate = () => html`
  <sp-theme system="spectrum" color="light" scale="medium">
    <sp-button variant="accent"><sp-icon-edit slot="icon"></sp-icon-edit>Edit</sp-button>
    <sp-button variant="secondary"><sp-icon-edit slot="icon"></sp-icon-edit></sp-button>
    <sp-checkbox checked>Subscribe</sp-checkbox>
    <sp-picker label="Size" value="m">
      <sp-menu-item value="s">Small</sp-menu-item>
      <sp-menu-item value="m">Medium</sp-menu-item>
      <sp-menu-item value="l">Large</sp-menu-item>
    </sp-picker>
    <sp-tabs selected="two" label="Sections">
      <sp-tab label="One" value="one"></sp-tab>
      <sp-tab label="Two" value="two"></sp-tab>
      <sp-tab-panel value="one">First panel</sp-tab-panel>
      <sp-tab-panel value="two">Second panel</sp-tab-panel>
    </sp-tabs>
    <sp-textfield label="Name" value="Ada"></sp-textfield>
  </sp-theme>
`;

const result = await renderSpectrum(smokeTemplate());
const tree = parseHtml(result.html);
const errors = result.report.elements.filter((element) => element.errors.length > 0);

function shadowRootOf(tag: string, predicate: (element: any) => boolean = () => true) {
  const host = findElement(tree, (element) => element.name === tag && predicate(element));
  assert.ok(host, `<${tag}> rendered`);
  const template = shadowTemplateOf(host);
  assert.ok(template, `<${tag}> has a declarative shadow root`);
  return {host, content: templateContent(template)};
}

test('every sp-* element has a declarative shadow root', () => {
  const spElements = [...walkElements(tree)].filter((element) => element.name.startsWith('sp-'));
  assert.ok(spElements.length >= 15, `found ${spElements.length} sp-* elements`);
  const missing = spElements.filter((element) => !shadowTemplateOf(element)).map((element) => element.name);
  assert.deepEqual(missing, []);
  for (const element of spElements) {
    assert.equal(shadowTemplateOf(element)!.attribs.shadowrootmode, 'open');
  }
});

test('the smoke set renders without errors', () => {
  assert.equal(result.report.passes >= 2, true);
  assert.deepEqual(errors, [], `render report has errors:\n${formatReport(result.report)}`);
});

test('no data-swc-ssr markers are left in the output', () => {
  assert.equal(result.html.includes('data-swc-ssr'), false);
  assert.equal(result.html.includes('[object Object]'), false);
});

test('picker button label equals the selected menu item (light-DOM aware)', () => {
  const {host, content} = shadowRootOf('sp-picker');
  const selected = host.children.filter(isElement).find((child) => child.name === 'sp-menu-item' && child.attribs.selected !== undefined);
  assert.ok(selected, 'the matching sp-menu-item is selected');
  assert.equal(selected.attribs.value, 'm');
  assert.equal(selected.attribs['aria-selected'], 'true');
  const label = findElement(content, (element) => element.name === 'span' && element.attribs.id === 'label');
  assert.ok(label, 'the picker renders the selected-item label span');
  assert.equal(textOf(label).trim(), textOf(selected).trim());
  assert.equal(textOf(label).trim(), 'Medium');
});

test('button label detection uses the light DOM (ObserveSlotText)', () => {
  const withLabel = shadowRootOf('sp-button', (element) => element.attribs.variant === 'accent');
  const iconSlot = findElement(withLabel.content, (element) => element.name === 'slot' && element.attribs.name === 'icon');
  assert.ok(iconSlot);
  assert.equal(iconSlot.attribs['icon-only'], undefined, 'a button with text is not icon-only');
  const iconOnly = shadowRootOf('sp-button', (element) => element.attribs.variant === 'secondary');
  const onlySlot = findElement(iconOnly.content, (element) => element.name === 'slot' && element.attribs.name === 'icon');
  assert.ok(onlySlot);
  assert.notEqual(onlySlot.attribs['icon-only'], undefined, 'a button without text is icon-only');
});

test('tabs select the tab and panel matching `selected`', () => {
  const tabs = findElement(tree, (element) => element.name === 'sp-tabs')!;
  const tab = tabs.children.filter(isElement).find((child) => child.name === 'sp-tab' && child.attribs.value === 'two');
  const panel = tabs.children.filter(isElement).find((child) => child.name === 'sp-tab-panel' && child.attribs.value === 'two');
  assert.ok(tab && panel);
  assert.notEqual(tab.attribs.selected, undefined);
  assert.equal(tab.attribs['aria-selected'], 'true');
  assert.notEqual(panel.attribs.selected, undefined);
});

test('checkbox, textfield and theme render their state', () => {
  const checkbox = shadowRootOf('sp-checkbox');
  const input = findElement(checkbox.content, (element) => element.name === 'input');
  // `.checked=${true}` is emitted as a bare attribute (never `checked="true"` / `checked="false"`).
  assert.ok(input && input.attribs.checked === '');
  const textfield = shadowRootOf('sp-textfield');
  const field = findElement(textfield.content, (element) => element.name === 'input');
  assert.equal(field?.attribs.value, 'Ada');
  const theme = shadowRootOf('sp-theme');
  // Like the browser (theme/src/Theme.js 1.12 sets no direction), the server adds no `dir`.
  assert.equal(theme.host.attribs.dir, undefined);
  const style = findElement(theme.content, (element) => element.name === 'style');
  assert.ok(style && textOf(style).includes('--spectrum'), 'theme fragment CSS is inlined');
  assert.ok(findElement(theme.content, (element) => element.name === 'slot'));
});

test('a theme requesting an unregistered fragment is reported, not fatal', async () => {
  const {html: output, report} = await renderSpectrum(
    html`<sp-theme system="express" color="light" scale="medium"><sp-button>Express</sp-button></sp-theme>`
  );
  const theme = report.elements.find((element) => element.tagName === 'sp-theme')!;
  assert.ok(
    theme.warnings.some((message) => message.includes('system="express"')),
    `expected a missing-fragment warning:\n${formatReport(theme)}`
  );
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
  assert.ok(shadowTemplateOf(findElement(parseHtml(output), (element) => element.name === 'sp-theme')!));
});

test('rendering is deterministic', async () => {
  const again = await renderSpectrum(smokeTemplate());
  assert.equal(again.html, result.html);
});

test('no render context or session is left behind', async () => {
  assert.equal(getCurrentRenderContext(), undefined);
  assert.equal(getActiveSession(), undefined);
  // Concurrent calls are serialized and give the same output as sequential ones.
  const [a, b] = await Promise.all([renderSpectrum(smokeTemplate()), renderSpectrum(smokeTemplate())]);
  assert.equal(a.html, result.html);
  assert.equal(b.html, result.html);
  assert.equal(getCurrentRenderContext(), undefined);
  assert.equal(getActiveSession(), undefined);
  const Theme = customElements.get('sp-theme') as any;
  assert.equal(Theme.instances.size, 0, 'no theme registered in the static Theme.instances set');
});

test('debug keeps markers; overlays stay closed without global side effects', async () => {
  const debug = await renderSpectrum(html`<sp-button>Debug</sp-button>`, {debug: true});
  assert.match(debug.html, / data-swc-ssr="\d+"/);
  const Overlay = customElements.get('sp-overlay') as any;
  const openCount = Overlay.openCount;
  const overlay = await renderSpectrum(
    html`<sp-button id="trigger">Open</sp-button>
      <sp-overlay trigger="trigger@click" type="auto" open><sp-popover>Content</sp-popover></sp-overlay>`
  );
  assert.equal(Overlay.openCount, openCount);
  const element = findElement(parseHtml(overlay.html), (node) => node.name === 'sp-overlay');
  assert.ok(element && element.attribs.open !== undefined, 'the open attribute is kept for the client');
  assert.deepEqual(overlay.report.elements.filter((report) => report.errors.length > 0), []);
});
