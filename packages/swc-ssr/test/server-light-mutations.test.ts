/**
 * Review M4 / M5: attribute changes components make on plain elements (light DOM or their own shadow root) are
 * written into the final output by locating the changed element again (light-mutations.ts).
 *
 * - M4: the element used to be found by its element-child index in its scope, guarded only by tag (+ id). When the
 *   final pass rendered the scope differently, the change landed on the wrong element (same tag, no id) or was
 *   silently dropped. It now has to match the recorded element's signature, is relocated to the one element that
 *   does, and is reported when it cannot be applied.
 * - M5: whole documents were parsed with parseFragment (which drops <html>/<head>/<body>) while the tree used
 *   parse(), so document-level changes were silently dropped.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, formatReport, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';
import {parse} from 'parse5';
import {adapter} from 'parse5-htmlparser2-tree-adapter';
import type {Document} from 'domhandler';

installSpectrumSsr();

const {html, nothing} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Renders an extra element at the start of its shadow once it knows its light DOM (pass 1 has none). */
class XScopeShift extends SpectrumElement {
  static override properties = {known: {type: Boolean}};
  declare known: boolean;
  constructor() {
    super();
    this.known = false;
  }
  override willUpdate() {
    this.known = this.querySelector('p') !== null;
  }
}

class XMarkById extends XScopeShift {
  override firstUpdated() {
    this.renderRoot.querySelector('#target')?.setAttribute('data-mark', 'by-id');
  }
  override render() {
    return html`${this.known ? html`<span class="extra">x</span>` : nothing}<span id="target" class="label">t</span><slot></slot>`;
  }
}
customElements.define('x-mark-by-id', XMarkById);

class XMarkByClass extends XScopeShift {
  override firstUpdated() {
    this.renderRoot.querySelector('.label')?.setAttribute('data-mark', 'by-class');
  }
  override render() {
    return html`${this.known ? html`<span class="extra">x</span>` : nothing}<span class="label">t</span><slot></slot>`;
  }
}
customElements.define('x-mark-by-class', XMarkByClass);

/** Changes an element of its previous-pass shadow that the final pass does not render any more. */
class XMarkGone extends XScopeShift {
  override firstUpdated() {
    this.renderRoot.querySelector('i.gone')?.setAttribute('data-mark', 'gone');
  }
  override render() {
    return html`${this.known ? nothing : html`<i class="gone">g</i>`}<b>b</b><slot></slot>`;
  }
}
customElements.define('x-mark-gone', XMarkGone);

/** Gives its slotted heading an id (like `dialog/src/Dialog.js` does for aria-labelledby). */
class XLabeller extends SpectrumElement {
  override firstUpdated() {
    this.querySelector('h2')?.setAttribute('id', 'heading-1');
  }
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('x-labeller', XLabeller);

function shadowElements(output: string, tag: string) {
  const host = findElement(parseHtml(output), (element) => element.name === tag);
  assert.ok(host, `<${tag}> rendered`);
  return [...walkElements(templateContent(shadowTemplateOf(host)!))];
}

test('a change is applied to the element with the recorded id although the scope shifted (M4)', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-mark-by-id><p>light</p></x-mark-by-id>`);
  const elements = shadowElements(output, 'x-mark-by-id');
  const target = elements.find((element) => element.attribs.id === 'target');
  const extra = elements.find((element) => element.attribs.class === 'extra');
  assert.ok(extra, 'precondition: the final pass renders the extra element first');
  assert.equal(target?.attribs['data-mark'], 'by-id', formatReport(report));
  assert.equal(extra.attribs['data-mark'], undefined);
});

test('a change never lands on a different element of the same tag (M4)', async () => {
  const {html: output} = await renderSpectrum(html`<x-mark-by-class><p>light</p></x-mark-by-class>`);
  const elements = shadowElements(output, 'x-mark-by-class');
  const label = elements.find((element) => element.attribs.class === 'label');
  const extra = elements.find((element) => element.attribs.class === 'extra');
  assert.ok(label && extra);
  assert.equal(extra.attribs['data-mark'], undefined, 'not applied to the element now at the recorded position');
  assert.equal(label.attribs['data-mark'], 'by-class', 'applied to the element with the recorded signature');
});

test('a change that cannot be applied is reported (M4)', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-mark-gone><p>light</p></x-mark-gone>`);
  assert.ok(!output.includes('data-mark'), 'nothing is applied');
  const host = report.elements.find((element) => element.tagName === 'x-mark-gone');
  assert.ok(
    host?.warnings.some((message) => message.includes('light-DOM attribute change not applied') && message.includes('<i')),
    formatReport(report)
  );
});

test('document-level changes are applied when the template is a whole document (M5)', async () => {
  const {html: output, report} = await renderSpectrum(
    html`<!doctype html><html lang="en"><head><title>Doc</title></head><body><x-labeller><h2>Title</h2></x-labeller></body></html>`
  );
  const document = parse(output, {treeAdapter: adapter}) as unknown as Document;
  const heading = findElement(document, (element) => element.name === 'h2');
  assert.equal(heading?.attribs.id, 'heading-1', formatReport(report));
});
