// Scratch: render every catalog entry on its own + the whole page (and the page without slider), save the HTML
// and a compact report summary into OUT (dir) for before/after diffs.
import '../demo/src/ssr-setup.ts';
import {mkdirSync, writeFileSync} from 'node:fs';
import {renderSpectrum} from 'swc-ssr/server';
import {catalog} from '../demo/src/catalog/index.ts';
import {pageTemplate} from '../demo/src/page.ts';
const out = process.env.OUT!;
mkdirSync(out, {recursive: true});
for (const e of catalog) await e.load();
const summary: string[] = [];
async function one(name: string, entries: typeof catalog) {
  try {
    const r = await renderSpectrum(pageTemplate(entries), {deferHydration: true});
    writeFileSync(`${out}/${name}.html`, r.html.replace(/></g, '>\n<'));
    const errs = r.report.elements.filter(e => e.errors.length).map(e => `${e.tagName}: ${e.errors.join(' | ')}`);
    writeFileSync(`${out}/${name}.report.txt`, `passes=${r.report.passes}\n` + errs.join('\n') + '\n');
    summary.push(`${name} OK passes=${r.report.passes} errors=${errs.length}`);
  } catch (error) {
    summary.push(`${name} FAIL ${String((error as Error).message).split('\n')[0]}`);
  }
}
for (const e of catalog) await one(e.name, [e]);
await one('ALL', catalog);
await one('ALL-minus-slider', catalog.filter(e => e.name !== 'slider'));
await one('dialog+slider', catalog.filter(e => e.name === 'dialog' || e.name === 'slider'));
writeFileSync(`${out}/summary.txt`, summary.join('\n') + '\n');
console.log(summary.join('\n'));
