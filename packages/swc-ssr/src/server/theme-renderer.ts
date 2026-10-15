/**
 * `ThemeRenderer` for `<sp-theme>` (`theme/src/Theme.js`, 1.12.x). Theme is not a LitElement: in the browser it
 * attaches a shadow root containing `<slot>` and adopts the CSS of its registered theme fragments
 * (`Theme.registerThemeFragment`, filled by importing `@spectrum-web-components/theme/src/themes.js` or the
 * individual `theme-*.js` / `scale-*.js` modules) through `adoptedStyleSheets`.
 *
 * On the server the same CSS (the instance's `styles` getter: system/color/scale fragments plus `core`/`app`
 * fragments, including the default `spectrum` system when no attributes are set) is emitted as a `<style>` inside
 * the declarative shadow root, followed by `<slot></slot>`. `adoptedStyleSheets` is never touched and the theme's
 * own `connectedCallback` is never called (it would add the instance to the static `Theme.instances` set).
 * No `dir` attribute is added (1.12's Theme does not add one in the browser).
 */
import {ElementRenderer} from '@lit-labs/ssr/lib/element-renderer.js';
import type {ThunkedRenderResult} from '@lit-labs/ssr/lib/render-result.js';
import {constructElement, isThemeClass, neutralizeTheme} from './construct.js';
import {errorMessage, getCurrentRenderContext} from './context.js';
import {
  adapterContextOf,
  buildElement,
  planElement,
  prepareFreshElement,
  sameValue,
  stashStaticAttributes,
  type ElementPlan,
} from './plan.js';
import {setAttributeAndNotify} from './realm.js';
import {MARKER_ATTRIBUTE} from './server-tree.js';
import {isElementPartMarker} from './plan.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const THEME_KINDS = ['system', 'color', 'scale'] as const;

export class ThemeRenderer extends ElementRenderer {
  declare element: HTMLElement;
  declare ssrPlan: ElementPlan | undefined;
  declare ssrKey: string | undefined;

  static override matchesClass(ctor: typeof HTMLElement, tagName?: string, attributes?: Map<string, string>): boolean {
    const matches = isThemeClass(ctor);
    if (matches && tagName !== undefined) {
      stashStaticAttributes(tagName, attributes);
    }
    return matches;
  }

  constructor(tagName: string) {
    super(tagName);
    const context = getCurrentRenderContext();
    const plan = context ? planElement(context, tagName) : undefined;
    this.ssrPlan = plan;
    this.ssrKey = plan?.key;
    let element: any = plan?.instance;
    if (!element) {
      if (plan) {
        element = buildElement(tagName, plan).element;
      } else {
        try {
          element = constructElement((globalThis as any).customElements.get(tagName));
        } catch {
          element = undefined;
        }
      }
      if (element) {
        prepareFreshElement(element, plan);
      }
    }
    if (element && isThemeClass(element.constructor)) {
      neutralizeTheme(element);
    }
    this.element = element;
  }

  override setAttribute(name: string, value: string): void {
    name = name.toLowerCase();
    if (isElementPartMarker(name)) {
      return;
    }
    const plan = this.ssrPlan;
    plan?.record?.attributes.set(name, value);
    if (!this.element || (plan?.instance && plan.previousRecord?.attributes.get(name) === value)) {
      return;
    }
    try {
      setAttributeAndNotify(this.element, name, value);
    } catch (error) {
      plan?.report.errors.push(`setAttribute(${name}): ${errorMessage(error)}`);
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
      plan?.report.errors.push(`property ${name}: ${errorMessage(error)}`);
    }
  }

  override connectedCallback(): void {
    const element = this.element;
    if (!element) {
      return;
    }
    // No `dir` default: `theme/src/Theme.js` 1.12 does not set one in the browser either (SpectrumElement resolves
    // direction through getComputedStyle), and an extra attribute would differ from the client-rendered DOM.
    const plan = this.ssrPlan;
    if (plan && plan.context.pass !== 1 && plan.adapter?.beforeRender) {
      try {
        plan.adapter.beforeRender(element, adapterContextOf(plan));
      } catch (error) {
        plan.report.errors.push(`adapter beforeRender: ${errorMessage(error)}`);
      }
    }
  }

  override renderAttributes(): ThunkedRenderResult {
    const result = super.renderAttributes() as string[];
    if (this.ssrPlan) {
      result.push(` ${MARKER_ATTRIBUTE}="${this.ssrPlan.id}"`);
    }
    return result;
  }

  override renderShadow(): ThunkedRenderResult {
    const element = this.element as any;
    const plan = this.ssrPlan;
    const ctor = element?.constructor as any;
    const result: string[] = [];
    if (element && isThemeClass(ctor)) {
      this.checkFragments(element, ctor);
      let styles: Array<{cssText?: string}> = [];
      try {
        styles = (element.styles ?? []).flat(Infinity);
      } catch (error) {
        plan?.report.errors.push(`styles: ${errorMessage(error)}`);
      }
      if (styles.length > 0) {
        result.push('<style>');
        for (const style of styles) {
          result.push(String(style?.cssText ?? ''));
        }
        result.push('</style>');
      }
    }
    result.push('<slot></slot>');
    return result;
  }

  /** Reports fragments requested through attributes that the application did not import. */
  private checkFragments(element: any, ctor: any): void {
    const report = this.ssrPlan?.report;
    if (!report) {
      return;
    }
    const fragments: Map<string, Map<string, unknown>> = ctor.themeFragmentsByKind;
    const system = String(element.system || 'spectrum');
    for (const kind of THEME_KINDS) {
      if (kind !== 'system' && !element.hasAttribute(kind)) {
        continue;
      }
      const name = String(element[kind] ?? '');
      if (!name) {
        continue;
      }
      const lookup = kind === 'system' || system === 'spectrum' ? name : `${name}-${system}`;
      if (!fragments.get(kind)?.has(lookup)) {
        const message =
          `theme fragment ${kind}="${name}" is not registered; import ` +
          `'@spectrum-web-components/theme/src/themes.js' (or the matching theme-*/scale-* module)`;
        if (!report.warnings.includes(message)) {
          report.warnings.push(message);
        }
      }
    }
  }
}
