/**
 * Review M3: matching pass-2 elements to the instances pre-built from the previous pass. The key used to be tree
 * scope + tag + ordinal only, so when a component renders an extra same-tag element before an existing one once it
 * knows its light DOM, the extra element adopted the other one's instance (its attributes, properties and light
 * DOM), and the existing element lost its tree information. The static template attributes are now part of the key,
 * and attributes of the previous pass's element that upstream does not set again are removed.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, formatReport, parseHtml, shadowTemplateOf, templateContent, textOf, walkElements} from './helpers.ts';

installSpectrumSsr();

const {html, nothing} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Shows its light-DOM text (read in willUpdate) and whether its `stale` boolean attribute/property is set. */
class XLeaf extends SpectrumElement {
  static override properties = {stale: {type: Boolean, reflect: true}, text: {}};
  declare stale: boolean;
  declare text: string;
  constructor() {
    super();
    this.stale = false;
    this.text = '';
  }
  override willUpdate() {
    this.text = (this.textContent ?? '').trim();
  }
  override render() {
    return html`<span id="text">${this.text}</span><span id="stale">${String(this.stale)}</span>`;
  }
}
customElements.define('x-leaf', XLeaf);

/**
 * Renders differently once it knows its light DOM (pass 1 has none): an extra `<x-leaf>` before the main one, and
 * the main one loses its `?stale` binding.
 */
class XKeyHost extends SpectrumElement {
  static override properties = {known: {type: Boolean}};
  declare known: boolean;
  constructor() {
    super();
    this.known = false;
  }
  override willUpdate() {
    this.known = this.querySelector('p') !== null;
  }
  override render() {
    return html`${this.known ? html`<x-leaf role="note"></x-leaf>` : nothing}<x-leaf
        role="main"
        ?stale=${!this.known}
        >main text</x-leaf
      ><slot></slot>`;
  }
}
customElements.define('x-key-host', XKeyHost);

/** Same position in both passes; its leaf's `?stale` binding is true in pass 1 only. */
class XStaleHost extends XKeyHost {
  override render() {
    return html`<x-leaf role="main" ?stale=${!this.known}>main text</x-leaf><slot></slot>`;
  }
}
customElements.define('x-stale-host', XStaleHost);

test('an extra same-tag element rendered before an existing one does not take over its instance', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-key-host><p>light</p></x-key-host>`);
  const host = findElement(parseHtml(output), (element) => element.name === 'x-key-host')!;
  const shadow = templateContent(shadowTemplateOf(host)!);
  const leaves = [...walkElements(shadow)].filter((element) => element.name === 'x-leaf');
  assert.deepEqual(
    leaves.map((leaf) => leaf.attribs.role),
    ['note', 'main'],
    'the final pass renders the extra leaf first'
  );
  const textOfLeaf = (leaf: any) =>
    textOf(findElement(templateContent(shadowTemplateOf(leaf)!), (element) => element.attribs.id === 'text')!).trim();
  assert.equal(textOfLeaf(leaves[1]), 'main text', 'the main leaf keeps its own instance and light DOM');
  assert.equal(textOfLeaf(leaves[0]), '', 'the extra leaf has no light DOM of its own');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), [], formatReport(report));
});

test('attributes of the previous pass that are not set again are removed from the adopted instance', async () => {
  const {html: output} = await renderSpectrum(html`<x-stale-host><p>light</p></x-stale-host>`);
  const host = findElement(parseHtml(output), (element) => element.name === 'x-stale-host')!;
  const main = [...walkElements(templateContent(shadowTemplateOf(host)!))].find(
    (element) => element.name === 'x-leaf' && element.attribs.role === 'main'
  )!;
  assert.equal(main.attribs.stale, undefined, 'the ?stale binding is false in the final pass');
  const stale = findElement(templateContent(shadowTemplateOf(main)!), (element) => element.attribs.id === 'stale')!;
  assert.equal(textOf(stale).trim(), 'false', 'the property follows the removed attribute');
});
