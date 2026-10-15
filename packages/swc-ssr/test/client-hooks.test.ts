/**
 * swc-ssr/client hydration hooks (`src/client/hooks.ts`) on a fake LitElement, without a browser:
 *  - L6: the hooks only apply to server-rendered shadow roots (a `<!--lit-part-->` marker) and Spectrum (`sp-*`)
 *    elements; other Lit elements with a pre-existing shadow root get no adapters and no extra `render()` call;
 *    the initial-slotchange plan calls `render()` after `willUpdate()`, unless an adapter asks for the early plan;
 *  - M9: the built-in MatchMediaController adapter pins `isMobile.matches` for the hydrating render of `sp-picker`
 *    and restores it (with `requestUpdate`) before `firstUpdated()`.
 * The fake mimics the call order of lit's ReactiveElement / LitElement as patched by lit-element-hydrate-support:
 * createRenderRoot() -> performUpdate() { willUpdate(); update() { render() } }.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installHydrationHooks, registerHydrationAdapter} from '../src/client/hooks.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeNode {
  nodeType: number;
  data?: string;
}

class FakeLitElement {
  log: string[] = [];
  shadowRoot: {childNodes: FakeNode[]; querySelectorAll(): never[]} | null = null;
  renderRoot: unknown;
  isConnected = false; // keeps the post-hydration slotchange dispatch away from the (fake) DOM
  hasUpdated = false;
  updates: Array<[PropertyKey | undefined, unknown]> = [];
  constructor(
    readonly localName: string,
    shadowChildren?: FakeNode[],
  ) {
    if (shadowChildren) this.shadowRoot = {childNodes: shadowChildren, querySelectorAll: () => []};
  }
  createRenderRoot(): unknown {
    return this.shadowRoot ?? (this.shadowRoot = {childNodes: [], querySelectorAll: () => []});
  }
  connect(): void {
    this.renderRoot = this.createRenderRoot();
  }
  performUpdate(): void {
    this.log.push('performUpdate');
    const changed = new Map();
    this.willUpdate();
    this.update(changed);
    this.hasUpdated = true;
    this.firstUpdated();
  }
  willUpdate(): void {
    this.log.push('willUpdate');
  }
  update(_changed: unknown): void {
    this.log.push('update');
    this.render();
  }
  firstUpdated(): void {
    this.log.push('firstUpdated');
  }
  render(): unknown {
    this.log.push('render');
    return null; // no @slotchange bindings: the plan only notes "dispatch at the shadow root"
  }
  requestUpdate(name?: PropertyKey, oldValue?: unknown): void {
    this.updates.push([name, oldValue]);
  }
  // Read by the built-in sp-picker selection adapter (no `value`: it does nothing).
  getAttribute(): string | null {
    return null;
  }
}

installHydrationHooks(() => undefined);
(globalThis as any).litElementHydrateSupport({LitElement: FakeLitElement});

registerHydrationAdapter({
  tag: /^(x-|sp-fake)/,
  beforeHydrate(element) {
    (element as unknown as FakeLitElement).log.push('beforeHydrate');
  },
  afterHydrate(element) {
    (element as unknown as FakeLitElement).log.push('afterHydrate');
  },
});
registerHydrationAdapter({tag: 'x-early', slotchangePlan: 'before-willupdate'});

const marker = (): FakeNode[] => [{nodeType: 1}, {nodeType: 8, data: 'lit-part AbCd=='}, {nodeType: 8, data: '/lit-part'}];

function hydrate(element: FakeLitElement): string[] {
  element.connect();
  element.performUpdate();
  return element.log;
}

test('server-rendered shadow root: adapters around the hydrating update, slotchange plan after willUpdate', () => {
  assert.deepEqual(hydrate(new FakeLitElement('x-ssr', marker())), [
    'beforeHydrate',
    'performUpdate',
    'willUpdate',
    'render', // the slotchange plan, after willUpdate()
    'update',
    'render',
    'afterHydrate',
    'firstUpdated',
  ]);
});

test('an adapter can move the slotchange plan before willUpdate', () => {
  assert.deepEqual(hydrate(new FakeLitElement('x-early', marker())), [
    'beforeHydrate',
    'render', // the early plan
    'performUpdate',
    'willUpdate',
    'update',
    'render',
    'afterHydrate',
    'firstUpdated',
  ]);
});

test('a declarative shadow root without server markers on a non-Spectrum element is left alone', () => {
  assert.deepEqual(hydrate(new FakeLitElement('x-handwritten', [{nodeType: 1}, {nodeType: 8, data: 'comment'}])), [
    'performUpdate',
    'willUpdate',
    'update',
    'render',
    'firstUpdated',
  ]);
});

test('client-rendered elements (no pre-existing shadow root) are left alone', () => {
  assert.deepEqual(hydrate(new FakeLitElement('x-csr')), ['performUpdate', 'willUpdate', 'update', 'render', 'firstUpdated']);
});

test('Spectrum elements are hooked even without server markers', () => {
  const log = hydrate(new FakeLitElement('sp-fake', [{nodeType: 1}]));
  assert.equal(log[0], 'beforeHydrate');
  assert.ok(log.includes('afterHydrate'));
});

test('second and later updates are never hooked', () => {
  const element = new FakeLitElement('x-ssr', marker());
  hydrate(element);
  element.log.length = 0;
  element.performUpdate();
  assert.deepEqual(element.log, ['performUpdate', 'willUpdate', 'update', 'render', 'firstUpdated']);
});

test('M9: sp-picker hydrates with the server value of isMobile, then gets the phone value back', () => {
  const picker = new FakeLitElement('sp-picker', marker()) as FakeLitElement & {isMobile: any; seen: boolean[]};
  picker.isMobile = {host: picker, matches: true, media: {matches: true}, key: Symbol('match-media-key')};
  picker.seen = [];
  const render = picker.render.bind(picker);
  picker.render = () => {
    picker.seen.push(picker.isMobile.matches);
    return render();
  };
  const firstUpdated = picker.firstUpdated.bind(picker);
  picker.firstUpdated = () => {
    picker.seen.push(picker.isMobile.matches);
    firstUpdated();
  };
  hydrate(picker);
  // render() for the slotchange plan and for the hydrating update: pinned; firstUpdated(): restored.
  assert.deepEqual(picker.seen, [false, false, true]);
  assert.deepEqual(picker.updates, [[picker.isMobile.key, false]]);
  assert.equal(Object.getOwnPropertyDescriptor(picker.isMobile, 'matches')?.value, true);
});

test('M9: a MatchMediaController element under another tag (a subclass) is pinned too', () => {
  // Review finding: the adapter matched only sp-picker / sp-action-menu / sp-contextual-help, so e.g.
  // `class MyPicker extends Picker` registered as <my-picker> hydrated with the phone's value (a mismatch).
  const picker = new FakeLitElement('my-picker', marker()) as FakeLitElement & {isMobile: any; seen: boolean[]};
  picker.isMobile = {host: picker, matches: true, media: {matches: true}, key: Symbol('match-media-key')};
  picker.seen = [];
  const render = picker.render.bind(picker);
  picker.render = () => {
    picker.seen.push(picker.isMobile.matches);
    return render();
  };
  hydrate(picker);
  assert.deepEqual(picker.seen, [false, false], 'pinned to the server value for the hydrating render');
  assert.deepEqual(picker.updates, [[picker.isMobile.key, false]], 'restored afterwards with requestUpdate');
  assert.equal(Object.getOwnPropertyDescriptor(picker.isMobile, 'matches')?.value, true);
});

test('M9: elements without MatchMediaControllers are not touched by the adapter', () => {
  const element = new FakeLitElement('x-no-media', marker()) as FakeLitElement & {other: any};
  element.other = {matches: true, media: {matches: true}, host: {}}; // a controller of another host
  hydrate(element);
  assert.deepEqual(element.updates, [], 'no update requested');
  assert.equal(Object.getOwnPropertyDescriptor(element.other, 'matches')?.value, true, 'not pinned');
});
