/**
 * Review finding (medium): the process-wide hooks (rAF sink, document listener log, selector error handler) pointed
 * at the most recent active render session. A late continuation of a finished render - a timer one of its
 * components started - that requested an animation frame while the next queued render ran had its frame flushed
 * inside that render, and the frame's error was attributed to an element of that render. Now every hook call is
 * filed under the render of the caller's render scope (AsyncLocalStorage): frames of a finished render are dropped,
 * document listeners it adds are removed at once, and only callers without a render scope go to the active render.
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

/* eslint-disable @typescript-eslint/no-explicit-any */

const LATE_DELAY_MS = 30;

/** What the late continuation of the first render observed. */
const late = {frameRan: false, listenerCalls: 0, done: undefined as Promise<void> | undefined};

/** Its first update starts a timer that outlives the render: a frame that throws, and a document listener. */
class XLateWork extends SpectrumElement {
  override firstUpdated(): void {
    if (late.done) {
      return;
    }
    late.done = new Promise<void>((resolve) => {
      setTimeout(() => {
        requestAnimationFrame(() => {
          late.frameRan = true;
          throw new Error('frame requested by a finished render');
        });
        const listener = () => {
          late.listenerCalls++;
        };
        document.addEventListener('swc-ssr-late-probe', listener);
        document.dispatchEvent(new Event('swc-ssr-late-probe'));
        document.removeEventListener('swc-ssr-late-probe', listener);
        resolve();
      }, LATE_DELAY_MS);
    });
  }
  override render() {
    return html`late`;
  }
}
customElements.define('x-late-work', XLateWork);

/** Keeps the render that is queued behind the first one busy while the first one's timer fires. */
class XBusy extends HTMLElement {}
customElements.define('x-busy', XBusy);
class BusyRenderer extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    return tagName === 'x-busy';
  }
  override renderShadow(): any {
    return [() => new Promise<string>((resolve) => setTimeout(() => resolve('<b>busy</b>'), LATE_DELAY_MS * 4))];
  }
}

/** A Spectrum element of the second render: its first updates run (and animation frames are flushed) in it. */
class XVictim extends SpectrumElement {
  override firstUpdated(): void {
    // Keeps the render's frame queue busy while the late frame arrives.
    requestAnimationFrame(() => {});
  }
  override render() {
    return html`victim`;
  }
}
customElements.define('x-victim', XVictim);

test('animation frames and document listeners of a finished render never reach the next render', async () => {
  const first = renderSpectrum(html`<x-late-work></x-late-work>`);
  const second = renderSpectrum(html`<x-busy></x-busy><x-victim></x-victim>`, {
    elementRenderers: [BusyRenderer as unknown as ElementRendererConstructor],
  });
  await first;
  const {report} = await second;
  await late.done;
  const messages = report.elements.flatMap((element) => [...element.errors, ...element.warnings]);
  assert.ok(
    !messages.some((message) => message.includes('frame requested by a finished render')),
    `the second render's report must not carry the first render's frame error:\n${formatReport(report)}`
  );
  assert.equal(late.frameRan, false, "the finished render's frame is dropped, not flushed by the second render");
  assert.equal(late.listenerCalls, 0, "a document listener of the finished render is removed at once");
});
