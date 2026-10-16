// Verification scratch: does the trimmed output of a page depend on earlier renders in the process?
//   SRC_DIR=<tree> SEQ="button:full,picker:trimmed" npx tsx tests/results/rerun-perf/hist.ts
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../../..');
const srcDir = process.env.SRC_DIR ? path.resolve(root, process.env.SRC_DIR) : root;
const server: any = await import(pathToFileURL(path.join(srcDir, 'packages/swc-ssr/src/server/index.ts')).href);
server.installSpectrumSsr();
const {catalog} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');
for (const e of catalog) await e.load();
for (const step of (process.env.SEQ ?? '').split(',')) {
  const [name, mode] = step.split(':');
  const entry = catalog.find((e: any) => e.name === name)!;
  const styles: any = mode === 'full' ? {} : {styles: {mode: 'trimmed', minifyCustomProperties: mode === 'minified'}};
  const r = await server.renderSpectrum(pageTemplate([entry]), {deferHydration: true, lang: 'en', ...styles});
  const norm = r.html.replace(/-[0-9a-f]{8}/g, '-ID');
  const css = [...r.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
  console.log(`${step}: html ${r.html.length} css ${css} normhash ${createHash('sha1').update(norm).digest('hex').slice(0, 10)}`);
}
process.exit(0);
