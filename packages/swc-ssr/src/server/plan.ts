/**
 * Shared construction logic of the Spectrum renderers: which element (key / id / pass-1 record / tree node /
 * pooled instance) an upstream `new Renderer(tagName)` call corresponds to, and how a fresh instance is built.
 */
import {_$LH} from 'lit-html/private-ssr-support.js';
import {setBacking, setConstructionHook, BACKING} from '../dom-shim/hooks.js';
import {createPlainElement} from '../dom-shim/nodes.js';
import {constructElement} from './construct.js';
import {errorMessage, withElementScope, type ElementRecord, type RenderContext} from './context.js';
import {markManaged} from './lifecycle.js';
import {attachShadowRoot, emptyBacking} from './realm.js';
import {findAdapter} from './adapters/registry.js';
import {lightSignature, type ServerTree, type TreeElementNode} from './server-tree.js';
import type {AdapterContext, ElementAdapter, ElementReport, LifecycleMode} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ElementPlan {
  context: RenderContext;
  id: number;
  key: string;
  tag: string;
  report: ElementReport;
  /** Effective lifecycle; refined once the element's `LitElementRenderer.renderOptions` are known. */
  mode: LifecycleMode;
  adapter: ElementAdapter | undefined;
  /** Canonical form of the static attributes upstream passed for this element (see `canonicalAttributes`). */
  staticAttributes: string;
  /** The record of this pass (what upstream does with the element; a further pass builds on it). */
  record?: ElementRecord;
  /** Pass >= 2: the previous pass's record with the same key and tag. */
  previousRecord?: ElementRecord;
  /** Pass >= 2: the previous pass's tree node of this element. */
  node?: TreeElementNode;
  /** Pass >= 2: the pre-instantiated instance handed to the renderer. */
  instance?: HTMLElement;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Static attributes (review M3)
 * ------------------------------------------------------------------------------------------------------------ */

const LIT_MARKER = (_$LH as unknown as {marker: string}).marker;

/**
 * `@lit-labs/ssr` 4.1.0 passes the marker attribute of an element binding (`<sp-color-handle ${streamingListener()}>`
 * in `color-area/src/ColorArea.js`) to custom element renderers as a static attribute (its filter only excludes
 * attribute bindings), so it would be rendered as e.g. `lit$418243935$8=""`. Such names are never applied.
 */
export function isElementPartMarker(name: string): boolean {
  return name.startsWith(LIT_MARKER);
}

/** Sorted `name=value` list of a template's static attributes (element-binding markers excluded). */
export function canonicalAttributes(attributes: ReadonlyMap<string, string> | undefined): string {
  if (!attributes || attributes.size === 0) {
    return '';
  }
  const entries: string[] = [];
  for (const [name, value] of attributes) {
    const lower = name.toLowerCase();
    if (!isElementPartMarker(lower)) {
      entries.push(`${lower}=${JSON.stringify(String(value))}`);
    }
  }
  return entries.sort().join(' ');
}

let pendingStatic: {tag: string; attributes: string} | undefined;

/**
 * Upstream gives the template's static attributes of a custom element only to `ElementRenderer.matchesClass(ctor,
 * tagName, attributes)`, right before it constructs the matching renderer (`getElementRenderer` in
 * `@lit-labs/ssr/lib/element-renderer.js`); the renderers stash them here for their constructor.
 */
export function stashStaticAttributes(tag: string, attributes: ReadonlyMap<string, string> | undefined): void {
  pendingStatic = {tag, attributes: canonicalAttributes(attributes)};
}

function takeStaticAttributes(tag: string): string {
  const stashed = pendingStatic;
  pendingStatic = undefined;
  return stashed && stashed.tag === tag ? stashed.attributes : '';
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------------------------------------------------ */

export function planElement(context: RenderContext, tag: string): ElementPlan {
  const staticAttributes = takeStaticAttributes(tag);
  const key = context.nextKey(tag, staticAttributes);
  const id = context.nextId++;
  const report = context.reportFor(key, tag);
  report.id = id;
  const adapter = findAdapter(tag);
  const plan: ElementPlan = {
    context,
    id,
    key,
    tag,
    report,
    adapter,
    staticAttributes,
    // Class-level mode; the renderer refines it with the element's render options (see `refineMode`).
    mode: context.lifecycleFor(tag, adapter?.lifecycle),
  };
  // Every pass records what upstream does with the element, so a further pass can build on it.
  plan.record = {id, key, tag, attributes: new Map(), properties: new Map(), staticAttributes};
  context.records.set(id, plan.record);
  context.recordsByKey.set(key, plan.record);
  const previous = context.previous;
  if (!previous) {
    return plan;
  }
  const previousRecord = previous.recordsByKey.get(key);
  if (!previousRecord || previousRecord.tag !== tag || previousRecord.staticAttributes !== staticAttributes) {
    report.warnings.push(
      previousRecord
        ? `the element at this position was a different <${previousRecord.tag}> in pass ${previous.pass}: rendered without tree information`
        : `not rendered in pass ${previous.pass}: rendered without light-DOM / shadow information`
    );
    context.untracked.push(report);
    return plan;
  }
  plan.previousRecord = previousRecord;
  plan.record.adoptedFrom = previousRecord.id;
  plan.node = context.tree?.byId(previousRecord.id);
  if (plan.node && context.realm && !context.claimed.has(key)) {
    const instance = context.realm.instanceForNode(plan.node);
    if (instance && instance.localName === tag) {
      plan.instance = instance;
      context.claimed.add(key);
    }
  }
  return plan;
}

/** The adapter context of a planned element (also for adapters called before it is rendered). */
export function adapterContextOf(plan: ElementPlan): AdapterContext {
  return {
    id: plan.id,
    pass: plan.context.pass,
    key: plan.key,
    previousId: plan.previousRecord?.id,
    tree: plan.context.tree,
    report: plan.report,
  };
}

/**
 * Builds the element for a renderer when no pooled instance exists. Construction errors are reported and an
 * inert placeholder element is returned (the renderer then falls back to pass-1 output / attributes only).
 */
export function buildElement(tag: string, plan: ElementPlan | undefined): {element: any; failed: boolean} {
  const ctor = (globalThis as any).customElements.get(tag) as (new () => HTMLElement) | undefined;
  if (!ctor) {
    return {element: createPlainElement(tag), failed: true};
  }
  const backing = plan?.node && plan.context.realm ? plan.context.realm.backingFor(plan.node) : undefined;
  const previousHook = backing
    ? setConstructionHook((element: any) => {
        if (element.localName === tag && !Object.prototype.hasOwnProperty.call(element, BACKING)) {
          setBacking(element, backing);
          return backing;
        }
        return undefined;
      })
    : undefined;
  try {
    // In the element's scope: promises its constructor creates belong to it (see context.ts onUnhandledRejection).
    return {element: withElementScope(plan?.report, () => constructElement(ctor)), failed: false};
  } catch (error) {
    plan?.report.errors.push(`constructor: ${errorMessage(error)}`);
    return {element: createPlainElement(tag), failed: true};
  } finally {
    if (backing) {
      setConstructionHook(previousHook);
    }
  }
}

/** Wires a freshly built (not pooled) element: tree facades when available, empty connected facades otherwise. */
export function prepareFreshElement(element: any, plan: ElementPlan | undefined): void {
  if (plan?.adapter?.prepare) {
    try {
      plan.adapter.prepare(element, adapterContextOf(plan));
    } catch (error) {
      plan.report.errors.push(`adapter prepare: ${errorMessage(error)}`);
    }
  }
  if (plan?.node && plan.context.realm) {
    plan.context.realm.attach(element, plan.node);
  } else {
    setBacking(element, emptyBacking());
    attachShadowRoot(element, emptyBacking());
  }
  if (plan) {
    plan.context.keyByInstance.set(element, plan.key);
    if (plan.mode === 'full') {
      markManaged(element, plan.report);
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Verifying adoptions after a pass
 * ------------------------------------------------------------------------------------------------------------ */

/** Elements of one pass and of the previous pass that share tree scope, tag and static attributes (key minus ordinal). */
interface KeyGroup {
  current: ElementRecord[];
  previous: ElementRecord[];
}

const groupOf = (key: string): string => key.slice(0, key.lastIndexOf(':'));

function keyGroups(context: RenderContext): Map<string, KeyGroup> {
  const groups = new Map<string, KeyGroup>();
  const group = (key: string): KeyGroup => {
    const name = groupOf(key);
    let entry = groups.get(name);
    if (!entry) {
      entry = {current: [], previous: []};
      groups.set(name, entry);
    }
    return entry;
  };
  for (const record of context.records.values()) {
    group(record.key).current.push(record);
  }
  for (const record of context.previous?.records.values() ?? []) {
    group(record.key).previous.push(record);
  }
  return groups;
}

/** Groups in which an element was matched by ordinal while another element of the same kind was a candidate too. */
function ambiguousGroups(context: RenderContext): KeyGroup[] {
  if (!context.previous || !context.tree) {
    return [];
  }
  return [...keyGroups(context).values()].filter(
    (group) =>
      (group.current.length > 1 || group.previous.length > 1) &&
      group.current.some((record) => record.adoptedFrom !== undefined)
  );
}

/** Whether `verifyAdoptions` has anything to check after this pass (it needs the pass output parsed). */
export function needsAdoptionCheck(context: RenderContext): boolean {
  return ambiguousGroups(context).length > 0;
}

/**
 * Review finding (fixed): pass >= 2 matches an element with the previous pass's element of the same key - tree scope
 * + tag + static attributes + ordinal - when upstream constructs its renderer, which is before the element's light
 * DOM is rendered (upstream gives renderers nothing but the tag and the static attributes). So when a component
 * renders a same-tag element with identical static attributes BEFORE an existing one once it knows its own light
 * DOM (or drops or reorders such elements), the elements took over each other's instance, light-DOM facade and
 * state, silently.
 *
 * After the pass, `tree` (the pass's own output) shows every element's light DOM. An element whose light DOM differs
 * from that of the previous-pass element it adopted, while another element of the same kind (tag, static
 * attributes, scope) has exactly that light DOM - in this pass, or in the previous one - was matched with the wrong
 * element: it is reported (`adopted candidate rejected: light DOM differs`), and the caller makes another pass.
 * That pass is built from this pass's output, where the ordinals already follow the new order, so every element
 * then adopts its own previous element (its light DOM and state). A light-DOM signature cannot be part of the key
 * itself: it is unknown when the renderer is constructed. Elements whose light DOM simply changed between the
 * passes (the same element with new content) are not affected: no other element has their previous light DOM.
 * Returns the number of rejected adoptions.
 */
export function verifyAdoptions(context: RenderContext, tree: ServerTree, willRetry: boolean): number {
  const previous = context.previous;
  const previousTree = context.tree;
  if (!previous || !previousTree) {
    return 0;
  }
  const signatures = new Map<ElementRecord, string | undefined>();
  const signature = (record: ElementRecord, of: ServerTree): string | undefined => {
    if (!signatures.has(record)) {
      const node = of.byId(record.id);
      signatures.set(record, node ? lightSignature(node) : undefined);
    }
    return signatures.get(record);
  };
  let rejected = 0;
  for (const group of ambiguousGroups(context)) {
    for (const record of group.current) {
      const source = record.adoptedFrom === undefined ? undefined : previous.records.get(record.adoptedFrom);
      if (!source) {
        continue;
      }
      const mine = signature(record, tree);
      const theirs = signature(source, previousTree);
      if (mine === undefined || theirs === undefined || mine === theirs) {
        continue;
      }
      const belongsElsewhere =
        group.current.some((other) => other !== record && signature(other, tree) === theirs) ||
        group.previous.some((other) => other !== source && signature(other, previousTree) === mine);
      if (!belongsElsewhere) {
        continue;
      }
      rejected++;
      context.reportsByKey
        .get(record.key)
        ?.warnings.push(
          `adopted candidate rejected: light DOM differs from the pass-${previous.pass} <${record.tag}> it was matched ` +
            'with (another element of the same kind in this scope has that light DOM)' +
            (willRetry ? '; another pass is made' : '; the output may show the state of that element')
        );
    }
  }
  return rejected;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  }
  return false;
}
