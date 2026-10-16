import type {Page} from '@playwright/test';

/**
 * Helpers of tests/styles-dedupe.spec.ts (`StyleOptions.dedupe: 'link'`, swc-ssr 0.3.0): the server writes
 * `<link rel="stylesheet" href="/swc-css/<hash>.css" data-swc-styles="...">` into the declarative shadow roots instead
 * of `<style>` copies, and preload hints into the page's `<head>`.
 */

/** `href`s of the server's stylesheet links in a page's HTML, in document order (with repetitions). */
export function linkedHrefs(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" data-swc-styles="(?:trimmed|minified|complete)">/g)].map(
    (match) => match[1]!.replace(/&amp;/g, '&'),
  );
}

/** `href`s of the `<link rel="preload" as="style">` hints in the page's `<head>`, in order. */
export function preloadHrefs(html: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
  return [...head.matchAll(/<link rel="preload" href="([^"]+)" as="style">/g)].map((match) => match[1]!.replace(/&amp;/g, '&'));
}

export interface ServerStylesLeft {
  /** `<style data-swc-styles>` that are direct children of an open shadow root (any depth). */
  markedStyles: number;
  /** `<link data-swc-styles>` that are direct children of an open shadow root (any depth). */
  links: number;
  /** Of those, the ones whose sheet is not loaded (`link.sheet === null`). */
  linksWithoutSheet: number;
  /** Host tags of the roots that still hold any of them (at most 8). */
  tags: string[];
}

/** Browser function (`page.evaluate`): the server style elements left in the document's shadow roots. */
export function serverStylesLeft(): ServerStylesLeft {
  const result: ServerStylesLeft = {markedStyles: 0, links: 0, linksWithoutSheet: 0, tags: []};
  const visit = (root: Document | ShadowRoot): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadow = (el as HTMLElement).shadowRoot;
      if (!shadow) continue;
      let found = false;
      for (const child of Array.from(shadow.children)) {
        if (!child.hasAttribute('data-swc-styles')) continue;
        if (child.localName === 'style') {
          result.markedStyles++;
          found = true;
        } else if (child.localName === 'link') {
          result.links++;
          if ((child as HTMLLinkElement).sheet === null) result.linksWithoutSheet++;
          found = true;
        }
      }
      if (found && result.tags.length < 8 && !result.tags.includes(el.localName)) result.tags.push(el.localName);
      visit(shadow);
    }
  };
  visit(document);
  return result;
}

/**
 * Init script (`page.addInitScript` / `context.addInitScript`): runs at every rendering opportunity (a
 * requestAnimationFrame callback runs right before its frame is rendered) and records per frame
 *   unstyled  hosts inside the viewport that have rendered content (shadow content other than the server style
 *             elements, or light-DOM children) while one of their server `<link data-swc-styles>` has no sheet yet:
 *             content painted without its CSS (the flash `dedupe: 'link'` can cause);
 *   pending   hosts with such a pending link at all (in Chromium the parser waits at it: nothing after it exists yet).
 * Read with `readFirstFrames`.
 */
export const FIRST_FRAME_OBSERVER = `(() => {
  if (window.__swcFrames) return;
  const frames = [];
  window.__swcFrames = frames;
  window.__swcFramesStop = false;
  let fcp = null;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') fcp = e.startTime;
    }).observe({type: 'paint', buffered: true});
  } catch {}
  window.__swcFcp = () => fcp;
  const isServerStyle = (n) => n.nodeType === 1 && (n.localName === 'style' || (n.localName === 'link' && n.hasAttribute('data-swc-styles')));
  const hasContent = (host, root) => {
    for (const n of root.childNodes) {
      if (isServerStyle(n) || n.nodeType === 8 || (n.nodeType === 3 && !n.data.trim())) continue;
      return true;
    }
    for (const n of host.childNodes) {
      if (n.nodeType === 1 || (n.nodeType === 3 && n.data.trim())) return true;
    }
    return false;
  };
  const visit = (root, acc) => {
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const sr = el.shadowRoot;
      if (!sr) continue;
      let pending = 0;
      for (const child of sr.children) {
        if (child.localName === 'link' && child.hasAttribute('data-swc-styles') && !child.sheet) pending++;
      }
      if (pending) {
        acc.pending++;
        if (hasContent(el, sr)) {
          const r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0 && r.height > 0) {
            acc.unstyled++;
            if (acc.tags.length < 6 && !acc.tags.includes(el.localName)) acc.tags.push(el.localName);
          }
        }
      }
      visit(sr, acc);
    }
  };
  const loop = () => {
    if (window.__swcFramesStop) return;
    const acc = {pending: 0, unstyled: 0, tags: []};
    if (document.body) visit(document, acc);
    frames.push({t: Math.round(performance.now()), state: document.readyState, els: document.body ? document.body.querySelectorAll('*').length : 0, ...acc});
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

export interface FirstFrames {
  /** Rendered frames with content (the body has more than `#app`). */
  frames: number;
  /** Of those, frames rendered while the document was still loading (progressive rendering). */
  partialFrames: number;
  /** Frames in which some host's content was painted without its linked sheet. */
  unstyledFrames: number;
  unstyledTags: string[];
  /** Hosts with a pending link in the first frame with content. */
  firstFramePending: number | null;
  fcp: number | null;
  dcl: number | null;
  load: number | null;
}

/** Stops the observer of `FIRST_FRAME_OBSERVER` and summarizes what it recorded. */
export async function readFirstFrames(page: Page): Promise<FirstFrames> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __swcFramesStop?: boolean;
      __swcFrames?: Array<{t: number; state: string; els: number; pending: number; unstyled: number; tags: string[]}>;
      __swcFcp?: () => number | null;
    };
    w.__swcFramesStop = true;
    const content = (w.__swcFrames ?? []).filter((frame) => frame.els > 1);
    const unstyled = content.filter((frame) => frame.unstyled > 0);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcp = typeof w.__swcFcp === 'function' ? w.__swcFcp() : null;
    return {
      frames: content.length,
      partialFrames: content.filter((frame) => frame.state === 'loading').length,
      unstyledFrames: unstyled.length,
      unstyledTags: [...new Set(unstyled.flatMap((frame) => frame.tags))].slice(0, 6),
      firstFramePending: content[0]?.pending ?? null,
      fcp: fcp === null ? null : Math.round(fcp),
      dcl: nav ? Math.round(nav.domContentLoadedEventStart) : null,
      load: nav ? Math.round(nav.loadEventStart) : null,
    };
  });
}
