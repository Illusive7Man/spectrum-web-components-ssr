/**
 * Review M8 (per-render switch): `RenderSpectrumOptions.deterministicIds` (default true). Spectrum's `randomID()`
 * (`shared/src/random-id.js`; here `field-label/src/FieldLabel.js` willUpdate(), which sets
 * `id="sp-field-label-<8 hex digits>"`) is deterministic per render by default; `deterministicIds: false` gives this
 * render CSPRNG ids without touching the process-wide setting (`configureRandomSource`).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {configureRandomSource} from '../src/dom-shim/index.ts';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/field-label/sp-field-label.js');

const page = () => html`<sp-field-label for="name">Name</sp-field-label><input id="name" />`;

function labelId(output: string): string {
  const match = /<sp-field-label[^>]*\sid="(sp-field-label-[0-9a-f]{8})"/.exec(output);
  assert.ok(match, `no generated id in ${output.slice(0, 400)}`);
  return match[1];
}

test('ids generated with randomID() are the same in every render by default', async () => {
  const first = labelId((await renderSpectrum(page())).html);
  const second = labelId((await renderSpectrum(page(), {deterministicIds: true})).html);
  assert.equal(first, second);
});

test('deterministicIds: false gives this render CSPRNG ids, other renders keep the deterministic ones', async () => {
  const deterministic = labelId((await renderSpectrum(page())).html);
  const random = new Set<string>();
  for (let i = 0; i < 4; i++) {
    random.add(labelId((await renderSpectrum(page(), {deterministicIds: false})).html));
  }
  // Four independent 32-bit ids: a collision (or hitting the deterministic id) is practically impossible.
  assert.equal(random.size, 4, [...random].join(', '));
  assert.ok(!random.has(deterministic));
  assert.equal(configureRandomSource({}).deterministicIds, true, 'the process-wide setting is untouched');
  assert.equal(labelId((await renderSpectrum(page())).html), deterministic, 'the next default render is deterministic again');
});
