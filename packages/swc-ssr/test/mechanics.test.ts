/**
 * Library-agnostic mechanics of the two-pass renderer, exercised with small LitElements:
 * light-DOM facades (also from constructors), shadow facades returning real instances, slot assignment,
 * the `full` lifecycle (firstUpdated / rAF / updateComplete / initial slotchange), error capture and fallback.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum, registerAdapter} from '../src/server/index.ts';
import {findElement, parseHtml, shadowTemplateOf, templateContent, textOf} from './helpers.ts';

installSpectrumSsr();

const {LitElement, html} = await import('lit');

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The x-* elements are plain Lit elements. swc-ssr drives only managed classes (Spectrum's by default) through its
 * server lifecycle; plain Lit elements keep upstream semantics unless opted in, as these tests do for all of them.
 */
const MANAGED = {isManagedClass: () => true};

/** Counts its light-DOM children from the constructor (like ObserveSlotPresence) and from willUpdate. */
class XCounter extends LitElement {
  static override properties = {count: {type: Number}, fromConstructor: {type: Boolean}};
  declare count: number;
  declare fromConstructor: boolean;
  constructor() {
    super();
    this.count = 0;
    this.fromConstructor = !!this.querySelector(':scope > [slot="icon"]');
  }
  override willUpdate() {
    this.count = this.querySelectorAll(':scope > x-item').length;
  }
  override render() {
    return html`<span id="count">${this.count}</span><span id="ctor">${this.fromConstructor}</span><slot></slot>`;
  }
}
customElements.define('x-counter', XCounter);

class XItem extends LitElement {
  static override properties = {label: {}};
  declare label: string;
  constructor() {
    super();
    this.label = '';
  }
  override render() {
    return html`<b>${this.label}</b>`;
  }
}
customElements.define('x-item', XItem);

/** Resolves state asynchronously like many Spectrum components: firstUpdated -> rAF -> updateComplete. */
class XAsync extends LitElement {
  static override properties = {
    status: {reflect: true},
    childLabel: {},
    slotted: {},
  };
  declare status: string;
  declare childLabel: string;
  declare slotted: string;
  constructor() {
    super();
    this.status = 'initial';
    this.childLabel = '';
    this.slotted = '';
  }
  override firstUpdated() {
    requestAnimationFrame(() => {
      this.updateComplete.then(() => {
        this.status = 'ready';
        // a real instance from the shadow root (pass-1 shadow content)
        const inner = this.renderRoot.querySelector('x-item') as XItem | null;
        this.childLabel = inner instanceof XItem ? `instance:${inner.label}` : 'missing';
      });
    });
  }
  private onSlotChange(event: Event) {
    const slot = event.target as HTMLSlotElement;
    this.slotted = slot
      .assignedNodes({flatten: true})
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join('+');
  }
  override render() {
    return html`
      <x-item label="inner"></x-item>
      <p id="status">${this.status}</p>
      <p id="child">${this.childLabel}</p>
      <p id="slotted">${this.slotted}</p>
      <slot @slotchange=${this.onSlotChange}></slot>
    `;
  }
}
customElements.define('x-async', XAsync);

class XBroken extends LitElement {
  static override properties = {ready: {type: Boolean}};
  declare ready: boolean;
  constructor() {
    super();
    this.ready = false;
  }
  override async firstUpdated() {
    this.ready = true;
    throw new Error('async firstUpdated failure');
  }
  override render() {
    if (this.ready) {
      throw new Error('render failure once ready');
    }
    return html`<i>pass-1 content</i>`;
  }
}
customElements.define('x-broken', XBroken);

/**
 * Like `slider/src/HandleController.js` behind `shared/src/focusable.js`'s `tabIndex`: a property with its own
 * accessor (Lit marks it `wrapped` and reads it at the start of the first update) whose getter reads the element's
 * render root and a property binding of a plain element there (`.model=${...}`, which only a client-side commit
 * sets; server markup cannot carry it). Records what the render root holds before and after the first render.
 */
class XHandles extends LitElement {
  static override properties = {focusIndex: {type: Number}, beforeRender: {}, afterRender: {}};
  declare beforeRender: string;
  declare afterRender: string;
  constructor() {
    super();
    this.beforeRender = 'unset';
    this.afterRender = 'unset';
  }
  get focusIndex(): number {
    const input = this.renderRoot?.querySelector?.('input') as (HTMLInputElement & {model?: {index: number}}) | null;
    // Throws when the input exists without its `.model` binding.
    return input ? input.model!.index : -1;
  }
  set focusIndex(_value: number) {}
  override willUpdate() {
    if (!this.hasUpdated) {
      this.beforeRender = `inputs:${this.renderRoot.querySelectorAll('input').length}`;
    }
  }
  override firstUpdated() {
    this.afterRender = `inputs:${this.renderRoot.querySelectorAll('input').length}`;
  }
  override render() {
    return html`<input .model=${{index: 0}} /><span id="before">${this.beforeRender}</span><span id="after">${this.afterRender}</span>`;
  }
}
customElements.define('x-handles', XHandles);

/** A wrapped property whose getter always throws. */
class XThrowingGetter extends LitElement {
  static override properties = {state: {}};
  get state(): string {
    throw new Error('wrapped getter failure');
  }
  set state(_value: string) {}
  override render() {
    return html`<i>still rendered</i>`;
  }
}
customElements.define('x-throwing-getter', XThrowingGetter);

function shadowOf(htmlText: string, tag: string) {
  const host = findElement(parseHtml(htmlText), (element) => element.name === tag);
  assert.ok(host, `<${tag}> rendered`);
  const template = shadowTemplateOf(host);
  assert.ok(template, `<${tag}> has a declarative shadow root`);
  return templateContent(template);
}

function textById(root: any, id: string): string {
  const element = findElement(root, (node) => node.attribs.id === id);
  assert.ok(element, `#${id} rendered`);
  return textOf(element).trim();
}

test('light-DOM facades answer queries from willUpdate and from the constructor', async () => {
  const {html: output, report} = await renderSpectrum(html`
    <x-counter><span slot="icon"></span><x-item label="a"></x-item><x-item label="b"></x-item></x-counter>
  `, MANAGED);
  const shadow = shadowOf(output, 'x-counter');
  assert.equal(textById(shadow, 'count'), '2');
  assert.equal(textById(shadow, 'ctor'), 'true');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
});

test('full lifecycle: rAF, updateComplete, shadow instances and initial slotchange', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-async>Hello <span>world</span></x-async>`, MANAGED);
  const host = findElement(parseHtml(output), (element) => element.name === 'x-async')!;
  assert.equal(host.attribs.status, 'ready', 'reflected after the rAF + updateComplete chain');
  const shadow = shadowOf(output, 'x-async');
  assert.equal(textById(shadow, 'status'), 'ready');
  assert.equal(textById(shadow, 'child'), 'instance:inner');
  assert.equal(textById(shadow, 'slotted'), 'Hello+world');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
});

test('lifecycle "none" keeps upstream semantics', async () => {
  const {html: output} = await renderSpectrum(html`<x-async>Hello</x-async>`, {...MANAGED, lifecycleByTag: {'x-async': 'none'}});
  const shadow = shadowOf(output, 'x-async');
  assert.equal(textById(shadow, 'status'), 'initial');
  assert.equal(textById(shadow, 'slotted'), '');
});

test('errors are reported per element and render() falls back to the pass-1 shadow', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-broken></x-broken><x-item label="ok"></x-item>`, MANAGED);
  const broken = report.elements.find((element) => element.tagName === 'x-broken')!;
  assert.ok(broken.errors.some((message) => message.includes('async firstUpdated failure')), broken.errors.join('\n'));
  assert.ok(broken.errors.some((message) => message.includes('render failure once ready')), broken.errors.join('\n'));
  assert.equal(broken.fallback, true);
  assert.equal(textOf(shadowOf(output, 'x-broken')).trim(), 'pass-1 content');
  // the rest of the document is unaffected
  assert.equal(textOf(shadowOf(output, 'x-item')).trim(), 'ok');
});

test('the render root shows an element its previous-pass content only once its first update has rendered', async () => {
  // Before the fix the pass-1 <input> (no `model`) was visible to the wrapped getter read at the start of the
  // first update in pass 2, and the TypeError escaped the document lifecycle: renderSpectrum() rejected.
  const {html: output, report} = await renderSpectrum(html`<x-handles></x-handles><x-item label="next"></x-item>`, MANAGED);
  const shadow = shadowOf(output, 'x-handles');
  assert.equal(textById(shadow, 'before'), 'inputs:0', 'empty render root before the first render (as in CSR)');
  assert.equal(textById(shadow, 'after'), 'inputs:1', 'the rendered content is there from firstUpdated() on');
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
  assert.equal(textOf(shadowOf(output, 'x-item')).trim(), 'next');
});

test('a wrapped-property getter that throws is reported, not fatal', async () => {
  const {html: output, report} = await renderSpectrum(html`<x-throwing-getter></x-throwing-getter>`, MANAGED);
  const element = report.elements.find((entry) => entry.tagName === 'x-throwing-getter')!;
  assert.ok(
    element.errors.some((message) => message.includes('initialize wrapped property state') && message.includes('wrapped getter failure')),
    element.errors.join('\n')
  );
  assert.equal(textOf(shadowOf(output, 'x-throwing-getter')).trim(), 'still rendered');
});

test('adapters: lifecycle override and beforeRender hook', async () => {
  const seen: string[] = [];
  registerAdapter({
    tag: 'x-counter',
    lifecycle: 'connected',
    beforeRender(element, context) {
      seen.push(`${element.localName}:${context.pass}`);
      (element as any).count = 42;
    },
  });
  const {html: output} = await renderSpectrum(html`<x-counter><x-item></x-item></x-counter>`, MANAGED);
  assert.deepEqual(seen, ['x-counter:2']);
  assert.equal(textById(shadowOf(output, 'x-counter'), 'count'), '42');
});
