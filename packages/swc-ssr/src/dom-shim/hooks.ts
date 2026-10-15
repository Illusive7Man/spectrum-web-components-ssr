/**
 * Internal hooks shared between the DOM shim extras (`swc-ssr/dom-shim`) and the server renderer
 * (`swc-ssr/server`). Nothing in here is Spectrum-specific.
 *
 * The shim extras only define *defaults* (empty light DOM, no-op rAF sink, real randomness). The server
 * renderer plugs per-render behaviour into these hooks while it renders and removes it afterwards, so no state
 * survives a render.
 */

/**
 * Per-node "structure backing". When an element / text node / shadow root / slot carries one (as an own,
 * non-enumerable property set with `Object.defineProperty`), the light-DOM API defined by the shim extras on the
 * prototypes (`childNodes`, `parentNode`, `querySelector`, `assignedNodes`, ...) is answered from it. Elements
 * without a backing get the empty defaults (no children, no parent), which is exactly what upstream Lit SSR
 * assumes today.
 */
export const BACKING: unique symbol = Symbol.for('swc-ssr.backing') as never;

export interface StructureBacking {
  /** Child nodes (elements and text nodes; comments are never exposed). Callers must not mutate the result. */
  childNodes(): unknown[];
  /** Parent node: an element, a shadow root, or null at the top of a tree. */
  parentNode(): unknown | null;
  /** Whether the node counts as connected (rendered nodes are, detached clones are not). */
  isConnected?(): boolean;
  /** The slot this node is assigned to (element / text nodes in a host's light DOM). */
  assignedSlot?(): unknown | null;
  /** For `<slot>` nodes: assigned nodes (flattened when requested, including fallback content). */
  assignedNodes?(flatten: boolean): unknown[];
  /** Mutation support (detached nodes only). Tree-backed nodes ignore mutations. */
  insertBefore?(node: unknown, ref: unknown | null): void;
  removeChild?(node: unknown): void;
  /** Set the parent of a detached node (called by `insertBefore` of the new parent). */
  setParent?(parent: unknown | null): void;
}

type ConstructionHook = (element: object) => StructureBacking | undefined;

let constructionHook: ConstructionHook | undefined;

/**
 * While a custom element is being constructed by the server renderer, light-DOM calls made from inside its
 * constructor (e.g. `this.querySelector(':scope > [slot="icon"]')` in
 * `@spectrum-web-components/shared/src/observe-slot-presence.js`) happen before the renderer can install the
 * backing on the new instance. The renderer therefore registers a one-shot hook that installs the backing on the
 * first element that asks for it ("upgrade" semantics: the element already has its children when it is created).
 */
export function setConstructionHook(hook: ConstructionHook | undefined): ConstructionHook | undefined {
  const previous = constructionHook;
  constructionHook = hook;
  return previous;
}

export function getBacking(node: object): StructureBacking | undefined {
  const own = (node as {[BACKING]?: StructureBacking})[BACKING];
  if (own !== undefined) {
    return own;
  }
  if (constructionHook !== undefined) {
    return constructionHook(node);
  }
  return undefined;
}

export function setBacking(node: object, backing: StructureBacking): void {
  Object.defineProperty(node, BACKING, {value: backing, configurable: true, enumerable: false, writable: true});
}

/* ------------------------------------------------------------------------------------------------------------ *
 * requestAnimationFrame sink
 * ------------------------------------------------------------------------------------------------------------ */

export interface RafEntry {
  id: number;
  callback: FrameRequestCallback;
}

export interface RafSink {
  push(entry: RafEntry): void;
  cancel(id: number): void;
}

let rafSink: RafSink | undefined;
let rafIds = 0;

/**
 * The shim's `requestAnimationFrame` queues callbacks into the sink of the render that is in progress (the
 * renderer flushes them synchronously, frame by frame). Outside of a render callbacks are dropped: nothing would
 * ever run them and keeping them would retain the elements they close over.
 */
export function setRafSink(sink: RafSink | undefined): RafSink | undefined {
  const previous = rafSink;
  rafSink = sink;
  return previous;
}

export function requestFrame(callback: FrameRequestCallback): number {
  const id = ++rafIds;
  rafSink?.push({id, callback});
  return id;
}

export function cancelFrame(id: number): void {
  rafSink?.cancel(id);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------------------------------------------------ */

let randomSource: ((array: Uint8Array) => void) | undefined;

/**
 * `crypto.getRandomValues` is wrapped by the shim. While a source is set (the server renderer sets one only for
 * the *synchronous* parts of a render, so no unrelated code can observe it) the wrapper fills typed arrays from it,
 * which makes ids generated by components (`shared/src/random-id.js`) deterministic per render.
 */
export function setRandomSource(source: ((array: Uint8Array) => void) | undefined): typeof randomSource {
  const previous = randomSource;
  randomSource = source;
  return previous;
}

export function getRandomSource(): typeof randomSource {
  return randomSource;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Listener bookkeeping
 * ------------------------------------------------------------------------------------------------------------ */

export type ListenerRecord = [target: EventTarget, type: string, listener: unknown, options: unknown];
let listenerLog: ListenerRecord[] | undefined;

/**
 * Listeners that components add to process-wide singletons (`document`, `window`) while a render is in progress
 * are logged here so the renderer can remove them when the render is over; otherwise every render would leak its
 * element instances through those singletons.
 */
export function setListenerLog(log: ListenerRecord[] | undefined): ListenerRecord[] | undefined {
  const previous = listenerLog;
  listenerLog = log;
  return previous;
}

export function logListener(record: ListenerRecord): void {
  listenerLog?.push(record);
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Dropped mutations
 * ------------------------------------------------------------------------------------------------------------ */

/**
 * `operation` was called on `target`, a node whose structure comes from a server tree (or that was rendered without
 * one): such nodes cannot be mutated, the call had no effect. `node` is the node that was to be inserted / removed.
 */
export type DroppedMutationHandler = (target: object, operation: string, node?: unknown) => void;

let droppedMutationHandler: DroppedMutationHandler | undefined;

/**
 * The server renderer sets a handler while a render is in progress, so that structure changes components make at
 * runtime (e.g. `sp-table` inserting checkbox cells into its rows) are reported instead of silently missing from
 * the output. Returns the previous handler.
 */
export function setDroppedMutationHandler(handler: DroppedMutationHandler | undefined): DroppedMutationHandler | undefined {
  const previous = droppedMutationHandler;
  droppedMutationHandler = handler;
  return previous;
}

export function reportDroppedMutation(target: object, operation: string, node?: unknown): void {
  droppedMutationHandler?.(target, operation, node);
}
