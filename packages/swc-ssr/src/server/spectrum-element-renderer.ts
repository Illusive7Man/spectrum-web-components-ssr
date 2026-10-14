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
 * Library-agnostic: it matches every LitElement class; Spectrum-specific behaviour comes from adapters.
 */
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {renderValue, type RenderInfo} from '@lit-labs/ssr/lib/render-value.js';
import type {ThunkedRenderResult} from '@lit-labs/ssr/lib/render-result.js';
import {overrideRegistryGet} from './construct.js';
import {errorMessage, getCurrentRenderContext, runInContext} from './context.js';
import {
  connectElement,
  hasPendingUpdate,
  reflectPending,
  runBaseUpdate,
  runFullUpdate,
  settle,
} from './lifecycle.js';
import {materialize} from './materialize.js';
import {buildElement, planElement, prepareFreshElement, sameValue, type ElementPlan} from './plan.js';
import {MARKER_ATTRIBUTE} from './server-tree.js';
import {isElementPartMarker} from './plan.js';
import type {AdapterContext} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_UPDATE_CYCLES = 3;

type RenderOptionsCallback = (element: HTMLElement) => {connectedCallback?: boolean; disableSsr?: boolean} | undefined;

export class SpectrumElementRenderer extends LitElementRenderer {
  declare ssrPlan: ElementPlan | undefined;
  declare ssrKey: string | undefined;
  declare ssrBroken: boolean;
  declare ssrLifecycle: Promise<void> | undefined;
  declare ssrDisabled: boolean;

  static override matchesClass(ctor: typeof HTMLElement): boolean {
    return !!(ctor as unknown as {_$litElement$?: boolean})._$litElement$;
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
    try {
      super(tagName);
    } finally {
      restore();
    }
    this.ssrPlan = plan;
    this.ssrKey = plan?.key;
    this.ssrBroken = failed;
    this.ssrLifecycle = undefined;
    if (!plan?.instance) {
      prepareFreshElement(this.element, plan);
    }
  }

  private get report() {
    return this.ssrPlan?.report;
  }

  private adapterContext(): AdapterContext | undefined {
    const plan = this.ssrPlan;
    return plan
      ? {id: plan.id, pass: plan.context.pass === 1 ? 1 : 2, tree: plan.context.tree, report: plan.report}
      : undefined;
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
      super.setAttribute(name, value);
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
      super.setProperty(name, value);
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
    let renderOptions: ReturnType<RenderOptionsCallback>;
    for (const callback of ((LitElementRenderer as any).renderOptions ?? []) as RenderOptionsCallback[]) {
      renderOptions = callback(element);
      if (renderOptions) {
        break;
      }
    }
    if (renderOptions?.disableSsr) {
      this.ssrDisabled = true;
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
    const {report, mode, context} = plan;
    context.session.lastReport = report;
    if (mode !== 'none') {
      connectElement(element, report);
    }
    if (mode !== 'full') {
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
    this.ssrLifecycle = this.finishLifecycle();
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
      plan.adapter.beforeRender(this.element as HTMLElement, adapterContext);
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
      value = materialize(element.render());
    } catch (error) {
      plan?.report.errors.push(`render: ${errorMessage(error)}`);
      const fallback = this.fallbackShadow();
      if (fallback) {
        return fallback;
      }
      value = undefined;
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

  /** Pass 2: the element's pass-1 shadow content (already server-rendered markup). */
  private fallbackShadow(): ThunkedRenderResult | undefined {
    const plan = this.ssrPlan;
    if (!plan || plan.context.pass === 1 || !plan.previousRecord || !plan.context.tree) {
      return undefined;
    }
    const markup = plan.context.tree.serializeShadow(plan.previousRecord.id);
    if (markup === undefined) {
      return undefined;
    }
    plan.report.fallback = true;
    return [markup];
  }
}
