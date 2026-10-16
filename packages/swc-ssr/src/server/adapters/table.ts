/**
 * `<sp-table selects="...">` creates its head/row `<sp-table-checkbox-cell>` elements imperatively from
 * `willUpdate()` (`manageCheckboxes()` / `manageSelects()` in `table/src/Table.js`: `document.createElement()` +
 * `insertAdjacentElement('afterbegin', ...)`). The application template therefore does not contain those cells and
 * Lit SSR cannot emit them by itself; the generic DOM shim keeps rendered trees immutable and drops the insertions.
 *
 * This adapter does not re-implement the table's logic. Spectrum's own code runs on the server and creates real
 * `TableCheckboxCell` instances (the shim's `document.createElement()` constructs registered classes) with the
 * properties Spectrum sets on them (`headCell`, `checked`, `indeterminate`, `selectsSingle`, `emphasized`, `label`).
 * `handlesMutation()` records those instances per target as they are inserted, and `lightDomInsertions()` turns each
 * recorded cell into a Lit value that binds the instance's reactive properties, so the rendered cell is whatever
 * Spectrum produced. If Adobe changes `manageCheckboxes()`, the server output follows without an adapter change;
 * the fidelity e2e (post-hydration DOM equals the client render) remains the guard.
 *
 * The client counterpart in `client/hooks.ts` adopts the server cells during the table's first update so Spectrum
 * does not create a second set.
 */
import {html} from 'lit-html';
import type {ElementAdapter, LightDomInsertion} from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CELL = 'sp-table-checkbox-cell';

/** The cells Spectrum inserted into each head/row of a table instance: latest insertion per target. */
const recordedCells = new WeakMap<object, Map<object, any>>();

/** Template strings per element tag and bound property list; stable so the renderer's template cache applies. */
const templateStrings = new Map<string, TemplateStringsArray>();

/**
 * `<tag .p1=${} .p2=${} ...></tag>`: a Lit template needs one string more than it has bindings, the first string
 * ending with the first binding's attribute name and the last one closing the element.
 */
const stringsFor = (tag: string, properties: string[]): TemplateStringsArray => {
  const key = `${tag}|${properties.join(',')}`;
  let strings = templateStrings.get(key);
  if (!strings) {
    const literal =
      properties.length === 0
        ? [`<${tag}></${tag}>`]
        : [`<${tag} .${properties[0]}=`, ...properties.slice(1).map((property) => ` .${property}=`), `></${tag}>`];
    strings = Object.assign(literal, {raw: [...literal]}) as unknown as TemplateStringsArray;
    templateStrings.set(key, strings);
  }
  return strings;
};

/**
 * A Lit value rendering `node` as a fresh element with the same reactive properties: every property the element
 * class declares whose value on the instance is defined becomes a property binding (a getter that throws, e.g. a
 * focus delegate that needs a shadow root, is skipped). Attributes Spectrum set on the created node are not copied
 * (none are set in 1.12.4; reflected properties are re-reflected by the render).
 */
const valueOf = (node: any): unknown => {
  const tag = String(node.localName);
  const ctor = (globalThis as any).customElements?.get(tag) ?? node.constructor;
  const declared: Map<PropertyKey, unknown> | undefined = ctor?.elementProperties;
  const properties: string[] = [];
  const values: unknown[] = [];
  for (const property of Array.from(declared?.keys() ?? []).sort()) {
    if (typeof property !== 'string') {
      continue;
    }
    let value: unknown;
    try {
      value = node[property];
    } catch {
      continue;
    }
    if (value !== undefined) {
      properties.push(property);
      values.push(value);
    }
  }
  return html(stringsFor(tag, properties), ...values);
};

const selectable = (table: any): boolean => !!table.selects && !table.isVirtualized;

export const tableAdapter: ElementAdapter = {
  tag: 'sp-table',

  handlesMutation(element, target, operation, node) {
    const table = element as any;
    const parent = target as any;
    const inserted = node as any;
    if (
      operation !== 'insertBefore' ||
      !selectable(table) ||
      inserted?.localName !== CELL ||
      (parent?.localName !== 'sp-table-head' && parent?.localName !== 'sp-table-row')
    ) {
      return false;
    }
    let cells = recordedCells.get(table);
    if (!cells) {
      cells = new Map();
      recordedCells.set(table, cells);
    }
    // `manageSelects()` inserts a clone when it does not find the first cell (the tree is immutable): the latest
    // insertion per target carries the final state Spectrum assigned.
    cells.set(parent, inserted);
    // In the browser the row learns it is selectable from the cell's slotchange; on the server the dropped cell never
    // reaches the slot. Set it now, inside the table's willUpdate(): the row's own first update has not run yet (the
    // document lifecycle runs elements in document order), so its `manageSelected()` reflects `aria-selected` itself.
    if (parent.localName === 'sp-table-row' && parent.selectable !== true) {
      parent.selectable = true;
    }
    return true;
  },

  lightDomInsertions(element): LightDomInsertion[] {
    const table = element as any;
    const cells = recordedCells.get(table);
    if (!cells || !selectable(table)) {
      return [];
    }
    // Document order: the head first, then the rows as the table sees them.
    const targets: any[] = [];
    const head = table.querySelector?.('sp-table-head');
    if (head && cells.has(head)) {
      targets.push(head);
    }
    for (const row of Array.from(table.querySelectorAll?.('sp-table-row') ?? []) as any[]) {
      if (cells.has(row)) {
        targets.push(row);
      }
    }
    return targets.map((target) => ({target, value: valueOf(cells.get(target)), position: 'afterbegin' as const}));
  },
};
