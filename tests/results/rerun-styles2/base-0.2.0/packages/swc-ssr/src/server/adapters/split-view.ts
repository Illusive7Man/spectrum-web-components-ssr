/**
 * `<sp-split-view>` (`split-view/src/SplitView.js`) positions its splitter from measured sizes: `checkResize()`
 * reads `offsetWidth` / `offsetHeight` into `viewSize`, derives `minPos` / `maxPos`, and starts at
 * `primary-size` (px or % of `viewSize`) or half of `viewSize`. On the server every size is 0, so the splitter
 * would be clamped to 0 - a collapsed first pane (`--spectrum-split-view-first-pane-size: 0px`, classes
 * `is-collapsed-start` / `is-resized-start`) - and lit's `classMap` in the browser never removes classes its
 * first client render did not set, so the collapsed look would even survive hydration.
 *
 * Without layout the server keeps `splitterPos` unset (no resized/collapsed classes) and expresses the start
 * position in CSS instead: the `primary-size` length or percentage, otherwise 50%. `viewSize` is 100 so that
 * `aria-valuenow` reads as a percentage. The browser measures and positions the splitter after hydration.
 */
import type {ElementAdapter} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function checkResizeWithoutLayout(this: any): Promise<void> {
  if (!this.enoughChildren) {
    return;
  }
  this.viewSize = 100;
  this.minPos = 0;
  this.maxPos = 100;
  const size = typeof this.primarySize === 'string' ? this.primarySize.trim() : undefined;
  if (size && /^\d+(px)?$/.test(size)) {
    this.firstPaneSize = `${parseInt(size, 10)}px`;
  } else if (size && /^\d+%$/.test(size)) {
    this.firstPaneSize = size;
  } else if (size === 'auto') {
    this.firstPaneSize = 'auto';
  } else {
    this.firstPaneSize = '50%';
  }
}

export const splitViewAdapter: ElementAdapter = {
  tag: 'sp-split-view',
  prepare(element) {
    Object.defineProperty(element, 'checkResize', {value: checkResizeWithoutLayout, configurable: true, writable: true});
  },
};
