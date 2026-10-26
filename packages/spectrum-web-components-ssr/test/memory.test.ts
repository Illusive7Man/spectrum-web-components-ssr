/**
 * (e) Memory: a render must not keep anything of itself alive once it is over. Components register connected
 * instances in module-level singletons (`reactive-controllers/src/AttributeObserver.js`, `iconset-registry.js`,
 * document listeners, ...); before swc-ssr disconnected its elements, every render of a page stayed reachable
 * through them (about 226 MB per full-catalog render) until the server ran out of heap.
 *
 * The test needs an explicit garbage collector: `global.gc` when the process runs with `--expose-gc`, otherwise
 * the flag is set at runtime and `gc` is taken from a fresh V8 context (`v8.setFlagsFromString` +
 * `vm.runInNewContext`).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {activateSession, getActiveSession, getCurrentRenderContext, RenderSession} from '../src/server/context.ts';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');
await import('@spectrum-web-components/action-button/sp-action-button.js');
await import('@spectrum-web-components/checkbox/sp-checkbox.js');
await import('@spectrum-web-components/switch/sp-switch.js');
await import('@spectrum-web-components/textfield/sp-textfield.js');
await import('@spectrum-web-components/number-field/sp-number-field.js');
await import('@spectrum-web-components/picker/sp-picker.js');
await import('@spectrum-web-components/action-menu/sp-action-menu.js');
await import('@spectrum-web-components/menu/sp-menu.js');
await import('@spectrum-web-components/menu/sp-menu-item.js');
await import('@spectrum-web-components/tabs/sp-tabs.js');
await import('@spectrum-web-components/tabs/sp-tab.js');
await import('@spectrum-web-components/tabs/sp-tab-panel.js');
await import('@spectrum-web-components/dialog/sp-dialog.js');
await import('@spectrum-web-components/slider/sp-slider.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-star.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const MB = 1024 * 1024;
const RENDERS = 12;
/** heapUsed after the last render may exceed heapUsed after this render by at most MAX_GROWTH. */
const BASELINE_RENDER = 4;
const MAX_GROWTH = 15 * MB;
/** RenderContexts of these renders must have been collected after the last one. */
const COLLECTED_RENDERS = 10;

function exposeGc(): () => void {
  const existing = (globalThis as {gc?: () => void}).gc;
  if (typeof existing === 'function') {
    return existing;
  }
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

const gc = exposeGc();
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** heapUsed after letting pending timers / finalizers run and collecting garbage. */
async function heapAfterGc(): Promise<number> {
  await nextTask();
  gc();
  await nextTask();
  gc();
  return process.memoryUsage().heapUsed;
}

/*
 * A probe element renderer (tried first via `elementRenderers`, never matches): upstream asks it about every
 * custom element while a pass is being rendered, i.e. while that pass's RenderContext is current. Every context is
 * registered with a FinalizationRegistry under the number of the render it belongs to.
 */
let currentRender = 0;
const created = new Map<number, number>();
const collected = new Map<number, number>();
const seen = new WeakSet<object>();
const finalization = new FinalizationRegistry<number>((render) => {
  collected.set(render, (collected.get(render) ?? 0) + 1);
});

class ContextProbe {
  static matchesClass(): boolean {
    const context = getCurrentRenderContext();
    if (context && !seen.has(context)) {
      seen.add(context);
      finalization.register(context, currentRender);
      created.set(currentRender, (created.get(currentRender) ?? 0) + 1);
    }
    return false;
  }
}

/**
 * A mid-size page: about a dozen components, slotted icons, light-DOM-driven state, a page that needs a third pass
 * (sp-dialog + sp-slider). No `disabled` sp-slider: its `shared/src/focusable.js` `handleDisabledChanged()` rejects
 * asynchronously after the render on the server (a known component-level issue, unrelated to memory) and the test
 * runner fails the file on any unhandled rejection.
 */
const page = () => html`
  <sp-theme system="spectrum" color="light" scale="medium">
    <section>
      <sp-button variant="accent"><sp-icon-edit slot="icon"></sp-icon-edit>Edit</sp-button>
      <sp-action-button label="Favorite"><sp-icon-star slot="icon"></sp-icon-star></sp-action-button>
      <sp-checkbox checked>Remember me</sp-checkbox>
      <sp-switch>Notifications</sp-switch>
      <sp-textfield label="Name" value="Ada"></sp-textfield>
      <sp-number-field label="Count" value="3"></sp-number-field>
    </section>
    <section>
      <sp-picker label="Size" value="m">
        <sp-menu-item value="s">Small</sp-menu-item>
        <sp-menu-item value="m">Medium</sp-menu-item>
        <sp-menu-item value="l">Large</sp-menu-item>
      </sp-picker>
      <sp-action-menu label="More">
        <sp-icon-settings slot="icon"></sp-icon-settings>
        <sp-menu-item>Rename</sp-menu-item>
        <sp-menu-item>Delete</sp-menu-item>
      </sp-action-menu>
    </section>
    <section>
      <sp-tabs selected="2" label="Sections">
        <sp-tab label="One" value="1"></sp-tab>
        <sp-tab label="Two" value="2"></sp-tab>
        <sp-tab label="Three" value="3"></sp-tab>
        <sp-tab-panel value="1">First</sp-tab-panel>
        <sp-tab-panel value="2">Second</sp-tab-panel>
        <sp-tab-panel value="3">Third</sp-tab-panel>
      </sp-tabs>
    </section>
    <section>
      <sp-dialog size="s">
        <h2 slot="heading">Disclaimer</h2>
        Lorem ipsum dolor sit amet.
        <sp-button slot="button" variant="accent">Continue</sp-button>
      </sp-dialog>
      <sp-slider label="Volume" value="40"></sp-slider>
      <sp-slider label="Editable" editable value="25"></sp-slider>
    </section>
  </sp-theme>
`;

test(`${RENDERS} renders of a mid-size page do not accumulate memory`, async (t) => {
  const heap: number[] = [];
  const elementRenderers = [ContextProbe as unknown as ElementRendererConstructor];
  for (let render = 1; render <= RENDERS; render++) {
    currentRender = render;
    const {html: output, report} = await renderSpectrum(page(), {deferHydration: true, elementRenderers});
    currentRender = 0;
    assert.ok(output.includes('<sp-slider'), 'the page rendered');
    assert.deepEqual(
      report.elements.filter((element) => element.errors.length > 0).map((element) => element.tagName),
      [],
      'no element errors'
    );
    heap[render] = await heapAfterGc();
  }
  const series = heap
    .slice(1)
    .map((bytes, index) => `${index + 1}: ${(bytes / MB).toFixed(1)}`)
    .join(', ');
  t.diagnostic(`heapUsed per render (MB): ${series}`);
  const growth = heap[RENDERS] - heap[BASELINE_RENDER];
  assert.ok(
    growth <= MAX_GROWTH,
    `heapUsed grew by ${(growth / MB).toFixed(1)} MB between render ${BASELINE_RENDER} and render ${RENDERS} ` +
      `(limit ${MAX_GROWTH / MB} MB); heapUsed per render in MB: ${series}`
  );

  // Every pass of every render was seen by the probe.
  for (let render = 1; render <= RENDERS; render++) {
    assert.ok((created.get(render) ?? 0) >= 2, `render ${render}: at least two passes observed`);
  }
  // The RenderContexts of the earlier renders are garbage collected (finalizers run in later tasks).
  const pending = () => {
    const missing: string[] = [];
    for (let render = 1; render <= COLLECTED_RENDERS; render++) {
      const alive = (created.get(render) ?? 0) - (collected.get(render) ?? 0);
      if (alive > 0) {
        missing.push(`render ${render}: ${alive} of ${created.get(render)} contexts alive`);
      }
    }
    return missing;
  };
  for (let attempt = 0; attempt < 50 && pending().length > 0; attempt++) {
    gc();
    await nextTask();
  }
  assert.deepEqual(pending(), [], `RenderContexts of renders 1-${COLLECTED_RENDERS} were not collected`);
});

test('a removed document listener does not keep its callback alive', async () => {
  // dom-shim/install.ts wraps listeners to bind `this`; the wrapper table must not hold callbacks strongly.
  let collectedCallback = false;
  const finalizer = new FinalizationRegistry<string>(() => {
    collectedCallback = true;
  });
  (() => {
    const payload = {data: new Array(10_000).fill(0)};
    const listener = () => payload;
    document.addEventListener('swc-ssr-memory-probe', listener);
    document.removeEventListener('swc-ssr-memory-probe', listener);
    finalizer.register(listener, 'listener');
  })();
  for (let attempt = 0; attempt < 50 && !collectedCallback; attempt++) {
    gc();
    await nextTask();
  }
  assert.ok(collectedCallback, 'the listener was garbage collected after removeEventListener');
});

test('sessions that end out of order leave no dead session hooked in', () => {
  const g = globalThis as any;
  const outer = new RenderSession({});
  const nested = new RenderSession({});
  const endOuter = activateSession(outer);
  const endNested = activateSession(nested);
  // The outer render finishes first (its nested render is still waiting for something).
  endOuter();
  assert.equal(getActiveSession(), nested);
  g.requestAnimationFrame(() => {});
  assert.equal(nested.raf.size, 1, 'frames go to the session that is still active');
  assert.equal(outer.raf.size, 0, 'nothing is queued into the finished session');
  endNested();
  endNested(); // idempotent
  assert.equal(getActiveSession(), undefined);
  g.requestAnimationFrame(() => {});
  assert.equal(outer.raf.size + nested.raf.size, 0, 'outside of renders frames are dropped');
  const listener = () => {};
  document.addEventListener('swc-ssr-memory-probe', listener);
  document.removeEventListener('swc-ssr-memory-probe', listener);
  assert.equal(
    outer.listeners.length + nested.listeners.length,
    0,
    'document listeners are not logged into ended sessions'
  );
});
