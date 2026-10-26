/**
 * Review finding (low): `@lit-labs/ssr` 4.1.0 pushes every custom element onto `customElementHostStack` before its
 * `renderShadow()` and pops it only when a shadow was emitted. Upstream's `FallbackRenderer` (non-Lit custom
 * elements, e.g. `sp-tooltip-openable` in `sp-tooltip`'s shadow root) emits none, so its element stayed on the stack:
 * every element rendered after it counted as nested in that host - keyed in its scope, `__host` = the host, an extra
 * `defer-hydration` attribute and a `<!--lit-node-->` marker. swc-ssr renders such elements with its own fallback
 * renderer, which pops the stack.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ElementRenderer} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {getCurrentRenderContext, installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';

installSpectrumSsr();

const {html} = await import('lit');
const {SpectrumElement} = await import('@spectrum-web-components/base');
await import('@spectrum-web-components/tooltip/sp-tooltip.js');
await import('@spectrum-web-components/button/sp-button.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A plain (non-Lit) custom element. */
customElements.define('x-plain-ce', class extends HTMLElement {});

/** A Lit host rendering a plain custom element in its shadow root (like sp-tooltip with sp-tooltip-openable). */
class XPlainHost extends SpectrumElement {
  override render() {
    return html`<x-plain-ce></x-plain-ce><slot></slot>`;
  }
}
customElements.define('x-plain-host', XPlainHost);

/** Records the host-stack depth seen when an element with this tag is constructed (never matches). */
const depths: number[] = [];
class StackSpy extends ElementRenderer {
  static override matchesClass(_ctor: unknown, tagName: string): boolean {
    const context = getCurrentRenderContext() as any;
    if (context && tagName === 'sp-button') {
      depths.push(context.stacks.customElementHostStack.length);
    }
    return false;
  }
}
const spy = [StackSpy as unknown as ElementRendererConstructor];

/** The start tag of the first `<sp-button>` and what precedes it. */
function button(output: string): {tag: string; before: string} {
  const index = output.indexOf('<sp-button');
  return {tag: /<sp-button[^>]*>/.exec(output.slice(index))![0], before: output.slice(Math.max(0, index - 40), index)};
}

for (const [name, template] of [
  ['a plain custom element in a shadow root', () => html`<x-plain-host>light</x-plain-host><sp-button>After</sp-button>`],
  ['sp-tooltip (sp-tooltip-openable)', () => html`<sp-tooltip>Tip</sp-tooltip><sp-button>After</sp-button>`],
] as const) {
  test(`${name} does not leave its host on the host stack`, async () => {
    depths.length = 0;
    const {html: output} = await renderSpectrum(template(), {elementRenderers: spy});
    assert.deepEqual(depths, [0, 0], 'the element after it is at document level in every pass');
    const {tag, before} = button(output);
    assert.ok(!tag.includes('defer-hydration'), `no defer-hydration on a top-level element: ${tag}`);
    assert.ok(!before.includes('lit-node'), `no lit-node marker before it: ${JSON.stringify(before)}`);
  });
}

test('plain custom elements are still rendered with their attributes and without a shadow root', async () => {
  const {html: output} = await renderSpectrum(html`<x-plain-ce data-a="1" title="t"></x-plain-ce>`);
  assert.match(output, /<x-plain-ce\s+data-a="1" title="t"><\/x-plain-ce>/);
});
