/**
 * Per-render state. Everything a render needs lives in a `RenderSession` (one per `renderSpectrum()` call) and two
 * `RenderContext`s (one per pass). Renderers reach the context of the render that constructs them through a
 * module-level "current context", which `renderSpectrum()` sets only while it synchronously evaluates render
 * thunks (and restores afterwards), so nested / queued renders never see each other's state and nothing survives a
 * render.
 */
import type {RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {
  setRafSink,
  setRandomSource,
  setListenerLog,
  type ListenerRecord,
  type RafEntry,
  type RafSink,
} from '../dom-shim/hooks.js';
import {setSelectorErrorHandler} from '../dom-shim/select.js';
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

/** FNV-1a hash of a string (used to seed pass 2 from the pass-1 HTML). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class RafQueue implements RafSink {
  entries: RafEntry[] = [];

  push(entry: RafEntry): void {
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

/** State shared by both passes of one `renderSpectrum()` call. */
export class RenderSession {
  readonly raf = new RafQueue();
  readonly listeners: ListenerRecord[] = [];
  readonly options: RenderSpectrumOptions;
  readonly startedAt = performance.now();
  /** Messages that could not be attributed to an element (e.g. unhandled rejections). */
  readonly orphanWarnings: string[] = [];
  /** Report of the element whose lifecycle ran last (unhandled rejections are attributed to it). */
  lastReport: ElementReport | undefined;
  frame = 0;

  constructor(options: RenderSpectrumOptions) {
    this.options = options;
  }

  debug(...args: unknown[]): void {
    if (this.options.debug) {
      console.debug('[swc-ssr]', ...args);
    }
  }
}

export interface RenderStacks {
  customElementInstanceStack: any[];
  customElementHostStack: any[];
  eventTargetStack: any[];
  slotStack: any[];
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
    readonly previous?: RenderContext,
    readonly tree?: ServerTree,
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
   * (the host whose shadow is being rendered, or the document) plus the tag and its ordinal within that scope.
   * Same-tag elements keep their key even if a component wraps or adds other elements in its shadow between
   * passes, and a change inside one shadow root never shifts the keys of elements elsewhere.
   */
  nextKey(tag: string): string {
    const host = this.stacks.customElementHostStack.at(-1);
    const scope = host === undefined ? '' : this.keyOfRenderer(host);
    let counters = this.counters.get(scope);
    if (!counters) {
      counters = new Map();
      this.counters.set(scope, counters);
    }
    const ordinal = counters.get(tag) ?? 0;
    counters.set(tag, ordinal + 1);
    return `${scope}>${tag}:${ordinal}`;
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

  /** Effective lifecycle for a tag: explicit per-tag option > min(global option, adapter default). */
  lifecycleFor(tag: string, adapterMode: LifecycleMode | undefined): LifecycleMode {
    const explicit = this.options.lifecycleByTag?.[tag];
    const mode = explicit ?? minMode(this.options.lifecycle ?? 'full', adapterMode ?? 'full');
    // Pass 1 only collects structure: never more than `connected`.
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
 */
export function runInContext<T>(context: RenderContext, fn: () => T): T {
  const previousContext = currentContext;
  const previousRandom = setRandomSource(context.random);
  const previousRaf = setRafSink(context.session.raf);
  currentContext = context;
  try {
    return fn();
  } finally {
    currentContext = previousContext;
    setRandomSource(previousRandom);
    setRafSink(previousRaf);
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Session activation (process-wide hooks that must be in place for the whole duration of a render)
 * ------------------------------------------------------------------------------------------------------------ */

let activeSession: RenderSession | undefined;
/** The last session that ended; unhandled rejections are reported after the microtask checkpoint it ended in. */
let lingeringSession: RenderSession | undefined;
let rejectionHandlerInstalled = false;
let activeCount = 0;

function onUnhandledRejection(reason: unknown): void {
  const session = activeSession ?? lingeringSession;
  if (!session) {
    // Not ours. If the application has its own handler, leave it to that one; otherwise keep Node's default
    // behaviour (an unhandled rejection is fatal).
    if (process.listenerCount('unhandledRejection') > 1) {
      return;
    }
    throw reason;
  }
  const message = `unhandled rejection: ${errorMessage(reason)}`;
  if (session.lastReport) {
    session.lastReport.warnings.push(message);
  } else {
    session.orphanWarnings.push(message);
  }
}

/**
 * Activates process-wide hooks for a session: the rAF sink (components queue frames from async continuations
 * too), the listener log for `document` listeners, an unsupported-selector logger, and an `unhandledRejection`
 * handler (component code runs asynchronously during the render; a stray rejection must not crash the server).
 * Returns the deactivation function.
 */
export function activateSession(session: RenderSession): () => void {
  const previousSession = activeSession;
  const previousRaf = setRafSink(session.raf);
  const previousLog = setListenerLog(session.listeners);
  activeSession = session;
  activeCount++;
  setSelectorErrorHandler((selector, error) => {
    session.debug(`unsupported selector "${selector}": ${errorMessage(error)}`);
  });
  if (!rejectionHandlerInstalled) {
    process.on('unhandledRejection', onUnhandledRejection);
    rejectionHandlerInstalled = true;
  }
  return () => {
    activeSession = previousSession;
    setRafSink(previousRaf);
    setListenerLog(previousLog);
    setSelectorErrorHandler(undefined);
    session.raf.entries.length = 0;
    // Remove listeners components added to process-wide singletons during the render.
    for (const [target, type, listener, options] of session.listeners.splice(0)) {
      try {
        target.removeEventListener(type, listener as EventListener, options as EventListenerOptions);
      } catch {
        // ignore
      }
    }
    activeCount--;
    lingeringSession = session;
    // Rejections are reported after the current microtask checkpoint; keep the handler until then.
    setImmediate(() => {
      if (lingeringSession === session) {
        lingeringSession = undefined;
      }
      if (activeCount === 0 && rejectionHandlerInstalled) {
        process.off('unhandledRejection', onUnhandledRejection);
        rejectionHandlerInstalled = false;
      }
    });
  };
}

export function getActiveSession(): RenderSession | undefined {
  return activeSession;
}
