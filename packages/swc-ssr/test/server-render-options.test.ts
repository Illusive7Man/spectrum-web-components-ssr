/**
 * Review H1 / M1: which elements get which lifecycle.
 *
 * - H1: `LitElementRenderer.renderOptions` (upstream's per-element `{disableSsr, connectedCallback}`) must also
 *   govern pre-instantiated elements. Before the fix every pooled element was connected and fully updated before
 *   any renderer evaluated its options, so `disableSsr` elements still got `connectedCallback` / `firstUpdated`.
 * - M1: the `full` server lifecycle is the default for Spectrum classes only; other Lit elements keep upstream
 *   semantics (`willUpdate` + reflection, no `connectedCallback`) unless opted in (`lifecycleByTag`,
 *   `isManagedClass`, or `renderOptions` asking for `connectedCallback`). They keep the light-DOM facades.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, parseHtml, shadowTemplateOf, templateContent, textOf} from './helpers.ts';

installSpectrumSsr();

const {LitElement, html} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

/* eslint-disable @typescript-eslint/no-explicit-any */

type Counts = {connected: number; willUpdate: number; firstUpdated: number; children: number};
const counts = new Map<string, Counts>();
const countsOf = (tag: string): Counts => {
  let entry = counts.get(tag);
  if (!entry) {
    entry = {connected: 0, willUpdate: 0, firstUpdated: 0, children: -1};
    counts.set(tag, entry);
  }
  return entry;
};

/** Records its lifecycle calls; `state` becomes 'updated' in firstUpdated (visible only when it re-renders). */
function counting(Base: typeof LitElement) {
  return class extends Base {
    static override properties = {state: {}};
    declare state: string;
    constructor() {
      super();
      this.state = 'initial';
    }
    override connectedCallback() {
      countsOf(this.localName).connected++;
      super.connectedCallback();
    }
    override willUpdate() {
      const entry = countsOf(this.localName);
      entry.willUpdate++;
      // The light-DOM facade is available whatever the lifecycle.
      entry.children = this.querySelectorAll('b').length;
    }
    override firstUpdated() {
      countsOf(this.localName).firstUpdated++;
      this.state = 'updated';
    }
    override render() {
      return html`<span id="state">${this.state}</span><slot></slot>`;
    }
  };
}

customElements.define('x-plain-lit', counting(LitElement));
customElements.define('x-plain-connected', counting(LitElement));
customElements.define('x-spectrum-like', counting(SpectrumElement));
customElements.define('x-spectrum-optout', counting(SpectrumElement));
customElements.define('x-spectrum-noconnect', counting(SpectrumElement));

const renderOptions = (LitElementRenderer as any).renderOptions as Array<(element: HTMLElement) => unknown>;
const optionsCallback = (element: HTMLElement) => {
  switch (element.localName) {
    case 'x-spectrum-optout':
      return {disableSsr: true};
    case 'x-plain-connected':
      return {connectedCallback: true};
    case 'x-spectrum-noconnect':
      return {connectedCallback: false};
    default:
      return undefined;
  }
};

function reset(): void {
  counts.clear();
}

function hostOf(output: string, tag: string) {
  const host = findElement(parseHtml(output), (element) => element.name === tag);
  assert.ok(host, `<${tag}> rendered`);
  return host;
}

function stateOf(output: string, tag: string): string {
  const template = shadowTemplateOf(hostOf(output, tag));
  assert.ok(template, `<${tag}> has a declarative shadow root`);
  const span = findElement(templateContent(template), (element) => element.attribs.id === 'state');
  return span ? textOf(span).trim() : '';
}

test('plain Lit elements keep upstream semantics by default, with light-DOM facades (M1)', async () => {
  reset();
  const {html: output, report} = await renderSpectrum(html`<x-plain-lit><b>a</b><b>b</b></x-plain-lit>`);
  const entry = countsOf('x-plain-lit');
  assert.equal(entry.connected, 0, 'connectedCallback is not called (upstream semantics)');
  assert.equal(entry.firstUpdated, 0, 'firstUpdated is not called (upstream semantics)');
  assert.ok(entry.willUpdate > 0, 'willUpdate runs, as upstream');
  assert.equal(entry.children, 2, 'willUpdate sees the light DOM (facades stay available)');
  assert.equal(stateOf(output, 'x-plain-lit'), 'initial');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
});

test('Spectrum classes get the full lifecycle by default (M1)', async () => {
  reset();
  const {html: output} = await renderSpectrum(html`<x-spectrum-like><b>a</b></x-spectrum-like>`);
  const entry = countsOf('x-spectrum-like');
  assert.ok(entry.connected > 0);
  assert.ok(entry.firstUpdated > 0);
  assert.equal(stateOf(output, 'x-spectrum-like'), 'updated');
});

test('plain Lit elements can opt in: lifecycleByTag and isManagedClass (M1)', async () => {
  reset();
  const byTag = await renderSpectrum(html`<x-plain-lit></x-plain-lit>`, {lifecycleByTag: {'x-plain-lit': 'full'}});
  assert.equal(stateOf(byTag.html, 'x-plain-lit'), 'updated');
  reset();
  const byPredicate = await renderSpectrum(html`<x-plain-lit></x-plain-lit>`, {
    isManagedClass: (_ctor, tag) => tag === 'x-plain-lit',
  });
  assert.equal(stateOf(byPredicate.html, 'x-plain-lit'), 'updated');
  assert.ok(countsOf('x-plain-lit').connected > 0);
});

test('renderOptions disableSsr: not connected, not updated, no shadow root; light DOM still rendered (H1)', async (t) => {
  renderOptions.push(optionsCallback);
  t.after(() => renderOptions.splice(renderOptions.indexOf(optionsCallback), 1));
  reset();
  const {html: output, report} = await renderSpectrum(
    html`<x-spectrum-like><x-spectrum-optout><b>light</b></x-spectrum-optout></x-spectrum-like>`
  );
  const entry = countsOf('x-spectrum-optout');
  assert.equal(entry.connected, 0, 'connectedCallback never runs for a disableSsr element');
  assert.equal(entry.willUpdate, 0, 'no update runs for a disableSsr element');
  assert.equal(entry.firstUpdated, 0, 'firstUpdated never runs for a disableSsr element');
  const host = hostOf(output, 'x-spectrum-optout');
  assert.equal(shadowTemplateOf(host), undefined, 'no declarative shadow root (upstream fallback output)');
  assert.ok(findElement(host, (element) => element.name === 'b'), 'its light DOM is rendered');
  // The surrounding element is unaffected.
  assert.equal(stateOf(output, 'x-spectrum-like'), 'updated');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
});

test('renderOptions connectedCallback: true / false (H1)', async (t) => {
  renderOptions.push(optionsCallback);
  t.after(() => renderOptions.splice(renderOptions.indexOf(optionsCallback), 1));
  reset();
  const {html: output} = await renderSpectrum(
    html`<x-plain-connected></x-plain-connected><x-spectrum-noconnect></x-spectrum-noconnect>`
  );
  const connected = countsOf('x-plain-connected');
  assert.ok(connected.connected > 0, 'a plain Lit element that asks for connectedCallback gets it');
  assert.equal(connected.firstUpdated, 0, '... but not the full lifecycle (upstream: connected only)');
  assert.equal(stateOf(output, 'x-plain-connected'), 'initial');
  const opted = countsOf('x-spectrum-noconnect');
  assert.equal(opted.connected, 0, 'connectedCallback: false is honoured for pre-instantiated elements too');
  assert.equal(opted.firstUpdated, 0);
  assert.equal(stateOf(output, 'x-spectrum-noconnect'), 'initial');
});
