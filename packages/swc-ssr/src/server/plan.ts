/**
 * Shared construction logic of the Spectrum renderers: which element (key / id / pass-1 record / tree node /
 * pooled instance) an upstream `new Renderer(tagName)` call corresponds to, and how a fresh instance is built.
 */
import {_$LH} from 'lit-html/private-ssr-support.js';
import {setBacking, setConstructionHook, BACKING} from '../dom-shim/hooks.js';
import {createPlainElement} from '../dom-shim/nodes.js';
import {constructElement} from './construct.js';
import {errorMessage, type ElementRecord, type RenderContext} from './context.js';
import {markManaged} from './lifecycle.js';
import {attachShadowRoot, emptyBacking} from './realm.js';
import {findAdapter} from './adapters/registry.js';
import type {TreeElementNode} from './server-tree.js';
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
    return {element: constructElement(ctor), failed: false};
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

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  }
  return false;
}
