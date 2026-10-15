// MUST be the first statement of this module, and `swc-ssr/client` must be the first import of the client bundle.
// It defines `globalThis.litElementHydrateSupport`, which `lit-element` reads once, when the LitElement class is
// created. Anything that evaluates `lit` / `lit-element` / a Spectrum module before this line produces elements that
// ignore the `defer-hydration` attribute and re-render their declarative shadow root from scratch (= flicker).
import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
import {hydrate} from '@lit-labs/ssr-client';
// lit-html, not lit: importing `lit` here would evaluate lit-element before the hooks below are installed.
import {render} from 'lit-html';
import {hydrateShadowRoots} from '@webcomponents/template-shadowroot';
import {installHydrationHooks} from './hooks.js';
import {
  bridgeServerThemes,
  pendingTrimmedThemes,
  releaseServerStyles,
  setRemoveServerStyles,
  settleThemeBridges,
  THEME_PENDING_WARNING,
} from './server-styles.js';
import {DEFER_ATTRIBUTE, isHydrationCandidate, tagsToDefine} from './elements.js';

export {registerHydrationAdapter} from './hooks.js';
export type {HydrationAdapter} from './hooks.js';

// Chains onto lit-element-hydrate-support (also before lit-element is evaluated): per-element hydration adapters,
// the initial `slotchange` that declarative shadow roots never get, and recovery from hydration mismatches.
installHydrationHooks(render);
// Trimmed / minified server CSS (docs/API.md "Styles"): keeps the server's `<sp-theme>` styles while elements depend on
// them. Must run before `<sp-theme>` is defined, like the hooks above.
bridgeServerThemes();

/** Outcome of one `hydrateSpectrum()` run. All lists are append-only and de-duplicated. */
export interface HydrationReport {
  /**
   * console.error output / uncaught errors / unhandled rejections captured while hydrating (the first report also
   * includes what was captured between loading this module and the `hydrateSpectrum()` call).
   */
  errors: string[];
  /**
   * console.warn output captured while hydrating, plus the helper's own warnings: tags not defined in time, updates
   * that did not settle, and `theme pending: sp-theme not defined; trimmed/minified theme values incomplete (...)`
   * when the call ends while an `<sp-theme>` whose server CSS was trimmed or minified has not upgraded (docs/API.md
   * "Styles").
   */
  warnings: string[];
  /** Tag name of every element that still carries `defer-hydration` once hydration has settled (one entry per element). */
  deferred: string[];
  /**
   * Number of custom elements (Spectrum's `sp-*` ones and the others, e.g. `<overlay-trigger>`; see
   * `isHydrationCandidate` in `elements.ts`) that have a (declarative) shadow root, are upgraded and are no longer
   * deferred.
   */
  hydratedCount: number;
  durationMs: number;
}

export interface HydrateSpectrumOptions {
  /**
   * A lit `TemplateResult` equal to the one that was rendered on the server. When given,
   * `hydrate(template, root)` from `@lit-labs/ssr-client` is used. Otherwise the framework-agnostic path runs:
   * `defer-hydration` is removed from the elements that carry it (Spectrum's and any other server-rendered custom
   * element, e.g. `<overlay-trigger>`) top-down, in document order.
   *
   * Works with server output rendered with either `deferHydration` setting. With `true` (recommended), no element
   * hydrates before `hydrateSpectrum()` runs: the elements of the outermost tree scope (light DOM below `root`) are
   * then enabled in document order in one pass - so their first updates run in document order, as with client-side
   * rendering, instead of in the order their definitions loaded - and `hydrate()` wires the bindings before any of
   * those updates runs. (@lit-labs/ssr only emits the `<!--lit-node-->` marker `hydrate()` needs to enable an element
   * for elements that are bound or nested in a shadow root, so `hydrate()` alone would leave unbound light-DOM
   * elements deferred.) With `false`, light-DOM elements hydrate as soon as their definition loads.
   */
  template?: unknown;
  /**
   * Default `true`: await `customElements.whenDefined()` for the custom element tags of the light DOM below `root`
   * first, and after hydrating for tags inside shadow roots (often defined lazily by their host's `render()`). Only
   * tags of elements that need hydrating are awaited (see `isHydrationCandidate` in `elements.ts`: deferred,
   * server-rendered or `sp-*`), not, e.g., the component hosts of a framework that never defines them.
   */
  whenDefined?: boolean;
  /**
   * Upper bound in ms for each individual wait (one `whenDefined` per tag, one settle round). Waits that run into
   * it are reported in `warnings` and hydration continues. Default 3000.
   */
  timeoutMs?: number;
  /**
   * Default `false`. Frees the `<style>` elements of the server-rendered shadow roots once the same CSS is in the
   * elements' `adoptedStyleSheets` (one shared `CSSStyleSheet` per component class instead of one parsed copy per
   * instance). A hydrated Lit element adopts its class's `elementStyles` right after its hydrating update (Lit's
   * hydration support does not adopt anything for a declarative shadow root), `<sp-theme>` adopts its theme sheets
   * itself and drops its declarative `<style>` when it upgrades. Elements that adopted no sheets keep their server
   * styles, as does every element in a browser without constructable stylesheets. Applies to the elements that
   * hydrate while this call runs, and to the ones already hydrated when it settles.
   *
   * Independent of this option, trimmed server CSS (`renderSpectrum({styles: {mode: 'trimmed'}})`, with or without
   * `minifyCustomProperties`) is always replaced: a hydrated element adopts its class's complete stylesheets and drops
   * the trimmed server `<style>` in the same task as its hydrating update, so that states the server did not render
   * have their rules, and (minified) the renamed theme properties the trimmed CSS reads are not needed any more. On
   * such a page every hydrated element moves to its adopted sheets, including those whose server CSS came out
   * complete. This option only adds the complete server CSS of `full` pages (the default mode) to what is released.
   */
  removeServerStyles?: boolean;
}

const DEFAULT_TIMEOUT_MS = 3000;
/** Safety net for the convergence loops; real pages need 2-4 rounds. */
const MAX_ROUNDS = 50;

const emptyReport = (): HydrationReport => ({
  errors: [],
  warnings: [],
  deferred: [],
  hydratedCount: 0,
  durationMs: 0,
});

let lastReport: HydrationReport = emptyReport();

/** Snapshot of the most recent (or still running) `hydrateSpectrum()` run; an empty report if none has happened. */
export function hydrationReport(): HydrationReport {
  return {
    errors: [...lastReport.errors],
    warnings: [...lastReport.warnings],
    deferred: [...lastReport.deferred],
    hydratedCount: lastReport.hydratedCount,
    durationMs: lastReport.durationMs,
  };
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Declarative shadow DOM polyfill
 * -------------------------------------------------------------------------------------------------------------- */

/**
 * Converts leftover `<template shadowrootmode>` elements into real shadow roots. A browser with declarative shadow DOM
 * (`'shadowRootMode' in HTMLTemplateElement.prototype`) consumes those templates while parsing, so there is nothing
 * to do for it; the polyfill is only needed in browsers without support (Firefox < 123, Safari < 16.4) and for markup
 * injected through `innerHTML` (which never attaches declarative shadow roots, not even in Chromium).
 * Must run before the custom elements are defined, otherwise they upgrade without their server-rendered shadow root.
 *
 * Detection is "a template[shadowrootmode] is still in the light DOM" instead of the package's own
 * `hasNativeDeclarativeShadowRoots()`: version 0.2.1 sniffs through the removed `DOMParser` `includeShadowRoots`
 * option and reports `false` in current Chromium, so it cannot be used as a gate. Every declarative shadow root
 * page has at least one outermost template in the light DOM, which makes this check sufficient.
 *
 * Returns whether anything was converted.
 *
 * Known limitation, observed in current Chromium with `innerHTML`-injected markup: the polyfill builds nested shadow
 * roots bottom-up inside inert `<template>` content, and Chromium then never upgrades the custom elements that sit in
 * a nested shadow root created that way (not even through `customElements.upgrade()`); `hydratedCount` stays below the
 * element count. Parsing the HTML natively (or `setHTMLUnsafe`) is not affected. The polyfill path itself could not be
 * verified in a browser without declarative shadow DOM support (none is available here).
 */
export function applyDeclarativeShadowDomPolyfill(root: ParentNode = document): boolean {
  if (typeof document === 'undefined') return false;
  if (root.querySelector('template[shadowrootmode]') === null) return false;
  hydrateShadowRoots(root === document ? (document.body ?? document.documentElement) : root);
  return true;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDeclarativeShadowDomPolyfill(), {once: true});
  } else {
    applyDeclarativeShadowDomPolyfill();
  }
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Error / warning capture
 * -------------------------------------------------------------------------------------------------------------- */

function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/** Appends `message` unless it is already in `list`; returns whether it was added. */
const pushUnique = (list: string[], message: string): boolean => {
  if (list.includes(message)) return false;
  list.push(message);
  return true;
};

/**
 * Records a failure in the report AND logs it with console.error. Awaiting `updateComplete` / catching `hydrate()`
 * marks these errors as handled, so without the log they would vanish from the console (where they would otherwise
 * show up as "Uncaught (in promise)"). The console message equals the report entry, so the capture de-duplicates them.
 */
function reportFailure(report: HydrationReport, label: string, error: unknown): void {
  // A rejected `updateComplete` stays rejected, so every settle round sees it again: log each failure once.
  if (pushUnique(report.errors, `${label}: ${formatValue(error)}`)) console.error(`${label}:`, error);
}

const captureSessions = new Set<HydrationReport>();
let uninstallCapture: (() => void) | undefined;

/**
 * Captures console.error / console.warn / window error / unhandledrejection for every active session.
 * Calls are always forwarded to the original console, so DevTools (and Playwright's console listener) still see them.
 * One shared patch serves overlapping runs.
 */
function installCapture(): () => void {
  const originalError = console.error;
  const originalWarn = console.warn;
  const wrappedError = function (this: Console, ...args: unknown[]): void {
    const message = args.map(formatValue).join(' ');
    for (const session of captureSessions) pushUnique(session.errors, message);
    originalError.apply(this, args);
  };
  const wrappedWarn = function (this: Console, ...args: unknown[]): void {
    const message = args.map(formatValue).join(' ');
    for (const session of captureSessions) pushUnique(session.warnings, message);
    originalWarn.apply(this, args);
  };
  const onError = (event: ErrorEvent): void => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    const message = `Uncaught ${event.error ? formatValue(event.error) : event.message}${where}`;
    for (const session of captureSessions) pushUnique(session.errors, message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const message = `Unhandled rejection: ${formatValue(event.reason)}`;
    for (const session of captureSessions) pushUnique(session.errors, message);
  };
  console.error = wrappedError;
  console.warn = wrappedWarn;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    if (console.error === wrappedError) console.error = originalError;
    if (console.warn === wrappedWarn) console.warn = originalWarn;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

function startCapture(report: HydrationReport): () => void {
  captureSessions.add(report);
  uninstallCapture ??= installCapture();
  return () => {
    captureSessions.delete(report);
    if (captureSessions.size === 0) {
      uninstallCapture?.();
      uninstallCapture = undefined;
    }
  };
}

/*
 * With `deferHydration: false`, light-DOM elements hydrate as soon as their definition is loaded - usually before the
 * application calls `hydrateSpectrum()`. Errors and warnings from that phase are captured from the moment this module
 * is evaluated and handed to the first `hydrateSpectrum()` run.
 */
let earlyReport: HydrationReport | undefined;
let stopEarlyCapture: (() => void) | undefined;
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  earlyReport = emptyReport();
  stopEarlyCapture = startCapture(earlyReport);
}

/** Moves what was captured before the first `hydrateSpectrum()` call into `report` (once). */
function adoptEarlyCapture(report: HydrationReport): void {
  if (!earlyReport) {
    return;
  }
  for (const message of earlyReport.errors) pushUnique(report.errors, message);
  for (const message of earlyReport.warnings) pushUnique(report.warnings, message);
  earlyReport = undefined;
  stopEarlyCapture?.();
  stopEarlyCapture = undefined;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Tree helpers
 * -------------------------------------------------------------------------------------------------------------- */

const isDeferred = (el: Element): boolean => el.hasAttribute(DEFER_ATTRIBUTE);
const isDefined = (localName: string): boolean => customElements.get(localName) !== undefined;

/**
 * The elements hydration takes care of (`isHydrationCandidate`): every element carrying `defer-hydration` and the
 * custom elements that are server-rendered, defined or `sp-*` - not only `sp-*` tags: Spectrum has custom elements
 * without the prefix (`<overlay-trigger>`, `overlay/overlay-trigger.js`), which the framework-agnostic path must
 * enable as well. One predicate for the collection, the definition waits and the report.
 */
const isCandidate = (el: Element): boolean => isHydrationCandidate(el, isDefined);

/**
 * Every candidate element under (and including) `root`, in document order, descending into open shadow roots.
 * A shadow host is listed before the elements of its shadow tree, which is listed before the host's light children,
 * so a parent always precedes its descendants.
 */
function collectCandidates(root: Element | ShadowRoot): Element[] {
  const found: Element[] = [];
  const visit = (el: Element): void => {
    if (isCandidate(el)) found.push(el);
    if (el.shadowRoot) walk(el.shadowRoot);
  };
  const walk = (scope: Element | ShadowRoot): void => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) visit(node as Element);
  };
  // `visit(root)` lists root and walks root's shadow tree; `walk(root)` then covers root's light descendants.
  if (root instanceof Element) visit(root);
  walk(root);
  return found;
}

function shadowHostOf(el: Element): Element | null {
  const rootNode = el.getRootNode();
  return rootNode instanceof ShadowRoot ? rootNode.host : null;
}

/** True when no shadow host above `el` is still deferred, i.e. the scope `el` lives in has been hydrated. */
function hasEnabledScope(el: Element): boolean {
  for (let host = shadowHostOf(el); host !== null; host = shadowHostOf(host)) {
    if (isDeferred(host)) return false;
  }
  return true;
}

function isUpgraded(el: Element): boolean {
  const ctor = customElements.get(el.localName);
  return ctor !== undefined && el instanceof ctor;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Waiting
 * -------------------------------------------------------------------------------------------------------------- */

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Resolves `true` when `promise` settled in time, `false` on timeout. Never rejects. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/**
 * Awaits the definitions of the candidate custom elements under `root` (see `isCandidate`): only those of the
 * outermost tree scope (the light DOM the application is responsible for) when `outermostOnly`, otherwise also the
 * ones inside (open) shadow roots, which are often defined lazily by their host's first render (e.g.
 * `color-field/src/ColorField.js` imports `sp-color-handle` in `render()`). Returns whether any definition was
 * missing when called.
 */
async function waitForDefinitions(
  root: Element,
  report: HydrationReport,
  timeoutMs: number,
  outermostOnly: boolean,
): Promise<boolean> {
  const elements = outermostOnly ? [root, ...Array.from(root.querySelectorAll('*'))] : collectCandidates(root);
  const missing = tagsToDefine(elements, isDefined).filter((tag) => !isDefined(tag));
  await Promise.all(
    missing.map(async (tag) => {
      const defined = await settledWithin(customElements.whenDefined(tag), timeoutMs);
      if (!defined) {
        pushUnique(report.warnings, `<${tag}> is not defined after ${timeoutMs} ms; its elements cannot hydrate`);
      }
    }),
  );
  return missing.length > 0;
}

/**
 * Waits until the pending Lit updates of `elements` finished (their first update is the hydration of their shadow root).
 * Elements that still carry `defer-hydration` are skipped: they are not connected as far as Lit is concerned, so their
 * `updateComplete` stays pending until somebody enables them.
 */
async function settleElements(elements: Element[], report: HydrationReport, timeoutMs: number): Promise<void> {
  const updates: Promise<unknown>[] = [];
  for (const el of elements) {
    if (isDeferred(el)) continue;
    let updateComplete: unknown;
    try {
      updateComplete = (el as {updateComplete?: unknown}).updateComplete;
    } catch (error) {
      reportFailure(report, `<${el.localName}>.updateComplete threw`, error);
      continue;
    }
    if (updateComplete instanceof Promise) {
      updates.push(
        updateComplete.catch((error: unknown) => {
          reportFailure(report, `<${el.localName}> update failed`, error);
        }),
      );
    }
  }
  const finished = await settledWithin(Promise.all(updates), timeoutMs);
  if (!finished) {
    pushUnique(report.warnings, `Element updates did not settle within ${timeoutMs} ms`);
  }
  await nextMacrotask();
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Hydration paths
 * -------------------------------------------------------------------------------------------------------------- */

/**
 * After `hydrate()` the elements update asynchronously, and every host that finishes hydrating enables the elements in
 * its own shadow root. Repeat until the element set and the deferred count stop changing.
 */
async function settleTree(root: Element, report: HydrationReport, timeoutMs: number): Promise<void> {
  let previous = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    await settleElements(collectCandidates(root), report, timeoutMs);
    const after = collectCandidates(root);
    const signature = `${after.length}:${after.filter(isDeferred).length}`;
    if (signature === previous) return;
    previous = signature;
  }
  pushUnique(report.warnings, `Hydration did not converge after ${MAX_ROUNDS} rounds`);
}

/** True once the shadow host of `el` (if any) has run its first update, i.e. hydrated the scope `el` lives in. */
function hostHasRendered(el: Element): boolean {
  const host = shadowHostOf(el) as (Element & {hasUpdated?: boolean}) | null;
  return host === null || host.hasUpdated !== false;
}

/**
 * Framework-agnostic path: remove `defer-hydration` parent-first.
 *
 * Elements in one tree scope (the light DOM below `root`) are enabled in a single synchronous pass in document order,
 * exactly like lit's `hydrate()` does: `connectedCallback` schedules each update as a microtask, so parents render
 * (and hydrate their shadow root) before their descendants. Elements inside a shadow root wait until their host is
 * enabled and has run its first update; lit's own `hydrate()` of that shadow root normally removes the attribute
 * itself, so this only acts when it did not (e.g. a host that is not a LitElement). Only first updates are awaited
 * between rounds (a component's `updateComplete` may wait for children that are enabled later); everything is
 * settled at the end.
 */
async function hydrateAgnostic(root: Element, report: HydrationReport, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (let round = 0; round < MAX_ROUNDS * 10; round++) {
    const pending = collectCandidates(root).filter(isDeferred);
    if (pending.length === 0) break;
    const eligible = pending.filter((el) => hasEnabledScope(el) && hostHasRendered(el));
    if (eligible.length === 0) {
      if (performance.now() > deadline || !pending.some(hasEnabledScope)) break; // leftovers are reported in `deferred`
      await nextMacrotask();
      continue;
    }
    for (const el of eligible) el.removeAttribute(DEFER_ATTRIBUTE);
    await nextMacrotask();
  }
  await settleTree(root, report, timeoutMs);
}

/**
 * Hydrates the server-rendered Spectrum elements below `root` (default `document.body`).
 *
 * - With `options.template`: `hydrate(template, root)` from `@lit-labs/ssr-client`, then waits for the elements to
 *   finish updating. The template must match what the server rendered.
 * - Without: the framework-agnostic path (see `hydrateAgnostic`).
 *
 * Never rejects: problems end up in the returned report (also readable through `hydrationReport()`).
 */
export async function hydrateSpectrum(
  root: Element = document.body,
  options: HydrateSpectrumOptions = {},
): Promise<HydrationReport> {
  const report = emptyReport();
  lastReport = report;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stopCapture = startCapture(report);
  adoptEarlyCapture(report);
  setRemoveServerStyles(options.removeServerStyles === true);
  const started = performance.now();
  try {
    applyDeclarativeShadowDomPolyfill(root);
    const whenDefined = options.whenDefined !== false;
    if (whenDefined) await waitForDefinitions(root, report, timeoutMs, true);

    if (options.template !== undefined) {
      // Server output rendered with `deferHydration: true`: enable the elements of the outermost tree scope in
      // document order (one synchronous pass, so their first updates run in that order, as with client-side
      // rendering - not in the order their definitions happened to load), then let hydrate() wire the bindings
      // before any of those updates runs. hydrate() itself only enables elements that carry a `<!--lit-node-->`
      // marker (bound or nested in a shadow root); elements inside shadow roots are enabled by their host.
      // querySelectorAll does not enter shadow roots: these are exactly the outermost scope's elements.
      for (const el of Array.from(root.querySelectorAll(`[${DEFER_ATTRIBUTE}]`))) el.removeAttribute(DEFER_ATTRIBUTE);
      if (root.hasAttribute(DEFER_ATTRIBUTE)) root.removeAttribute(DEFER_ATTRIBUTE);
      try {
        hydrate(options.template, root);
      } catch (error) {
        reportFailure(report, 'hydrate() failed', error);
      }
      await settleTree(root, report, timeoutMs);
      // Elements inside shadow roots whose definitions arrive late (loaded by their host's render) hydrate then.
      if (whenDefined && (await waitForDefinitions(root, report, timeoutMs, false))) {
        await settleTree(root, report, timeoutMs);
      }
    } else {
      await hydrateAgnostic(root, report, timeoutMs);
      if (whenDefined && (await waitForDefinitions(root, report, timeoutMs, false))) {
        await hydrateAgnostic(root, report, timeoutMs);
      }
    }
    // Elements that hydrated before this call (deferHydration: false) and <sp-theme>, which is not a Lit element.
    if (options.removeServerStyles === true) {
      for (const el of collectCandidates(root)) releaseServerStyles(el);
    }
    // Trimmed / minified server CSS: the server's <sp-theme> styles are kept while marked <style>s are left (elements
    // not hydrated yet); once none is left anywhere in the document, they go.
    settleThemeBridges();
    // A theme still on its trimmed / minified server <style> (`sp-theme` not defined): only what the server kept.
    const pendingThemes = pendingTrimmedThemes();
    if (pendingThemes > 0) {
      pushUnique(
        report.warnings,
        `${THEME_PENDING_WARNING} (${pendingThemes} <sp-theme> ${pendingThemes === 1 ? 'element runs' : 'elements run'} ` +
          "on the server's theme <style>: content created on the client and states entered later lack the theme " +
          'values the server left out until sp-theme is defined)',
      );
    }
  } catch (error) {
    reportFailure(report, 'hydrateSpectrum() failed', error);
  } finally {
    const elements = collectCandidates(root);
    report.deferred = elements.filter(isDeferred).map((el) => el.localName);
    report.hydratedCount = elements.filter((el) => el.shadowRoot !== null && isUpgraded(el) && !isDeferred(el)).length;
    report.durationMs = Math.round((performance.now() - started) * 10) / 10;
    stopCapture();
  }
  return report;
}
