/**
 * Render time grows linearly with the page: rendering 2N copies of a fragment takes less than 2.6 times as long as
 * rendering N copies (minimum of 3 interleaved runs each, after a warm-up; the ratio is robust on a loaded machine
 * where absolute times are not).
 *
 * Guards the render-speed work (0.3.0). Light-DOM attribute changes used to be applied to the page one at a time,
 * copying the whole page per change (~19 MB of HTML on the full catalog: about a quarter of its render time) -
 * quadratic in the page size. Two pages:
 *  - a mid-size Spectrum fragment (three passes: sp-dialog + sp-slider; dialog headings get an `id`; slotted icons,
 *    menus, tabs);
 *  - a fragment that is mostly light-DOM attribute changes and stylesheet text (a test element that marks its
 *    slotted children), where the quadratic cost dominated (ratio ~4 before the fix).
 */
import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';

installSpectrumSsr();

const {html, unsafeCSS} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');
await import('@spectrum-web-components/action-button/sp-action-button.js');
await import('@spectrum-web-components/checkbox/sp-checkbox.js');
await import('@spectrum-web-components/textfield/sp-textfield.js');
await import('@spectrum-web-components/field-label/sp-field-label.js');
await import('@spectrum-web-components/picker/sp-picker.js');
await import('@spectrum-web-components/menu/sp-menu.js');
await import('@spectrum-web-components/menu/sp-menu-item.js');
await import('@spectrum-web-components/tabs/sp-tabs.js');
await import('@spectrum-web-components/tabs/sp-tab.js');
await import('@spectrum-web-components/tabs/sp-tab-panel.js');
await import('@spectrum-web-components/dialog/sp-dialog.js');
await import('@spectrum-web-components/slider/sp-slider.js');
await import('@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const RUNS = 3;
const MAX_RATIO = 2.6;

/** Marks its slotted children (light-DOM attribute changes) and carries a ~16 KB stylesheet. */
class XPerfMarker extends SpectrumElement {
  static override styles = [
    unsafeCSS(Array.from({length: 400}, (_, i) => `.rule-${i} { color: rgb(${i % 256}, 0, 0); }`).join('\n')),
  ];
  override firstUpdated(): void {
    [...this.children].forEach((child, index) => child.setAttribute('data-index', String(index)));
  }
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('x-perf-marker', XPerfMarker);

const spectrumFragment = (index: number) => html`
  <section>
    <sp-button variant="accent"><sp-icon-edit slot="icon"></sp-icon-edit>Edit ${index}</sp-button>
    <sp-action-button label="Edit ${index}"><sp-icon-edit slot="icon"></sp-icon-edit></sp-action-button>
    <sp-checkbox checked>Remember ${index}</sp-checkbox>
    <sp-field-label for="name-${index}">Name ${index}</sp-field-label>
    <sp-textfield id="name-${index}" value="Ada"></sp-textfield>
    <sp-picker label="Size ${index}" value="m">
      <sp-menu-item value="s">Small</sp-menu-item>
      <sp-menu-item value="m">Medium</sp-menu-item>
      <sp-menu-item value="l">Large</sp-menu-item>
    </sp-picker>
    <sp-tabs selected="2" label="Sections ${index}">
      <sp-tab label="One" value="1"></sp-tab>
      <sp-tab label="Two" value="2"></sp-tab>
      <sp-tab-panel value="1">First</sp-tab-panel>
      <sp-tab-panel value="2">Second</sp-tab-panel>
    </sp-tabs>
    <sp-dialog size="s">
      <h2 slot="heading">Disclaimer ${index}</h2>
      Lorem ipsum dolor sit amet.
      <sp-button slot="button" variant="accent">Continue</sp-button>
    </sp-dialog>
    <sp-slider label="Volume ${index}" value="40"></sp-slider>
  </section>
`;

const spectrumPage = (copies: number) => html`
  <sp-theme system="spectrum" color="light" scale="medium">
    ${Array.from({length: copies}, (_, index) => spectrumFragment(index))}
  </sp-theme>
`;

const markerPage = (copies: number) => html`
  ${Array.from(
    {length: copies},
    (_, index) => html`<x-perf-marker><span>a ${index}</span><span>b</span><span>c</span><span>d</span></x-perf-marker>`
  )}
`;

interface Measurement {
  ms: number;
  passes: number;
  elements: number;
}

async function timeRender(page: (copies: number) => unknown, copies: number): Promise<Measurement> {
  const started = performance.now();
  const {report} = await renderSpectrum(page(copies), {deferHydration: true, lang: 'en'});
  const ms = performance.now() - started;
  assert.deepEqual(
    report.elements.filter((element) => element.errors.length > 0).map((element) => element.tagName),
    [],
    `no element errors (${copies} copies)`
  );
  return {ms, passes: report.passes, elements: report.elements.filter((element) => element.id >= 0).length};
}

/** Renders N and 2N copies (interleaved, after a warm-up) and checks the ratio of the minimum times. */
async function checkScaling(
  t: TestContext,
  page: (copies: number) => unknown,
  n: number,
  fixedElements: number
): Promise<void> {
  // Warm-up: the first renders of a process compile everything.
  await timeRender(page, n);
  await timeRender(page, 2 * n);
  const single: Measurement[] = [];
  const double: Measurement[] = [];
  for (let run = 0; run < RUNS; run++) {
    single.push(await timeRender(page, n));
    double.push(await timeRender(page, 2 * n));
  }
  const best = (list: Measurement[]) => Math.min(...list.map(({ms}) => ms));
  const ratio = best(double) / best(single);
  const times = (list: Measurement[]) => list.map(({ms}) => ms.toFixed(0)).join(' / ');
  t.diagnostic(
    `${n} copies: ${times(single)} ms (${single[0].elements} elements, ${single[0].passes} passes); ` +
      `${2 * n} copies: ${times(double)} ms (${double[0].elements} elements); ratio of the minimums ${ratio.toFixed(2)}`
  );
  assert.equal(single[0].passes, double[0].passes, 'both pages need the same number of passes');
  assert.equal(double[0].elements - fixedElements, 2 * (single[0].elements - fixedElements), 'twice the elements');
  assert.ok(ratio < MAX_RATIO, `2N / N render time ${ratio.toFixed(2)} >= ${MAX_RATIO} (super-linear growth)`);
}

test('rendering 2N copies of a mid-size Spectrum fragment takes less than 2.6x the time of N copies', async (t) => {
  // (+1 element: the sp-theme.)
  await checkScaling(t, spectrumPage, 8, 1);
});

test('rendering 2N copies of a fragment with light-DOM attribute changes takes less than 2.6x the time', async (t) => {
  await checkScaling(t, markerPage, 150, 0);
});
