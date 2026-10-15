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

/**
 * The `open` state of kept-closed overlays. The accessor below is shared by all of them: V8 stores an accessor's
 * functions in the hidden class the property transition creates, which outlives the instance, so a per-instance
 * closure (over the overlay) would pin the first overlay of the process - and its whole render - forever.
 */
const openState = new WeakMap<object, boolean>();
const OPEN_PROPERTY: PropertyDescriptor = {
  get(this: object) {
    return openState.get(this) ?? false;
  },
  set(this: any, value: unknown) {
    const previous = openState.get(this) ?? false;
    const open = !!value;
    openState.set(this, open);
    if (previous !== open && typeof this.requestUpdate === 'function') {
      this.requestUpdate('open', previous);
    }
  },
  configurable: true,
  enumerable: true,
};
const manageOpen = async () => {};

export function keepClosed(element: HTMLElement): void {
  openState.set(element, false);
  Object.defineProperty(element, 'open', OPEN_PROPERTY);
  Object.defineProperty(element, 'manageOpen', {value: manageOpen, configurable: true, writable: true});
}

export const overlayAdapter: ElementAdapter = {
  tag: 'sp-overlay',
  lifecycle: 'connected',
  prepare: keepClosed,
};
