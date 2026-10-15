/**
 * Which custom element classes are Spectrum Web Components (the classes swc-ssr drives through its server lifecycle
 * by default, see `RenderSpectrumOptions.isManagedClass`).
 *
 * `base/src/Base.js` (1.12.x): every Lit-based Spectrum element extends `SpectrumElement = SpectrumMixin(LitElement)`
 * or applies `SpectrumMixin` itself. The mixin class defines an `isLTR` getter and a `hasVisibleFocusInTree()`
 * method on its prototype. The base module cannot be imported here (it writes `window.__swc` at import time, before
 * the DOM shim is installed), so the prototype chain is inspected instead. Of the 135 elements the demo catalog
 * defines, only `sp-theme` (a plain HTMLElement with its own renderer) and `sp-tooltip-openable` (a plain
 * HTMLElement in `tooltip/src/Tooltip.js`) are not Spectrum classes by this test.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const cache = new WeakMap<object, boolean>();

export function isSpectrumClass(ctor: unknown): boolean {
  if (typeof ctor !== 'function') {
    return false;
  }
  const cached = cache.get(ctor);
  if (cached !== undefined) {
    return cached;
  }
  let result = false;
  if ((ctor as any)._$litElement$) {
    for (let proto = ctor.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      const isLTR = Object.getOwnPropertyDescriptor(proto, 'isLTR');
      const focus = Object.getOwnPropertyDescriptor(proto, 'hasVisibleFocusInTree');
      if (typeof isLTR?.get === 'function' && typeof focus?.value === 'function') {
        result = true;
        break;
      }
    }
  }
  cache.set(ctor, result);
  return result;
}
