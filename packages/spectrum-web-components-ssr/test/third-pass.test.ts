/**
 * The smallest catalog combination that failed on the all-components page (GET /): `sp-dialog` with a slotted button
 * makes the render take a third pass (its `sp-button-group` only appears in pass 2 and fails there without tree
 * information), and in that pass an editable `sp-slider`'s shadow facade held the pass-2 handle `<input>`s, whose
 * `.model` property binding the markup cannot carry. Lit's first update reads the wrapped `tabIndex`
 * (`shared/src/focusable.js`) -> `focusElement` -> `slider/src/HandleController.js` `input.model.handle`, which threw
 * out of the document lifecycle ("Cannot read properties of undefined (reading 'handle')"). Each component alone
 * rendered fine (two passes).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, formatReport, isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/dialog/sp-dialog.js');
await import('@spectrum-web-components/button/sp-button.js');
await import('@spectrum-web-components/slider/sp-slider.js');
// On the full page sp-number-field (which an editable slider imports lazily) is already defined by another entry.
await import('@spectrum-web-components/number-field/sp-number-field.js');

const template = () => html`
  <sp-theme system="spectrum" color="light" scale="medium">
    <sp-dialog size="s">
      <h2 slot="heading">Disclaimer</h2>
      Body text.
      <sp-button slot="button" variant="accent">Continue</sp-button>
    </sp-dialog>
    <sp-slider label="Editable" editable value="25"></sp-slider>
    <sp-slider label="Volume" value="40"></sp-slider>
  </sp-theme>
`;

test('an editable slider renders on a page that needs a third pass (sp-dialog + sp-slider)', async () => {
  const {html: output, report} = await renderSpectrum(template(), {deferHydration: true});
  assert.equal(report.passes, 3, `precondition: sp-dialog's button group makes the render take a third pass\n${formatReport(report)}`);
  const failing = report.elements.filter((element) => element.errors.length > 0);
  assert.deepEqual(failing, [], formatReport(failing));

  const sliders = [...walkElements(parseHtml(output))].filter((element) => element.name === 'sp-slider');
  assert.equal(sliders.length, 2);
  for (const slider of sliders) {
    const shadow = shadowTemplateOf(slider);
    assert.ok(shadow, 'sp-slider has a declarative shadow root');
    const input = findElement(templateContent(shadow), (element) => element.name === 'input' && element.attribs.type === 'range');
    assert.ok(input, 'the handle input is rendered');
  }
  const editable = sliders.find((slider) => slider.attribs.editable !== undefined)!;
  const numberField = findElement(templateContent(shadowTemplateOf(editable)!), (element) => element.name === 'sp-number-field');
  assert.ok(numberField && isElement(numberField), 'the editable slider renders its number field');
  assert.ok(shadowTemplateOf(numberField), 'sp-number-field is server-rendered too');
});
