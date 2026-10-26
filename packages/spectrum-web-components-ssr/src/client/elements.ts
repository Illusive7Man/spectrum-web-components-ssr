/**
 * Which elements the client side of swc-ssr takes care of. Pure predicates over minimal DOM-like shapes (no DOM, no
 * lit imports), shared by `index.ts` (`hydrateSpectrum()`: collection, definition waits, report) and `hooks.ts` (the
 * hydration hooks), and unit-tested without a browser (packages/spectrum-web-components-ssr/test/client-elements.test.ts).
 */

export const DEFER_ATTRIBUTE = 'defer-hydration';

/**
 * Names that contain a hyphen but are reserved by the HTML spec ("valid custom element name"): SVG / MathML
 * elements, never custom elements.
 */
const RESERVED_NAMES = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

/**
 * True for a valid custom element name (as far as `localName` tells): starts with a lowercase ASCII letter, contains a
 * hyphen, is not reserved. Only such names can be passed to `customElements.whenDefined()` (it rejects others).
 */
export function isCustomElementName(localName: string): boolean {
  return /^[a-z][^\s/>A-Z]*-[^\s/>A-Z]*$/.test(localName) && !RESERVED_NAMES.has(localName);
}

/** Spectrum Web Components tag (`sp-*`). Spectrum also has elements without the prefix, e.g. `<overlay-trigger>`. */
export const isSpectrumTag = (localName: string): boolean => localName.startsWith('sp-');

export interface ElementLike {
  localName: string;
  hasAttribute(name: string): boolean;
  readonly shadowRoot: unknown;
}

/**
 * The elements `hydrateSpectrum()` collects, waits for, enables and reports on ("candidates"):
 *  - every element that carries `defer-hydration` (whatever its name: @lit-labs/ssr sets it on every custom element
 *    it rendered when `deferHydration` is on, and on every one nested in a shadow root);
 *  - custom elements (a hyphen in the tag name) that have a shadow root (server-rendered declarative shadow root, or
 *    rendered on the client), are already defined, or are Spectrum elements (`sp-*`).
 * Not candidates: plain elements, and custom-element-named tags that are neither defined nor server-rendered - for
 * example the component hosts of a framework that does not register them with `customElements` (Angular's
 * `<app-root>`): their definition never arrives, so waiting for it would only run into the timeout.
 * `isDefined` is `(name) => customElements.get(name) !== undefined` in the browser.
 */
export function isHydrationCandidate(element: ElementLike, isDefined: (localName: string) => boolean): boolean {
  if (element.hasAttribute(DEFER_ATTRIBUTE)) {
    return true;
  }
  const name = element.localName;
  if (!isCustomElementName(name)) {
    return false;
  }
  return isSpectrumTag(name) || element.shadowRoot != null || isDefined(name);
}

/** Tags among `elements` whose definitions `hydrateSpectrum()` waits for: candidate custom elements, de-duplicated. */
export function tagsToDefine(elements: Iterable<ElementLike>, isDefined: (localName: string) => boolean): string[] {
  const tags = new Set<string>();
  for (const element of elements) {
    if (isCustomElementName(element.localName) && isHydrationCandidate(element, isDefined)) {
      tags.add(element.localName);
    }
  }
  return [...tags];
}

interface NodeLike {
  nodeType: number;
  data?: string;
}

const COMMENT_NODE = 8;

/**
 * True when a (declarative) shadow root was rendered by @lit-labs/ssr: it contains the `<!--lit-part ...-->` marker
 * of the element's render result as a direct child (after the `<style>` elements). Shadow roots without it - created
 * by other server renderers or written by hand - are left to lit's own hydration support.
 */
export function hasServerMarkers(root: {childNodes: ArrayLike<NodeLike>}): boolean {
  const nodes = root.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === COMMENT_NODE && typeof node.data === 'string' && node.data.startsWith('lit-part')) {
      return true;
    }
  }
  return false;
}
