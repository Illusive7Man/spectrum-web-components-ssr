/** Selectable tables: imperative checkbox cells are rendered into the server light DOM and adopted on hydration. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Element} from 'domhandler';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {
  findElement,
  formatReport,
  isElement,
  parseHtml,
  shadowTemplateOf,
  templateContent,
  walkElements,
} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
await Promise.all([
  import('@spectrum-web-components/table/sp-table.js'),
  import('@spectrum-web-components/table/sp-table-head.js'),
  import('@spectrum-web-components/table/sp-table-head-cell.js'),
  import('@spectrum-web-components/table/sp-table-body.js'),
  import('@spectrum-web-components/table/sp-table-row.js'),
  import('@spectrum-web-components/table/sp-table-cell.js'),
  import('@spectrum-web-components/table/sp-table-checkbox-cell.js'),
]);

const directChild = (parent: Element, name: string): Element | undefined =>
  parent.children.find((child): child is Element => isElement(child) && child.name === name);

const checkboxInput = (cell: Element): Element => {
  const checkbox = findElement(
    templateContent(shadowTemplateOf(cell)!),
    (element) => element.name === 'sp-checkbox'
  )!;
  return findElement(
    templateContent(shadowTemplateOf(checkbox)!),
    (element) => element.name === 'input'
  )!;
};

test('sp-table selection checkbox cells and labels are present in SSR output', async () => {
  const {html: output, report} = await renderSpectrum(html`
    <sp-table selects="multiple" select-all-label="Select every row" selected='["a"]'>
      <sp-table-head><sp-table-head-cell>Name</sp-table-head-cell></sp-table-head>
      <sp-table-body>
        <sp-table-row value="a"><sp-table-cell>Alpha</sp-table-cell></sp-table-row>
        <sp-table-row value="b"><sp-table-cell>Beta</sp-table-cell></sp-table-row>
      </sp-table-body>
    </sp-table>
  `);
  const root = parseHtml(output);
  const head = findElement(root, (element) => element.name === 'sp-table-head')!;
  const rowElements = Array.from(walkElements(root)).filter((element) => element.name === 'sp-table-row');
  const headCheckbox = directChild(head, 'sp-table-checkbox-cell')!;
  const rowCheckboxes = rowElements.map((row) => directChild(row, 'sp-table-checkbox-cell')!);

  assert.ok(headCheckbox, 'head checkbox cell');
  assert.equal(rowCheckboxes.length, 2);
  assert.ok(rowCheckboxes.every(Boolean), 'row checkbox cells');
  assert.equal(checkboxInput(headCheckbox).attribs['aria-label'], 'Select every row');
  assert.equal(checkboxInput(rowCheckboxes[0]).attribs['aria-label'], 'Alpha');
  assert.equal(checkboxInput(rowCheckboxes[1]).attribs['aria-label'], 'Beta');
  assert.equal(rowElements[0].attribs['aria-selected'], 'true');
  assert.equal(rowElements[1].attribs['aria-selected'], 'false');
  assert.ok(
    report.elements.every((entry) => entry.warnings.every((warning) => !warning.startsWith('dropped DOM change'))),
    formatReport(report)
  );
});
