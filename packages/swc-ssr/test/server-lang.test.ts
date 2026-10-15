/**
 * Review M7: the locale of components that format numbers (`reactive-controllers/src/LanguageResolution.js`:
 * `<sp-theme lang>`, else `document.documentElement.lang`, else `navigator.language`). The server had no way to
 * set the document language, and a page without any language silently rendered `en-US` formatting.
 * `RenderSpectrumOptions.lang` sets the server document's language for the render (restored afterwards), and
 * elements whose language falls back to `navigator.language` are reported.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum} from '../src/server/index.ts';
import {findElement, formatReport, parseHtml, shadowTemplateOf, templateContent} from './helpers.ts';

installSpectrumSsr();

const {html} = await import('lit');
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/number-field/sp-number-field.js');

/* eslint-disable @typescript-eslint/no-explicit-any */

const page = (themeLang?: string) =>
  themeLang
    ? html`<sp-theme system="spectrum" color="light" scale="medium" lang=${themeLang}
        ><sp-number-field label="Amount" value="1234.5"></sp-number-field
      ></sp-theme>`
    : html`<sp-theme system="spectrum" color="light" scale="medium"
        ><sp-number-field label="Amount" value="1234.5"></sp-number-field
      ></sp-theme>`;

function inputValue(output: string): string | undefined {
  const field = findElement(parseHtml(output), (element) => element.name === 'sp-number-field');
  assert.ok(field);
  const input = findElement(templateContent(shadowTemplateOf(field)!), (element) => element.name === 'input');
  return input?.attribs.value;
}

const localeWarnings = (report: any): string[] =>
  report.elements.flatMap((element: any) => element.warnings.filter((message: string) => message.startsWith('locale:')));

const documentLang = () => (globalThis as any).document.documentElement.getAttribute('lang');

test('the lang option sets the document language for the render and restores it afterwards', async () => {
  assert.equal(documentLang(), null);
  const {html: output, report} = await renderSpectrum(page(), {lang: 'de-DE'});
  assert.equal(inputValue(output), '1.234,5', 'formatted for de-DE');
  assert.deepEqual(localeWarnings(report), [], formatReport(report));
  assert.equal(documentLang(), null, 'restored after the render');
});

test('<sp-theme lang> is used without warnings', async () => {
  const {html: output, report} = await renderSpectrum(page('fr-FR'));
  assert.match(inputValue(output) ?? '', /^1\s234,5$/u);
  assert.deepEqual(localeWarnings(report), []);
});

test('an element whose language falls back to navigator.language is reported', async () => {
  const {html: output, report} = await renderSpectrum(page());
  assert.equal(inputValue(output), '1,234.5');
  const field = report.elements.find((element) => element.tagName === 'sp-number-field');
  assert.ok(
    field?.warnings.some((message) => message.startsWith('locale: no language is set')),
    formatReport(report)
  );
});
