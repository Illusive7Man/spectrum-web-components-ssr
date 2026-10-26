/**
 * spectrum-web-components-ssr/client, M9: `MatchMediaController.matches` is pinned to the server's value for the hydrating update and
 * restored afterwards with `requestUpdate()`. Uses Spectrum's real controller
 * (`reactive-controllers/src/MatchMedia.js`) with a fake host and a phone-like `window.matchMedia`.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_MEDIA_MATCHES,
  findMatchMediaControllers,
  isPinned,
  pinElementMedia,
  pinMatches,
  restoreElementMedia,
  unpinMatches,
} from '../src/client/match-media.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A phone: every media query matches (this test process never installs the server DOM shim).
const g = globalThis as any;
const listeners = new Set<(event: {matches: boolean}) => void>();
g.window = {
  matchMedia: (media: string) => ({
    matches: true,
    media,
    addEventListener: (_type: string, listener: (event: {matches: boolean}) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: {matches: boolean}) => void) => listeners.delete(listener),
  }),
};

const {MatchMediaController, IS_MOBILE, IS_TOUCH_DEVICE} = await import(
  '@spectrum-web-components/reactive-controllers/src/MatchMedia.js'
);

class FakeHost {
  updates: Array<[PropertyKey | undefined, unknown]> = [];
  isMobile: any;
  isTouchDevice: any;
  label = 'not a controller';
  other = {matches: true, media: {matches: true}, host: {}}; // a controller of another host
  constructor() {
    this.isMobile = new MatchMediaController(this as any, IS_MOBILE);
    this.isTouchDevice = new MatchMediaController(this as any, IS_TOUCH_DEVICE);
  }
  addController(): void {}
  requestUpdate(name?: PropertyKey, oldValue?: unknown): void {
    this.updates.push([name, oldValue]);
  }
}

test('the server value is "no media query matches"', () => {
  assert.equal(SERVER_MEDIA_MATCHES, false);
});

test('finds the MatchMediaController instances of an element by shape', () => {
  const host = new FakeHost();
  const found = findMatchMediaControllers(host);
  assert.deepEqual(found, [host.isMobile, host.isTouchDevice]);
});

test('pinned for the hydrating update, restored afterwards with requestUpdate(key, serverValue)', () => {
  const host = new FakeHost();
  assert.equal(host.isMobile.matches, true, 'the phone matches IS_MOBILE');

  pinElementMedia(host);
  assert.equal(host.isMobile.matches, false, 'the hydrating render sees the server value');
  assert.equal(host.isTouchDevice.matches, false);
  assert.equal(isPinned(host.isMobile), true);
  pinElementMedia(host); // idempotent
  assert.equal(host.isMobile.matches, false);

  const requested = restoreElementMedia(host);
  assert.equal(requested, 2);
  assert.equal(host.isMobile.matches, true, 'restored to the media query state');
  assert.equal(host.isTouchDevice.matches, true);
  assert.equal(isPinned(host.isMobile), false);
  assert.equal(Object.getOwnPropertyDescriptor(host.isMobile, 'matches')?.writable, true, 'a plain data property again');
  assert.deepEqual(host.updates, [
    [host.isMobile.key, false],
    [host.isTouchDevice.key, false],
  ]);
  // The controller keeps working: a later change event updates the host as before.
  host.updates.length = 0;
  host.isMobile.hostConnected();
  for (const listener of listeners) listener({matches: false});
  assert.equal(host.isMobile.matches, false);
  assert.ok(host.updates.some(([key]) => key === host.isMobile.key));
});

test('a change event during hydration is remembered, not applied; nothing to update when the state equals the server value', () => {
  const controller = {host: {}, matches: true, media: null as {matches: boolean} | null, key: Symbol('k')};
  pinMatches(controller);
  controller.matches = false; // what MatchMediaController.onChange() does when the query flips
  assert.equal(controller.matches, false);
  controller.matches = true;
  assert.equal(controller.matches, false, 'still pinned');
  controller.matches = false;
  // No media object: the last written value wins; it equals the server value, so no update is needed.
  assert.equal(unpinMatches(controller), false);
  assert.equal(controller.matches, false);
  assert.equal(unpinMatches(controller), false, 'not pinned any more');
});

test('desktop: restoring requests no update', () => {
  const host = {
    requestUpdate() {
      throw new Error('must not be called');
    },
  } as any;
  host.isMobile = {host, matches: false, media: {matches: false}, key: Symbol('isMobile')};
  pinElementMedia(host);
  assert.equal(restoreElementMedia(host), 0);
  assert.equal(host.isMobile.matches, false);
});
