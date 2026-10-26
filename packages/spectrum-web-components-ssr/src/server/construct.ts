/**
 * Constructing custom element instances on the server, and handing a pre-built instance to a renderer whose base
 * class insists on constructing the element itself (`LitElementRenderer`'s constructor does
 * `new (customElements.get(tagName))()`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Theme-like classes (`theme/src/Theme.js`): plain HTMLElements that manage theme fragments statically. */
export function isThemeClass(ctor: unknown): boolean {
  return (
    typeof ctor === 'function' &&
    typeof (ctor as any).registerThemeFragment === 'function' &&
    (ctor as any).themeFragmentsByKind instanceof Map
  );
}

/**
 * `theme/src/Theme.js` adopts its fragment styles through `adoptedStyleSheets` from a microtask scheduled in its
 * constructor (`shouldAdoptStyles()`), and registers every connected instance in the static `Theme.instances` set.
 * On the server the styles are emitted as `<style>` by the ThemeRenderer instead, so both are disabled per
 * instance (and `connectedCallback` is never called for themes, see `adapters/theme.ts`).
 */
export function neutralizeTheme(element: any): void {
  const noop = () => {};
  const asyncNoop = async () => {};
  Object.defineProperty(element, 'adoptStyles', {value: noop, configurable: true, writable: true});
  Object.defineProperty(element, 'shouldAdoptStyles', {value: asyncNoop, configurable: true, writable: true});
}

export function constructElement(ctor: new () => HTMLElement): HTMLElement {
  const element = new ctor();
  if (isThemeClass(ctor)) {
    neutralizeTheme(element);
  }
  return element;
}

/**
 * Makes `customElements.get(tagName)` return a factory that yields `instance` until the returned function is
 * called. Used around a renderer's `super()` call so the base renderer adopts our (pre-built) instance instead
 * of constructing a new one.
 */
export function overrideRegistryGet(tagName: string, instance: object): () => void {
  const registry = (globalThis as any).customElements;
  const hadOwn = Object.prototype.hasOwnProperty.call(registry, 'get');
  const previous = registry.get;
  const factory = function PrebuiltElement() {
    return instance;
  };
  Object.defineProperty(registry, 'get', {
    value: (name: string) => (name === tagName ? factory : previous.call(registry, name)),
    configurable: true,
    writable: true,
  });
  return () => {
    if (hadOwn) {
      Object.defineProperty(registry, 'get', {value: previous, configurable: true, writable: true});
    } else {
      delete registry.get;
    }
  };
}
