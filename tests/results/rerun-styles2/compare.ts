// Fresh verification: sizes and output hashes of the 0.2.0 baseline source (BASE=1, extracted from 7dd69b8 into
// ./base-0.2.0) against the working tree, for button / picker / the whole catalog in full / trimmed / minified mode.
//   [BASE=1] npx tsx tests/results/rerun-styles2/compare.ts
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdirSync, writeFileSync} from 'node:fs';

const base = process.env.BASE === '1';
const server: any = await import(base ? './base-0.2.0/packages/swc-ssr/src/server/index.ts' : '../../../packages/swc-ssr/src/server/index.ts');
server.installSpectrumSsr();
const {catalog} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');

const targets: Array<[string, string[] | undefined]> = [
  ['button', ['button']],
  ['picker', ['picker']],
  ['tabs', ['tabs']],
  ['catalog', undefined],
];
const modes: Array<[string, any]> = [
  ['full', undefined],
  ['trimmed', {mode: 'trimmed'}],
  ['minified', {mode: 'trimmed', minifyCustomProperties: true}],
];
console.log(`source: ${base ? 'BASE 7dd69b8 (0.2.0)' : 'working tree (0.2.1)'}`);
for (const [label, names] of targets) {
  const entries = names ? names.map((n) => catalog.find((e: any) => e.name === n)!) : catalog;
  await Promise.all(entries.map((e: any) => e.load()));
  await server.renderSpectrum(pageTemplate(entries), {deferHydration: true, deterministicIds: true, styles: {mode: 'trimmed', minifyCustomProperties: true}});
  for (const [mode, styles] of modes) {
    const {html} = await server.renderSpectrum(pageTemplate(entries), {deferHydration: true, deterministicIds: true, ...(styles ? {styles} : {})});
    let css = 0;
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) css += Buffer.byteLength(m[1]);
    if (process.env.DUMP) { mkdirSync(process.env.DUMP, {recursive: true}); writeFileSync(process.env.DUMP + '/' + label + '-' + mode + '.html', html); }
    const sha = createHash('sha256').update(html).digest('hex').slice(0, 16);
    console.log(`${label.padEnd(8)} ${mode.padEnd(9)} html ${Buffer.byteLength(html)} css ${css} gzip ${gzipSync(html).length} sha ${sha}`);
  }
}
process.exit(0);
