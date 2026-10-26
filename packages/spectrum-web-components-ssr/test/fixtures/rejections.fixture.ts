/**
 * Child-process fixture of server-rejections.test.ts (the test runner fails a test file on any unhandled
 * rejection, so these scenarios run in their own process). Prints one JSON line: the render report's messages and
 * the rejections the application's own `unhandledRejection` listener saw.
 *
 * SCENARIO=attribution  an element's hook starts a promise chain that rejects (nobody handles it), and an unrelated
 *                       rejection (created outside any render) happens while the render is in progress; the
 *                       application has its own listener.
 * SCENARIO=unrelated    the same unrelated rejection, no application listener: Node's default must apply (the
 *                       process fails with that error).
 * SCENARIO=late         an element's hook schedules a rejection that happens after the render is over, no
 *                       application listener: it belongs to the (finished) render, the process must not fail (a
 *                       process warning is printed).
 * SCENARIO=late-root    a long-lived resource first created inside a render, outside of any element hook (here: an
 *                       interval started by a custom element renderer, like a lazily created client or pool of the
 *                       application) rejects after the render is over, no application listener: Node's default
 *                       must apply (the process fails with that error).
 */
import {ElementRenderer} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {installSpectrumSsr, renderSpectrum} from '../../src/server/index.ts';

installSpectrumSsr();

const {html} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');

const scenario = process.env.SCENARIO ?? 'attribution';
const seenByApp: string[] = [];
if (scenario === 'attribution') {
  process.on('unhandledRejection', (reason) => {
    seenByApp.push(reason instanceof Error ? reason.message : String(reason));
  });
}

/** Starts an application-level interval the first time it renders; the interval fails 3 ticks later. */
let intervalStarted = false;
class StartsInterval extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    return tagName === 'x-starts-interval';
  }
  override renderShadow(): string[] {
    if (!intervalStarted) {
      intervalStarted = true;
      let ticks = 0;
      const timer = setInterval(() => {
        if (++ticks === 3) {
          clearInterval(timer);
          void Promise.reject(new Error('rejection of a resource created during a render'));
        }
      }, 30);
    }
    return ['<b>ok</b>'];
  }
}
customElements.define('x-starts-interval', class extends HTMLElement {});

if (scenario === 'late-root') {
  const {report} = await renderSpectrum(html`<x-starts-interval></x-starts-interval>`, {
    elementRenderers: [StartsInterval as unknown as ElementRendererConstructor],
  });
  // The process must fail before this resolves (Node's default for an unhandled rejection).
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log(JSON.stringify({messages: report.elements.flatMap((element) => element.warnings), seenByApp}));
  process.exit(0);
}

class XRejecting extends SpectrumElement {
  override firstUpdated(): void {
    if (scenario === 'late') {
      // Rejects well after the render returned (the render's own work is long over by then).
      void new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late rejection')), 50));
    } else {
      // Not returned to the caller: nobody handles the rejection.
      void this.failLater();
    }
  }
  private async failLater(): Promise<void> {
    await null;
    throw new Error('rejection from x-rejecting');
  }
  override render() {
    return html`<i>content</i>`;
  }
}
customElements.define('x-rejecting', XRejecting);

const rendering = renderSpectrum(html`<x-rejecting></x-rejecting>`);
if (scenario !== 'late') {
  // Started outside of any render, fires while the render is in progress (renders span macrotasks).
  setTimeout(() => {
    void Promise.reject(new Error('unrelated rejection'));
  }, 0);
}
const {report} = await rendering;
await new Promise((resolve) => setTimeout(resolve, 150));
const messages = report.elements.flatMap((element) =>
  [...element.errors, ...element.warnings].map((message) => `${element.tagName}: ${message}`)
);
console.log(JSON.stringify({messages, seenByApp}));
