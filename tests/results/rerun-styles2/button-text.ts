import {installSpectrumSsr, renderSpectrum} from '../../../packages/swc-ssr/src/server/index.ts';
import {isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from '../../../packages/swc-ssr/test/helpers.ts';
installSpectrumSsr();
const {findEntry} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');
const button = findEntry('button')!;
await button.load();
for (const [label, styles] of [['trimmed', {mode: 'trimmed'}], ['minified', {mode: 'trimmed', minifyCustomProperties: true}]] as const) {
  const {html} = await renderSpectrum(pageTemplate([button]), {deferHydration: true, styles: styles as any});
  const texts: string[] = [];
  for (const el of walkElements(parseHtml(html))) {
    if (el.name !== 'sp-button') continue;
    const t = shadowTemplateOf(el);
    if (!t) continue;
    const style = (templateContent(t) as any).children.find((n: any) => isElement(n) && n.name === 'style');
    texts.push(style ? style.children.map((n: any) => n.data ?? '').join('') : '');
  }
  console.log(label, 'sp-button distinct', new Set(texts).size, 'length', texts[0].length, (texts[0].length / 1024).toFixed(1) + ' KB');
}
process.exit(0);
