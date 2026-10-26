/**
 * `<sp-breadcrumbs>` (`breadcrumbs/src/Breadcrumbs.js`): which items stay visible and which collapse into the
 * overflow `<sp-action-menu>` is decided by `adjustOverflow()` from measured widths (`list.clientWidth`, each item's
 * `offsetWidth`). The server has no layout - every width is 0, so all items but the last would collapse into the
 * menu, which is what the page shows without JavaScript and what then visibly jumps when the browser lays it out.
 *
 * The server assumes there is room for the items instead: the last `max-visible-items` (default 4) items are
 * visible and only the rest goes into the menu - the same result `adjustOverflow()` computes in a browser whenever
 * the bar is wide enough. The browser recomputes from real widths after hydration (slotchange / ResizeObserver).
 * The client counterpart (`spectrum-web-components-ssr/client`, hooks.ts) restores this state before hydrating.
 */
import type {ElementAdapter} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function adjustOverflowWithoutLayout(this: any): void {
  const items: any[] = Array.isArray(this.items) ? this.items : [];
  if (items.length === 0) {
    return;
  }
  const visible = Math.min(items.length, Math.max(Number(this.maxVisibleItems) || 0, 1));
  items.forEach((item, index) => {
    item.isVisible = index >= items.length - visible;
  });
  if (visible !== this.visibleItems) {
    this.visibleItems = visible;
  }
}

export const breadcrumbsAdapter: ElementAdapter = {
  tag: 'sp-breadcrumbs',
  prepare(element) {
    Object.defineProperty(element, 'adjustOverflow', {
      value: adjustOverflowWithoutLayout,
      configurable: true,
      writable: true,
    });
  },
};
