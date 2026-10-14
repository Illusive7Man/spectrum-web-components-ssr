/**
 * Server output details found while integrating with the browser-side hydration and the e2e suite: the markup must
 * be what the first client render hydrates and what client-side rendering produces (see docs/DESIGN.md
 * "Integration findings").
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';
import type {AnyNode, Element} from 'domhandler';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/checkbox/sp-checkbox.js');
await import('@spectrum-web-components/textfield/sp-textfield.js');
await import('@spectrum-web-components/picker/sp-picker.js');
await import('@spectrum-web-components/menu/sp-menu-item.js');
await import('@spectrum-web-components/menu/sp-menu-group.js');
await import('@spectrum-web-components/menu/sp-menu.js');
await import('@spectrum-web-components/alert-dialog/sp-alert-dialog.js');
await import('@spectrum-web-components/swatch/sp-swatch.js');
await import('@spectrum-web-components/swatch/sp-swatch-group.js');
await import('@spectrum-web-components/color-area/sp-color-area.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const shadowOf = (host: Element): AnyNode => {
  const template = shadowTemplateOf(host);
  assert.ok(template, `<${host.name}> has a declarative shadow root`);
  return templateContent(template);
};

const all = (root: AnyNode, name: string): Element[] => [...walkElements(root)].filter((el) => el.name === name);

test('boolean property bindings on native elements are never emitted as ="false"', async () => {
  const {html: output} = await renderSpectrum(
    html`<sp-theme><sp-checkbox>Off</sp-checkbox><sp-checkbox checked>On</sp-checkbox></sp-theme>`
  );
  assert.ok(!/checked="(true|false)"/.test(output), 'no stringified boolean');
  const [off, on] = all(parseHtml(output), 'sp-checkbox');
  assert.equal(findElement(shadowOf(off), (el) => el.name === 'input')?.attribs.checked, undefined);
  assert.equal(findElement(shadowOf(on), (el) => el.name === 'input')?.attribs.checked, '');
});

test('a textarea renders its value as text content', async () => {
  const {html: output} = await renderSpectrum(
    html`<sp-theme><sp-textfield multiline label="Notes" value="a < b & c"></sp-textfield></sp-theme>`
  );
  assert.match(output, /<textarea[^>]*>a &lt; b &amp; c<\/textarea>/);
});

test('constraint validation: required / pattern decide valid and invalid', async () => {
  const {html: output} = await renderSpectrum(html`
    <sp-theme>
      <sp-textfield label="A" required></sp-textfield>
      <sp-textfield label="B" pattern="[P]ositive" value="Positive"></sp-textfield>
      <sp-textfield label="C" pattern="[P]ositive" value="Negative"></sp-textfield>
    </sp-theme>
  `);
  const [required, matching, failing] = all(parseHtml(output), 'sp-textfield');
  assert.notEqual(required.attribs.invalid, undefined, 'empty required field is invalid');
  assert.notEqual(matching.attribs.valid, undefined);
  assert.equal(matching.attribs.invalid, undefined);
  assert.notEqual(failing.attribs.invalid, undefined);
});

test('a selected picker item is rendered into the button without hydration markers inside the node content', async () => {
  const {html: output} = await renderSpectrum(html`
    <sp-theme>
      <sp-picker label="Action" value="edit">
        <sp-menu-item value="edit"><sp-icon-edit slot="icon"></sp-icon-edit>Edit</sp-menu-item>
        <sp-menu-item value="copy">Copy</sp-menu-item>
      </sp-picker>
    </sp-theme>
  `);
  assert.ok(!output.includes('swc-raw'), 'raw region delimiters are removed');
  const picker = all(parseHtml(output), 'sp-picker')[0];
  const icon = findElement(shadowOf(picker), (el) => el.attribs.id === 'icon')!;
  const copy = icon.children.find((child) => isElement(child) && child.name === 'sp-icon-edit') as Element;
  assert.ok(copy, 'the icon clone is rendered');
  assert.equal(copy.attribs['defer-hydration'], undefined, 'nobody would remove defer-hydration from a node value');
  const comments = icon.children.filter((child) => child.type === 'comment').map((child) => (child as any).data);
  assert.ok(!comments.some((data: string) => data.startsWith('lit-node')), 'no lit-node marker in node content');
});

test('ids that components give plain light-DOM elements are written into the markup', async () => {
  const {html: output} = await renderSpectrum(html`
    <sp-theme>
      <sp-alert-dialog variant="confirmation"><h2 slot="heading">Title</h2>Body</sp-alert-dialog>
      <sp-menu><sp-menu-group><span slot="header">Group</span><sp-menu-item>One</sp-menu-item></sp-menu-group></sp-menu>
    </sp-theme>
  `);
  const tree = parseHtml(output);
  const dialog = all(tree, 'sp-alert-dialog')[0];
  const heading = all(tree, 'h2')[0];
  assert.ok(heading.attribs.id, 'the heading got an id');
  assert.ok(dialog.attribs['aria-labelledby']?.split(' ').includes(heading.attribs.id), 'aria-labelledby resolves');
  const group = all(tree, 'sp-menu-group')[0];
  const header = all(tree, 'span').find((span) => span.attribs.slot === 'header')!;
  assert.ok(header.attribs.id && group.attribs['aria-labelledby'] === header.attribs.id, 'menu group header id');
});

test('a swatch group applies selection and roles from its initial slotchange', async () => {
  const {html: output} = await renderSpectrum(html`
    <sp-theme>
      <sp-swatch-group selects="single" selected='["#00f"]'>
        <sp-swatch color="#f00" value="#f00"></sp-swatch>
        <sp-swatch color="#00f" value="#00f"></sp-swatch>
      </sp-swatch-group>
    </sp-theme>
  `);
  const [red, blue] = all(parseHtml(output), 'sp-swatch');
  assert.equal(red.attribs.role, 'radio');
  assert.equal(blue.attribs.role, 'radio');
  assert.notEqual(blue.attribs.selected, undefined);
  assert.equal(red.attribs.selected, undefined);
});

test('the element-binding marker of upstream is never rendered as an attribute', async () => {
  const {html: output} = await renderSpectrum(html`<sp-theme><sp-color-area></sp-color-area></sp-theme>`);
  assert.ok(!/\slit\$\d+\$/.test(output));
});
