/**
 * Component-owned light DOM that a component creates imperatively (`document.createElement()` +
 * `insertAdjacentElement()`) instead of returning it from its template: the generic DOM shim keeps rendered trees
 * immutable, so such insertions are dropped from the page. An adapter can recognize them (`handlesMutation`) and hand
 * the created content back as Lit values (`lightDomInsertions`); this module renders those values through the normal
 * two-pass pipeline after the page's final pass and splices the markup in front of each target's light DOM.
 *
 * `sp-table`'s selection checkbox cells are the built-in user (`adapters/table.ts`).
 */
import {renderValue, type RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';
import {html as litHtml} from 'lit-html';
import {RenderContext, errorMessage, runInContext} from './context.js';
import {runDocumentLifecycle} from './lifecycle.js';
import {TreeRealm} from './realm.js';
import {ServerTree} from './server-tree.js';
import {stripSupplementalTemplateMarkers} from './materialize.js';
import {applyEdits, lightMutationEdits, type Edit} from './light-mutations.js';
import {findAdapter} from './adapters/registry.js';
import type {ElementReport, LightDomInsertion} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Collects the output of a thunked render into a string (the page renderer's implementation is passed in). */
export type CollectOutput = (result: unknown, context: RenderContext) => Promise<string>;

const LIGHT_INSERTION_ATTRIBUTE = 'data-swc-ssr-light-insertion';

interface PlannedLightDomInsertion extends LightDomInsertion {
  targetId: number;
  owner: ElementReport;
}

/** Collects final-pass adapter insertions and resolves their target instances to final-pass marker ids. */
export function planLightDomInsertions(context: RenderContext): PlannedLightDomInsertion[] {
  const planned: PlannedLightDomInsertion[] = [];
  // Supplemental elements rendered below are appended to `context.rendered`; only adapters of the original pass run.
  for (const {element, report} of [...context.rendered]) {
    const adapter = findAdapter(element.localName);
    const hook = adapter?.lightDomInsertions;
    if (!hook) {
      continue;
    }
    let insertions: LightDomInsertion[];
    try {
      insertions = Array.from(hook.call(adapter, element) ?? []);
    } catch (error) {
      report.errors.push(`adapter lightDomInsertions: ${errorMessage(error)}`);
      continue;
    }
    for (const insertion of insertions) {
      const target = insertion?.target;
      if (insertion?.position !== undefined && insertion.position !== 'afterbegin') {
        report.warnings.push(
          `light-DOM insertion not applied: position "${String(insertion.position)}" is not supported (only "afterbegin")`
        );
        continue;
      }
      const targetReport = target ? context.reportOfInstance(target) : undefined;
      if (!targetReport || targetReport.id < 0) {
        report.warnings.push(
          'light-DOM insertion not applied: its target is not a custom element rendered in the final pass'
        );
        continue;
      }
      planned.push({...insertion, targetId: targetReport.id, owner: report});
    }
  }
  return planned;
}

/** Adds the reports/instances of a supplemental final pass to the page's final context. */
function mergeSupplementalContext(target: RenderContext, first: RenderContext, final: RenderContext): void {
  let ordinal = 0;
  for (const [key, report] of final.reportsByKey) {
    const earlier = first.reportsByKey.get(key);
    if (earlier) {
      report.warnings.unshift(
        ...earlier.errors.map((message) => `supplemental pass 1: ${message}`),
        ...earlier.warnings.map((message) => `supplemental pass 1: ${message}`)
      );
    }
    let mergedKey = `#light-dom:${key}:${ordinal++}`;
    while (target.reportsByKey.has(mergedKey)) {
      mergedKey += ':';
    }
    target.reportsByKey.set(mergedKey, report);
  }
  target.rendered.push(...final.rendered);
  target.nextId = Math.max(target.nextId, final.nextId);
}

/**
 * Renders all adapter-created light-DOM values together through a small two-pass render. A real second pass matters
 * for components such as `sp-table-checkbox-cell`: its `firstUpdated()` finds the nested `sp-checkbox` in the
 * pass-1 shadow facade and adds the accessible label to that checkbox's native input.
 */
export async function renderLightDomInsertions(
  insertions: PlannedLightDomInsertion[],
  pageHtml: string,
  pageTree: ServerTree | undefined,
  page: RenderContext,
  renderers: ElementRendererConstructor[],
  /** Every context created here is appended, so the page render disposes it with its own. */
  created: RenderContext[],
  collect: CollectOutput
): Promise<Edit[]> {
  if (insertions.length === 0) {
    return [];
  }
  const wrapped = litHtml`${insertions.map(
    (insertion, index) =>
      litHtml`<div data-swc-ssr-light-insertion=${String(index)}>${insertion.value}</div>`
  )}`;
  const baseId = page.nextId;
  const session = page.session;
  const first = new RenderContext(session, 1);
  first.nextId = baseId;
  created.push(first);
  let supplemental = '';
  try {
    session.pass = first.pass;
    session.current = first;
    supplemental = await collect(
      runInContext(first, () => renderValue(wrapped, first.renderInfo(renderers) as RenderInfo, false)),
      first
    );

    const firstTree = new ServerTree(supplemental);
    const final = new RenderContext(session, 2, first, firstTree, firstTree.contentHash);
    final.nextId = baseId;
    const realm = new TreeRealm(final, firstTree);
    final.realm = realm;
    created.push(final);
    session.pass = final.pass;
    session.current = final;
    const pooled = runInContext(final, () => realm.preinstantiate());
    await runDocumentLifecycle(final, pooled);
    supplemental = await collect(
      runInContext(final, () => renderValue(wrapped, final.renderInfo(renderers) as RenderInfo, false)),
      final
    );

    if (realm.lightMutations.size > 0) {
      const outputTree = new ServerTree(supplemental, {locations: true});
      const mutations = lightMutationEdits(
        supplemental,
        realm.lightMutations,
        realm.tree,
        (host) => {
          const instance = realm.facadeOf(host);
          const report = instance ? final.reportOfInstance(instance) : undefined;
          return report === undefined || report.id < 0 ? undefined : report.id;
        },
        (message, host) => {
          const instance = host ? realm.facadeOf(host) : undefined;
          const report = instance ? final.reportOfInstance(instance) : undefined;
          (report ? report.warnings : session.orphanWarnings).push(message);
        },
        (message) => session.debug(message),
        outputTree
      );
      supplemental = applyEdits(supplemental, mutations);
    }

    const rendered = new ServerTree(supplemental);
    const wrappers = rendered.queryAll(rendered.root, `[${LIGHT_INSERTION_ATTRIBUTE}]`);
    const fragments = new Map<number, string>();
    for (const wrapper of wrappers) {
      const index = Number(wrapper.attribs[LIGHT_INSERTION_ATTRIBUTE]);
      if (Number.isInteger(index) && index >= 0 && index < insertions.length) {
        const markup = rendered.serializeChildren(wrapper, {stripMarkers: !session.options.debug});
        fragments.set(index, stripSupplementalTemplateMarkers(markup));
      }
    }

    const located = pageTree?.hasLocations ? pageTree : new ServerTree(pageHtml, {locations: true});
    const grouped = new Map<number, {at: number; text: string}>();
    for (let index = 0; index < insertions.length; index++) {
      const insertion = insertions[index];
      const fragment = fragments.get(index);
      const at = located.lightDomStart(insertion.targetId);
      if (fragment === undefined || at === undefined) {
        insertion.owner.warnings.push(
          `light-DOM insertion not applied: could not locate or render target data-swc-ssr="${insertion.targetId}"`
        );
        continue;
      }
      const existing = grouped.get(insertion.targetId);
      if (existing) {
        existing.text += fragment;
      } else {
        grouped.set(insertion.targetId, {at, text: fragment});
      }
    }
    mergeSupplementalContext(page, first, final);
    return [...grouped.values()].map(({at, text}) => ({start: at, end: at, text}));
  } finally {
    session.pass = page.pass;
    session.current = page;
  }
}
