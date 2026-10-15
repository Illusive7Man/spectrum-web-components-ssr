/**
 * Review L1-L5: details of the pass machinery.
 *
 * - L1: the previous-pass shadow used as fallback output carried that pass's `data-swc-ssr` ids, which collided
 *   with the final pass's ids (light-DOM mutation targets, the next pass's tree).
 * - L2: an update of an element whose markup the pass had already emitted was silently lost; it is now reported
 *   and another pass (bounded) is made, in which it updates before rendering.
 * - L3: adapters got `pass: 1 | 2` (also in pass 3) and `id: -1` without any way to identify the element in
 *   `prepare()` of pre-instantiated elements; they now get the real pass, the key and the previous pass's id.
 * - L4: pre-instantiation de-duplicated with `Array.includes` (quadratic in the number of elements).
 * - L5: structure changes components make on rendered nodes (e.g. `sp-table` inserting checkbox cells) were
 *   dropped silently; they are now reported.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, registerAdapter, renderSpectrum} from '../src/server/index.ts';
import type {AdapterContext} from '../src/server/index.ts';
import {findElement, formatReport, parseHtml, shadowTemplateOf, templateContent, textOf} from './helpers.ts';

installSpectrumSsr();

const {html, nothing} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

/* eslint-disable @typescript-eslint/no-explicit-any */

class XInnerItem extends SpectrumElement {
  override render() {
    return html`<i>inner</i>`;
  }
}
customElements.define('x-inner-item', XInnerItem);

/** Renders in pass 1; its render() fails once it has updated, so pass 2 falls back to the pass-1 shadow. */
class XFragile extends SpectrumElement {
  static override properties = {ready: {type: Boolean}};
  declare ready: boolean;
  constructor() {
    super();
    this.ready = false;
  }
  override firstUpdated() {
    this.ready = true;
  }
  override render() {
    if (this.ready) {
      throw new Error('render fails once ready');
    }
    return html`<x-inner-item></x-inner-item>`;
  }
}
customElements.define('x-fragile', XFragile);

test('fallback markup carries no previous-pass markers (L1)', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-fragile></x-fragile><x-inner-item></x-inner-item>`, {
    debug: true,
  });
  const fragile = report.elements.find((element) => element.tagName === 'x-fragile')!;
  assert.equal(fragile.fallback, true, 'precondition: x-fragile falls back to its pass-1 shadow');
  const ids = [...output.matchAll(/ data-swc-ssr="(\d+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, [...new Set(ids)], `every marker id is unique in the output: ${ids.join(', ')}`);
});

/** Announces itself to its host when connected (bubbling, composed event), like Spectrum's child elements do. */
class XLateChild extends SpectrumElement {
  override connectedCallback() {
    super.connectedCallback();
    this.dispatchEvent(new Event('x-child-ready', {bubbles: true, composed: true}));
  }
  override render() {
    return html`<i>child</i>`;
  }
}
customElements.define('x-late-child', XLateChild);

/** Renders its child only once it knows its light DOM (pass 1 has none); the child's announcement updates it. */
class XLateHost extends SpectrumElement {
  static override properties = {known: {type: Boolean}, childReady: {type: Boolean}};
  declare known: boolean;
  declare childReady: boolean;
  constructor() {
    super();
    this.known = false;
    this.childReady = false;
    this.addEventListener('x-child-ready', () => {
      this.childReady = true;
    });
  }
  override willUpdate() {
    this.known = this.querySelector('p') !== null;
  }
  override render() {
    return html`${this.known ? html`<x-late-child></x-late-child>` : nothing}<span id="ready"
        >${this.childReady ? 'ready' : 'waiting'}</span
      ><slot></slot>`;
  }
}
customElements.define('x-late-host', XLateHost);

const adapterCalls: Array<{hook: string; ctx: AdapterContext}> = [];
registerAdapter({
  tag: 'x-late-host',
  prepare(_element, ctx) {
    adapterCalls.push({hook: 'prepare', ctx: {...ctx}});
  },
  beforeRender(_element, ctx) {
    adapterCalls.push({hook: 'beforeRender', ctx: {...ctx}});
  },
});

test('an update after the markup was emitted is reported and resolved by another pass (L2)', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-late-host><p>light</p></x-late-host>`);
  const host = findElement(parseHtml(output), (element) => element.name === 'x-late-host')!;
  const ready = findElement(templateContent(shadowTemplateOf(host)!), (element) => element.attribs.id === 'ready')!;
  assert.equal(textOf(ready).trim(), 'ready', formatReport(report));
  assert.equal(report.passes, 3);
  const entry = report.elements.find((element) => element.tagName === 'x-late-host')!;
  assert.ok(
    entry.warnings.some((message) => /updated after its markup was emitted in pass 2 \(changed: childReady\)/.test(message)),
    formatReport(entry)
  );
});

test('adapters get the real pass number, the key and the previous id (L3)', async () => {
  adapterCalls.length = 0;
  await renderSpectrum(html`<x-late-host><p>light</p></x-late-host>`);
  const pooled = adapterCalls.filter(({hook, ctx}) => hook === 'prepare' && ctx.pass > 1);
  assert.ok(pooled.length > 0, 'prepare() of pre-instantiated elements');
  for (const {ctx} of pooled) {
    assert.equal(ctx.id, -1, 'not rendered yet');
    assert.equal(typeof ctx.key, 'string');
    assert.equal(typeof ctx.previousId, 'number', 'the previous pass id identifies the element');
  }
  const passes = adapterCalls.filter(({hook}) => hook === 'beforeRender').map(({ctx}) => ctx.pass);
  assert.deepEqual(passes, [2, 3], 'beforeRender in pass 2 and in pass 3');
  const last = adapterCalls.filter(({hook}) => hook === 'beforeRender').at(-1)!.ctx;
  assert.ok(last.id >= 0 && typeof last.previousId === 'number');
});

class XFlatItem extends SpectrumElement {
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('x-flat-item', XFlatItem);

test('pre-instantiation does not search arrays of elements (L4: linear in the number of elements)', async () => {
  const items = Array.from({length: 300}, (_unused, index) => html`<x-flat-item>${index}</x-flat-item>`);
  const includes = Array.prototype.includes;
  let elementSearches = 0;
  Array.prototype.includes = function (this: unknown[], value: unknown, ...rest: unknown[]) {
    if (this.length >= 50 && value !== null && typeof value === 'object' && 'localName' in (value as object)) {
      elementSearches++;
    }
    return includes.call(this, value, ...(rest as [number?]));
  };
  try {
    await renderSpectrum(html`<div>${items}</div>`);
  } finally {
    Array.prototype.includes = includes;
  }
  assert.equal(elementSearches, 0, 'linear scans of element arrays during the render');
});

/** Changes the structure of nodes the server renders from templates. */
class XInserter extends SpectrumElement {
  override firstUpdated() {
    this.appendChild(document.createElement('span'));
    (this.querySelector('p') as any).textContent = 'changed';
    this.renderRoot.querySelector('div')?.insertBefore(document.createElement('em'), null);
  }
  override render() {
    return html`<div><slot></slot></div>`;
  }
}
customElements.define('x-inserter', XInserter);

test('structure changes on rendered nodes are reported, not silently dropped (L5)', async () => {
  const {report} = await renderSpectrum(html`<x-inserter><p>text</p></x-inserter>`);
  const entry = report.elements.find((element) => element.tagName === 'x-inserter')!;
  const dropped = entry.warnings.filter((message) => message.startsWith('dropped DOM change'));
  assert.ok(dropped.some((message) => message.includes('insertBefore(<span>) on <x-inserter>')), formatReport(entry));
  assert.ok(dropped.some((message) => message.includes('textContent on <p> in <x-inserter>')), formatReport(entry));
  assert.ok(dropped.some((message) => message.includes('insertBefore(<em>) on <div> in <x-inserter>')), formatReport(entry));
});
