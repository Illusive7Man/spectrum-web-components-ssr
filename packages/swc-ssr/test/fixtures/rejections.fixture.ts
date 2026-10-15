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
 *                       application listener: it belongs to the (finished) render, the process must not fail.
 */
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
