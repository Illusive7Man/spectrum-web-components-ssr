/**
 * Browser-side DOM helpers. Every exported function here is meant to be passed to `page.evaluate` /
 * `locator.evaluate` and is therefore completely self-contained: it must not reference anything outside its own
 * body (Playwright ships `fn.toString()` to the page). That is why helpers are declared inside each function.
 */

export interface SerializeOptions {
  /** Extra attribute names (lowercase) to leave out, e.g. generated ids. */
  ignoreAttributes?: string[];
  /**
   * Keep attribute values verbatim instead of collapsing / trimming their whitespace (generated ids are still
   * canonicalized token by token, `style` is still compared by declarations). Used by the stricter section
   * comparison of tests/all-components.spec.ts, where e.g. a trailing space in `aria-labelledby` must show.
   */
  rawAttributeValues?: boolean;
}

/**
 * Serializes `root` (light DOM and open shadow roots, recursively) to a normalized, indentation-based tree string.
 *
 * Normalization (so that an SSR'd+hydrated DOM can be compared with a client-rendered one):
 *  - lowercase tag names, attributes sorted by name, values whitespace-collapsed
 *  - attributes `defer-hydration`, `data-swc-ssr` and `hydrate-internals-*` are dropped
 *  - comment nodes are dropped (Lit marker comments)
 *  - `<style>` and `<link rel=stylesheet>` inside shadow trees are dropped (SSR emits them into the declarative
 *    shadow root, CSR uses adoptedStyleSheets)
 *  - text nodes separated only by comments are merged, whitespace-only text is dropped, text is trimmed/collapsed
 *  - generated ids: in id / id-reference attributes (`id`, `for`, `aria-labelledby`, `aria-controls`, ..., and slot
 *    names) tokens that end in a generated part - Spectrum's `randomID()` (8 hex digits, `shared/src/random-id.js`)
 *    or an instance counter (`-<digits>`, e.g. `contextual-help-popover-3`) - are replaced by `<prefix>#<n>`, n
 *    numbering the distinct values in order of first appearance. Two client renders never produce the same random
 *    ids, so only the reference structure can be compared: every `aria-labelledby` still has to point at the same
 *    element as in the reference DOM.
 *  - `style` attributes are compared by their declarations (`element.style.cssText`), not their formatting
 *  - form controls are compared by their live state: `<input>` / `<textarea>` / `<select>` drop the `value` and
 *    `checked` attributes (and a textarea its text content) - the server transports the state of `.value` /
 *    `.checked` property bindings through them, client rendering sets only the properties - and get `.value` /
 *    `.checked` pseudo-attributes with the current property values instead.
 *
 * Usage: `await page.locator('section[data-component="x"]').evaluate(serializeTree, {})`.
 */
export function serializeTree(root: Element, opts?: SerializeOptions): string {
  const ignoredNames = new Set(['defer-hydration', 'data-swc-ssr']);
  for (const name of opts?.ignoreAttributes ?? []) ignoredNames.add(name.toLowerCase());
  const ignoredPrefixes = ['hydrate-internals-'];
  const lines: string[] = [];

  const ID_ATTRIBUTES = new Set([
    'id',
    'for',
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-activedescendant',
    'aria-details',
    'aria-errormessage',
    'aria-flowto',
    'headers',
    'list',
    'form',
    'slot',
  ]);
  const GENERATED = /^(.*?-)((?:\d+-)?[0-9a-f]{8}|\d+)$/;
  const canonical = new Map<string, string>();
  const canonicalId = (token: string): string => {
    const match = GENERATED.exec(token);
    if (!match) return token;
    let value = canonical.get(token);
    if (value === undefined) {
      value = `${match[1]}#${canonical.size + 1}`;
      canonical.set(token, value);
    }
    return value;
  };
  const isIdAttribute = (el: Element, name: string): boolean =>
    ID_ATTRIBUTES.has(name) || (name === 'name' && el.localName === 'slot');

  const FORM_CONTROLS = new Set(['input', 'textarea', 'select']);
  const isFormControl = (el: Element): boolean => FORM_CONTROLS.has(el.localName);
  const formState = (el: Element): string => {
    const control = el as HTMLInputElement;
    let state = ` .value="${collapse(String(control.value ?? ''))}"`;
    if (el.localName === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
      state += ` .checked="${control.checked}"`;
    }
    return state;
  };

  const pad = (depth: number): string => '  '.repeat(depth);
  const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

  const isIgnoredAttribute = (name: string): boolean => {
    const lower = name.toLowerCase();
    return ignoredNames.has(lower) || ignoredPrefixes.some((prefix) => lower.startsWith(prefix));
  };

  const isStyleNode = (el: Element): boolean => {
    const tag = el.localName.toLowerCase();
    if (tag === 'style') return true;
    return tag === 'link' && /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute('rel') ?? '');
  };

  const openTag = (el: Element): string => {
    const control = isFormControl(el);
    const attrs = Array.from(el.attributes)
      .filter((attr) => !isIgnoredAttribute(attr.name))
      .filter((attr) => !(control && (attr.name === 'value' || attr.name === 'checked')))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((attr) => {
        let value = opts?.rawAttributeValues ? attr.value : collapse(attr.value);
        if (attr.name === 'style') {
          // The declarations, not their formatting: a style the client updated through the CSSOM is re-serialized
          // by the browser ("width: 39.2157%;"), one written as attribute text keeps the template's formatting.
          const css = (el as HTMLElement).style?.cssText;
          if (typeof css === 'string') value = collapse(css);
        }
        const shown = isIdAttribute(el, attr.name) ? value.split(' ').map(canonicalId).join(' ') : value;
        return ` ${attr.name}="${shown}"`;
      })
      .join('');
    return `<${el.localName.toLowerCase()}${attrs}${control ? formState(el) : ''}>`;
  };

  const walkChildren = (parent: Node, depth: number, inShadowTree: boolean): void => {
    let pendingText = '';
    const flushText = (): void => {
      const text = collapse(pendingText);
      pendingText = '';
      if (text) lines.push(`${pad(depth)}${JSON.stringify(text)}`);
    };
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        pendingText += node.nodeValue ?? '';
        continue;
      }
      if (node.nodeType !== 1 /* ELEMENT_NODE */) continue; // comments, processing instructions
      flushText();
      walkElement(node as Element, depth, inShadowTree);
    }
    flushText();
  };

  const walkElement = (el: Element, depth: number, inShadowTree: boolean): void => {
    if (inShadowTree && isStyleNode(el)) return;
    lines.push(`${pad(depth)}${openTag(el)}`);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      lines.push(`${pad(depth + 1)}#shadow-root`);
      walkChildren(shadow, depth + 2, true);
    }
    // A textarea's text content is its default value; the live value is in the `.value` pseudo-attribute.
    if (el.localName !== 'textarea') walkChildren(el, depth + 1, inShadowTree);
  };

  walkElement(root, 0, false);
  return lines.join('\n');
}

/** Tag names (lowercase) of all `sp-*` elements under `root`, in document order, including inside open shadow roots. */
export function collectSpTags(root: Element): string[] {
  const tags: string[] = [];
  const visit = (el: Element): void => {
    const tag = el.localName.toLowerCase();
    if (tag.startsWith('sp-')) tags.push(tag);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) for (const child of Array.from(shadow.children)) visit(child);
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  return tags;
}

/** Tag names of all elements in the whole document (including shadow roots) that still carry `defer-hydration`. */
export function collectDeferredHydration(): string[] {
  const found: string[] = [];
  const visit = (el: Element): void => {
    if (el.hasAttribute('defer-hydration')) found.push(el.localName.toLowerCase());
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) for (const child of Array.from(shadow.children)) visit(child);
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(document.documentElement);
  return found;
}

export interface SettleResult {
  rounds: number;
  timedOut: boolean;
}

/**
 * Waits until every Lit element under `root` (light DOM and shadow roots) has finished its pending update, then two
 * animation frames. Used before serializing/clicking so async first renders have landed.
 * Usage: `await locator.evaluate(settleTree, {timeoutMs: 5000})`.
 */
export async function settleTree(root: Element, opts?: {timeoutMs?: number}): Promise<SettleResult> {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  type Updatable = Element & {updateComplete?: Promise<unknown>; isUpdatePending?: boolean};
  const gather = (el: Element, out: Updatable[]): void => {
    out.push(el as Updatable);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) for (const child of Array.from(shadow.children)) gather(child, out);
    for (const child of Array.from(el.children)) gather(child, out);
  };

  const frames = (n: number): Promise<void> =>
    new Promise((resolve) => {
      const tick = (left: number): void => {
        if (left <= 0) resolve();
        else requestAnimationFrame(() => tick(left - 1));
      };
      tick(n);
    });

  let rounds = 0;
  let timedOut = false;
  for (; rounds < 6; rounds++) {
    const all: Updatable[] = [];
    gather(root, all);
    const pending = all.filter((el) => el.isUpdatePending === true || el.updateComplete !== undefined);
    const waits = pending.map((el) => {
      try {
        return Promise.resolve(el.updateComplete).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    });
    const remaining = Math.max(0, deadline - Date.now());
    const result = await Promise.race([
      Promise.all(waits).then(() => 'done' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), remaining)),
    ]);
    if (result === 'timeout') {
      timedOut = true;
      break;
    }
    await frames(1);
    const again: Updatable[] = [];
    gather(root, again);
    if (!again.some((el) => el.isUpdatePending === true)) break;
  }
  await frames(2);
  return {rounds: rounds + 1, timedOut};
}
