/**
 * DOM shim globals (L7, M9):
 *  - `window` is `globalThis`, process-wide and permanent (documented in `src/dom-shim/install.ts`): it cannot be
 *    scoped to imports + renders because Spectrum reads it outside both (see .probe/window-scope.ts). This test pins
 *    the documented contract so a change to it is deliberate.
 *  - the server's `matchMedia()` never matches, which is the value the client adapters pin MatchMediaControllers to
 *    while hydrating (`src/client/match-media.ts` `SERVER_MEDIA_MATCHES`): the two must agree.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumDomShim} from '../src/dom-shim/index.ts';
import {SERVER_MEDIA_MATCHES} from '../src/client/match-media.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
// @lit-labs/ssr's own global shim (imported by swc-ssr/dom-shim) defines `window: undefined`.
const windowBefore = g.window;

installSpectrumDomShim();

test('window is globalThis, process-wide and permanent (plain data property)', () => {
  assert.equal(windowBefore, undefined, 'neither Node nor the @lit-labs/ssr shim defines a window object');
  assert.equal(g.window, globalThis);
  assert.equal(typeof g.window, 'object');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  assert.ok(descriptor && 'value' in descriptor, 'a data property, not a getter that changes with the render state');
  // The global event API exists (no-ops) and so does the rAF sink (callbacks are dropped outside renders).
  assert.equal(typeof g.addEventListener, 'function');
  assert.equal(typeof g.requestAnimationFrame, 'function');
  assert.equal(g.dispatchEvent(new Event('x')), true);
});

test("the server's matchMedia() never matches, the value the client pins MatchMediaControllers to", () => {
  const queries = [
    '(max-width: 743px) and (hover: none) and (pointer: coarse)', // IS_MOBILE
    '(hover: none) and (pointer: coarse)', // IS_TOUCH_DEVICE
    '(prefers-color-scheme: dark)', // DARK_MODE
    '(prefers-reduced-motion: no-preference)', // sp-tray
    'all',
  ];
  for (const query of queries) {
    const list = g.matchMedia(query);
    assert.equal(list.matches, SERVER_MEDIA_MATCHES, query);
    assert.equal(list.media, query);
    assert.equal(typeof list.addEventListener, 'function');
  }
});
