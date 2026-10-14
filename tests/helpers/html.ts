/** Helpers that inspect the raw SSR HTML string (no browser involved). */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the outer HTML of `<section ... data-component="name">...</section>` (nesting-aware), or null.
 * The match is purely textual, so it works on the unparsed server response.
 */
export function extractSection(html: string, name: string): string | null {
  const open = new RegExp(`<section\\b[^>]*\\sdata-component=(?:"${escapeRegExp(name)}"|'${escapeRegExp(name)}'|${escapeRegExp(name)}(?=[\\s>/]))[^>]*>`, 'i');
  const match = open.exec(html);
  if (!match) return null;
  const start = match.index;
  const bodyStart = start + match[0].length;

  const tokens = /<(\/?)section\b[^>]*>/gi;
  tokens.lastIndex = bodyStart;
  let depth = 1;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(html))) {
    depth += token[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, token.index + token[0].length);
  }
  return html.slice(start); // unterminated: return the rest
}

/**
 * Spectrum custom elements that never have a shadow root, not even when rendered in the browser, so the
 * "declarative shadow root for every sp-* element" check does not apply to them:
 *  - `sp-tooltip-openable`: a plain `HTMLElement` wrapper defined in `tooltip/src/Tooltip.js` that self-managed
 *    tooltips render into their overlay.
 */
export const SHADOWLESS_TAGS: ReadonlySet<string> = new Set(['sp-tooltip-openable']);

/** Distinct `sp-*` tag names that appear as start tags in `html` (document order of first occurrence). */
export function distinctSpTags(html: string): string[] {
  const seen = new Set<string>();
  const re = /<(sp-[a-z0-9]+(?:-[a-z0-9]+)*)(?=[\s/>])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) seen.add(m[1]!.toLowerCase());
  return [...seen];
}

/**
 * True if at least one `<tag ...>` start tag is immediately followed by `<template shadowrootmode`, i.e. the element
 * was serialized with a declarative shadow root.
 */
export function hasDeclarativeShadowRoot(html: string, tag: string): boolean {
  const re = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>\\s*<template\\s[^>]*shadowrootmode`, 'i');
  return re.test(html);
}

/** Number of `<template shadowrootmode` occurrences. */
export function countDeclarativeShadowRoots(html: string): number {
  return (html.match(/<template\s[^>]*shadowrootmode/gi) ?? []).length;
}
