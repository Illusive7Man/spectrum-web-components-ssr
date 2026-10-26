import fs from 'node:fs';
import path from 'node:path';
import type {APIRequestContext, Browser, BrowserContext, Page} from '@playwright/test';
import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';
import {RESULTS_DIR} from './results.ts';

/**
 * Helpers of tests/styles.spec.ts, the oracle for `renderSpectrum({styles: {mode: 'trimmed'}})`: trimmed CSS must
 * render exactly like the full CSS (docs/API.md "Styles").
 */

/** `?styles=` of the demo server. */
export type StylesMode = 'full' | 'trimmed' | 'minified';

export const STYLES_DIR = path.join(RESULTS_DIR, 'styles');

/** Viewport of every oracle page: the same for the full and the trimmed page, so that layouts are comparable. */
export const ORACLE_VIEWPORT = {width: 1280, height: 800};

/** The CSS-only part of a section is settled after this long (the specs wait it after every load / interaction). */
export const SETTLE_MS = 300;

/** A page of the demo: one catalog entry (`/component/<name>`) or the whole catalog (`/`). */
export interface StylesTarget {
  /** Row of the results store (catalog entry name, or `STYLES_PAGE_ROW` for `/`). */
  row: string;
  /** Entry name; undefined for `/`. */
  name?: string;
  interactive: boolean;
}

/** Path + query of a target's page. `extra` is appended verbatim (`nohydrate=1`, `removeStyles=1`). */
export function pageUrl(target: StylesTarget, mode: StylesMode, extra: string[] = []): string {
  const base = target.name === undefined ? '/' : `/component/${encodeURIComponent(target.name)}`;
  return `${base}?${[...extra, `styles=${mode}`].join('&')}`;
}

/** A browser context without JavaScript, the viewport / scale factor / motion preference every oracle page shares. */
export async function newOracleContext(
  browser: Browser,
  baseURL: string | undefined,
  options: {javaScriptEnabled: boolean},
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    javaScriptEnabled: options.javaScriptEnabled,
    viewport: ORACLE_VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
}

// ---------------------------------------------------------------------------------------------
// Exact pixel comparison
// ---------------------------------------------------------------------------------------------

export interface ExactDiff {
  /** pixelmatch with threshold 0 and anti-aliased pixels counted: any differing pixel in the overlapping area. */
  diffPixels: number;
  /** The decoded pixel data is byte-identical (also covers the alpha channel and sizes). */
  identical: boolean;
  sizeChanged: boolean;
  width: number;
  height: number;
  a: {width: number; height: number};
  b: {width: number; height: number};
  diffPng: Buffer;
}

function cropData(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) return png.data;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = y * png.width * 4;
    png.data.copy(out, y * width * 4, from, from + width * 4);
  }
  return out;
}

/**
 * pixelmatch with `threshold: 0` and `includeAA: true` (nothing is forgiven, anti-aliasing included) plus a byte
 * comparison of the decoded pixels. Sizes that differ are compared over the overlapping top-left area and flagged.
 */
export function exactDiff(aPng: Buffer, bPng: Buffer): ExactDiff {
  const a = PNG.sync.read(aPng);
  const b = PNG.sync.read(bPng);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  if (width * height === 0) {
    throw new Error(`cannot compare empty screenshots (${a.width}x${a.height} vs ${b.width}x${b.height})`);
  }
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  const pa = cropData(a, width, height);
  const pb = cropData(b, width, height);
  const diff = new PNG({width, height});
  const diffPixels = pixelmatch(pa, pb, diff.data, width, height, {threshold: 0, includeAA: true});
  return {
    diffPixels,
    identical: !sizeChanged && pa.equals(pb),
    sizeChanged,
    width,
    height,
    a: {width: a.width, height: a.height},
    b: {width: b.width, height: b.height},
    diffPng: PNG.sync.write(diff),
  };
}

const safe = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'page';

/**
 * Writes the reference / other / diff images of a mismatch to tests/results/styles/ (`<label>.<referenceLabel>.png`,
 * `<label>.<otherLabel>.png`, `<label>.<otherLabel>.diff.png`); returns the repo-relative paths. The reference is
 * `full` (the full-CSS page) unless the comparison says otherwise.
 */
export function saveMismatch(
  label: string,
  otherLabel: string,
  images: {full: Buffer; other: Buffer; diff: Buffer},
  referenceLabel = 'full',
): string[] {
  fs.mkdirSync(STYLES_DIR, {recursive: true});
  const base = safe(label);
  const files = {
    [`${base}.${safe(referenceLabel)}.png`]: images.full,
    [`${base}.${safe(otherLabel)}.png`]: images.other,
    [`${base}.${safe(otherLabel)}.diff.png`]: images.diff,
  };
  return Object.entries(files).map(([file, data]) => {
    const target = path.join(STYLES_DIR, file);
    fs.writeFileSync(target, data);
    return path.relative(process.cwd(), target).replace(/\\/g, '/');
  });
}

// ---------------------------------------------------------------------------------------------
// /styles.json
// ---------------------------------------------------------------------------------------------

/** Response of the demo server's `GET /styles.json` (demo/src/server.ts). */
export interface StylesInfo {
  component: string;
  styles: StylesMode;
  /** The server core reported `report.styles`. */
  reported: boolean;
  /** From `report.styles`; the measured CSS size when nothing was reported. */
  fullBytes: number;
  trimmedBytes: number;
  /** Measured: the text of every <style> element of the document. */
  cssBytes: number;
  htmlBytes: number;
  /** gzip of the whole document. */
  gzipBytes: number;
  sheets: Array<{id: string; tag: string; instances: number; fullBytes: number; trimmedBytes: number}>;
  durationMs: number | null;
  elements: number;
}

export async function fetchStylesInfo(
  request: APIRequestContext,
  target: StylesTarget,
  mode: StylesMode,
  timeoutMs: number,
): Promise<StylesInfo> {
  const component = target.name === undefined ? '' : `component=${encodeURIComponent(target.name)}&`;
  const url = `/styles.json?${component}styles=${mode}`;
  const res = await request.get(url, {timeout: timeoutMs});
  if (res.status() !== 200) {
    throw new Error(`GET ${url} -> ${res.status()}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as StylesInfo;
}

/** `1234567` -> `1205.6` (KiB, one decimal). */
export const kib = (bytes: number): string => (bytes / 1024).toFixed(1);

// ---------------------------------------------------------------------------------------------
// Browser-side helpers (passed to page.evaluate: self-contained)
// ---------------------------------------------------------------------------------------------

export interface ShadowStyles {
  /** Direct `<style>` children of the shadow roots of `sp-*` elements (all depths, open shadow roots only). */
  total: number;
  /** `<style data-swc-styles>` (trimmed / minified server CSS) in ANY open shadow root, whatever its host. */
  marked: number;
  /** Marked `<style>` count per host tag (any host), only tags that have any. */
  markedByTag: Record<string, number>;
  /** `sp-*` hosts that have a shadow root. */
  hosts: number;
  /** `sp-*` hosts whose shadow root has adopted style sheets. */
  adopted: number;
  /** `<style>` count per host tag, only tags that have any. */
  byTag: Record<string, number>;
  /**
   * Hydrated `sp-*` Lit elements (upgraded, first update done, their class has `elementStyles`): after hydration of a
   * trimmed / minified page each of them must run on adopted sheets (spectrum-web-components-ssr/client restores the complete ones).
   */
  litElements: number;
  /** Of those, the ones whose shadow root has NO adopted style sheets, per tag. */
  litWithoutAdopted: Record<string, number>;
}

/**
 * Counts the `<style>` elements that are direct children of `sp-*` shadow roots, the roots with adopted sheets, the
 * marked server `<style>`s left in any shadow root, and the hydrated Lit `sp-*` elements without adopted sheets.
 */
export function collectShadowStyles(): ShadowStyles {
  const result: ShadowStyles = {
    total: 0,
    marked: 0,
    markedByTag: {},
    hosts: 0,
    adopted: 0,
    byTag: {},
    litElements: 0,
    litWithoutAdopted: {},
  };
  const visit = (el: Element): void => {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      const adoptedCount = (shadow as ShadowRoot & {adoptedStyleSheets?: unknown[]}).adoptedStyleSheets?.length ?? 0;
      const styles = Array.from(shadow.children).filter((child) => child.localName === 'style');
      const marked = styles.filter((style) => style.hasAttribute('data-swc-styles')).length;
      if (marked > 0) {
        result.marked += marked;
        result.markedByTag[el.localName] = (result.markedByTag[el.localName] ?? 0) + marked;
      }
      if (el.localName.startsWith('sp-')) {
        result.hosts++;
        if (adoptedCount > 0) result.adopted++;
        if (styles.length > 0) {
          result.total += styles.length;
          result.byTag[el.localName] = (result.byTag[el.localName] ?? 0) + styles.length;
        }
        const ctor = customElements.get(el.localName) as (CustomElementConstructor & {elementStyles?: unknown[]}) | undefined;
        const lit = el as Element & {hasUpdated?: boolean};
        if (ctor && el instanceof ctor && Array.isArray(ctor.elementStyles) && ctor.elementStyles.length > 0 && lit.hasUpdated === true) {
          result.litElements++;
          if (adoptedCount === 0) result.litWithoutAdopted[el.localName] = (result.litWithoutAdopted[el.localName] ?? 0) + 1;
        }
      }
      for (const child of Array.from(shadow.children)) visit(child);
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(document.documentElement);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Hydrated page: states the server did not render
// ---------------------------------------------------------------------------------------------

/**
 * Attributes set on every `sp-*` element of a hydrated section, group by group (`applyStates`). Trimmed server CSS
 * keeps `:host([selected])` only when an instance rendered `selected`: a hydrated trimmed page must still style the
 * states the page enters later, which is what spectrum-web-components-ssr/client's server-styles restore is for. The groups pair states
 * that do not hide each other (`disabled` goes last and alone: it dims most components).
 */
export const STATE_GROUPS: ReadonlyArray<readonly string[]> = [
  ['selected', 'quiet'],
  ['emphasized', 'invalid'],
  ['checked', 'readonly'],
  ['disabled', 'dragged'],
];

/**
 * Sets `attrs` (empty value) on every compatible `sp-*` element below `rootSelector` (not `sp-theme`; light DOM, which
 * is where the demo's components are) that does not have them, and waits for the elements' updates. Array/Object
 * properties are skipped: an empty attribute is invalid JSON, so Lit converts it to `null` rather than a usable state.
 * Returns the number of attributes added; `clearStates` takes them off again.
 */
export async function applyStates(page: Page, rootSelector: string, attrs: readonly string[]): Promise<number> {
  return page.evaluate(
    async ({root, names}) => {
      const scope = document.querySelector(root);
      if (!scope) return 0;
      const added: Array<[Element, string]> = [];
      for (const el of Array.from(scope.querySelectorAll('*'))) {
        if (!el.localName.startsWith('sp-') || el.localName === 'sp-theme') continue;
        for (const name of names) {
          if (el.hasAttribute(name)) continue;
          const declaration = (
            el.constructor as typeof HTMLElement & {
              elementProperties?: Map<PropertyKey, {type?: unknown}>;
            }
          ).elementProperties?.get(name);
          if (declaration?.type === Array || declaration?.type === Object) continue;
          el.setAttribute(name, '');
          added.push([el, name]);
        }
      }
      (window as unknown as {__swcStyleStates?: unknown}).__swcStyleStates = added;
      // Bounded: an element whose update never settles must not hang the test (hydrateSpectrum() reports those).
      await Promise.race([
        Promise.all(
          added.map(async ([el]) => {
            try {
              await (el as unknown as {updateComplete?: Promise<unknown>}).updateComplete;
            } catch {
              /* an element that cannot update with this state is the same on both pages */
            }
          }),
        ),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      return added.length;
    },
    {root: rootSelector, names: [...attrs]},
  );
}

/** Takes the attributes `applyStates` added off again. */
export async function clearStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {__swcStyleStates?: Array<[Element, string]>};
    for (const [el, name] of w.__swcStyleStates ?? []) el.removeAttribute(name);
    w.__swcStyleStates = [];
  });
}

/**
 * Paints the whole page again (the root is hidden for two frames, then shown: no layout, no style recalculation) so
 * that a screenshot shows what the current styles paint, not what an earlier paint left in the raster cache.
 *
 * Why: a hydrated page that swapped its style sources (a minified element adopts the complete stylesheets, the theme
 * drops its bridge) repaints regions whose computed values did not change, and Chrome then rasterizes the
 * anti-aliased edge pixels of some rounded borders one colour level differently from the first paint (probed:
 * 8 pixels of the `field-label` text fields, deterministic, equal to the full-CSS page after any later repaint; the
 * computed styles, pseudo-elements and layout rectangles of both pages are identical). The pages that are compared
 * are repainted the same way, so a difference that remains is a difference of the CSS.
 */
export async function forceRepaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const root = document.documentElement;
        root.style.visibility = 'hidden';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            root.style.visibility = '';
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
        );
      }),
  );
}

// ---------------------------------------------------------------------------------------------
// Hydrated page (normal timing): manipulations after hydration (`post-hydration:states`)
// ---------------------------------------------------------------------------------------------

/**
 * The steps of `post-hydration:states`, applied in this order (cumulatively) to a hydrated page and captured after each:
 * the pointer and focus on the first control, a click on it, then attribute changes through the DOM that the server did
 * not render: `disabled` on that control, `size="xl"` on the first sp-button / sp-action-button, `quiet` toggled on the
 * first sp-* element that has the property, `selected` on the first sp-menu-item / sp-tab without it, `invalid` on the
 * first text field. Steps whose element the section does not have are skipped (on every page alike).
 */
export const POST_STEPS = ['hover', 'focus', 'click', 'disabled', 'size-xl', 'quiet', 'selected', 'invalid'] as const;
export type PostStep = (typeof POST_STEPS)[number];
export type DomStep = Exclude<PostStep, 'hover' | 'focus' | 'click'>;

/**
 * Keeps a click from leaving the page: a click whose path holds an anchor that would navigate to another document
 * (or download) is prevented, as is a form submission. Fragment links (`#x`, every link of the demo catalog) stay.
 */
export function installNavigationGuard(): void {
  const w = window as unknown as {__swcNavigationGuard?: boolean};
  if (w.__swcNavigationGuard) return;
  w.__swcNavigationGuard = true;
  window.addEventListener(
    'click',
    (event) => {
      for (const node of event.composedPath()) {
        if (!(node instanceof HTMLAnchorElement) || !node.hasAttribute('href')) continue;
        const href = node.getAttribute('href') ?? '';
        if (node.hasAttribute('download') || node.target === '_blank' || !href.startsWith('#')) event.preventDefault();
        return;
      }
    },
    true,
  );
  window.addEventListener('submit', (event) => event.preventDefault(), true);
}

/**
 * Applies a DOM step of `POST_STEPS` inside `root` (light DOM) and waits for the affected element's update and for
 * every sp-* element of the scope to settle (bounded). `window.__swcControl` is the control of the pointer steps.
 * Returns the tag of the element that was changed, or null when the section has none for this step.
 */
export async function applyDomStep(page: Page, rootSelector: string, step: DomStep): Promise<string | null> {
  return page.evaluate(
    async ({root, kind}) => {
      const scope = document.querySelector(root);
      if (!scope) return null;
      const all = Array.from(scope.querySelectorAll('*'));
      const first = (selector: string, filter?: (el: Element) => boolean): Element | undefined =>
        all.find((el) => el.matches(selector) && (!filter || filter(el)));
      let target: Element | undefined;
      switch (kind) {
        case 'disabled':
          target = (window as unknown as {__swcControl?: Element}).__swcControl;
          target?.setAttribute('disabled', '');
          break;
        case 'size-xl':
          target = first('sp-button, sp-action-button');
          target?.setAttribute('size', 'xl');
          break;
        case 'quiet':
          target = all.find((el) => el.localName.startsWith('sp-') && el.localName !== 'sp-theme' && 'quiet' in el);
          target?.toggleAttribute('quiet');
          break;
        case 'selected':
          target = first('sp-menu-item, sp-tab', (el) => !el.hasAttribute('selected'));
          target?.setAttribute('selected', '');
          break;
        case 'invalid':
          target = first('sp-textfield, sp-number-field, sp-search, sp-combobox', (el) => !el.hasAttribute('invalid'));
          target?.setAttribute('invalid', '');
          break;
      }
      if (!target) return null;
      const settle = async (el: Element): Promise<void> => {
        try {
          await (el as unknown as {updateComplete?: Promise<unknown>}).updateComplete;
        } catch {
          /* the same on every page */
        }
      };
      const bounded = (work: Promise<unknown>) => Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2000))]);
      await bounded(settle(target));
      await bounded(Promise.all(all.filter((el) => el.localName.startsWith('sp-')).map(settle)));
      return target.localName;
    },
    {root: rootSelector, kind: step},
  );
}
