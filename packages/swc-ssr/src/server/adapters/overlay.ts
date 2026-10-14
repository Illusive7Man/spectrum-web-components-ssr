/**
 * `<sp-overlay>` (`overlay/src/Overlay.js`) must stay closed on the server.
 *
 * Opening an overlay has process-wide side effects: the `open` setter increments the static
 * `Overlay.openCount` (rendered into `--swc-overlay-open-count`, so output would drift between renders) and
 * `manageOpen()` adds the instance to the module-level `overlayStack` (leaking it across renders) and registers
 * document listeners. That happens even with lifecycle `none` (it runs from `willUpdate`), so the instance gets a
 * plain reactive `open` property and a no-op `manageOpen()`: the `open` attribute is still reflected (the client
 * opens the overlay after hydration), the server renders the closed state.
 *
 * Lifecycle `connected`: `firstUpdated()` / `updated()` only position the overlay (PlacementController), which
 * is meaningless without layout.
 */
import type {ElementAdapter} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function keepClosed(element: HTMLElement): void {
  const overlay = element as any;
  let open = false;
  Object.defineProperty(overlay, 'open', {
    get: () => open,
    set: (value: unknown) => {
      const previous = open;
      open = !!value;
      if (previous !== open && typeof overlay.requestUpdate === 'function') {
        overlay.requestUpdate('open', previous);
      }
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(overlay, 'manageOpen', {value: async () => {}, configurable: true, writable: true});
}

export const overlayAdapter: ElementAdapter = {
  tag: 'sp-overlay',
  lifecycle: 'connected',
  prepare: keepClosed,
};
