/**
 * Pinning `MatchMediaController.matches` (`reactive-controllers/src/MatchMedia.js`) for the hydrating update.
 *
 * The server's `matchMedia()` never matches (spectrum-web-components-ssr/dom-shim `mediaQueryList`), so the server renders every
 * component in its "no media query matches" state: e.g. `sp-picker` / `sp-action-menu` with `IS_MOBILE` false, i.e.
 * an `sp-popover` overlay container instead of `sp-tray` (rendered right away when the overlay is rendered, e.g. for
 * the deprecated `<sp-menu>` child) and no `mobile-view` on the menu; `sp-contextual-help` with `type="auto"`, a
 * placement and no `aria-haspopup`. On a phone the controller matches from its construction on, so the first client
 * render differs: structurally (`sp-tray`, `hydrate()` throws and the element is re-rendered from scratch - flicker)
 * or in attributes, which `hydrate()` never writes (it only primes the committed value), so the server's attribute
 * would stay in place until the value changes again.
 *
 * The client adapters (`hooks.ts`) pin `matches` to the server's value while the element hydrates and restore it
 * afterwards with `requestUpdate()`, so the hydrating render matches the server markup and the next update renders
 * (and commits) the mobile state - what a client-rendered component shows.
 *
 * No DOM or lit imports: unit-tested in packages/spectrum-web-components-ssr/test/client-match-media.test.ts.
 */

/** The value the server's `matchMedia()` reports for every query. */
export const SERVER_MEDIA_MATCHES = false;

export interface MatchMediaControllerLike {
  host: unknown;
  matches: boolean;
  media?: {matches: boolean} | null;
  key?: PropertyKey;
}

/** `MatchMediaController` instances of `element`, found by shape among its own properties (`isMobile`, `isTouchDevice`, ...). */
export function findMatchMediaControllers(element: object): MatchMediaControllerLike[] {
  const found: MatchMediaControllerLike[] = [];
  for (const key of Object.keys(element)) {
    let value: unknown;
    try {
      value = (element as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    const candidate = value as Partial<MatchMediaControllerLike>;
    if (
      candidate.host === element &&
      typeof candidate.matches === 'boolean' &&
      candidate.media != null &&
      typeof candidate.media.matches === 'boolean'
    ) {
      found.push(candidate as MatchMediaControllerLike);
    }
  }
  return found;
}

interface Pin {
  /** The data property's value when the pin was installed, then whatever the controller wrote since. */
  latest: boolean;
}

const pins = new WeakMap<object, Pin>();

/** Whether `controller.matches` is currently pinned by `pinMatches()`. */
export const isPinned = (controller: object): boolean => pins.has(controller);

/**
 * Makes `controller.matches` read `value` (an own accessor). Writes - `onChange()` when the media query flips during
 * hydration - are remembered, not applied. Idempotent.
 */
export function pinMatches(controller: MatchMediaControllerLike, value: boolean = SERVER_MEDIA_MATCHES): void {
  if (pins.has(controller)) return;
  const pin: Pin = {latest: Boolean(controller.matches)};
  pins.set(controller, pin);
  Object.defineProperty(controller, 'matches', {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (next: boolean) => {
      pin.latest = Boolean(next);
    },
  });
}

/**
 * Removes the pin: `matches` becomes a plain data property again, with the media query's current state (or the last
 * value the controller wrote). Returns whether the element rendered with a different value than that, i.e. needs an
 * update; `false` when the controller was not pinned.
 */
export function unpinMatches(controller: MatchMediaControllerLike, pinnedValue: boolean = SERVER_MEDIA_MATCHES): boolean {
  const pin = pins.get(controller);
  if (!pin) return false;
  pins.delete(controller);
  const media = controller.media;
  const current = media != null && typeof media.matches === 'boolean' ? media.matches : pin.latest;
  Object.defineProperty(controller, 'matches', {configurable: true, enumerable: true, writable: true, value: current});
  return current !== pinnedValue;
}

/**
 * Pins every `MatchMediaController` of `element` to the server's value (the `beforeHydrate` step of the adapters).
 * Returns the number of controllers found (0: the element has none, nothing was changed).
 */
export function pinElementMedia(element: object): number {
  const controllers = findMatchMediaControllers(element);
  for (const controller of controllers) pinMatches(controller);
  return controllers.length;
}

/**
 * Restores every pinned controller of `element` and requests an update for each one whose state differs from what
 * the server rendered (the `afterHydrate` step), the way `MatchMediaController.onChange()` does:
 * `host.requestUpdate(key, oldValue)`. Returns the number of updates requested.
 */
export function restoreElementMedia(element: {requestUpdate?: (name?: PropertyKey, oldValue?: unknown) => void}): number {
  let requested = 0;
  for (const controller of findMatchMediaControllers(element)) {
    if (unpinMatches(controller)) {
      element.requestUpdate?.(controller.key, SERVER_MEDIA_MATCHES);
      requested++;
    }
  }
  return requested;
}
