/**
 * 0.3.0 review: compiled selectors are cached process-wide (dom-shim/select.ts). css-select's default
 * `cacheResults: true` kept a `WeakSet` of non-matching ancestors inside every compiled descendant combinator, so a
 * cached selector returned stale results after an ancestor's attributes changed: `querySelector('.on span')` stayed
 * `null` after `p.setAttribute('class', 'on')`, and in a render a component that queried after its sibling marked an
 * ancestor rendered a different result than the browser. The cache must not carry state about nodes between queries.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, parseHtml, shadowTemplateOf, templateContent, textOf, walkElements} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

function tree(): {div: any; p: any; span: any} {
  const div = g.document.createElement('div');
  const p = g.document.createElement('p');
  const span = g.document.createElement('span');
  p.appendChild(span);
  div.appendChild(p);
  return {div, p, span};
}

test('querySelector / querySelectorAll see an ancestor attribute set after the same selector was evaluated', () => {
  const {div, p, span} = tree();
  assert.equal(div.querySelector('.on span'), null);
  assert.equal(div.querySelectorAll('.on span').length, 0);
  p.setAttribute('class', 'on');
  assert.equal(div.querySelector('.on span'), span);
  assert.equal(div.querySelectorAll('.on span').length, 1);
  p.removeAttribute('class');
  assert.equal(div.querySelector('.on span'), null);
  // a fresh tree with the same selector is unaffected either way
  const other = tree();
  other.p.className = 'on';
  assert.equal(other.div.querySelector('.on span'), other.span);
});

test('matches / closest see an ancestor attribute set after the same selector was evaluated', () => {
  const {div, p, span} = tree();
  assert.equal(span.matches('[data-x] span'), false);
  assert.equal(span.closest('[data-x] span'), null);
  p.setAttribute('data-x', '');
  assert.equal(span.matches('[data-x] span'), true);
  assert.equal(span.closest('[data-x] span'), span);
  // `:not` / `:is` / `:has` compile sub-selectors with the same options
  assert.equal(span.matches(':not([data-y] *)'), true);
  div.setAttribute('data-y', '');
  assert.equal(span.matches(':not([data-y] *)'), false);
  assert.equal(span.matches(':is([data-z] span)'), false);
  p.setAttribute('data-z', '');
  assert.equal(span.matches(':is([data-z] span)'), true);
  assert.equal(div.matches(':has(.late)'), false);
  span.className = 'late';
  assert.equal(div.matches(':has(.late)'), true);
});

/** Renders whether its parent has an `<em>` inside an element marked `data-active` (as text). */
class XSelectProbe extends SpectrumElement {
  static override properties = {found: {state: true}};
  declare found: string;
  override connectedCallback(): void {
    super.connectedCallback();
    this.found = this.parentElement?.querySelector('[data-active] em') ? 'found' : 'none';
  }
  override render() {
    return html`<span class="found">${this.found}</span><slot></slot>`;
  }
}
/** Marks its previous sibling `data-active`. */
class XSelectMark extends SpectrumElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.previousElementSibling?.setAttribute('data-active', '');
  }
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('x-select-probe', XSelectProbe);
customElements.define('x-select-mark', XSelectMark);

test('render: a query after a sibling changed an ancestor attribute matches what the browser computes', async () => {
  const result = await renderSpectrum(
    html`<section><x-select-probe></x-select-probe><div><em>1</em></div><x-select-mark></x-select-mark><x-select-probe></x-select-probe></section>`,
    {deferHydration: true, lang: 'en'}
  );
  const root = parseHtml(result.html);
  const probes = [...walkElements(root)].filter((element) => element.name === 'x-select-probe');
  assert.equal(probes.length, 2);
  // In the browser the elements upgrade in document order: the first probe runs before the mark, the second after.
  const texts = probes.map((probe) => {
    const shadow = shadowTemplateOf(probe);
    assert.ok(shadow, 'probe has a declarative shadow root');
    const label = findElement(templateContent(shadow), (element) => element.attribs.class === 'found');
    assert.ok(label);
    return textOf(label).trim();
  });
  assert.deepEqual(texts, ['none', 'found']);
  assert.ok(findElement(root, (element) => element.name === 'div' && element.attribs['data-active'] === ''));
});
