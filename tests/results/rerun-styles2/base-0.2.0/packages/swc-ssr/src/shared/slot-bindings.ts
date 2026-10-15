/**
 * Finding the `<slot @slotchange=${listener}>` bindings of a render result. Shared by the server (which emulates the
 * initial `slotchange` before its final render, `server/lifecycle.ts`) and the client (which does the same around
 * hydration, `client/hooks.ts`), so both treat a component identically. No DOM or lit imports.
 */

export interface SlotchangeBinding {
  /** Slot name ('' for the default slot). */
  name: string;
  /** True when the name comes from a binding (it may differ between two render() calls, e.g. a random id). */
  dynamicName: boolean;
  /** Index of the slot among all `<slot>` elements the render result produces, in document order. */
  ordinal: number;
  listener: unknown;
}

const PLACEHOLDER = '\u0001';
const SLOT_TAG_RE = /<slot\b([^>]*)>/gi;
const SLOTCHANGE_RE = /@slotchange\s*=\s*["']?\u0001(\d+)\u0001/;
const SLOT_NAME_RE =
  /(?:^|\s)name\s*=\s*(?:"([^"\u0001]*)"|'([^'\u0001]*)'|["']?\u0001(\d+)\u0001["']?|([^\s"'>\u0001]+))/;
const VALUE_RE = /\u0001(\d+)\u0001/g;

const childPositionCache = new WeakMap<object, boolean[]>();

/** For each value of a template: bound in a text position (true) or inside a tag (attribute/property/event/element). */
export function childPositions(strings: ArrayLike<string>): boolean[] {
  const cached = childPositionCache.get(strings as object);
  if (cached) {
    return cached;
  }
  const result: boolean[] = [];
  let inTag = false;
  let quote: string | null = null;
  for (let i = 0; i < strings.length - 1; i++) {
    const text = strings[i];
    for (let j = 0; j < text.length; j++) {
      const char = text[j];
      if (!inTag) {
        if (char === '<' && /[a-zA-Z/!?]/.test(text[j + 1] ?? '')) {
          inTag = true;
        }
      } else if (quote) {
        if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        inTag = false;
      }
    }
    result.push(!inTag);
  }
  childPositionCache.set(strings as object, result);
  return result;
}

/** `<slot @slotchange=${listener}>` bindings of a template result and the templates it renders, in document order. */
export function collectSlotchangeBindings(value: unknown): SlotchangeBinding[] {
  const out: SlotchangeBinding[] = [];
  const counter = {slots: 0};
  visit(value, out, counter, 0);
  return out;
}

function visit(value: unknown, out: SlotchangeBinding[], counter: {slots: number}, depth: number): void {
  if (value === null || typeof value !== 'object' || depth > 32) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, out, counter, depth + 1);
    }
    return;
  }
  const result = value as {_$litType$?: unknown; strings?: ArrayLike<string>; values?: unknown[]};
  if (result._$litType$ === undefined || !Array.isArray(result.values) || !result.strings) {
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && !('nodeType' in (value as object))) {
      for (const item of value as Iterable<unknown>) {
        visit(item, out, counter, depth + 1);
      }
    }
    return;
  }
  const {strings, values} = result;
  const positions = childPositions(strings);
  let text = '';
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      text += `${PLACEHOLDER}${i}${PLACEHOLDER}`;
    }
  }
  // Slot tags and text-position values in document order.
  const events: Array<{at: number; slot?: string; value?: number}> = [];
  for (const match of text.matchAll(SLOT_TAG_RE)) {
    events.push({at: match.index ?? 0, slot: match[1]});
  }
  for (const match of text.matchAll(VALUE_RE)) {
    const index = Number(match[1]);
    if (positions[index]) {
      events.push({at: match.index ?? 0, value: index});
    }
  }
  events.sort((a, b) => a.at - b.at);
  for (const event of events) {
    if (event.value !== undefined) {
      visit(values[event.value], out, counter, depth + 1);
      continue;
    }
    const ordinal = counter.slots++;
    const attributes = event.slot!;
    const binding = SLOTCHANGE_RE.exec(attributes);
    if (!binding) {
      continue;
    }
    const nameMatch = SLOT_NAME_RE.exec(attributes);
    let name = '';
    let dynamicName = false;
    if (nameMatch) {
      if (nameMatch[3] !== undefined) {
        const dynamic = values[Number(nameMatch[3])];
        name = typeof dynamic === 'string' ? dynamic : '';
        dynamicName = true;
      } else {
        name = nameMatch[1] ?? nameMatch[2] ?? nameMatch[4] ?? '';
      }
    }
    out.push({name, dynamicName, ordinal, listener: values[Number(binding[1])]});
  }
}

interface SlotQueryRoot {
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

const escapeName = (name: string): string => name.replace(/["\\]/g, '\\$&');

/**
 * The slot element a binding belongs to in an already rendered (or server-rendered) shadow root: by its name, or -
 * for a name that came from a binding and is not found - by its position among the root's slots.
 */
export function findBoundSlot<T>(root: SlotQueryRoot, binding: SlotchangeBinding): T | null {
  const selector = binding.name ? `slot[name="${escapeName(binding.name)}"]` : 'slot:not([name])';
  const byName = root.querySelector(selector) as T | null;
  if (byName || !binding.dynamicName) {
    return byName;
  }
  return (root.querySelectorAll('slot')[binding.ordinal] as T | undefined) ?? null;
}
