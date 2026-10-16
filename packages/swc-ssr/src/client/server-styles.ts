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
 *    fallback when the attribute is missing; lengths first, the text once per class). On a page whose server CSS was
 *    trimmed (any marked `<style>`), the complete server `<style>`s of hydrated Lit elements are released the same
 *    way, so that every hydrated element runs on its adopted complete sheets; with `removeServerStyles` that also
 *    happens on `full` pages.
 *  - Minified server CSS (`data-swc-styles="minified"`) is special twice (0.2.1):
 *     a. while a bridged `<sp-theme>` has not upgraded (`sp-theme` defined late, or never), the element keeps running
 *        on its minified `<style>`: the theme's server `<style>` defines the renamed names only, so the complete sheets
 *        (original names) would find no theme values. It is restored when `sp-theme` gets defined (`onThemeDefined`).
 *     b. once restored, its minified `<style>` is not removed but kept until no element runs on minified CSS any more:
 *        it may define renamed properties that elements below it (not hydrated, or not defined yet) still read. The
 *        adopted complete sheets come later in the cascade and win wherever both have a rule.
 *  - `bridgeServerThemes()`, at load: until the last element with a marked `<style>` has been restored, the server's
 *    marked `<sp-theme>` `<style>` is kept alive in the theme's shadow root (re-inserted in the microtask right after
 *    the theme upgraded, before anything paints), so that elements that have not hydrated yet keep their theme values.
 *    It is a `<style>` element and not an adopted sheet on purpose: `Theme.adoptStyles()` re-assigns
 *    `adoptedStyleSheets` whenever a fragment is registered and would drop an adopted bridge. It is removed with the
 *    last marked `<style>` (confirmed by a scan of the document), or at the end of `hydrateSpectrum()` when none is
 *    left - but only from themes that have upgraded: the server `<style>` of a theme that has not (its definition
 *    loads late, or never) is all the theme has and stays where the server put it (its upgrade clears it anyway).
 *  - `StyleOptions.dedupe: 'link'` (0.3.0): the server writes `<link rel="stylesheet" data-swc-styles="trimmed|
 *    minified|complete">` in place of (some of) those `<style>`s; such a `<link>` counts as a marked server `<style>`
 *    everywhere here (restored, removed, kept, counted), except that it is never bridged (theme sheets that need the
 *    bridge - minified ones - stay inline) and that `'complete'` is not partial (`pendingTrimmedThemes`).
 *  - `pendingTrimmedThemes()`, at the end of `hydrateSpectrum()` (0.2.2): such a theme defines only what the server
 *    kept (`trimTheme`) under the names it chose (`minifyCustomProperties`), so content created on the client and
 *    states entered later lack theme values until `sp-theme` is defined; `hydrateSpectrum()` reports it as a warning
 *    (`THEME_PENDING_WARNING`). Nothing on the client can supply the complete theme without its definition.
 *
 * This module must not import `lit` / `lit-element` (see the file comment of hooks.ts): it only reads what the classes
 * and the DOM offer.
 */

/** The attribute the server puts on `<style>` elements whose CSS it trimmed (any value; the server writes the mode). */
export const SERVER_STYLES_ATTRIBUTE = 'data-swc-styles';
/** `data-swc-styles` value of a `<style>` whose custom properties were renamed (`minifyCustomProperties`). */
const MINIFIED = 'minified';

/**
 * `HydrateSpectrumOptions.removeServerStyles`: set by `hydrateSpectrum()`, read when an element finishes hydrating.
 * Module state like the adapters: the hooks are installed once per page.
 */
let removeServerStyles = false;

export function setRemoveServerStyles(enabled: boolean): void {
  removeServerStyles = enabled;
}

/**
 * The page's server CSS was trimmed (a `<style data-swc-styles>` was seen, by the scan at load or later): hydrated Lit
 * elements then release their complete server `<style>`s too (they adopt the same sheets), so that every hydrated
 * element runs on adopted sheets.
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
 * `data-swc-styles` value of a server `<link>` (`StyleOptions.dedupe: 'link'`, 0.3.0) to a stylesheet nothing was
 * taken from: marked so that the element is restored and the `<link>` removed like a partial `<style>`, but not
 * partial itself (a theme on it is complete).
 */
const COMPLETE = 'complete';

/**
 * The `<style>` elements the server put into a declarative shadow root: the direct `<style>` children that come before
 * the root's first `<!--lit-part-->` marker (the server writes the element's styles first, then its render result; a
 * `<style>` in the render result itself belongs to a template part and stays), and (0.3.0, `dedupe: 'link'`) the
 * direct `<link data-swc-styles>` children there, which stand for a server `<style>` each. `<sp-theme>`'s shadow root
 * has no markers: all of its direct `<style>` (and marked `<link>`) children are the server's. Indexes the live
 * `childNodes` and stops at the marker (no `Array.from()` copy of every child: this runs for every shadow root at load
 * and for every hydrated element).
 */
function serverStyleElements(root: ShadowRoot): Element[] {
  const found: Element[] = [];
  const nodes = root.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.nodeType === 8 && (node as Comment).data.startsWith('lit-part')) {
      break;
    }
    if (node.nodeType !== 1) {
      continue;
    }
    const name = (node as Element).localName;
    if (name === 'style' || (name === 'link' && (node as Element).hasAttribute(SERVER_STYLES_ATTRIBUTE))) {
      found.push(node as Element);
    }
  }
  return found;
}

const isMarked = (style: Element): boolean => style.hasAttribute(SERVER_STYLES_ATTRIBUTE);
const isMinified = (style: Element): boolean => style.getAttribute(SERVER_STYLES_ATTRIBUTE) === MINIFIED;
/** Marked and not complete: the server left something out of it (trimmed) or renamed it (minified). */
const isPartial = (style: Element): boolean => isMarked(style) && style.getAttribute(SERVER_STYLES_ATTRIBUTE) !== COMPLETE;
const isStyleElement = (element: Element): boolean => element.localName === 'style';

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

/** The `cssText` of a class style, or undefined (a native `CSSStyleSheet`, or no text). */
function cssTextOf(style: ElementStyle): string | undefined {
  const cssText = style instanceof CSSStyleSheet ? undefined : style.cssText;
  return typeof cssText === 'string' ? cssText : undefined;
}

/** What the server writes for these styles in `full` mode (the `cssText`s in a row), or undefined when not known. */
function classCssText(styles: ElementStyle[]): string | undefined {
  let text = '';
  for (const style of styles) {
    const cssText = cssTextOf(style);
    if (cssText === undefined) {
      return undefined;
    }
    text += cssText;
  }
  return text;
}

/** Length of a `<style>`'s text (the sum of its text children), without building the string. */
function textLength(style: Element): number {
  let length = 0;
  for (let node = style.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === 3) {
      length += (node as Text).length;
    }
  }
  return length;
}

/** Per class: the length of the server text that was compared with its `elementStyles` text, and the verdict. */
const classVerdicts = new WeakMap<object, {length: number; differs: boolean}>();

/**
 * Unmarked server `<style>`s whose text is not the class's `elementStyles` text: the fallback for output changed
 * without a marker (e.g. Spectrum CSS that a build step rewrote on one side only, see docs/API.md "Styles"). Cheap:
 * the lengths are compared first (exact when they differ); equal lengths are compared as text once per class, and
 * later instances of the class with the same length reuse that verdict (in `full` mode every instance carries the
 * same text). Before 0.2.1 every hydrated element concatenated and compared its complete CSS.
 */
function differsFromClass(element: Element, serverStyles: Element[], styles: ElementStyle[] | undefined): boolean {
  if (styles === undefined) {
    return false;
  }
  let expectedLength = 0;
  for (const style of styles) {
    const cssText = cssTextOf(style);
    if (cssText === undefined) {
      return false;
    }
    expectedLength += cssText.length;
  }
  let actualLength = 0;
  for (const style of serverStyles) {
    actualLength += textLength(style);
  }
  if (actualLength !== expectedLength) {
    return true;
  }
  const known = classVerdicts.get(element.constructor);
  if (known !== undefined && known.length === actualLength) {
    return known.differs;
  }
  let actual = '';
  for (const style of serverStyles) {
    actual += style.textContent ?? '';
  }
  const differs = actual !== classCssText(styles);
  classVerdicts.set(element.constructor, {length: actualLength, differs});
  return differs;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Theme bridge, kept minified styles
 * -------------------------------------------------------------------------------------------------------------- */

interface ThemeBridge {
  host: Element;
  /** The server's marked `<style>` elements of the theme's declarative shadow root. */
  styles: Element[];
  /** `reinsertBridges()` put them back after the theme upgraded (and cleared its declarative shadow root). */
  reinserted: boolean;
}

let bridges: ThemeBridge[] = [];
/**
 * Minified server `<style>`s of elements that adopted their complete sheets (`keepUntilSettled`): removed with the
 * bridges, once no element runs on minified CSS any more.
 */
let kept: Element[] = [];
/** Elements restored while their minified server `<style>`s are kept: those `<style>`s are not pending. */
const restoredHosts = new WeakSet<Element>();
/** Marked server `<style>` elements (other than the themes' and the kept ones) still in the document, as far as counted. */
let pendingPartial = 0;
/** Minified elements whose restoration waits for `<sp-theme>` (`themePending`); handled when it gets defined. */
let deferredRestorations = 0;

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

/** The element is an instance of the class now defined for its tag (it upgraded). */
function isUpgraded(host: Element): boolean {
  const ctor = typeof customElements === 'undefined' ? undefined : customElements.get(host.localName);
  return ctor !== undefined && host instanceof ctor;
}

/**
 * A bridged `<sp-theme>` of the document has not upgraded (`sp-theme` is defined late, or never): its declarative
 * shadow root still holds the server's `<style>`, which defines the theme under the MINIFIED names only. An element
 * whose server CSS is minified must not move to its complete sheets (original names) yet: nothing would define them.
 */
const themePending = (): boolean => bridges.some((bridge) => bridge.host.isConnected && !isUpgraded(bridge.host));

/** Marked server `<style>` elements in the document outside `<sp-theme>` shadow roots and restored hosts (a full scan). */
function countPendingMarked(): number {
  let pending = 0;
  eachShadowRoot(document, (host, root) => {
    if (!isTheme(host) && !restoredHosts.has(host)) {
      pending += serverStyleElements(root).filter(isMarked).length;
    }
  });
  return pending;
}

/**
 * No element runs on trimmed / minified server CSS any more: the bridged `<style>`s of UPGRADED themes go - those of a
 * theme that has not upgraded stay where the server put them (they are all that theme has; its upgrade clears its
 * declarative shadow root anyway) - and so do the kept minified `<style>`s of restored elements.
 */
function dropBridges(): void {
  const dropped = bridges;
  const keptStyles = kept;
  bridges = [];
  kept = [];
  pendingPartial = 0;
  for (const bridge of dropped) {
    if (bridge.reinserted || isUpgraded(bridge.host)) {
      for (const style of bridge.styles) {
        style.remove();
      }
    }
  }
  for (const style of keptStyles) {
    style.remove();
  }
}

/**
 * Marked server `<style>`s were removed (or kept by a restored element): the bridges and the kept `<style>`s go with the
 * last one. The count is only a hint (content inserted after the load is not in it), so it is confirmed by a scan.
 */
function markedStylesRemoved(count: number): void {
  if (count === 0 || (bridges.length === 0 && kept.length === 0)) {
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

/** End of `hydrateSpectrum()`: drops the bridges and the kept styles when no marked server `<style>` is pending. */
export function settleThemeBridges(): void {
  if ((bridges.length > 0 || kept.length > 0) && countPendingMarked() === 0) {
    dropBridges();
  }
}

/**
 * `HydrationReport.warnings` entry (prefix) when `hydrateSpectrum()` ends while an `<sp-theme>` whose server CSS was
 * trimmed or minified has not upgraded (see `pendingTrimmedThemes`).
 */
export const THEME_PENDING_WARNING = 'theme pending: sp-theme not defined; trimmed/minified theme values incomplete';

/**
 * Number of `<sp-theme>` elements (light DOM and open shadow roots) that have not upgraded - `sp-theme` is defined late,
 * or never - while their declarative shadow root still holds a trimmed or minified server `<style>` (or `<link>`,
 * `dedupe: 'link'`; a `'complete'` one is the whole theme). Such a theme provides only
 * what the server kept: the theme properties the server-rendered markup used (`trimTheme`), under the short names
 * (`minifyCustomProperties`). Content created on the client (an `sp-table`'s checkbox cells, a pending button's
 * progress circle, overlays), states entered later and restored elements reading names the server pruned or renamed
 * find no theme values until `sp-theme` gets defined (its upgrade adopts the complete theme). 0 once `sp-theme` is
 * defined (`define()` upgrades every connected instance), and on pages without trimmed server CSS (no scan then).
 */
export function pendingTrimmedThemes(): number {
  if (!trimmedPage || typeof document === 'undefined' || typeof customElements === 'undefined') {
    return 0;
  }
  if (customElements.get('sp-theme') !== undefined) {
    return 0;
  }
  let pending = 0;
  eachShadowRoot(document, (host, root) => {
    if (isTheme(host) && !isUpgraded(host) && serverStyleElements(root).some(isPartial)) {
      pending++;
    }
  });
  return pending;
}

/**
 * Keeps the server's marked `<sp-theme>` `<style>` alive while elements still depend on it (see the file comment).
 * Called when `swc-ssr/client` loads - before any element is defined, so before `<sp-theme>` upgrades and clears its
 * declarative shadow root. Themes in the light DOM and in open (declarative) shadow roots are bridged. Does nothing
 * when no theme has a marked `<style>` (`full` mode), or nothing else does. The same scan records whether the page has
 * trimmed server CSS at all (`trimmedPage`). The bridge is a plain `<style>`: browsers without constructable
 * stylesheets (the declarative shadow DOM polyfill path) need it as much.
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
        // Only `<style>` elements are bridged. A theme `<link>` (`dedupe: 'link'`) is never minified - the server keeps
        // minified theme sheets inline -, so it defines original names, which the upgraded theme defines completely;
        // re-inserting it would also have the browser process the link again (not synchronously).
        const styles = marked.filter(isStyleElement);
        if (styles.length > 0) {
          found.push({host, styles, reinserted: false});
        }
      } else {
        pending += marked.length;
      }
    });
    pendingPartial = pending;
    if (found.length === 0 || pending === 0 || typeof customElements === 'undefined') {
      return;
    }
    bridges = found;
    // `<sp-theme>` clears its declarative shadow root when it upgrades (`attachShadow()` in its constructor); our
    // references to the `<style>` elements stay valid. `whenDefined()` resolves in the microtask checkpoint after
    // `customElements.define()`, in the same task as the upgrade, so nothing paints without the bridge (`define()`
    // upgrades the themes inside declarative shadow roots in the same step: shadow-including document order).
    void customElements.whenDefined('sp-theme').then(onThemeDefined);
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
    if (!root || !isUpgraded(bridge.host)) {
      continue;
    }
    for (const style of bridge.styles) {
      if (style.parentNode !== root) {
        root.append(style);
      }
    }
    bridge.reinserted = true;
  }
}

/**
 * `sp-theme` got defined (the themes upgraded, in this task): the bridges go back in, and the minified elements that
 * hydrated while the theme was pending get their complete stylesheets now (the upgraded theme adopts its complete
 * fragments, which define the original names). The same task: nothing paints in between.
 */
function onThemeDefined(): void {
  reinsertBridges();
  if (deferredRestorations === 0) {
    return;
  }
  deferredRestorations = 0;
  const waiting: Element[] = [];
  eachShadowRoot(document, (host) => {
    if (hydratedElements.has(host) && !restoredHosts.has(host) && !isTheme(host)) {
      waiting.push(host);
    }
  });
  for (const host of waiting) {
    settleServerStyles(host, true);
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
 * A minified element that adopted its complete sheets keeps its server `<style>`s until no element runs on minified
 * CSS any more (they go with the bridges): they may define renamed custom properties that elements below it, not
 * hydrated (or not defined) yet, still read through their own minified CSS. Harmless for the element itself: its
 * server rules are a subset of the adopted ones, which come later in the cascade and win.
 */
function keepUntilSettled(element: Element, styles: Element[], marked: number): void {
  restoredHosts.add(element);
  kept.push(...styles);
  markedStylesRemoved(marked);
}

/**
 * Replaces the partial server CSS of an element with the complete one, and (trimmed page, or `removeServerStyles`)
 * frees the complete server CSS once it is adopted; returns whether any server `<style>` was removed, kept or replaced.
 *
 *  - Lit element, hydrated by the hooks: adopts its class's `elementStyles` and removes the server `<style>`s when they
 *    are partial, when the page's server CSS was trimmed (`trimmedPage`), or when `removeServerStyles` is set.
 *    Minified server CSS waits while a bridged theme has not upgraded (`themePending`), and its `<style>`s are kept
 *    until the bridges go (`keepUntilSettled`).
 *  - Browser without constructable stylesheets (only reachable through the declarative shadow DOM polyfill): the first
 *    server `<style>` gets the class's complete CSS text and the others go (minified: a `<style>` with the complete
 *    text is added after them, and they are kept until the bridges go).
 *  - `<sp-theme>` (not a Lit element): when it adopted sheets itself and `removeServerStyles` is set, a server `<style>`
 *    it left is released. A theme that adopted nothing keeps it.
 * Nothing is removed from a root that does not hold the complete CSS afterwards.
 */
function settleServerStyles(element: Element, hydrated: boolean): boolean {
  const root = element.shadowRoot;
  if (!root || restoredHosts.has(element) || bridges.some((bridge) => bridge.host === element)) {
    return false; // restored already (its minified <style>s wait for the bridges), or a bridged theme
  }
  const serverStyles = serverStyleElements(root);
  if (serverStyles.length === 0) {
    return false;
  }
  const styles = classStyles(element);
  let marked = 0;
  let minified = false;
  for (const style of serverStyles) {
    if (isMarked(style)) {
      marked++;
      minified ||= isMinified(style);
    }
  }
  if (marked > 0) {
    trimmedPage = true;
  }
  // On a trimmed page every hydrated Lit element moves to its adopted complete sheets (also when its own server CSS
  // came out complete); otherwise complete server CSS is only released with `removeServerStyles`, and unmarked server
  // CSS is partial when its text is not the class's (only computed when that decides something).
  const releasing = removeServerStyles || (trimmedPage && styles !== undefined);
  const partial = marked > 0 || (!releasing && differsFromClass(element, serverStyles, styles));
  if (!partial && !releasing) {
    return false;
  }
  try {
    if (styles !== undefined) {
      if (!hydrated) {
        return false; // not hydrated (yet): its server CSS is all it has
      }
      if (minified && themePending()) {
        deferredRestorations++;
        return false; // restored when sp-theme is defined (onThemeDefined)
      }
      if (supportsAdoptingStyleSheets()) {
        const sheets = classSheets(styles);
        if (sheets === undefined) {
          return false;
        }
        adoptClassSheets(root, sheets);
      } else {
        // No constructable stylesheets (declarative shadow DOM polyfill): a server <style> carries the complete CSS.
        const text = classCssText(styles);
        if (text === undefined || !(partial || differsFromClass(element, serverStyles, styles))) {
          return false;
        }
        if (minified) {
          const complete = document.createElement('style');
          complete.textContent = text;
          serverStyles[serverStyles.length - 1]!.after(complete);
          keepUntilSettled(element, serverStyles, marked);
          return true;
        }
        const first = serverStyles[0]!;
        if (isStyleElement(first)) {
          first.textContent = text;
          first.removeAttribute(SERVER_STYLES_ATTRIBUTE);
          serverStyles.slice(1).forEach((style) => style.remove());
        } else {
          // A server `<link>` (`dedupe: 'link'`) comes first: a new `<style>` takes its place.
          const complete = document.createElement('style');
          complete.textContent = text;
          first.before(complete);
          serverStyles.forEach((style) => style.remove());
        }
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
  if (minified) {
    keepUntilSettled(element, serverStyles, marked);
    return true;
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
