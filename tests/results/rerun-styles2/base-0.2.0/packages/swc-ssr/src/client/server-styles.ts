/**
 * The CSS the server put into the declarative shadow roots, as seen by the client.
 *
 * What a browser does with a server-rendered Lit element: `lit-element-hydrate-support` returns the declarative shadow
 * root from `createRenderRoot()` WITHOUT calling `adoptStyles()`, so a hydrated element adopts nothing: the `<style>`
 * the server wrote stays its only stylesheet (`shadowRoot.adoptedStyleSheets` is empty, measured). `<sp-theme>` is the
 * opposite: it is a plain `HTMLElement` whose constructor calls `attachShadow()`, which clears the declarative shadow
 * root (the server's `<style>` is gone), and it then adopts the complete theme fragments itself (`Theme.adoptStyles()`,
 * a microtask later, and again whenever a theme fragment is registered).
 *
 * That is harmless while the server wrote the complete stylesheets (`renderSpectrum({styles: {mode: 'full'}})`), and
 * breaks the page when it wrote trimmed ones (`mode: 'trimmed'`):
 *  1. A trimmed `<style>` has no rules for what the server did not render. After hydration the element changes state
 *     (`selected`, `quiet`, a slotted icon, `sp-tabs-overflow`'s scroll buttons, ...) and has no CSS for it.
 *  2. With `minifyCustomProperties` the components' `<style>` read renamed properties (`var(--a)`), which only the
 *     server's `<sp-theme>` `<style>` defines. When `<sp-theme>` upgrades it drops that `<style>` and adopts the
 *     complete theme (`--spectrum-*`): every component that has not hydrated yet loses all of its theme values, and
 *     the hydrated ones keep reading the renamed names for ever - the page loses its styling.
 *
 * What this module does about it:
 *  - `settleServerStyles()`, in the hydrating update of every element (hooks.ts): when the server `<style>` is partial
 *    the element adopts its class's complete `elementStyles` (one shared `CSSStyleSheet` per `CSSResult`, the
 *    `CSSResult.styleSheet` getter - what `createRenderRoot()` adopts for a client-rendered element) and the server
 *    `<style>` is removed - the same task, so nothing paints in between, and for the state that was rendered the
 *    complete sheets give the same result as the trimmed ones (the trimmed text is the complete one minus rules that
 *    cannot match what was rendered). Partial is: the `<style>` carries the `data-swc-styles` attribute (what the
 *    server writes in trimmed / minified mode), or its text differs from the class's `elementStyles` text (the
 *    fallback when the attribute is missing). On a page whose server CSS was trimmed (any marked `<style>`), the
 *    complete server `<style>`s of hydrated Lit elements are released the same way, so that every hydrated element
 *    runs on its adopted complete sheets; with `removeServerStyles` that also happens on `full` pages.
 *  - `bridgeServerThemes()`, at load: until the last element with a marked `<style>` has been restored, the server's
 *    marked `<sp-theme>` `<style>` is kept alive in the theme's shadow root (re-inserted in the microtask right after
 *    the theme upgraded, before anything paints), so that elements that have not hydrated yet keep their theme values.
 *    It is a `<style>` element and not an adopted sheet on purpose: `Theme.adoptStyles()` re-assigns
 *    `adoptedStyleSheets` whenever a fragment is registered and would drop an adopted bridge. It is removed with the
 *    last marked `<style>` (confirmed by a scan of the document), or at the end of `hydrateSpectrum()` when none is
 *    left.
 *
 * This module must not import `lit` / `lit-element` (see the file comment of hooks.ts): it only reads what the classes
 * and the DOM offer.
 */

/** The attribute the server puts on `<style>` elements whose CSS it trimmed (any value; the server writes the mode). */
export const SERVER_STYLES_ATTRIBUTE = 'data-swc-styles';

/**
 * `HydrateSpectrumOptions.removeServerStyles`: set by `hydrateSpectrum()`, read when an element finishes hydrating.
 * Module state like the adapters: the hooks are installed once per page.
 */
let removeServerStyles = false;

export function setRemoveServerStyles(enabled: boolean): void {
  removeServerStyles = enabled;
}

/**
 * The page's server CSS was trimmed (a `<style data-swc-styles>` was seen): hydrated Lit elements then release their
 * complete server `<style>`s too (they adopt the same sheets), so that every hydrated element runs on adopted sheets.
 */
let trimmedPage = false;

/** Elements whose declarative shadow root was hydrated by the hooks (their first update ran). */
const hydratedElements = new WeakSet<object>();

const supportsAdoptingStyleSheets = (): boolean =>
  typeof ShadowRoot !== 'undefined' &&
  typeof CSSStyleSheet !== 'undefined' &&
  'adoptedStyleSheets' in ShadowRoot.prototype &&
  'replaceSync' in CSSStyleSheet.prototype;

/**
 * The `<style>` elements the server put into a declarative shadow root: the direct `<style>` children that come before
 * the root's first `<!--lit-part-->` marker (the server writes the element's styles first, then its render result; a
 * `<style>` in the render result itself belongs to a template part and stays). `<sp-theme>`'s shadow root has no
 * markers: all of its direct `<style>` children are the server's.
 */
function serverStyleElements(root: ShadowRoot): Element[] {
  const found: Element[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 8 && (node as Comment).data.startsWith('lit-part')) {
      break;
    }
    if (node.nodeType === 1 && (node as Element).localName === 'style') {
      found.push(node as Element);
    }
  }
  return found;
}

const isMarked = (style: Element): boolean => style.hasAttribute(SERVER_STYLES_ATTRIBUTE);

/* -------------------------------------------------------------------------------------------------------------- *
 * The class's own styles
 * -------------------------------------------------------------------------------------------------------------- */

/** An entry of a Lit class's `elementStyles`: a `CSSResult` (`cssText`, `styleSheet`) or a native `CSSStyleSheet`. */
type ElementStyle = CSSStyleSheet | {cssText?: unknown; styleSheet?: CSSStyleSheet | null};

/** `elementStyles` of the element's class (what Lit adopts for a client-rendered element), if it has any. */
function classStyles(element: Element): ElementStyle[] | undefined {
  const styles = (element.constructor as {elementStyles?: unknown}).elementStyles;
  return Array.isArray(styles) && styles.length > 0 ? (styles as ElementStyle[]) : undefined;
}

/** One `CSSStyleSheet` per entry (the shared sheet of the class), or undefined when one has none. */
function classSheets(styles: ElementStyle[]): CSSStyleSheet[] | undefined {
  const sheets: CSSStyleSheet[] = [];
  for (const style of styles) {
    const sheet = style instanceof CSSStyleSheet ? style : style.styleSheet;
    if (!(sheet instanceof CSSStyleSheet)) {
      return undefined;
    }
    sheets.push(sheet);
  }
  return sheets;
}

/** What the server writes for these styles in `full` mode (the `cssText`s in a row), or undefined when not known. */
function classCssText(styles: ElementStyle[]): string | undefined {
  let text = '';
  for (const style of styles) {
    const cssText = style instanceof CSSStyleSheet ? undefined : style.cssText;
    if (typeof cssText !== 'string') {
      return undefined;
    }
    text += cssText;
  }
  return text;
}

/** The server `<style>`s are not the complete stylesheets of the class: marked by the server, or different text. */
function isPartial(serverStyles: Element[], styles: ElementStyle[] | undefined): boolean {
  if (serverStyles.some(isMarked)) {
    return true;
  }
  const expected = styles && classCssText(styles);
  if (expected === undefined) {
    return false;
  }
  let actual = '';
  for (const style of serverStyles) {
    actual += style.textContent ?? '';
  }
  return actual !== expected;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Theme bridge
 * -------------------------------------------------------------------------------------------------------------- */

interface ThemeBridge {
  host: Element;
  /** The server's marked `<style>` elements of the theme's declarative shadow root. */
  styles: Element[];
}

let bridges: ThemeBridge[] = [];
/** Marked server `<style>` elements (other than the themes') still in the document, as far as counted. */
let pendingPartial = 0;

/** Visits every shadow host below `scope` (light DOM and open shadow roots, any depth), in document order. */
function eachShadowRoot(scope: ParentNode, visit: (host: Element, root: ShadowRoot) => void): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const root = (node as Element).shadowRoot;
    if (root) {
      visit(node as Element, root);
      eachShadowRoot(root, visit);
    }
  }
}

const isTheme = (host: Element): boolean => host.localName === 'sp-theme';

/** Marked server `<style>` elements in the document outside `<sp-theme>` shadow roots (a full scan). */
function countPendingMarked(): number {
  let pending = 0;
  eachShadowRoot(document, (host, root) => {
    if (!isTheme(host)) {
      pending += serverStyleElements(root).filter(isMarked).length;
    }
  });
  return pending;
}

function dropBridges(): void {
  const dropped = bridges;
  bridges = [];
  pendingPartial = 0;
  for (const bridge of dropped) {
    for (const style of bridge.styles) {
      style.remove();
    }
  }
}

/**
 * A marked server `<style>` is gone (the element adopted the complete sheets): the bridge goes with the last one.
 * The count is only a hint (content inserted after the load is not in it), so it is confirmed by a scan first.
 */
function markedStylesRemoved(count: number): void {
  if (count === 0 || bridges.length === 0) {
    return;
  }
  pendingPartial -= count;
  if (pendingPartial <= 0) {
    pendingPartial = countPendingMarked();
    if (pendingPartial === 0) {
      dropBridges();
    }
  }
}

/** End of `hydrateSpectrum()`: drops the theme bridges when no marked server `<style>` is left in the document. */
export function settleThemeBridges(): void {
  if (bridges.length > 0 && countPendingMarked() === 0) {
    dropBridges();
  }
}

/**
 * Keeps the server's marked `<sp-theme>` `<style>` alive while elements still depend on it (see the file comment, 2.).
 * Called when `swc-ssr/client` loads - before any element is defined, so before `<sp-theme>` upgrades and clears its
 * declarative shadow root. Themes in the light DOM and in open (declarative) shadow roots are bridged. Does nothing
 * when no theme has a marked `<style>` (`full` mode), or nothing else does.
 */
export function bridgeServerThemes(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const install = (): void => {
    const found: ThemeBridge[] = [];
    let pending = 0;
    eachShadowRoot(document, (host, root) => {
      const marked = serverStyleElements(root).filter(isMarked);
      if (marked.length === 0) {
        return;
      }
      trimmedPage = true;
      if (isTheme(host)) {
        found.push({host, styles: marked});
      } else {
        pending += marked.length;
      }
    });
    if (found.length === 0 || pending === 0 || !supportsAdoptingStyleSheets()) {
      return;
    }
    pendingPartial = pending;
    bridges = found;
    // `<sp-theme>` clears its declarative shadow root when it upgrades (`attachShadow()` in its constructor); our
    // references to the `<style>` elements stay valid. `whenDefined()` resolves in the microtask checkpoint after
    // `customElements.define()`, in the same task as the upgrade, so nothing paints without the bridge (`define()`
    // upgrades the themes inside declarative shadow roots in the same step: shadow-including document order).
    void customElements.whenDefined('sp-theme').then(reinsertBridges);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, {once: true});
  } else {
    install();
  }
}

/** Puts the bridged `<style>`s back into the shadow roots of the themes that dropped them (upgraded themes). */
function reinsertBridges(): void {
  for (const bridge of bridges) {
    const root = bridge.host.shadowRoot;
    if (!root) {
      continue;
    }
    for (const style of bridge.styles) {
      if (style.parentNode !== root) {
        root.append(style);
      }
    }
  }
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Per element
 * -------------------------------------------------------------------------------------------------------------- */

/** Makes the complete sheets of the class the element's `adoptedStyleSheets` (before whatever else is adopted). */
function adoptClassSheets(root: ShadowRoot, sheets: CSSStyleSheet[]): void {
  const current = Array.from(root.adoptedStyleSheets);
  if (!sheets.every((sheet) => current.includes(sheet))) {
    root.adoptedStyleSheets = [...sheets, ...current.filter((sheet) => !sheets.includes(sheet))];
  }
}

/**
 * Replaces the partial server CSS of an element with the complete one, and (trimmed page, or `removeServerStyles`)
 * frees the complete server CSS once it is adopted; returns whether any server `<style>` was removed or replaced.
 *
 *  - Lit element, hydrated by the hooks: adopts its class's `elementStyles` and removes the server `<style>`s when they
 *    are partial, when the page's server CSS was trimmed (`trimmedPage`), or when `removeServerStyles` is set.
 *  - Browser without constructable stylesheets (only reachable through the declarative shadow DOM polyfill): the first
 *    server `<style>` gets the class's complete CSS text, the others go.
 *  - `<sp-theme>` (not a Lit element): when it adopted sheets itself and `removeServerStyles` is set, a server `<style>`
 *    it left is released. A theme that adopted nothing keeps it.
 * Nothing is removed from a root that does not hold the complete CSS afterwards.
 */
function settleServerStyles(element: Element, hydrated: boolean): boolean {
  const root = element.shadowRoot;
  if (!root || bridges.some((bridge) => bridge.host === element)) {
    return false; // a theme whose server <style> is bridged keeps it until the last partial <style> is gone
  }
  const serverStyles = serverStyleElements(root);
  if (serverStyles.length === 0) {
    return false;
  }
  const styles = classStyles(element);
  const marked = serverStyles.filter(isMarked).length;
  if (marked > 0) {
    trimmedPage = true;
  }
  const partial = isPartial(serverStyles, styles);
  // On a trimmed page every hydrated Lit element moves to its adopted complete sheets (also when its own server CSS
  // came out complete); otherwise complete server CSS is only released with `removeServerStyles`.
  if (!partial && !removeServerStyles && !(trimmedPage && styles !== undefined)) {
    return false;
  }
  try {
    if (styles !== undefined) {
      if (!hydrated) {
        return false; // not hydrated (yet): its server CSS is all it has
      }
      if (supportsAdoptingStyleSheets()) {
        const sheets = classSheets(styles);
        if (sheets === undefined) {
          return false;
        }
        adoptClassSheets(root, sheets);
      } else {
        // No constructable stylesheets (declarative shadow DOM polyfill): the server <style> carries the complete CSS.
        const text = classCssText(styles);
        if (text === undefined || !partial) {
          return false;
        }
        serverStyles[0]!.textContent = text;
        serverStyles[0]!.removeAttribute(SERVER_STYLES_ATTRIBUTE);
        serverStyles.slice(1).forEach((style) => style.remove());
        markedStylesRemoved(marked);
        return true;
      }
    } else if (!removeServerStyles || !supportsAdoptingStyleSheets() || root.adoptedStyleSheets.length === 0) {
      return false; // not a Lit element: nothing tells what its adopted sheets hold, so only the opt-in releases
    }
  } catch (error) {
    console.warn(`[swc-ssr] <${element.localName}> could not adopt its styles; its server styles stay:`, error);
    return false;
  }
  for (const style of serverStyles) {
    style.remove();
  }
  markedStylesRemoved(marked);
  return true;
}

/** `hydrateSpectrum({removeServerStyles})` sweep for elements that were hydrated before it ran, and the theme. */
export function releaseServerStyles(element: Element): boolean {
  return settleServerStyles(element, hydratedElements.has(element));
}

/** Called when an element's hydrating update is over (also after a mismatch recovery, which keeps the `<style>`s). */
export function afterHydratingUpdate(element: object): void {
  hydratedElements.add(element);
  settleServerStyles(element as Element, true);
}
