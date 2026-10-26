/**
 * Attribute reactions: as in browsers, a connected custom element's `attributeChangedCallback` runs when an observed
 * attribute changes, also when the component's own code changes it (`field-label/src/FieldLabel.js` sets its
 * generated `id` attribute in `willUpdate()` and relies on the `id` property following; without the reaction the
 * slider section of the full-catalog page rendered `aria-labelledby="label "`). The renderer's own writes notify
 * exactly once (no second, reaction-driven call).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, formatReport, parseHtml, shadowTemplateOf, templateContent, textOf} from './helpers.ts';

installSpectrumSsr();

const {LitElement, html} = await import('lit');

/* eslint-disable @typescript-eslint/no-explicit-any */

const MANAGED = {isManagedClass: () => true};

/** Generates its `label` attribute in willUpdate (like FieldLabel's id) and renders the `label` property. */
class XSelfLabel extends LitElement {
  static override properties = {label: {type: String}};
  declare label: string;
  constructor() {
    super();
    this.label = '';
  }
  override willUpdate() {
    if (!this.hasAttribute('label')) {
      this.setAttribute('label', 'generated');
    }
  }
  override render() {
    return html`<span id="label">${this.label}</span>`;
  }
}
customElements.define('x-self-label', XSelfLabel);

/** Counts attributeChangedCallback calls per attribute. */
const calls: Array<Map<string, number>> = [];
class XCounted extends LitElement {
  static override properties = {mode: {type: String, reflect: true}};
  declare mode: string;
  readonly counts = new Map<string, number>();
  constructor() {
    super();
    this.mode = 'a';
    calls.push(this.counts);
  }
  override attributeChangedCallback(name: string, old: string | null, value: string | null) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    super.attributeChangedCallback(name, old, value);
  }
  override render() {
    return html`<i>${this.mode}</i>`;
  }
}
customElements.define('x-counted', XCounted);

function shadowText(output: string, tag: string): string {
  const host = findElement(parseHtml(output), (element) => element.name === tag);
  assert.ok(host, `<${tag}> in ${output}`);
  const template = shadowTemplateOf(host);
  assert.ok(template);
  return textOf(templateContent(template)).trim();
}

test("a component's own setAttribute of an observed attribute updates the property (attributeChangedCallback)", async () => {
  const {html: output, report} = await renderSpectrum(html`<x-self-label></x-self-label>`, MANAGED);
  assert.equal(shadowText(output, 'x-self-label'), 'generated', formatReport(report));
  assert.match(output, /<x-self-label[^>]*\slabel="generated"/);
});

test('attributes the renderer sets notify exactly once; Lit reflection does not re-enter', async () => {
  calls.length = 0;
  const {html: output, report} = await renderSpectrum(html`<x-counted mode="b"></x-counted>`, MANAGED);
  assert.equal(shadowText(output, 'x-counted'), 'b', formatReport(report));
  assert.ok(calls.length >= 2, 'one instance per pass');
  for (const counts of calls) {
    assert.ok((counts.get('mode') ?? 0) <= 1, `attributeChangedCallback(mode) ran ${counts.get('mode')} times`);
  }
  assert.ok(calls.some((counts) => counts.get('mode') === 1));
});

test('elements with upstream semantics (not connected) keep the shim behaviour', async () => {
  // Not managed: lifecycle 'none' (willUpdate + reflection only); no component reactions, as upstream.
  const {html: output} = await renderSpectrum(html`<x-self-label></x-self-label>`);
  assert.equal(shadowText(output, 'x-self-label'), '');
});
