/**
 * Review M6: the render queue. Renders are serialized in one promise queue; before the fix there was no deadline,
 * so a render that never settled (a template awaiting a promise that never settles) blocked every later render,
 * and a `renderSpectrum()` awaited from asynchronous code of a render (not from its synchronous thunks) waited in
 * the queue behind the render waiting for it: a deadlock. The lazy-definition wait could not be turned off.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ElementRenderer} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {formatReport} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');
await import('@spectrum-web-components/button/sp-button.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fails the test instead of hanging it when `promise` does not settle in time. */
function settleWithin<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

class XHang extends HTMLElement {}
customElements.define('x-hang', XHang);
class XNest extends HTMLElement {}
customElements.define('x-nest', XNest);

/** Which construction of an x-hang renderer (1 = pass 1, 2 = pass 2) renders a shadow that never settles. */
let hangAt = 0;
let constructions = 0;

class HangRenderer extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    return tagName === 'x-hang';
  }
  private readonly hangs: boolean;
  constructor(tagName: string) {
    super(tagName);
    this.hangs = ++constructions === hangAt;
  }
  override renderShadow(): any {
    return [() => (this.hangs ? new Promise<string>(() => {}) : '<b>settled</b>')];
  }
}

/** Renders its shadow with a nested renderSpectrum() started from asynchronous code (a microtask). */
class NestRenderer extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    return tagName === 'x-nest';
  }
  override renderShadow(): any {
    return [
      () =>
        Promise.resolve()
          .then(() => renderSpectrum(html`<sp-button>Inner</sp-button>`))
          .then((result) => result.html),
    ];
  }
}

const renderers = [HangRenderer, NestRenderer] as unknown as ElementRendererConstructor[];

test('a render whose pass 2 never settles returns the pass-1 output at its deadline', async () => {
  hangAt = 2;
  constructions = 0;
  const {html: output, report} = await settleWithin(
    renderSpectrum(html`<x-hang></x-hang><sp-button>Next</sp-button>`, {elementRenderers: renderers, timeoutMs: 300}),
    10_000,
    'the render'
  );
  assert.ok(output.includes('<b>settled</b>'), 'the output of the completed pass 1');
  assert.ok(output.includes('<sp-button'), output.slice(0, 200));
  assert.equal(report.passes, 1);
  const render = report.elements.find((element) => element.tagName === '#render');
  assert.ok(render?.warnings.some((message) => message.includes('did not settle within 300 ms')), formatReport(report));
});

test('a render whose pass 1 never settles rejects at its deadline, and the queue moves on', async () => {
  hangAt = 1;
  constructions = 0;
  const stuck = renderSpectrum(html`<x-hang></x-hang>`, {elementRenderers: renderers, timeoutMs: 300});
  // Queued behind the stuck render.
  const next = renderSpectrum(html`<sp-button>After</sp-button>`);
  await assert.rejects(settleWithin(stuck, 10_000, 'the stuck render'), /did not settle within 300 ms/);
  const {html: output} = await settleWithin(next, 10_000, 'the next render');
  assert.ok(output.includes('After'));
});

test('a renderSpectrum() awaited from asynchronous code of a render runs nested instead of deadlocking', async () => {
  const {html: output, report} = await settleWithin(
    renderSpectrum(html`<x-nest></x-nest>`, {elementRenderers: renderers}),
    10_000,
    'the outer render'
  );
  assert.match(output, /<x-nest[^>]*><template shadowroot[^>]*>[\s\S]*<sp-button[^>]*>[\s\S]*Inner/);
  assert.deepEqual(report.elements.filter((element) => element.errors.length > 0), []);
});

class XLazyA extends SpectrumElement {
  override render() {
    return html`<x-never-defined-a></x-never-defined-a>`;
  }
}
customElements.define('x-lazy-a', XLazyA);
class XLazyB extends SpectrumElement {
  override render() {
    return html`<x-never-defined-b></x-never-defined-b>`;
  }
}
customElements.define('x-lazy-b', XLazyB);

/** setTimeout delays of at least 100 ms requested while `fn` runs (the renders below have no deadline timer). */
async function longTimers(fn: () => Promise<unknown>): Promise<number[]> {
  const original = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if ((delay ?? 0) >= 100) {
      delays.push(delay!);
    }
    return original(callback, delay, ...args);
  }) as typeof setTimeout;
  try {
    await fn();
  } finally {
    globalThis.setTimeout = original;
  }
  return delays;
}

test('the lazy-definition wait is configurable and only happens for undefined tags', async () => {
  const none = await longTimers(() => renderSpectrum(html`<sp-button>Defined</sp-button>`, {timeoutMs: 0}));
  assert.deepEqual(none, [], 'no wait when every rendered tag is defined');
  const disabled = await longTimers(() => renderSpectrum(html`<x-lazy-b></x-lazy-b>`, {lazyDefinitionWaitMs: 0, timeoutMs: 0}));
  assert.deepEqual(disabled, [], 'lazyDefinitionWaitMs: 0 disables the wait');
  const waited = await longTimers(() => renderSpectrum(html`<x-lazy-a></x-lazy-a>`, {lazyDefinitionWaitMs: 120, timeoutMs: 0}));
  assert.deepEqual(waited, [120], 'a rendered undefined tag is waited for (once per process), as configured');
});

/* Review finding (low): delays of 2^31 ms and more overflowed setTimeout to 1 ms. */

class XSlowShadow extends HTMLElement {}
customElements.define('x-slow-shadow', XSlowShadow);
class SlowRenderer extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    return tagName === 'x-slow-shadow';
  }
  override renderShadow(): any {
    return [() => new Promise<string>((resolve) => setTimeout(() => resolve('<b>slow</b>'), 30))];
  }
}

test('timeoutMs of 2^31 ms and more means no deadline (it used to time out after 1 ms)', async () => {
  for (const timeoutMs of [2 ** 31, Number.MAX_SAFE_INTEGER, Infinity]) {
    const {html: output, report} = await settleWithin(
      renderSpectrum(html`<x-slow-shadow></x-slow-shadow>`, {
        elementRenderers: [SlowRenderer as unknown as ElementRendererConstructor],
        timeoutMs,
      }),
      10_000,
      `the render with timeoutMs ${timeoutMs}`
    );
    assert.ok(output.includes('<b>slow</b>'), `timeoutMs ${timeoutMs}`);
    assert.equal(report.passes, 2, `timeoutMs ${timeoutMs}: ${formatReport(report)}`);
  }
});

class XLazyLong extends SpectrumElement {
  override render() {
    return html`<x-defined-later></x-defined-later>`;
  }
}
customElements.define('x-lazy-long', XLazyLong);

test('lazyDefinitionWaitMs of 2^31 ms and more waits for the definition (it used to give up after 1 ms)', async () => {
  setTimeout(() => {
    customElements.define(
      'x-defined-later',
      class extends SpectrumElement {
        override render() {
          return html`<b>defined later</b>`;
        }
      }
    );
  }, 40);
  const {html: output} = await settleWithin(
    renderSpectrum(html`<x-lazy-long></x-lazy-long>`, {lazyDefinitionWaitMs: 2 ** 31, timeoutMs: 5000}),
    10_000,
    'the render'
  );
  assert.match(output, /<x-defined-later[^>]*><template shadowroot[^>]*>[\s\S]*defined later/);
});
