/**
 * Keeps the declarative shadow root of `<sp-theme>` through its upgrade.
 *
 * Spectrum's `Theme` is a plain `HTMLElement` whose constructor calls `attachShadow({mode: 'open'})` and then appends
 * its own `<slot>`. Called on an element that already has a declarative shadow root, `attachShadow()` returns that root
 * EMPTIED (HTML spec): the server's `<slot>` is gone and a new one comes a statement later. In between, the theme's
 * light DOM - the whole page - is assigned to no slot, and every CSS animation running inside it is cancelled and
 * started again: an indeterminate `sp-progress-circle`, the rings of `sp-coach-indicator`, all with the same new start
 * time, one frame after `sp-theme` was defined (measured). Putting the same children back synchronously does not
 * help: the clearing itself does it (measured as well).
 *
 * So `Element.prototype.attachShadow` is wrapped, before `sp-theme` is defined: for an `<sp-theme>` that already has an
 * open shadow root, the existing root is returned untouched, and the `<slot>` the constructor appends next is dropped
 * because the root has one (the server's, first in tree order, stays the default slot). Nothing is unslotted and the
 * animations keep their clocks. The theme adopts its sheets as before (`Theme.adoptStyles()`, a microtask later); once
 * it did, the server's complete theme `<style>` / `<link>` is removed - which is what the clearing used to do - while
 * a trimmed or minified one is left to the bridges of server-styles.ts. Every other call goes to the native method: Lit
 * elements never call it for a declarative root (Lit's hydration support reuses the root), and other libraries may
 * rely on getting an empty one.
 */
import {releaseAdoptedThemeStyles} from './server-styles.js';

/** Tags whose declarative shadow root survives their constructor's `attachShadow()`. */
const KEPT_TAGS: ReadonlySet<string> = new Set(['sp-theme']);

let installed = false;

/**
 * Wraps `Element.prototype.attachShadow` (once per page). Must run before `sp-theme` is defined; a no-op outside a DOM.
 */
export function keepThemeShadowRoots(): void {
  if (installed || typeof Element === 'undefined') {
    return;
  }
  installed = true;
  const native = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
    const existing = this.shadowRoot;
    if (!existing || init?.mode !== 'open' || !KEPT_TAGS.has(this.localName)) {
      return native.call(this, init);
    }
    dropNextDuplicateSlot(existing);
    releaseThemeStylesOnceAdopted(this, existing);
    return existing;
  };
}

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isDefaultSlot = (node: Node): boolean => isElement(node) && node.localName === 'slot' && !node.hasAttribute('name');
const hasDefaultSlot = (root: ShadowRoot): boolean => Array.from(root.children).some(isDefaultSlot);

/** A default `<slot>`, or a fragment holding nothing but default `<slot>`s (Spectrum's `Theme.template` is `<slot></slot>`). */
function onlyDefaultSlots(node: Node): boolean {
  if (node.nodeType === 11) {
    const children = Array.from(node.childNodes).filter((child) => child.nodeType !== 3 || child.textContent?.trim());
    return children.length > 0 && children.every(isDefaultSlot);
  }
  return isDefaultSlot(node);
}

/**
 * The constructor's `this.shadowRoot.appendChild(<slot>)` comes right after `attachShadow()`: a one-shot own
 * `appendChild` on the root swallows a default slot when the root has one, and anything else goes through. The
 * override removes itself with the first call, and at the microtask checkpoint at the latest (the constructor is
 * synchronous), so nothing later is intercepted.
 */
function dropNextDuplicateSlot(root: ShadowRoot): void {
  const inherited = root.appendChild;
  const restore = (): void => {
    if (root.appendChild === oneShot) {
      delete (root as {appendChild?: unknown}).appendChild;
    }
  };
  const oneShot = function <T extends Node>(this: ShadowRoot, node: T): T {
    restore();
    if (hasDefaultSlot(root) && onlyDefaultSlots(node)) {
      return node; // the server's slot keeps the children; the new, empty one is not inserted
    }
    return inherited.call(this, node) as T;
  };
  Object.defineProperty(root, 'appendChild', {configurable: true, writable: true, value: oneShot});
  queueMicrotask(restore);
}

/**
 * Releases the server's theme CSS once the theme adopted its own sheets (`releaseAdoptedThemeStyles` of
 * server-styles.ts decides what goes: everything, except a trimmed / minified bridge that elements still depend on).
 * `Theme.updateComplete` is assigned at the end of the constructor and resolves right after `adoptStyles()`, in the
 * same task as the upgrade, so nothing paints with both or with neither. A theme that adopted nothing (no fragment
 * registered) keeps the server CSS: it is all it has.
 */
function releaseThemeStylesOnceAdopted(host: Element, root: ShadowRoot): void {
  queueMicrotask(() => {
    const pending = (host as {updateComplete?: unknown}).updateComplete;
    void Promise.resolve(pending).then(
      () => {
        if (!('adoptedStyleSheets' in root) || root.adoptedStyleSheets.length === 0) {
          return;
        }
        releaseAdoptedThemeStyles(host, root);
      },
      () => undefined,
    );
  });
}
