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
import type {ElementAdapter, ElementReport, LifecycleMode} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ElementPlan {
  context: RenderContext;
  id: number;
  key: string;
  tag: string;
  report: ElementReport;
  mode: LifecycleMode;
  adapter: ElementAdapter | undefined;
  /** Pass 1: the record being collected. */
  record?: ElementRecord;
  /** Pass 2: the pass-1 record with the same key and tag. */
  previousRecord?: ElementRecord;
  /** Pass 2: the pass-1 tree node of this element. */
  node?: TreeElementNode;
  /** Pass 2: the pre-instantiated instance handed to the renderer. */
  instance?: HTMLElement;
}

export function planElement(context: RenderContext, tag: string): ElementPlan {
  const key = context.nextKey(tag);
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
    mode: context.lifecycleFor(tag, adapter?.lifecycle),
  };
  // Every pass records what upstream does with the element, so a further pass can build on it.
  plan.record = {id, key, tag, attributes: new Map(), properties: new Map()};
  context.records.set(id, plan.record);
  context.recordsByKey.set(key, plan.record);
  const previous = context.previous;
  if (!previous) {
    return plan;
  }
  const previousRecord = previous.recordsByKey.get(key);
  if (!previousRecord || previousRecord.tag !== tag) {
    report.warnings.push(
      previousRecord
        ? `the element at this position was <${previousRecord.tag}> in pass ${previous.pass}: rendered without tree information`
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
      plan.adapter.prepare(element, {
        id: plan.id,
        pass: plan.context.pass === 1 ? 1 : 2,
        tree: plan.context.tree,
        report: plan.report,
      });
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

const LIT_MARKER = (_$LH as unknown as {marker: string}).marker;

/**
 * `@lit-labs/ssr` 4.1.0 passes the marker attribute of an element binding (`<sp-color-handle ${streamingListener()}>`
 * in `color-area/src/ColorArea.js`) to custom element renderers as a static attribute (its filter only excludes
 * attribute bindings), so it would be rendered as e.g. `lit$418243935$8=""`. Such names are never applied.
 */
export function isElementPartMarker(name: string): boolean {
  return name.startsWith(LIT_MARKER);
}
