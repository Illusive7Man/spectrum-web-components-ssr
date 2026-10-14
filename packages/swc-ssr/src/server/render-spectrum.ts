/**
 * `renderSpectrum()`: the two-pass render on top of unmodified `@lit-labs/ssr`.
 *
 *  1. Pass 1 renders the value with the Spectrum renderers in "collect" mode (minimal lifecycle, every element
 *     marked with `data-swc-ssr` and its attributes/properties recorded).
 *  2. The pass-1 HTML is parsed into a `ServerTree`; every pass-1 element is pre-instantiated with light-DOM /
 *     shadow facades backed by the tree and connected (document order), then the document-wide `full`
 *     lifecycle runs (first updates in document order, animation frames, re-updates; see lifecycle.ts).
 *  3. Pass 2 renders the value again; renderers adopt the pre-instantiated elements (matched by a structural
 *     key: tree scope + tag + ordinal, see `RenderContext.nextKey`) and render their final state.
 *     Elements that only appeared in pass 2 (e.g. a component rendering different shadow content once it knows
 *     its light DOM) have no tree information; if one of them failed, a third pass builds on the pass-2 tree.
 *  4. Markers are stripped (unless `debug`) and a per-element report is returned.
 *
 * Renders are serialized (one at a time per process); a render started from inside another render's
 * synchronous code runs immediately (nested), with the outer context saved and restored around it.
 */
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {renderThunked} from '@lit-labs/ssr/lib/render.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {installSpectrumDomShim} from '../dom-shim/index.js';
import {
  activateSession,
  getCurrentRenderContext,
  hashString,
  runInContext,
  RenderContext,
  RenderSession,
  errorMessage,
} from './context.js';
import {runDocumentLifecycle} from './lifecycle.js';
import {TreeRealm} from './realm.js';
import {MARKER_ATTRIBUTE, ServerTree} from './server-tree.js';
import {awaitLazyDefinitions, finalizeHtml, takeTextareaContent} from './materialize.js';
import {applyLightMutations} from './light-mutations.js';
import {SpectrumElementRenderer} from './spectrum-element-renderer.js';
import {ThemeRenderer} from './theme-renderer.js';
import type {ElementReport, RenderReport, RenderSpectrumOptions, RenderSpectrumResult} from './types.js';
import './adapters/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const spectrumElementRenderers: ElementRendererConstructor[] = [
  ThemeRenderer as unknown as ElementRendererConstructor,
  SpectrumElementRenderer as unknown as ElementRendererConstructor,
];

const MARKER_RE = new RegExp(` ${MARKER_ATTRIBUTE}="\\d+"`, 'g');

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

function renderersFor(options: RenderSpectrumOptions): ElementRendererConstructor[] {
  return [
    ...(options.elementRenderers ?? []),
    ...spectrumElementRenderers,
    LitElementRenderer as unknown as ElementRendererConstructor,
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

/** How long a render waits (once per tag and process) for definitions its components import lazily. */
const LAZY_DEFINITION_WAIT_MS = 250;

/** At most one extra pass is made, and only when elements without tree information failed in the last one. */
const MAX_PASSES = 3;

async function renderNow(value: unknown, options: RenderSpectrumOptions): Promise<RenderSpectrumResult> {
  installSpectrumDomShim();
  const session = new RenderSession(options);
  const deactivate = activateSession(session);
  const renderers = renderersFor(options);
  const passes: RenderContext[] = [];
  try {
    // Pass 1: collect structure.
    let first = new RenderContext(session, 1);
    let html = await collect(
      runInContext(first, () => renderThunked(value, first.renderInfo(renderers))),
      first
    );
    // Components that import what they render lazily (e.g. sp-slider -> sp-number-field) rendered those elements
    // as plain tags; if their definitions arrive shortly, collect the structure again with them.
    if (await awaitLazyDefinitions(LAZY_DEFINITION_WAIT_MS)) {
      session.debug('pass 1 repeated: lazily imported definitions arrived');
      first = new RenderContext(session, 1);
      html = await collect(
        runInContext(first, () => renderThunked(value, first.renderInfo(renderers))),
        first
      );
    }
    passes.push(first);
    session.debug(`pass 1: ${first.records.size} elements, ${html.length} chars`);

    // Pass 2 (and possibly 3): render with the light-DOM / shadow information of the previous pass.
    for (let pass = 2; pass <= MAX_PASSES; pass++) {
      const previous = passes[passes.length - 1];
      let tree: ServerTree;
      try {
        tree = new ServerTree(html);
      } catch (error) {
        session.orphanWarnings.push(`could not parse the pass-${previous.pass} HTML: ${errorMessage(error)}`);
        break;
      }
      const context = new RenderContext(session, pass, previous, tree, hashString(html));
      context.realm = new TreeRealm(context, tree);
      const pooled = runInContext(context, () => context.realm!.preinstantiate());
      session.debug(`pass ${pass}: ${pooled.length} elements pre-instantiated`);
      await runDocumentLifecycle(context, pooled);
      html = await collect(
        runInContext(context, () => renderThunked(value, context.renderInfo(renderers))),
        context
      );
      passes.push(context);
      session.debug(`pass ${pass}: ${context.nextId} elements, ${html.length} chars`);
      // Elements without tree information that failed (e.g. a component that reads its own shadow DOM in
      // firstUpdated() but whose shadow content only appeared in this pass) get one more pass.
      if (!context.untracked.some((report) => report.errors.length > 0)) {
        break;
      }
    }
    const last = passes[passes.length - 1];
    if (last.realm && last.realm.lightMutations.size > 0) {
      try {
        const realm = last.realm;
        html = applyLightMutations(html, realm.lightMutations, realm.tree, (host) => {
          const instance = realm.facadeOf(host);
          const key = instance ? last.keyByInstance.get(instance) : undefined;
          const id = key === undefined ? undefined : last.reportsByKey.get(key)?.id;
          return id === undefined || id < 0 ? undefined : id;
        });
      } catch (error) {
        session.orphanWarnings.push(`could not apply light-DOM attribute changes: ${errorMessage(error)}`);
      }
    }
    return {
      html: finalizeHtml(options.debug ? html : html.replace(MARKER_RE, '')),
      report: buildReport(session, passes),
    };
  } finally {
    deactivate();
  }
}

let queue: Promise<unknown> = Promise.resolve();

export function renderSpectrum(value: unknown, options: RenderSpectrumOptions = {}): Promise<RenderSpectrumResult> {
  if (getCurrentRenderContext() !== undefined) {
    // Called from inside a render (e.g. a directive): run nested, the outer context is restored afterwards.
    return renderNow(value, options);
  }
  const run = queue.then(() => renderNow(value, options));
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
