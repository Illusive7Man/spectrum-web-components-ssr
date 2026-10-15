/**
 * `<sp-color-wheel>` (`color-wheel/src/ColorWheel.js`) draws its track with clip paths whose geometry
 * `calculateStyleData()` derives from the measured size (`getBoundingClientRect()`, cached by `cacheLayoutData()`)
 * and from the computed `--_border-width` / `--_track-width`. On the server every size is 0 and custom properties
 * do not compute, so the wheel would be rendered 0px wide (no wheel at all in the server markup, and a jump when
 * the browser renders it).
 *
 * The server computes the same geometry from the design tokens the wheel's CSS resolves to instead
 * (`--spectrum-color-wheel-width` / `--spectrum-color-control-track-width` of the theme scale, 1px border), i.e.
 * the size the wheel has in a browser unless the application overrides it (an inline px width is honoured). The
 * browser re-measures after hydration (`firstUpdated()` / ResizeObserver).
 */
import type {ElementAdapter} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCALES: Record<string, {diameter: number; track: number}> = {
  medium: {diameter: 192, track: 24},
  large: {diameter: 240, track: 30},
};
const BORDER_WIDTH = 1;

/** `scale` of the closest `<sp-theme>` (crossing shadow boundaries), default medium. */
function scaleOf(element: any): string {
  let node = element;
  for (let depth = 0; node && depth < 1000; depth++) {
    if (node.localName === 'sp-theme' && typeof node.getAttribute === 'function') {
      const scale = node.getAttribute('scale');
      if (scale && SCALES[scale]) {
        return scale;
      }
    }
    const parent = node.parentElement ?? null;
    if (parent) {
      node = parent;
      continue;
    }
    const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    node = root && root !== node && root.host ? root.host : null;
  }
  return 'medium';
}

/** A px width given inline (`style="width: 200px"`, `inline-size`, `--mod-colorwheel-width`), if any. */
function inlineWidth(element: any): number | undefined {
  const style = typeof element.getAttribute === 'function' ? element.getAttribute('style') : null;
  const match = style ? /(?:^|;)\s*(?:width|inline-size|--mod-colorwheel-width)\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style) : null;
  return match ? Number(match[1]) : undefined;
}

/** `ColorWheel.calculateStyleData()` with token (or inline) sizes instead of measured ones. */
function calculateStyleData(this: any) {
  const tokens = SCALES[scaleOf(this)];
  const diameter = inlineWidth(this) ?? tokens.diameter;
  const trackWidth = tokens.track;
  const borderWidth = BORDER_WIDTH;
  const radius = diameter / 2;
  const diameterAfterBoarder = diameter - borderWidth * 2;
  const radiusAfterBoarder = radius - borderWidth;
  const innerRadius = radius - trackWidth;
  const innerDiameter = innerRadius * 2;
  const innerRadiusAfterBorder = innerRadius + borderWidth;
  const innerDiameterAfterBorder = innerDiameter + borderWidth * 2;
  const clipPathBorders = `"M ${radius} ${radius} m -${radius} 0 a ${radius} ${radius} 0 1 0 ${diameter} 0 a ${radius} ${radius} 0 1 0 -${diameter} 0 M ${radius} ${radius} m -${innerRadius} 0 a ${innerRadius} ${innerRadius} 0 1 0 ${innerDiameter} 0 a ${innerRadius} ${innerRadius} 0 1 0 -${innerDiameter} 0"`;
  const clipPath = `"M ${radiusAfterBoarder} ${radiusAfterBoarder} m -${radiusAfterBoarder} 0 a ${radiusAfterBoarder} ${radiusAfterBoarder} 0 1 0 ${diameterAfterBoarder} 0 a ${radiusAfterBoarder} ${radiusAfterBoarder} 0 1 0 -${diameterAfterBoarder} 0 M ${radiusAfterBoarder} ${radiusAfterBoarder} m -${innerRadiusAfterBorder} 0 a ${innerRadiusAfterBorder} ${innerRadiusAfterBorder} 0 1 0 ${innerDiameterAfterBorder} 0 a ${innerRadiusAfterBorder} ${innerRadiusAfterBorder} 0 1 0 -${innerDiameterAfterBorder} 0"`;
  const value = Number(this.value) || 0;
  const translateX = (this.dir === 'rtl' ? -1 : 1) * (radius - trackWidth / 2) * Math.cos((value * Math.PI) / 180);
  const translateY = (radius - trackWidth / 2) * Math.sin((value * Math.PI) / 180);
  const handleLocationStyles = `transform: translate(${translateX}px, ${translateY}px);`;
  return {clipPath, clipPathBorders, diameter, handleLocationStyles};
}

export const colorWheelAdapter: ElementAdapter = {
  tag: 'sp-color-wheel',
  prepare(element) {
    Object.defineProperty(element, 'calculateStyleData', {value: calculateStyleData, configurable: true, writable: true});
  },
};
