/**
 * `renderSpectrum()`: the two-pass render on top of unmodified `@lit-labs/ssr`.
 *
 *  1. Pass 1 renders the value with the Spectrum renderers in "collect" mode (minimal lifecycle, every element
 *     marked with `data-swc-ssr` and its attributes/properties recorded).
 *  2. The pass-1 HTML is parsed into a `ServerTree`; every pass-1 element is pre-instantiated with light-DOM /
 *     shadow facades backed by the tree and connected (document order), then the document-wide `full`
 *     lifecycle runs (first updates in document order, animation frames, re-updates; see lifecycle.ts).
 *  3. Pass 2 renders the value again; renderers adopt the pre-instantiated elements (matched by a structural
 *     key: tree scope + tag + static attributes + ordinal, see `RenderContext.nextKey`) and render their final
 *     state. A third pass (built on the pass-2 tree) is made when elements that only appeared in pass 2 failed
 *     there, or when an element was updated after its markup had been emitted (`findLateUpdates`).
 *  4. Markers are stripped (unless `debug`) and a per-element report is returned.
 *
 * Renders are serialized (one at a time per process). A render started from inside another render - from its
 * synchronous code or from asynchronous work it started (a directive, a component) - runs immediately (nested)
 * instead of waiting in the queue behind the render that waits for it. Every render has a deadline
 * (`timeoutMs`), after which the queue moves on.
 */
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {renderThunked} from '@lit-labs/ssr/lib/render.js';
import {FallbackRenderer, type ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import type {RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ThunkedRenderResult} from '@lit-labs/ssr/lib/render-result.js';
import {_$LE} from 'lit-element/private-ssr-support.js';
import {installSpectrumDomShim} from '../dom-shim/index.js';
import {
  activateSession,
  getCurrentRenderContext,
  getRenderScope,
  hashString,
  runInContext,
  runInRenderScope,
  RenderContext,
  RenderSession,
  errorMessage,
  setDocumentLanguage,
  timerDelay,
} from './context.js';
import {controllersOf, disconnectAll, hasPendingUpdate, isManaged, runDocumentLifecycle} from './lifecycle.js';
import {needsAdoptionCheck, verifyAdoptions} from './plan.js';
import {TreeRealm} from './realm.js';
import {MARKER_ATTRIBUTE, ServerTree} from './server-tree.js';
import {awaitLazyDefinitions, finalizeHtml, takeTextareaContent} from './materialize.js';
import {applyLightMutations} from './light-mutations.js';
import {SpectrumElementRenderer} from './spectrum-element-renderer.js';
import {ThemeRenderer} from './theme-renderer.js';
import {inspectors} from './adapters/registry.js';
import type {ElementReport, RenderReport, RenderSpectrumOptions, RenderSpectrumResult} from './types.js';
import './adapters/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const spectrumElementRenderers: ElementRendererConstructor[] = [
  ThemeRenderer as unknown as ElementRendererConstructor,
  SpectrumElementRenderer as unknown as ElementRendererConstructor,
];

const MARKER_RE = new RegExp(` ${MARKER_ATTRIBUTE}="\\d+"`, 'g');

const {changedProperties} = _$LE as unknown as {changedProperties: (element: unknown) => Map<PropertyKey, unknown>};

/**
 * Collects a thunked render result into a string. Thunks are evaluated synchronously inside the render
 * context (so renderers constructed by upstream find it); only real Promises (from async lifecycle work or async
 * directives) are awaited, with the context released while waiting.
 */
async function collect(result: unknown, context: RenderContext): Promise<string> {
  let out = '';
  // Text content for a <textarea> whose `.value` binding was just rendered: goes right after its start tag.
  let textareaContent: string | undefined;
  const stack: Array<{items: unknown[]; index: number}> = [{items: [result], index: 0}];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.items.length) {
      stack.pop();
      continue;
    }
    let value = frame.items[frame.index++];
    if (typeof value === 'function') {
      value = runInContext(context, () => {
        let current = value;
        while (typeof current === 'function') {
          current = (current as () => unknown)();
        }
        return current;
      });
      textareaContent = takeTextareaContent() ?? textareaContent;
    }
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      if (textareaContent !== undefined) {
        const end = value.indexOf('>');
        if (end !== -1) {
          value = value.slice(0, end + 1) + textareaContent + value.slice(end + 1);
          textareaContent = undefined;
        }
      }
      out += value;
      continue;
    }
    if (Array.isArray(value)) {
      stack.push({items: value, index: 0});
      continue;
    }
    if (typeof (value as PromiseLike<unknown>).then === 'function') {
      const resolved = await (value as PromiseLike<unknown>);
      // The render's deadline may have passed while waiting: stop here (see `withDeadline`).
      context.session.checkAborted();
      stack.push({items: [resolved], index: 0});
      continue;
    }
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
      stack.push({items: [...(value as Iterable<unknown>)], index: 0});
      continue;
    }
    throw new Error(`Unexpected value in render result: ${String(value)}`);
  }
  return out;
}

/**
 * Review finding (fixed): renderer for every other custom element - non-Lit custom elements such as
 * `sp-tooltip-openable`, which `tooltip/src/Tooltip.js` renders in its shadow root - instead of upstream's
 * `FallbackRenderer` (same output: the attributes, no shadow root). `@lit-labs/ssr` 4.1.0 pushes every custom
 * element onto `customElementHostStack` before calling `renderShadow()` and pops it only when that returned a shadow
 * (`custom-element-shadow` in `lib/render-value.js`). `FallbackRenderer.renderShadow()` returns `undefined`, so its
 * element stayed on the stack (popped instead of its real host when that host's shadow ended), and every element
 * rendered after it - e.g. everything after an `<sp-tooltip>` - counted as nested in that host: keyed in its scope,
 * `__host` = the tooltip, a `defer-hydration` attribute and a `<!--lit-node-->` marker it should not get. This
 * renderer pops the stack itself, like `SpectrumElementRenderer` does for `disableSsr` elements.
 */
export class FallbackElementRenderer extends FallbackRenderer {
  static override matchesClass(): boolean {
    return true;
  }

  override renderShadow(renderInfo: RenderInfo): ThunkedRenderResult | undefined {
    renderInfo.customElementHostStack.pop();
    return undefined;
  }
}

function renderersFor(options: RenderSpectrumOptions): ElementRendererConstructor[] {
  return [
    ...(options.elementRenderers ?? []),
    ...spectrumElementRenderers,
    LitElementRenderer as unknown as ElementRendererConstructor,
    FallbackElementRenderer as unknown as ElementRendererConstructor,
  ];
}

/**
 * Report of the final pass. Errors caught in earlier passes are kept as warnings prefixed with the pass number:
 * those passes only collect structure (pass 1 has no light-DOM information, so e.g. a render() that needs its
 * children may legitimately fail there) and do not contribute to the output.
 */
function buildReport(session: RenderSession, passes: RenderContext[]): RenderReport {
  const final = passes[passes.length - 1];
  const earlier = passes.slice(0, -1);
  const elements: ElementReport[] = [];
  const earlierMessages = (key: string): string[] => {
    const messages: string[] = [];
    for (const context of earlier) {
      const report = context.reportsByKey.get(key);
      if (report) {
        messages.push(...report.errors.map((m) => `pass ${context.pass}: ${m}`));
        messages.push(...report.warnings.map((m) => `pass ${context.pass}: ${m}`));
      }
    }
    return messages;
  };
  for (const [key, report] of final.reportsByKey) {
    const merged: ElementReport = {
      id: report.id,
      tagName: report.tagName,
      errors: [...report.errors],
      warnings: [...earlierMessages(key), ...report.warnings],
      fallback: report.fallback,
    };
    if (report.id === -1) {
      // Pre-instantiated from the previous pass but not rendered: only reported if something happened.
      if (merged.errors.length === 0 && merged.warnings.length === 0) {
        continue;
      }
      merged.warnings.push(`pre-instantiated from pass ${final.pass - 1} but not rendered in pass ${final.pass}`);
    }
    elements.push(merged);
  }
  const seen = new Set(final.reportsByKey.keys());
  for (const context of earlier) {
    for (const [key, report] of context.reportsByKey) {
      if (seen.has(key) || (report.errors.length === 0 && report.warnings.length === 0)) {
        continue;
      }
      seen.add(key);
      elements.push({
        id: -1,
        tagName: report.tagName,
        errors: [],
        warnings: [...earlierMessages(key), `not part of the final output (pass ${final.pass})`],
        fallback: false,
      });
    }
  }
  if (session.orphanWarnings.length > 0) {
    elements.push({id: -1, tagName: '#render', errors: [], warnings: [...session.orphanWarnings], fallback: false});
  }
  elements.sort((a, b) => (a.id === -1 ? (b.id === -1 ? 0 : 1) : b.id === -1 ? -1 : a.id - b.id));
  return {
    elements,
    passes: final.pass,
    durationMs: Math.round((performance.now() - session.startedAt) * 100) / 100,
  };
}

/** Default of `RenderSpectrumOptions.lazyDefinitionWaitMs`. */
const LAZY_DEFINITION_WAIT_MS = 250;

/** Default of `RenderSpectrumOptions.timeoutMs`. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** At most one extra pass is made (see the file comment). */
const MAX_PASSES = 3;

/**
 * Review L2: elements of a managed (`full`) lifecycle whose markup this pass emitted but that were updated
 * afterwards (`requestUpdate` from another element's lifecycle, an async continuation, ...): the output shows their
 * earlier state. Each gets a warning naming the changed properties; the caller makes one more pass (within
 * `MAX_PASSES`), in which their lifecycle runs before anything is rendered.
 */
function findLateUpdates(context: RenderContext, willRetry: boolean): number {
  let late = 0;
  for (const {element, report} of context.rendered) {
    if (!isManaged(element) || !hasPendingUpdate(element)) {
      continue;
    }
    late++;
    const names = [...changedProperties(element).keys()].map((name) => String(name));
    report.warnings.push(
      `updated after its markup was emitted in pass ${context.pass}` +
        (names.length > 0 ? ` (changed: ${names.join(', ')})` : '') +
        (willRetry ? '; another pass is made' : '; the output shows the earlier state')
    );
  }
  return late;
}

/** Runs the inspectors (adapters/registry.ts) over the elements of the final pass. */
function inspect(context: RenderContext): void {
  const list = inspectors();
  if (list.length === 0) {
    return;
  }
  for (const {element, report} of context.rendered) {
    const inspectorContext = {report, options: context.options, controllers: controllersOf(element)};
    for (const inspector of list) {
      try {
        inspector(element, inspectorContext);
      } catch (error) {
        report.warnings.push(`inspector: ${errorMessage(error)}`);
      }
    }
  }
}

/** Progress of a render: the passes that completed and the output of the last one. */
interface RenderProgress {
  passes: RenderContext[];
  html: string | undefined;
  /** Every context created by this render (also a repeated pass 1 and a pass that failed), disposed at the end. */
  created: RenderContext[];
}

/**
 * Resolves true when `work` settles in time, false at the deadline (`work` keeps running; its result is ignored).
 * No deadline for 0, negative values, NaN, Infinity and anything beyond the longest timer delay (`timerDelay`).
 */
function withDeadline(work: Promise<void>, timeoutMs: number): Promise<boolean> {
  const delay = timeoutMs > 0 ? timerDelay(timeoutMs) : undefined;
  if (delay === undefined) {
    return work.then(() => true);
  }
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), delay);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** All passes of a render. Updates `progress` after every completed pass. */
async function runPasses(value: unknown, session: RenderSession, progress: RenderProgress): Promise<void> {
  const {options} = session;
  const renderers = renderersFor(options);
  const newContext = (...args: ConstructorParameters<typeof RenderContext>): RenderContext => {
    const context = new RenderContext(...args);
    progress.created.push(context);
    session.pass = context.pass;
    session.current = context;
    return context;
  };
  // Pass 1: collect structure.
  let first = newContext(session, 1);
  let html = await collect(
    runInContext(first, () => renderThunked(value, first.renderInfo(renderers))),
    first
  );
  // Components that import what they render lazily (e.g. sp-slider -> sp-number-field) rendered those elements
  // as plain tags; if their definitions arrive shortly, collect the structure again with them. Only tags that were
  // undefined when rendered are waited for, each at most once per process (review M6: configurable).
  if (await awaitLazyDefinitions(session, options.lazyDefinitionWaitMs ?? LAZY_DEFINITION_WAIT_MS)) {
    session.checkAborted();
    session.debug('pass 1 repeated: lazily imported definitions arrived');
    first = newContext(session, 1);
    html = await collect(
      runInContext(first, () => renderThunked(value, first.renderInfo(renderers))),
      first
    );
  }
  progress.passes.push(first);
  progress.html = html;
  session.debug(`pass 1: ${first.records.size} elements, ${html.length} chars`);

  // Pass 2 (and possibly 3): render with the light-DOM / shadow information of the previous pass.
  /** The previous pass's output, parsed already (to verify its adoptions). */
  let parsed: ServerTree | undefined;
  for (let pass = 2; pass <= MAX_PASSES; pass++) {
    session.checkAborted();
    const previous = progress.passes[progress.passes.length - 1];
    let tree: ServerTree;
    try {
      tree = parsed ?? new ServerTree(html);
    } catch (error) {
      session.orphanWarnings.push(`could not parse the pass-${previous.pass} HTML: ${errorMessage(error)}`);
      break;
    }
    parsed = undefined;
    if (options.lang === undefined) {
      // A whole-document template's own `<html lang>` is the document language from now on (see context.ts).
      setDocumentLanguage(session, tree.documentLanguage());
    }
    const context = newContext(session, pass, previous, tree, hashString(html));
    context.realm = new TreeRealm(context, tree);
    const pooled = runInContext(context, () => context.realm!.preinstantiate());
    session.debug(`pass ${pass}: ${pooled.length} elements pre-instantiated`);
    await runDocumentLifecycle(context, pooled);
    html = await collect(
      runInContext(context, () => renderThunked(value, context.renderInfo(renderers))),
      context
    );
    progress.passes.push(context);
    progress.html = html;
    session.debug(`pass ${pass}: ${context.nextId} elements, ${html.length} chars`);
    const canRetry = pass < MAX_PASSES;
    // Elements without tree information that failed (e.g. a component that reads its own shadow DOM in
    // firstUpdated() but whose shadow content only appeared in this pass), elements updated after their markup
    // was emitted, and elements that adopted another element's previous-pass instance (see `verifyAdoptions`)
    // get one more pass.
    const failedUntracked = context.untracked.some((report) => report.errors.length > 0);
    const late = findLateUpdates(context, canRetry);
    let rejected = 0;
    if (needsAdoptionCheck(context)) {
      try {
        parsed = new ServerTree(html);
        rejected = verifyAdoptions(context, parsed, canRetry);
      } catch (error) {
        parsed = undefined;
        session.orphanWarnings.push(`could not verify the elements of pass ${pass}: ${errorMessage(error)}`);
      }
    }
    if (!failedUntracked && late === 0 && rejected === 0) {
      break;
    }
  }
}

async function renderNow(value: unknown, options: RenderSpectrumOptions): Promise<RenderSpectrumResult> {
  installSpectrumDomShim();
  const session = new RenderSession(options);
  // Everything the render starts (also asynchronously) runs in its scope (see context.ts `RenderScope`).
  return runInRenderScope(session, () => renderSession(value, session));
}

async function renderSession(value: unknown, session: RenderSession): Promise<RenderSpectrumResult> {
  const {options} = session;
  const deactivate = activateSession(session);
  const progress: RenderProgress = {passes: [], html: undefined, created: []};
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const work = runPasses(value, session, progress);
    const settled = await withDeadline(work, timeoutMs);
    // A snapshot: abandoned work could otherwise still add a pass.
    const passes = [...progress.passes];
    let html = progress.html;
    if (!settled) {
      // Review M6: the render did not settle in time (e.g. a template awaits a promise that never settles). Its
      // remaining work stops at its next step; the output of the last completed pass is used.
      session.aborted = true;
      const abandoned = session.pass;
      if (passes.length === 0 || html === undefined) {
        throw new Error(`renderSpectrum: the render did not settle within ${timeoutMs} ms (pass 1 did not complete)`);
      }
      session.orphanWarnings.push(
        `the render did not settle within ${timeoutMs} ms: pass ${abandoned} was abandoned, ` +
          `the output of pass ${passes[passes.length - 1].pass} is used`
      );
    }
    const last = passes[passes.length - 1];
    if (last.realm && last.realm.lightMutations.size > 0) {
      try {
        const realm = last.realm;
        html = applyLightMutations(
          html!,
          realm.lightMutations,
          realm.tree,
          (host) => {
            const instance = realm.facadeOf(host);
            const report = instance ? last.reportOfInstance(instance) : undefined;
            return report === undefined || report.id < 0 ? undefined : report.id;
          },
          (message, host) => {
            const instance = host ? realm.facadeOf(host) : undefined;
            const report = instance ? last.reportOfInstance(instance) : undefined;
            (report ? report.warnings : session.orphanWarnings).push(message);
          }
        );
      } catch (error) {
        session.orphanWarnings.push(`could not apply light-DOM attribute changes: ${errorMessage(error)}`);
      }
    }
    // Before the elements are disconnected (their controllers still hold what they resolved).
    inspect(last);
    // The rendered tree is discarded: disconnect its elements (every pass) before reporting, so errors of
    // `disconnectedCallback`s end up in the report (see `disconnectAll` for the retention path this closes).
    runInContext(last, () => disconnectAll(session));
    // Let the event loop turn once while the session is still active, so that what the render left behind runs
    // now, attributed to this render: zero-delay timers components scheduled (e.g. `iconset/src/
    // iconset-registry.js` dispatches its added/removed events from `setTimeout(..., 0)`, holding the iconset),
    // late promise continuations (their rejections become report warnings) and Node's processing of pending
    // rejections. Retention path (fixed): renders queued behind each other run in one microtask chain, in which
    // none of this ever ran, so every queued render stayed reachable from timers / pending rejections until the
    // queue drained.
    session.lastReport = undefined;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return {
      html: finalizeHtml(options.debug ? html! : html!.replace(MARKER_RE, '')),
      report: buildReport(session, passes),
    };
  } finally {
    // Also when the render failed. Nothing of the render may stay reachable from process-wide state.
    try {
      disconnectAll(session);
    } finally {
      for (const context of progress.created) {
        context.dispose();
      }
      deactivate();
    }
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Whether the caller runs inside a render that is still in progress: synchronously (a renderer / directive) or in
 * asynchronous work the render started (its `AsyncLocalStorage` scope). Such a call must not wait in the queue
 * behind the render that waits for it (review M6: that deadlocked every later render).
 */
function isNested(): boolean {
  if (getCurrentRenderContext() !== undefined) {
    return true;
  }
  const scope = getRenderScope();
  return !!scope && !scope.session.ended;
}

export function renderSpectrum(value: unknown, options: RenderSpectrumOptions = {}): Promise<RenderSpectrumResult> {
  if (isNested()) {
    // Called from inside a render: run nested, the outer render's state is restored afterwards.
    return renderNow(value, options);
  }
  const run = queue.then(() => renderNow(value, options));
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
