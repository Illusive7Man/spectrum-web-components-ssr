/**
 * Upstream's per-element render options (`LitElementRenderer.renderOptions`, @lit-labs/ssr 4.1.0): callbacks that
 * return `{connectedCallback?, disableSsr?}` for an element (the first callback returning an object wins).
 * Upstream evaluates them in `LitElementRenderer.connectedCallback()`, i.e. after the element's static and dynamic
 * attributes were set; swc-ssr evaluates them at the same point for the elements its renderers build, and for
 * pre-instantiated (pooled) elements right after their recorded attributes / properties were applied - before
 * anything connects or updates them.
 */
import {LitElementRenderer} from '@lit-labs/ssr/lib/lit-element-renderer.js';
import {errorMessage} from './context.js';
import type {ElementReport} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ElementRenderOptions {
  connectedCallback?: boolean;
  disableSsr?: boolean;
}

type RenderOptionsCallback = (element: HTMLElement) => ElementRenderOptions | undefined | null;

export function resolveRenderOptions(element: HTMLElement, report?: ElementReport): ElementRenderOptions | undefined {
  // Only Lit elements are rendered by LitElementRenderer (and its subclasses), so only they get render options.
  if (!(element?.constructor as any)?._$litElement$) {
    return undefined;
  }
  const callbacks = ((LitElementRenderer as any).renderOptions ?? []) as RenderOptionsCallback[];
  for (const callback of callbacks) {
    let options: ElementRenderOptions | undefined | null;
    try {
      options = callback(element);
    } catch (error) {
      report?.errors.push(`LitElementRenderer.renderOptions callback: ${errorMessage(error)}`);
      continue;
    }
    if (options) {
      return options;
    }
  }
  return undefined;
}
