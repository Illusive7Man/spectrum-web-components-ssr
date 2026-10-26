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
 * `canonicalAttributes` per static-attribute map. Upstream builds one map per element of a template when it first
 * prepares the template (`staticAttributes` in `@lit-labs/ssr/lib/render-value.js`) and hands the same map to every
 * render and pass (render speed: it was canonicalized again for every element, pass and renderer asked). The size
 * guards against a map that changed anyway.
 */
const canonicalByMap = new WeakMap<ReadonlyMap<string, string>, {size: number; canonical: string}>();

function canonicalAttributesOf(attributes: ReadonlyMap<string, string> | undefined): string {
  if (!attributes || attributes.size === 0) {
    return '';
  }
  const cached = canonicalByMap.get(attributes);
  if (cached !== undefined && cached.size === attributes.size) {
    return cached.canonical;
  }
  const canonical = canonicalAttributes(attributes);
  canonicalByMap.set(attributes, {size: attributes.size, canonical});
  return canonical;
}

/**
 * Upstream gives the template's static attributes of a custom element only to `ElementRenderer.matchesClass(ctor,
 * tagName, attributes)`, right before it constructs the matching renderer (`getElementRenderer` in
 * `@lit-labs/ssr/lib/element-renderer.js`); the renderers stash them here for their constructor.
 */
export function stashStaticAttributes(tag: string, attributes: ReadonlyMap<string, string> | undefined): void {
  pendingStatic = {tag, attributes: canonicalAttributesOf(attributes)};
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
 * Whether an element of this pass (`current`) and one of the previous pass (`previous`) look like the same element by
 * one criterion: true / false, or undefined when it cannot tell (see `verifyAdoptions`).
 */
type Likeness = (current: ElementRecord, previous: ElementRecord) => boolean | undefined;

/**
 * Whether `record` (this pass) adopted the wrong previous-pass element (`source`) by the criterion `same`: they
 * differ, and the difference is explained by another member of the group - an element of this pass that is like
 * `source` and did not get a matching instance itself (none, or one it is not like), or a previous-pass element
 * like `record` that no element of this pass like it adopted. Third review (fixed): 0.1.1 counted every other
 * element like `source`, so an element whose light DOM changed while a sibling kept its old content ('A' -> 'B'
 * next to an 'A') was rejected - a warning and a third pass for nothing.
 */
function misadopted(
  record: ElementRecord,
  source: ElementRecord,
  group: KeyGroup,
  same: Likeness,
  sourceOf: (record: ElementRecord) => ElementRecord | undefined
): boolean {
  if (same(record, source) !== false) {
    return false;
  }
  const unmatched = (other: ElementRecord): boolean => {
    const adopted = sourceOf(other);
    return !adopted || same(other, adopted) === false;
  };
  const adoptedByLike = (other: ElementRecord): boolean =>
    group.current.some((candidate) => candidate.adoptedFrom === other.id && same(candidate, other) === true);
  return (
    group.current.some((other) => other !== record && same(other, source) === true && unmatched(other)) ||
    group.previous.some((other) => other !== source && same(record, other) === true && !adoptedByLike(other))
  );
}

/**
 * Review finding (fixed): pass >= 2 matches an element with the previous pass's element of the same key - tree scope
 * + tag + static attributes + ordinal - when upstream constructs its renderer, which is before the element's light
 * DOM is rendered (upstream gives renderers nothing but the tag and the static attributes). So when a component
 * renders a same-tag element with identical static attributes BEFORE an existing one once it knows its own light
 * DOM (or drops or reorders such elements), the elements took over each other's instance, light-DOM facade and
 * state, silently.
 *
 * After the pass, `tree` (the pass's own output) shows every element's light DOM, and the records hold what upstream
 * set on every element (attributes and properties of the template's bindings). An adoption is checked by two
 * criteria, each with `misadopted`:
 *
 *  1. light DOM (`server-tree.ts` `lightSignature`: child tags with `slot`, text);
 *  2. the attributes and properties upstream set (third review: elements told apart only by bound attributes /
 *     properties, e.g. `<x-leaf label=${'extra'}>` rendered before `<x-leaf label=${'main'}>`, still swapped
 *     instances silently). Static attributes are equal within a group by construction. Property values are compared
 *     with `sameValue`, previous-pass instances translated to this pass's (`TreeRealm.translate`); values created
 *     anew in every render (object literals, closures) never compare equal, so they never confirm another candidate
 *     either (no rejection). Skipped when the light DOM already identifies the element: same light DOM as its
 *     source, and no other member of the group has it (e.g. tabs with distinct labels whose bound `selected`
 *     moved between the passes).
 *
 * A wrong adoption is reported (`adopted candidate rejected: ...`), and the caller makes another pass. That pass is
 * built from this pass's output, where the ordinals already follow the new order, so every element then adopts its
 * own previous element (its light DOM, attributes and state). Neither criterion can be part of the key itself: the
 * light DOM is unknown when the renderer is constructed, and the bound values are set after it. Elements whose light
 * DOM or bound values simply changed between the passes (the same element with new content / state) are not
 * affected. Limitation: elements with no light DOM that differ only by a bound value that moves from one to another
 * between the passes (e.g. a selection flag on otherwise identical elements) cannot be told from reordered
 * elements: they cost a third pass and the warning. Returns the number of rejected adoptions.
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
  const sameLight: Likeness = (current, before) => {
    const mine = signature(current, tree);
    const theirs = signature(before, previousTree);
    return mine === undefined || theirs === undefined ? undefined : mine === theirs;
  };
  const translate = (value: unknown): unknown => context.realm?.translate(value) ?? value;
  const sameBindings: Likeness = (current, before) => {
    if (current.attributes.size !== before.attributes.size || current.properties.size !== before.properties.size) {
      return false;
    }
    for (const [name, value] of current.attributes) {
      if (before.attributes.get(name) !== value) {
        return false;
      }
    }
    for (const [name, value] of current.properties) {
      if (!before.properties.has(name) || !sameValue(value, translate(before.properties.get(name)))) {
        return false;
      }
    }
    return true;
  };
  const sourceOf = (record: ElementRecord): ElementRecord | undefined =>
    record.adoptedFrom === undefined ? undefined : previous.records.get(record.adoptedFrom);
  /** How many of `records` have each light-DOM signature in `of`. */
  const countSignatures = (records: ElementRecord[], of: ServerTree): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const light = signature(record, of);
      if (light !== undefined) {
        counts.set(light, (counts.get(light) ?? 0) + 1);
      }
    }
    return counts;
  };
  let rejected = 0;
  for (const group of ambiguousGroups(context)) {
    // Counted once per group (render speed: comparing every member with every other one was quadratic in large
    // groups, e.g. hundreds of same-tag siblings in one scope).
    let currentCounts: Map<string, number> | undefined;
    let previousCounts: Map<string, number> | undefined;
    /** Whether the light DOM alone identifies `record` as `source` (no other member of the group has it). */
    const identifiedByLight = (record: ElementRecord, source: ElementRecord): boolean => {
      if (sameLight(record, source) !== true) {
        return false;
      }
      // Both have this signature (`sameLight`): it identifies them when no other member of either pass has it.
      const mine = signature(record, tree)!;
      currentCounts ??= countSignatures(group.current, tree);
      previousCounts ??= countSignatures(group.previous, previousTree);
      return currentCounts.get(mine) === 1 && previousCounts.get(mine) === 1;
    };
    for (const record of group.current) {
      const source = sourceOf(record);
      if (!source) {
        continue;
      }
      let differs: {what: string; that: string} | undefined;
      if (misadopted(record, source, group, sameLight, sourceOf)) {
        differs = {what: 'light DOM differs', that: 'that light DOM'};
      } else if (!identifiedByLight(record, source) && misadopted(record, source, group, sameBindings, sourceOf)) {
        differs = {what: 'upstream attributes / properties differ', that: 'those values'};
      }
      if (differs === undefined) {
        continue;
      }
      rejected++;
      context.reportsByKey
        .get(record.key)
        ?.warnings.push(
          `adopted candidate rejected: ${differs.what} from the pass-${previous.pass} <${record.tag}> it was ` +
            `matched with (another element of the same kind in this scope has ${differs.that})` +
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
