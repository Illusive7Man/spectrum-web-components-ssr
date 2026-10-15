/**
 * `SpectrumElementRenderer`: a `LitElementRenderer` that
 *  - records what upstream does with each element in pass 1 (attributes, properties) and marks the output
 *    (`data-swc-ssr`) so the pass-1 HTML can be turned into a server tree;
 *  - in pass 2 adopts the pre-instantiated element (with light-DOM / shadow facades backed by the tree) instead
 *    of constructing a new one, ignores upstream's replays of attributes/properties that were already applied,
 *    and runs the server lifecycle extension before attributes and shadow are rendered;
 *  - catches errors per element (reported, never fatal) and falls back to the pass-1 shadow when `render()`
 *    fails in pass 2.
 *
 * Library-agnostic: it matches every LitElement class (all of them get the light-DOM / shadow facades). The server
 * lifecycle (`full`) is the default only for managed classes (Spectrum's, see `RenderSpectrumOptions.
 * isManagedClass`); other Lit elements keep upstream semantics unless `lifecycleByTag` opts them in.
 * `LitElementRenderer.renderOptions` are honoured as upstream does. Spectrum-specific behaviour comes from adapters.
 */
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {renderValue, type RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ThunkedRenderResult} from '@lit-labs/ssr/lib/render-result.js';
import {overrideRegistryGet} from './construct.js';
import {errorMessage, getCurrentRenderContext, runInContext, withElementScope} from './context.js';
import {
  connectElement,
  hasPendingUpdate,
  reflectPending,
  runBaseUpdate,
  runFullUpdate,
  settle,
  suspendAttributeReactions,
  unmarkManaged,
  withoutAttributeReactions,
} from './lifecycle.js';
import {materialize} from './materialize.js';
import {
  adapterContextOf,
  buildElement,
  isElementPartMarker,
  planElement,
  prepareFreshElement,
  sameValue,
  stashStaticAttributes,
  type ElementPlan,
} from './plan.js';
import {resolveRenderOptions} from './render-options.js';
import {MARKER_ATTRIBUTE} from './server-tree.js';
import type {AdapterContext} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_UPDATE_CYCLES = 3;

export class SpectrumElementRenderer extends LitElementRenderer {
  declare ssrPlan: ElementPlan | undefined;
  declare ssrKey: string | undefined;
  declare ssrBroken: boolean;
  declare ssrLifecycle: Promise<void> | undefined;
  declare ssrDisabled: boolean;

  static override matchesClass(ctor: typeof HTMLElement, tagName?: string, attributes?: Map<string, string>): boolean {
    const matches = !!(ctor as unknown as {_$litElement$?: boolean})._$litElement$;
    if (matches && tagName !== undefined) {
      // The constructor only gets the tag name; the static attributes are part of the element's key (plan.ts).
      stashStaticAttributes(tagName, attributes);
    }
    return matches;
  }

  constructor(tagName: string) {
    const context = getCurrentRenderContext();
    const plan = context ? planElement(context, tagName) : undefined;
    let element: any = plan?.instance;
    let failed = false;
    if (!element) {
      ({element, failed} = buildElement(tagName, plan));
    }
    // LitElementRenderer's constructor constructs the element itself; hand it ours instead.
    const restore = overrideRegistryGet(tagName, element);
    // (Upstream reflects ElementInternals ARIA attributes here; the renderer's writes are not attribute reactions.)
    const resume = suspendAttributeReactions();
    try {
      super(tagName);
    } finally {
      resume();
      restore();
    }
    this.ssrPlan = plan;
    this.ssrKey = plan?.key;
    this.ssrBroken = failed;
    this.ssrLifecycle = undefined;
    this.ssrDisabled = false;
    if (!plan?.instance) {
      prepareFreshElement(this.element, plan);
    }
  }

  private get report() {
    return this.ssrPlan?.report;
  }

  private adapterContext(): AdapterContext | undefined {
    return this.ssrPlan ? adapterContextOf(this.ssrPlan) : undefined;
  }

  override setAttribute(name: string, value: string): void {
    name = name.toLowerCase();
    if (isElementPartMarker(name)) {
      return;
    }
    const plan = this.ssrPlan;
    plan?.record?.attributes.set(name, value);
    if (plan?.instance && plan.previousRecord?.attributes.get(name) === value) {
      // Replay of an attribute applied when the element was pre-instantiated.
      return;
    }
    try {
      // Upstream's setAttribute notifies `attributeChangedCallback` itself (no second, browser-like reaction).
      withElementScope(this.report, () => withoutAttributeReactions(() => super.setAttribute(name, value)));
    } catch (error) {
      this.report?.errors.push(`setAttribute(${name}): ${errorMessage(error)}`);
    }
  }

  override setProperty(name: string, value: unknown): void {
    const plan = this.ssrPlan;
    plan?.record?.properties.set(name, value);
    if (
      plan?.instance &&
      plan.previousRecord?.properties.has(name) &&
      sameValue(plan.context.realm?.translate(plan.previousRecord.properties.get(name)), value)
    ) {
      return;
    }
    try {
      withElementScope(this.report, () => super.setProperty(name, value));
    } catch (error) {
      this.report?.errors.push(`property ${name}: ${errorMessage(error)}`);
    }
  }

  override attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (this.ssrBroken) {
      return;
    }
    super.attributeChangedCallback(name, old, value);
  }

  override connectedCallback(): void {
    if (this.ssrBroken) {
      return;
    }
    const element = this.element as any;
    const plan = this.ssrPlan;
    // Pooled (pre-instantiated) elements: the decision made when they were created, before anything connected or
    // updated them (realm.ts `renderOptionsOf`); elements built by this renderer: evaluated now, as upstream does.
    const decided = plan?.instance ? plan.context.realm?.renderOptionsOf(element) : undefined;
    const renderOptions = decided?.found ? decided.options : resolveRenderOptions(element, plan?.report);
    if (renderOptions?.disableSsr) {
      // Upstream semantics: no connectedCallback, no update, no shadow root (see renderShadow).
      this.ssrDisabled = true;
      unmarkManaged(element);
      return;
    }
    if (!plan) {
      // Used without renderSpectrum(): upstream semantics.
      if (renderOptions?.connectedCallback || (globalThis as any).litSsrCallConnectedCallback) {
        connectElement(element, {id: -1, tagName: this.tagName, errors: [], warnings: [], fallback: false});
      }
      runBaseUpdate(element, {id: -1, tagName: this.tagName, errors: [], warnings: [], fallback: false});
      return;
    }
    const {report, context} = plan;
    // The class-level mode refined by the element's render options (review H1 / M1, see `lifecycleFor`).
    plan.mode = context.lifecycleFor(plan.tag, plan.adapter?.lifecycle, element.constructor, renderOptions);
    if (plan.mode !== 'full') {
      unmarkManaged(element);
    }
    if (plan.instance) {
      this.removeStaleAttributes();
    }
    context.session.lastReport = report;
    if (plan.mode !== 'none') {
      connectElement(element, report, context.session);
    }
    if (plan.mode !== 'full') {
      runBaseUpdate(element, report);
      this.beforeRender();
      return;
    }
    if (plan.instance && element.hasUpdated && !hasPendingUpdate(element)) {
      // Pre-instantiated element whose lifecycle already ran (document lifecycle) and nothing changed since.
      this.beforeRender();
      return;
    }
    runFullUpdate(element, report);
    this.ssrLifecycle = withElementScope(report, () => this.finishLifecycle());
  }

  /**
   * Review M3: a pre-instantiated element got the attributes upstream set on the previous pass's element with the
   * same key. Attributes of that record which upstream did not set again in this pass (e.g. a `?disabled=${...}`
   * binding that is false now) are removed, unless the component changed them itself in the meantime.
   */
  private removeStaleAttributes(): void {
    const plan = this.ssrPlan!;
    const previous = plan.previousRecord;
    const current = plan.record;
    if (!previous || !current) {
      return;
    }
    const element = this.element as any;
    for (const [name, value] of previous.attributes) {
      if (current.attributes.has(name) || element.getAttribute(name) !== value) {
        continue;
      }
      try {
        withElementScope(plan.report, () => {
          const old = element.getAttribute(name);
          withoutAttributeReactions(() => element.removeAttribute(name));
          const observed: string[] = element.constructor?.observedAttributes ?? [];
          if (observed.includes(name) && typeof element.attributeChangedCallback === 'function') {
            element.attributeChangedCallback(name, old, null);
          }
        });
      } catch (error) {
        plan.report.errors.push(`removeAttribute(${name}): ${errorMessage(error)}`);
      }
    }
  }

  /** The asynchronous part of the `full` lifecycle: settle frames/microtasks, re-run pending updates. */
  private async finishLifecycle(): Promise<void> {
    const plan = this.ssrPlan!;
    const {context, report} = plan;
    const element = this.element as any;
    try {
      for (let cycle = 1; ; cycle++) {
        await settle(context);
        if (!hasPendingUpdate(element)) {
          break;
        }
        if (cycle >= MAX_UPDATE_CYCLES) {
          report.warnings.push(`still had pending updates after ${MAX_UPDATE_CYCLES} update cycles`);
          // Reflect what is pending so attributes match the rendered state.
          runInContext(context, () => reflectPending(element, report));
          break;
        }
        runInContext(context, () => {
          context.session.lastReport = report;
          runFullUpdate(element, report);
        });
      }
    } catch (error) {
      context.session.checkAborted();
      report.errors.push(`lifecycle: ${errorMessage(error)}`);
    }
    runInContext(context, () => this.beforeRender());
  }

  private beforeRender(): void {
    const plan = this.ssrPlan;
    const adapterContext = this.adapterContext();
    if (!plan?.adapter?.beforeRender || !adapterContext || plan.context.pass === 1) {
      return;
    }
    try {
      withElementScope(plan.report, () => plan.adapter!.beforeRender!(this.element as HTMLElement, adapterContext));
    } catch (error) {
      plan.report.errors.push(`adapter beforeRender: ${errorMessage(error)}`);
    }
  }

  override renderAttributes(): ThunkedRenderResult {
    const plan = this.ssrPlan;
    const render = (): ThunkedRenderResult => {
      const result = super.renderAttributes() as string[];
      if (plan) {
        result.push(` ${MARKER_ATTRIBUTE}="${plan.id}"`);
      }
      return result;
    };
    const lifecycle = this.ssrLifecycle;
    if (plan && lifecycle) {
      return [() => lifecycle.then(() => runInContext(plan.context, render))];
    }
    return render();
  }

  override renderShadow(renderInfo: RenderInfo): ThunkedRenderResult | undefined {
    const plan = this.ssrPlan;
    if (this.ssrDisabled) {
      // Upstream pushes the host before calling renderShadow() and only pops it when a shadow was emitted.
      renderInfo.customElementHostStack.pop();
      return undefined;
    }
    if (this.ssrBroken) {
      return this.fallbackShadow() ?? [];
    }
    const element = this.element as any;
    let value: unknown;
    try {
      value = materialize(withElementScope(plan?.report, () => element.render()));
    } catch (error) {
      plan?.report.errors.push(`render: ${errorMessage(error)}`);
      const fallback = this.fallbackShadow();
      if (fallback) {
        return fallback;
      }
      value = undefined;
    }
    if (plan) {
      // From here on the element's markup is out; a later update of it would be lost (see `findLateUpdates`).
      plan.context.rendered.push({element, report: plan.report});
    }
    if (plan?.adapter?.afterRender && plan.context.pass !== 1) {
      try {
        plan.adapter.afterRender(element, this.adapterContext()!);
      } catch (error) {
        plan.report.errors.push(`adapter afterRender: ${errorMessage(error)}`);
      }
    }
    const result: ThunkedRenderResult = [];
    const styles = element.constructor?.elementStyles as Array<{cssText: string}> | undefined;
    if (styles !== undefined && styles.length > 0) {
      result.push('<style>');
      for (const style of styles) {
        result.push(style.cssText);
      }
      result.push('</style>');
    }
    result.push(() => renderValue(value, renderInfo));
    return result;
  }

  override renderLight(renderInfo: RenderInfo): ThunkedRenderResult {
    if (typeof (this.element as any)?.renderLight !== 'function') {
      return [''];
    }
    return super.renderLight(renderInfo);
  }

  /**
   * Pass >= 2: the element's shadow content of the previous pass (already server-rendered markup). Review L1: the
   * `data-swc-ssr` markers inside it are previous-pass ids, which would collide with this pass's ids (light-DOM
   * mutation targets, the next pass's tree); they are left out, so the fallback content counts as plain markup.
   */
  private fallbackShadow(): ThunkedRenderResult | undefined {
    const plan = this.ssrPlan;
    if (!plan || plan.context.pass === 1 || !plan.previousRecord || !plan.context.tree) {
      return undefined;
    }
    const markup = plan.context.tree.serializeShadow(plan.previousRecord.id, {stripMarkers: true});
    if (markup === undefined) {
      return undefined;
    }
    plan.report.fallback = true;
    return [markup];
  }
}

