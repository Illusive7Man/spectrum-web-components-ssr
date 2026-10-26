/**
 * DOM shim, M8: `crypto.getRandomValues` gives deterministic bytes during a render only for requests shaped like
 * Spectrum's `randomID()` (`shared/src/random-id.js`: `new Uint8Array(4)`); nonces, tokens and keys generated during
 * SSR come from the real CSPRNG. `configureRandomSource({deterministicIds: false})` turns the deterministic ids off.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumDomShim, setRandomSource} from '../src/dom-shim/index.ts';
import {configureRandomSource, isRandomIdRequest} from '../src/dom-shim/install.ts';

installSpectrumDomShim();

const {randomID} = await import('@spectrum-web-components/shared/src/random-id.js');

/** A render's deterministic source in miniature: every byte is 0xAB. */
const constantSource = (array: Uint8Array): void => {
  array.fill(0xab);
};

/** Runs `fn` with `source` active, as the server renderer does around the synchronous parts of a render. */
function withSource<T>(source: (array: Uint8Array) => void, fn: () => T): T {
  const previous = setRandomSource(source);
  try {
    return fn();
  } finally {
    setRandomSource(previous);
  }
}

const allBytes = (array: ArrayBufferView, value: number): boolean =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).every((byte) => byte === value);

test('randomID()-shaped requests get the render source', () => {
  assert.equal(isRandomIdRequest(new Uint8Array(4)), true);
  for (const other of [new Uint8Array(3), new Uint8Array(5), new Uint8Array(16), new Uint32Array(1), new Int8Array(4),
    Buffer.alloc(4), new DataView(new ArrayBuffer(4))]) {
    assert.equal(isRandomIdRequest(other), false, `${other.constructor.name}(${other.byteLength})`);
  }
  const id = withSource(constantSource, () => randomID());
  assert.equal(id, 'abababab', "Spectrum's randomID() is deterministic during a render");
  const bytes = withSource(constantSource, () => crypto.getRandomValues(new Uint8Array(4)));
  assert.ok(allBytes(bytes, 0xab));
});

test('everything else uses the real CSPRNG, also during a render', () => {
  withSource(constantSource, () => {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const token = crypto.getRandomValues(new Uint8Array(32));
    const words = crypto.getRandomValues(new Uint32Array(4));
    const signed = crypto.getRandomValues(new Int8Array(4));
    const buffer = crypto.getRandomValues(Buffer.alloc(4));
    // With the old wrapper every one of these was filled from the seeded source (all 0xAB here).
    for (const [name, array] of Object.entries({nonce, token, words, signed, buffer})) {
      assert.equal(allBytes(array, 0xab), false, `${name} must not come from the render's source`);
    }
    assert.notEqual(crypto.randomUUID(), crypto.randomUUID());
    // The real implementation's validation still applies.
    assert.throws(() => crypto.getRandomValues(new Float32Array(4) as unknown as Uint8Array), /integer-type/);
    assert.throws(() => crypto.getRandomValues(new Uint8Array(65537)), /quota|65536/i);
  });
});

test('outside a render randomID() is random', () => {
  const ids = new Set(Array.from({length: 20}, () => randomID()));
  assert.ok(ids.size > 1);
  assert.ok([...ids].every((id) => /^[0-9a-f]{8}$/.test(id)));
});

test('configureRandomSource({deterministicIds: false}) sends randomID() to the CSPRNG during renders', () => {
  const previous = configureRandomSource({deterministicIds: false});
  try {
    assert.equal(previous.deterministicIds, true, 'on by default');
    const ids = withSource(constantSource, () => Array.from({length: 20}, () => randomID()));
    assert.ok(ids.some((id) => id !== 'abababab'));
    assert.ok(new Set(ids).size > 1);
  } finally {
    configureRandomSource(previous);
  }
  assert.equal(withSource(constantSource, () => randomID()), 'abababab', 'back on');
});
