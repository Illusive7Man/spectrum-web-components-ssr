/**
 * `<sp-theme>` (`theme/src/Theme.js`) is rendered by the dedicated `ThemeRenderer`. Its own lifecycle must never
 * run on the server: `connectedCallback` adds the instance to the static `Theme.instances` set (a leak across
 * renders) and schedules `adoptStyles()` (adoptedStyleSheets).
 */
import type {ElementAdapter} from '../types.js';

export const themeAdapter: ElementAdapter = {
  tag: 'sp-theme',
  lifecycle: 'none',
};
