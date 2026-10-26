/**
 * spectrum-web-components-ssr/client hydration hooks (`src/client/hooks.ts`) on a fake LitElement, without a browser:
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

/**
 * 0.3.0 review (the catalog's color-area handles stayed in the corner): `sp-color-area` / `sp-color-wheel` measure
 * themselves from a ResizeObserver started in their own `connectedCallback()`, which runs at the upgrade while the
 * element still carries `defer-hydration`. Measured before the hydrating update, the hydrating render differed from
 * the server markup only in attribute values, which lit's `hydrate()` primes without writing: the DOM kept the
 * server's `transform`. The measurement is hidden for the hydrating render and given back right after it, with one
 * more update requested (which then writes the measured layout).
 */
function measuredElement(tag: string, shape: 'area' | 'wheel' | 'none') {
  const element = new FakeLitElement(tag, marker()) as FakeLitElement & {boundingClientRect?: unknown; seen: unknown[]};
  element.seen = [];
  if (shape === 'area') (element as any).getContentBoundingRect = () => ({width: 192, height: 192});
  if (shape === 'wheel') (element as any).cacheLayoutData = () => {};
  const render = element.render.bind(element);
  element.render = () => {
    element.seen.push(element.boundingClientRect);
    return render();
  };
  const firstUpdated = element.firstUpdated.bind(element);
  element.firstUpdated = () => {
    element.seen.push(`firstUpdated:${element.boundingClientRect === undefined ? 'none' : 'rect'}`);
    firstUpdated();
  };
  return element;
}

test('measured layout: hidden for the hydrating render, given back afterwards with one more update', () => {
  const rect = {width: 192, height: 192};
  for (const [tag, shape] of [
    ['sp-color-area', 'area'],
    ['my-color-wheel', 'wheel'],
  ] as const) {
    const element = measuredElement(tag, shape);
    element.boundingClientRect = rect; // the ResizeObserver measured it before hydration
    hydrate(element);
    assert.deepEqual(element.seen, [undefined, undefined, 'firstUpdated:rect'], `${tag}: unmeasured renders, rect back after`);
    assert.equal(element.boundingClientRect, rect);
    assert.deepEqual(element.updates, [[undefined, undefined]], `${tag}: one update requested`);
  }
});

test('measured layout: not measured before hydration - nothing hidden, one more update still requested', () => {
  const element = measuredElement('sp-color-area', 'area');
  hydrate(element);
  assert.deepEqual(element.seen, [undefined, undefined, 'firstUpdated:none']);
  assert.deepEqual(element.updates, [[undefined, undefined]]);
});

test('measured layout: elements of another shape keep their boundingClientRect and get no update', () => {
  const element = measuredElement('x-measures', 'none');
  const rect = {width: 1, height: 1};
  element.boundingClientRect = rect;
  hydrate(element);
  assert.deepEqual(element.seen, [rect, rect, 'firstUpdated:rect']);
  assert.deepEqual(element.updates, []);
});
