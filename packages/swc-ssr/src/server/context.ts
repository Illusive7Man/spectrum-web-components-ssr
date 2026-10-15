/**
 * Per-render state. Everything a render needs lives in a `RenderSession` (one per `renderSpectrum()` call) and two
 * `RenderContext`s (one per pass). Renderers reach the context of the render that constructs them through a
 * module-level "current context", which `renderSpectrum()` sets only while it synchronously evaluates render
 * thunks (and restores afterwards), so nested / queued renders never see each other's state and nothing survives a
 * render.
 *
 * Asynchronous work started by a render (component promise chains, timers) is tied to it through an
 * `AsyncLocalStorage` scope (`runInRenderScope` / `withElementScope`): rejections nobody handles are attributed to
 * the render - and to the element whose code created the promise - and a `renderSpectrum()` awaited from inside a
 * render is recognized as nested.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import type {RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {
  setDroppedMutationHandler,
  setRafSink,
  setRandomSource,
  setListenerLog,
  type DroppedMutationHandler,
  type ListenerLog,
  type ListenerRecord,
  type RafEntry,
  type RafSink,
} from '../dom-shim/hooks.js';
import {setSelectorErrorHandler, type SelectorErrorHandler} from '../dom-shim/select.js';
import {isSpectrumClass} from './adapters/spectrum-class.js';
import type {ServerTree} from './server-tree.js';
import type {TreeRealm} from './realm.js';
import type {ElementReport, LifecycleMode, RenderSpectrumOptions} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What pass 1 records about every element rendered by a Spectrum renderer. */
export interface ElementRecord {
  id: number;
  key: string;
  tag: string;
  /** `setAttribute` calls made by upstream (static + dynamic attribute parts), last value wins. */
  attributes: Map<string, string>;
  /** `setProperty` calls made by upstream (property parts), last value wins. */
  properties: Map<string, unknown>;
  /** Canonical form of the template's static attributes of the element (see `plan.ts`). */
  staticAttributes: string;
  /** Pass >= 2: id of the previous pass's record the element was matched with (by key), if any. */
  adoptedFrom?: number;
}

/** A tiny deterministic PRNG (mulberry32). */
export function createRandom(seed: number): (array: Uint8Array) => void {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(next() * 256);
    }
  };
}

/** The longest delay `setTimeout` accepts (2^31 - 1 ms). */
export const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * The `setTimeout` delay for a positive wait of `ms` milliseconds, or undefined for "no timer" (`Infinity` and
 * everything above `MAX_TIMER_DELAY`). Review finding (fixed): Node turns longer delays into 1 ms (with a
 * `TimeoutOverflowWarning`), so `timeoutMs: 2 ** 31` made every render time out at once.
 */
export function timerDelay(ms: number): number | undefined {
  return ms > MAX_TIMER_DELAY ? undefined : Math.max(ms, 1);
}

/** FNV-1a hash of a string (used to seed pass 2 from the pass-1 HTML). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A queued animation frame and the render scope of the code that requested it (the callback runs in it). */
export interface ScopedRafEntry extends RafEntry {
  scope?: RenderScope;
}

export class RafQueue implements RafSink {
  entries: ScopedRafEntry[] = [];

  push(entry: ScopedRafEntry): void {
    this.entries.push(entry);
  }

  cancel(id: number): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
  }

  get size(): number {
    return this.entries.length;
  }
}

/** An element swc-ssr called `connectedCallback` on during a render (disconnected when the render ends). */
export interface ConnectedElement {
  element: HTMLElement;
  report: ElementReport;
}

/** Thrown into a render's remaining work once its deadline passed (see `renderSpectrum`'s `timeoutMs`). */
export class RenderAbortedError extends Error {
  constructor(message = 'the render was abandoned (deadline exceeded)') {
    super(message);
    this.name = 'RenderAbortedError';
  }
}

/** State shared by both passes of one `renderSpectrum()` call. */
export class RenderSession {
  readonly raf = new RafQueue();
  readonly listeners: ListenerRecord[] = [];
  readonly options: RenderSpectrumOptions;
  readonly startedAt = performance.now();
  /** Messages that could not be attributed to an element (e.g. unhandled rejections). */
  readonly orphanWarnings: string[] = [];
  /**
   * Every element (of every pass) whose `connectedCallback` swc-ssr ran, in connection order. They are all
   * disconnected when the render ends (see `disconnectAll` in lifecycle.ts): components register connected
   * instances in module-level singletons and remove them only in `disconnectedCallback`.
   */
  readonly connected: ConnectedElement[] = [];
  /** Report of the element whose lifecycle ran last (errors of animation frame callbacks are attributed to it). */
  lastReport: ElementReport | undefined;
  frame = 0;
  /** The pass in progress (1, 2, 3). */
  pass = 0;
  /** The context of the pass in progress. */
  current: RenderContext | undefined;
  /** Set when the session was deactivated: its queues are no longer drained, nothing may be added to them. */
  ended = false;
  /** Set when the render's deadline passed: the remaining work stops at its next step. */
  aborted = false;
  /**
   * The `lang` of the template's own `<html>` element (whole-document templates, read from the pass-1 tree; see
   * `setDocumentLanguage`). Used as the document language from pass 2 on when `options.lang` is not set.
   */
  documentLang: string | undefined;
  /** Logs selectors the shim could not evaluate (code of this render, see `dispatchSelectorError`). */
  readonly selectorErrorHandler: SelectorErrorHandler = (selector, error) => {
    this.debug(`unsupported selector "${selector}": ${errorMessage(error)}`);
  };

  constructor(options: RenderSpectrumOptions) {
    this.options = options;
  }

  debug(...args: unknown[]): void {
    if (this.options.debug) {
      console.debug('[swc-ssr]', ...args);
    }
  }

  /** Throws `RenderAbortedError` when the render's deadline passed (called between steps of the render's work). */
  checkAborted(): void {
    if (this.aborted) {
      throw new RenderAbortedError();
    }
  }
}

export interface RenderStacks {
  customElementInstanceStack: any[];
  customElementHostStack: any[];
  eventTargetStack: any[];
  slotStack: any[];
}

/** An element rendered (markup emitted) in a pass. */
export interface RenderedElement {
  element: HTMLElement;
  report: ElementReport;
}

export class RenderContext {
  readonly records = new Map<number, ElementRecord>();
  readonly recordsByKey = new Map<string, ElementRecord>();
  readonly reportsByKey = new Map<string, ElementReport>();
  /** Instances rendered in this pass -> key (used to translate pass-1 instances found in property values). */
  readonly keyByInstance = new WeakMap<object, string>();
  /** Pass 2: pre-instantiated custom element instances by key. */
  readonly pool = new Map<string, HTMLElement>();
  /** Pass 2: keys whose pooled instance was handed to an upstream renderer. */
  readonly claimed = new Set<string>();
  /** Pass >= 2: reports of elements rendered without tree information from the previous pass. */
  readonly untracked: ElementReport[] = [];
  /** Elements whose markup this pass emitted, in render order. */
  readonly rendered: RenderedElement[] = [];
  readonly stacks: RenderStacks = {
    customElementInstanceStack: [],
    customElementHostStack: [],
    eventTargetStack: [],
    slotStack: [],
  };
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly foreignKeys = new WeakMap<object, string>();
  private foreignCount = 0;
  nextId = 0;
  realm: TreeRealm | undefined;
  readonly random: (array: Uint8Array) => void;

  constructor(
    readonly session: RenderSession,
    readonly pass: number,
    /** The previous pass (cleared by `dispose`). */
    public previous?: RenderContext,
    /** Pass >= 2: the tree of the previous pass's output (cleared by `dispose`). */
    public tree?: ServerTree,
    seed = 0x5eed
  ) {
    this.random = createRandom(seed);
  }

  get options(): RenderSpectrumOptions {
    return this.session.options;
  }

  /** The `renderInfo` passed to upstream `render()`: our own stacks so renderers can see where they are. */
  renderInfo(elementRenderers: ElementRendererConstructor[]): Partial<RenderInfo> {
    return {
      elementRenderers,
      deferHydration: this.options.deferHydration ?? false,
      ...this.stacks,
    } as Partial<RenderInfo>;
  }

  /**
   * Stable key of the next element with `tag` constructed at the current position: the key of the tree scope
   * (the host whose shadow is being rendered, or the document) plus the tag, a short hash of the element's static
   * template attributes (`variant` (when given), ...) and its ordinal among the elements with the same tag and
   * static attributes within that scope. Same-tag elements keep their key even if a component wraps or adds other
   * elements in its shadow between passes, an element added before a same-tag sibling with different static
   * attributes does not shift that sibling's key, and a change inside one shadow root never shifts the keys of
   * elements elsewhere.
   */
  nextKey(tag: string, staticAttributes = ''): string {
    const host = this.stacks.customElementHostStack.at(-1);
    const scope = host === undefined ? '' : this.keyOfRenderer(host);
    let counters = this.counters.get(scope);
    if (!counters) {
      counters = new Map();
      this.counters.set(scope, counters);
    }
    const name = staticAttributes ? `${tag}#${hashString(staticAttributes).toString(36)}` : tag;
    const ordinal = counters.get(name) ?? 0;
    counters.set(name, ordinal + 1);
    return `${scope}>${name}:${ordinal}`;
  }

  keyOfRenderer(renderer: object): string {
    const own = (renderer as {ssrKey?: string}).ssrKey;
    if (own !== undefined) {
      return own;
    }
    let key = this.foreignKeys.get(renderer);
    if (key === undefined) {
      key = `~${(renderer as {tagName?: string}).tagName ?? 'element'}:${this.foreignCount++}`;
      this.foreignKeys.set(renderer, key);
    }
    return key;
  }

  reportFor(key: string, tagName: string): ElementReport {
    let report = this.reportsByKey.get(key);
    if (!report) {
      report = {id: -1, tagName, errors: [], warnings: [], fallback: false};
      this.reportsByKey.set(key, report);
    }
    return report;
  }

  /** The report of a custom element instance of this pass (undefined for other nodes). */
  reportOfInstance(element: object): ElementReport | undefined {
    const key = this.keyByInstance.get(element);
    return key === undefined ? undefined : this.reportsByKey.get(key);
  }

  /**
   * Releases everything the pass holds once the render is over (its report has been built): the realm (see
   * `TreeRealm.dispose`), the server tree, the link to the previous pass, the pool, the records (their property
   * values may be element instances) and the stacks. Whatever still references a context after the render (e.g. a
   * closure of the last render kept by the engine until the next one) then pins an empty shell, not the render.
   */
  dispose(): void {
    this.realm?.dispose();
    this.realm = undefined;
    this.previous = undefined;
    this.tree = undefined;
    this.pool.clear();
    this.claimed.clear();
    this.records.clear();
    this.recordsByKey.clear();
    this.reportsByKey.clear();
    this.untracked.length = 0;
    this.rendered.length = 0;
    this.counters.clear();
    this.stacks.customElementInstanceStack.length = 0;
    this.stacks.customElementHostStack.length = 0;
    this.stacks.eventTargetStack.length = 0;
    this.stacks.slotStack.length = 0;
  }

  /** Whether instances of `ctor` get the swc-ssr lifecycle by default (`RenderSpectrumOptions.isManagedClass`). */
  isManagedClass(ctor: unknown, tag: string): boolean {
    if (typeof ctor !== 'function') {
      return false;
    }
    const predicate = this.options.isManagedClass;
    if (!predicate) {
      return isSpectrumClass(ctor);
    }
    try {
      return !!predicate(ctor as CustomElementConstructor, tag);
    } catch (error) {
      this.session.orphanWarnings.push(`isManagedClass(<${tag}>): ${errorMessage(error)}`);
      return false;
    }
  }

  /**
   * Effective lifecycle of an element:
   *  1. an explicit per-tag option (`lifecycleByTag`) wins;
   *  2. `LitElementRenderer.renderOptions` returning `connectedCallback: false` means `none` (upstream semantics);
   *  3. managed classes (Spectrum by default): min(global option, adapter default), default `full`;
   *  4. other classes keep upstream semantics: `connected` when `renderOptions` (or the deprecated
   *     `globalThis.litSsrCallConnectedCallback`) asks for `connectedCallback`, otherwise `none`.
   * Pass 1 only collects structure: never more than `connected`. (`disableSsr` is handled by the callers: such
   * elements are neither pooled, connected nor updated.)
   */
  lifecycleFor(
    tag: string,
    adapterMode: LifecycleMode | undefined,
    ctor: unknown = (globalThis as any).customElements?.get(tag),
    renderOptions?: {connectedCallback?: boolean}
  ): LifecycleMode {
    const explicit = this.options.lifecycleByTag?.[tag];
    let mode: LifecycleMode;
    if (explicit !== undefined) {
      mode = explicit;
    } else if (renderOptions?.connectedCallback === false) {
      mode = 'none';
    } else if (this.isManagedClass(ctor, tag)) {
      mode = minMode(this.options.lifecycle ?? 'full', adapterMode ?? 'full');
    } else {
      mode = renderOptions?.connectedCallback || (globalThis as any).litSsrCallConnectedCallback ? 'connected' : 'none';
    }
    return this.pass === 1 ? minMode(mode, 'connected') : mode;
  }
}

const MODE_ORDER: Record<LifecycleMode, number> = {none: 0, connected: 1, full: 2};

export function minMode(a: LifecycleMode, b: LifecycleMode): LifecycleMode {
  return MODE_ORDER[a] <= MODE_ORDER[b] ? a : b;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // SWC_SSR_DEBUG_STACKS=1 includes stack traces in report messages (debugging aid).
    if (process.env.SWC_SSR_DEBUG_STACKS) {
      return String(error.stack ?? `${error.name}: ${error.message}`);
    }
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Current context & synchronous windows
 * ------------------------------------------------------------------------------------------------------------ */

let currentContext: RenderContext | undefined;

/** The context of the render whose thunks are being evaluated right now (undefined outside of renders). */
export function getCurrentRenderContext(): RenderContext | undefined {
  return currentContext;
}

/**
 * Runs `fn` synchronously with `context` as the current context and its deterministic random source active, then
 * restores whatever was active before (so nested renders are safe).
 *
 * Frames, document listeners and the other per-render hooks of code running in `fn` belong to the context's render
 * because they are filed by render scope (see "Session activation" below), even while another render is the most
 * recent active session (nested / overlapping renders). `fn` normally runs in that scope already; when it does not
 * (no scope, or another render's), it is run in the render's scope.
 */
export function runInContext<T>(context: RenderContext, fn: () => T): T {
  const {session} = context;
  if (renderScope.getStore()?.session !== session) {
    return renderScope.run({session}, () => runInContext(context, fn));
  }
  const previousContext = currentContext;
  // RenderSpectrumOptions.deterministicIds (review M8): `false` leaves the CSPRNG in place for this render only (the
  // process-wide default is `configureRandomSource` in dom-shim/install.ts).
  const previousRandom = setRandomSource(context.options.deterministicIds === false ? undefined : context.random);
  currentContext = context;
  try {
    return fn();
  } finally {
    currentContext = previousContext;
    setRandomSource(previousRandom);
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Asynchronous render scope
 * ------------------------------------------------------------------------------------------------------------ */

/** The render (and, inside an element's lifecycle hooks, the element) that asynchronous work belongs to. */
export interface RenderScope {
  session: RenderSession;
  report?: ElementReport;
}

const renderScope = new AsyncLocalStorage<RenderScope>();

/** Runs `fn` (and everything asynchronous it starts) as part of `session`'s render. */
export function runInRenderScope<T>(session: RenderSession, fn: () => T): T {
  return renderScope.run({session}, fn);
}

/** The render scope of the code running now (also in async continuations and timers started by a render). */
export function getRenderScope(): RenderScope | undefined {
  return renderScope.getStore();
}

/** Runs `fn` in `scope` (e.g. an animation frame callback in the scope of the code that requested the frame). */
export function runInScope<T>(scope: RenderScope | undefined, fn: () => T): T {
  return scope === undefined || renderScope.getStore() === scope ? fn() : renderScope.run(scope, fn);
}

/**
 * Runs `fn` with `report` as the element of the current render scope: promises created by the element's hooks
 * carry its report, so a rejection nobody handles is attributed to the element. Outside of a render scope `fn`
 * just runs.
 */
export function withElementScope<T>(report: ElementReport | undefined, fn: () => T): T {
  const scope = renderScope.getStore();
  if (!scope || !report || scope.report === report) {
    return fn();
  }
  return renderScope.run({session: scope.session, report}, fn);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Unhandled rejections
 * ------------------------------------------------------------------------------------------------------------ */

let rejectionHandlerInstalled = false;

/** Node's `--unhandled-rejections` mode (from the process flags; `throw` is Node's default). */
function unhandledRejectionsMode(): string {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)];
  let mode = 'throw';
  for (const flag of flags) {
    const match = /^--unhandled-rejections=(\S+)$/.exec(flag);
    if (match) {
      mode = match[1];
    }
  }
  return mode;
}

/**
 * What Node does with a rejection nobody handles when no `unhandledRejection` listener exists (our own listener
 * must not change that for rejections that do not belong to a render).
 */
function forwardUnhandledRejection(reason: unknown): void {
  if (process.listenerCount('unhandledRejection') > 1) {
    // The application has its own listener: it decides.
    return;
  }
  const mode = unhandledRejectionsMode();
  if (mode === 'none') {
    return;
  }
  const error =
    reason instanceof Error
      ? reason
      : Object.assign(
          new Error(
            'This error originated either by throwing inside of an async function without a catch block, or by ' +
              `rejecting a promise which was not handled with .catch(). The promise rejected with the reason "${String(reason)}".`
          ),
          {name: 'UnhandledPromiseRejection', code: 'ERR_UNHANDLED_REJECTION'}
        );
  if (mode === 'warn' || mode === 'warn-with-error-code') {
    console.error(error);
    process.emitWarning(`Unhandled promise rejection: ${errorMessage(error)}`, 'UnhandledPromiseRejectionWarning');
    if (mode === 'warn-with-error-code') {
      process.exitCode = 1;
    }
    return;
  }
  // `throw` (default) / `strict`: an uncaught exception, as without this listener.
  throw error;
}

/**
 * A late rejection of a finished render's element hook (see `onUnhandledRejection`): not fatal, but visible - a
 * process warning, unless the application has its own listener (it sees the rejection and decides) or Node's mode
 * is `none`.
 */
function warnLateRejection(reason: unknown, tagName: string): void {
  if (process.listenerCount('unhandledRejection') > 1 || unhandledRejectionsMode() === 'none') {
    return;
  }
  process.emitWarning(
    `unhandled rejection in <${tagName}> after its render ended (the element was discarded with the render): ${errorMessage(reason)}`,
    {type: 'SwcSsrLateRejectionWarning', code: 'SWC_SSR_LATE_REJECTION'}
  );
}

/**
 * Rejections nobody handled. Only those of promises created by a render (its `AsyncLocalStorage` scope; Node runs
 * this listener in the async context of the rejected promise) are attributed to it while it is in progress: to the
 * element whose hook created the promise, or to the render (`#render`). Every other rejection gets Node's behaviour
 * (see `forwardUnhandledRejection`).
 *
 * After the render ended its scope lives on in whatever it started: timers, promise chains, and also long-lived
 * resources that were first created inside the render (a lazily created client, an interval, a pool). Review
 * finding (fixed): such rejections used to be debug-logged only, i.e. swallowed for the life of the process. Now:
 *  - from the render's own scope (no element: templates, directives, custom renderers, application code they
 *    started): Node's behaviour, as if swc-ssr had no listener;
 *  - from an element's hooks (component code of the discarded tree, e.g. a disabled `sp-slider`'s
 *    `handleDisabledChanged()` continuing after the render): a process warning (`SWC_SSR_LATE_REJECTION`) instead
 *    of a crash, unless the application has its own listener. Spectrum components leave such work behind (see the
 *    README, "Late work after a render"); crashing a server for it would make every render a risk.
 *
 * Review M2 (fixed): the listener used to turn every rejection of the process into a report warning while any
 * render was in progress (renders span macrotasks, so unrelated rejections of other requests were swallowed).
 */
function onUnhandledRejection(reason: unknown): void {
  const scope = renderScope.getStore();
  if (!scope) {
    forwardUnhandledRejection(reason);
    return;
  }
  const {session, report} = scope;
  const message = `unhandled rejection: ${errorMessage(reason)}`;
  if (session.ended) {
    session.debug(`after the render: ${message}${report ? ` (<${report.tagName}>)` : ''}`);
    if (report) {
      warnLateRejection(reason, report.tagName);
    } else {
      forwardUnhandledRejection(reason);
    }
    return;
  }
  if (report) {
    report.warnings.push(message);
  } else {
    session.orphanWarnings.push(message);
  }
}

/** Installed with the first render, kept for the life of the process (see `onUnhandledRejection`). */
function installRejectionHandler(): void {
  if (!rejectionHandlerInstalled) {
    process.on('unhandledRejection', onUnhandledRejection);
    rejectionHandlerInstalled = true;
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Dropped mutations (review L5)
 * ------------------------------------------------------------------------------------------------------------ */

function describeNode(node: any): string {
  if (node == null || typeof node !== 'object') {
    return String(node);
  }
  if (node.nodeType === 3) {
    return 'text';
  }
  if (node.nodeType === 11) {
    return node.host ? `the shadow root of <${node.host.localName}>` : 'a fragment';
  }
  return `<${node.localName ?? node.nodeName ?? 'node'}>`;
}

/**
 * A component changed the structure of a node the server renders from templates (a tree-backed facade, or an
 * element rendered without tree information): the change cannot appear in the output (it appears only after
 * hydration). The message goes to the element whose code made the change (its lifecycle scope), else to the
 * closest rendered custom element containing the target, else to the render. Only the final passes report (pass
 * 1 has no structure at all).
 */
function reportDroppedMutation(session: RenderSession, target: any, operation: string, node: unknown): void {
  if (session.ended || session.pass < 2) {
    return;
  }
  const context = session.current;
  let host: any = null;
  const scope = renderScope.getStore();
  let report = scope?.session === session ? scope.report : undefined;
  for (let current = target, depth = 0; current && depth < 10_000; depth++) {
    const own = context?.reportOfInstance(current);
    if (own) {
      host = current;
      report ??= own;
      break;
    }
    const parent = current.parentNode;
    current = parent && parent.nodeType === 11 ? parent.host : parent;
  }
  const what = node === undefined ? operation : `${operation}(${describeNode(node)})`;
  const where = host && host !== target ? `${describeNode(target)} in <${host.localName}>` : describeNode(target);
  const message =
    `dropped DOM change: ${what} on ${where} has no effect on the server output ` +
    '(rendered structure comes from templates; the change appears only after hydration)';
  const messages = report ? report.warnings : session.orphanWarnings;
  if (!messages.includes(message)) {
    messages.push(message);
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Session activation (process-wide hooks that must be in place for the whole duration of a render)
 * ------------------------------------------------------------------------------------------------------------ */

/**
 * Sessions whose render is in progress, in activation order. Usually there is at most one (renders are serialized),
 * but a render started from inside another render runs nested, and the two can finish in any order.
 *
 * Retention path (fixed): the hooks used to be saved and restored as a LIFO stack (`previous = activeSession` on
 * activation, restored on deactivation, and the selector error handler reset to `undefined`). When an outer render
 * finished before a nested one, the nested render's deactivation re-installed the hooks of the outer, already
 * finished session; from then on the animation frames and document listeners of every later async continuation
 * were queued into that dead session (never flushed, never removed), retaining its render graph and growing without
 * bound. Now a deactivating session is removed from this set, and the hooks dispatch by render scope (below).
 */
const activeSessions = new Set<RenderSession>();
/** The hooks that were in place before the first of the currently active sessions was activated. */
let baseHooks:
  | {
      raf: RafSink | undefined;
      log: ListenerLog | undefined;
      selector: SelectorErrorHandler | undefined;
      dropped: DroppedMutationHandler | undefined;
      lang: string | null;
    }
  | undefined;

/** The most recently activated session that is still active. */
function latestActiveSession(): RenderSession | undefined {
  let latest: RenderSession | undefined;
  for (const session of activeSessions) {
    latest = session;
  }
  return latest;
}

/*
 * The process-wide hooks (dom-shim/hooks.ts, dom-shim/select.ts) are installed once while any session is active and
 * file every call under the render whose code made it: the session of the caller's render scope
 * (`AsyncLocalStorage`, also in timers and promise continuations a render started); only callers without a render
 * scope (code unrelated to any render) go to the most recent active session.
 *
 * Review finding (fixed): the hooks used to point at the most recent active session. A late continuation of a
 * finished render (a timer one of its components started) that requested an animation frame while the next queued
 * render ran had its frame flushed inside that render, with its error attributed to an element of that render (and
 * its document listeners were removed with that render). Now the work of a finished render cannot reach another
 * render: its frames are dropped (nothing will ever flush them), the document listeners it adds are removed at once
 * (its render already removed its listeners from the process-wide document; nothing else would), and its
 * unsupported selectors are logged by its own session.
 */

/** The session the code running now belongs to (see above), and its render scope; undefined outside of renders. */
function callerSession(): {session: RenderSession | undefined; scope: RenderScope | undefined} {
  const scope = renderScope.getStore();
  return scope ? {session: scope.session, scope} : {session: latestActiveSession(), scope: undefined};
}

const rafDispatcher: RafSink = {
  push(entry: RafEntry): void {
    const {session, scope} = callerSession();
    if (!session) {
      baseHooks?.raf?.push(entry);
    } else if (session.ended) {
      session.debug('requestAnimationFrame after the render ended: the frame is dropped');
    } else {
      // The callback runs in the requesting code's render scope (rejections it causes are attributed to its element).
      session.raf.push(scope ? {...entry, scope} : entry);
    }
  },
  cancel(id: number): void {
    // Frame ids are unique in the process.
    for (const session of activeSessions) {
      session.raf.cancel(id);
    }
    baseHooks?.raf?.cancel(id);
  },
};

const listenerDispatcher: ListenerLog = {
  push(record: ListenerRecord): void {
    const {session} = callerSession();
    if (!session) {
      baseHooks?.log?.push(record);
    } else if (session.ended) {
      session.debug(`document listener "${record[1]}" added after the render ended: removed`);
      removeListener(record);
    } else {
      session.listeners.push(record);
    }
  },
};

const dispatchSelectorError: SelectorErrorHandler = (selector, error) => {
  const {session} = callerSession();
  if (session) {
    session.selectorErrorHandler(selector, error);
  } else {
    baseHooks?.selector?.(selector, error);
  }
};

/** Reports structure changes the server cannot render to the render whose code made them. */
const dispatchDroppedMutation: DroppedMutationHandler = (target, operation, node) => {
  const {session} = callerSession();
  if (session) {
    reportDroppedMutation(session, target, operation, node);
  } else {
    baseHooks?.dropped?.(target, operation, node);
  }
};

function removeListener([target, type, listener, options]: ListenerRecord): void {
  try {
    target.removeEventListener(type, listener as EventListener, options as EventListenerOptions);
  } catch {
    // ignore
  }
}

function documentElement(): any {
  return (globalThis as any).document?.documentElement;
}

function readDocumentLang(): string | null {
  const root = documentElement();
  return typeof root?.getAttribute === 'function' ? root.getAttribute('lang') : null;
}

/** Sets (or, with `null`, removes) the `lang` attribute of the server document's root element. */
function writeDocumentLang(lang: string | null): void {
  const root = documentElement();
  if (typeof root?.setAttribute !== 'function' || readDocumentLang() === lang) {
    return;
  }
  if (lang === null) {
    root.removeAttribute('lang');
  } else {
    root.setAttribute('lang', lang);
  }
}

/**
 * The document language while `session` is the most recent active one: `RenderSpectrumOptions.lang` (review M7);
 * else, for whole-document templates, the template's own `<html lang>` from pass 2 on (`setDocumentLanguage`); else
 * what the document had before. Components resolve their locale from it (directly,
 * `reactive-controllers/src/LanguageResolution.js`, or through `theme/src/Theme.js`'s fallback).
 */
function sessionLang(session: RenderSession): string | null {
  return session.options.lang ?? session.documentLang ?? baseHooks?.lang ?? null;
}

/**
 * Whole-document templates (review finding, fixed): `<html lang="de">` in a template is markup, not the server
 * document's language, so such a page used to render with `navigator.language` unless `lang` was passed too. The
 * renderer reads the `lang` of the template's `<html>` from the pass-1 tree and sets it here before pass 2; it
 * applies when `options.lang` is not set.
 */
export function setDocumentLanguage(session: RenderSession, lang: string | undefined): void {
  session.documentLang = lang || undefined;
  if (!session.ended && latestActiveSession() === session) {
    writeDocumentLang(sessionLang(session));
  }
}

/** Installs the dispatching hooks while sessions are active (or restores the hooks found before any was active). */
function installHooks(session: RenderSession | undefined): void {
  if (session) {
    setRafSink(rafDispatcher);
    setListenerLog(listenerDispatcher);
    setSelectorErrorHandler(dispatchSelectorError);
    setDroppedMutationHandler(dispatchDroppedMutation);
    writeDocumentLang(sessionLang(session));
  } else {
    setRafSink(baseHooks?.raf);
    setListenerLog(baseHooks?.log);
    setSelectorErrorHandler(baseHooks?.selector);
    setDroppedMutationHandler(baseHooks?.dropped);
    writeDocumentLang(baseHooks?.lang ?? null);
    baseHooks = undefined;
  }
}

/**
 * Activates process-wide hooks for a session: the rAF sink (components queue frames from async continuations
 * too), the listener log for `document` listeners, an unsupported-selector logger, the dropped-mutation reporter
 * (all four dispatch by render scope, see above), the document language, and (once per process) the
 * `unhandledRejection` listener. Returns the deactivation function (idempotent).
 */
export function activateSession(session: RenderSession): () => void {
  if (activeSessions.size === 0) {
    baseHooks = {
      raf: setRafSink(undefined),
      log: setListenerLog(undefined),
      selector: setSelectorErrorHandler(undefined),
      dropped: setDroppedMutationHandler(undefined),
      lang: readDocumentLang(),
    };
  }
  activeSessions.delete(session);
  activeSessions.add(session);
  installHooks(session);
  installRejectionHandler();
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    session.ended = true;
    activeSessions.delete(session);
    installHooks(latestActiveSession());
    session.raf.entries.length = 0;
    session.current = undefined;
    // Remove listeners components added to process-wide singletons during the render.
    for (const record of session.listeners.splice(0)) {
      removeListener(record);
    }
    session.connected.length = 0;
  };
}

export function getActiveSession(): RenderSession | undefined {
  return latestActiveSession();
}
