// Verification probe: which <style> elements carry no data-swc-styles marker on trimmed / minified pages, and do they read theme vars?
import '../../../demo/src/ssr-setup.ts';
import {renderSpectrum} from 'swc-ssr/server';
import {catalog} from '../../../demo/src/catalog/index.ts';
import {pageTemplate} from '../../../demo/src/page.ts';
const mode = process.env.STYLES ?? 'minified';
await Promise.all(catalog.map((e) => e.load()));
const {html} = await renderSpectrum(pageTemplate(catalog), {deferHydration: true, styles: {mode: 'trimmed', minifyCustomProperties: mode === 'minified'}});
const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g;
let m; const rows = new Map<string, {n: number; spectrumVars: number; size: number; owner: string}>();
const tagRe = /<(sp-[a-z0-9-]+|overlay-trigger)\b/g; const opens: {idx: number; tag: string}[] = [];
while ((m = tagRe.exec(html))) opens.push({idx: m.index, tag: m[1]});
let oi = 0;
while ((m = re.exec(html))) {
  while (oi + 1 < opens.length && opens[oi + 1].idx < m.index) oi++;
  if (!/data-swc-styles="trimmed"/.test(m[1])) continue;
  const key = `${opens[oi]?.tag ?? '?'} attrs=[${m[1].trim()}] first=${m[2].slice(0, 60).replace(/\s+/g, ' ')}`;
  const r = rows.get(key) ?? {n: 0, spectrumVars: 0, size: m[2].length, owner: opens[oi]?.tag ?? '?'};
  r.n++; r.spectrumVars += (m[2].match(/var\(--(spectrum|system|mod)-/g) ?? []).length; rows.set(key, r);
}
console.log(`mode=${mode} unmarked style kinds: ${rows.size}`);
for (const [k, r] of rows) console.log(`${String(r.n).padStart(4)}x  ${(r.size / 1024).toFixed(1)}KB  --spectrum/system/mod var() refs: ${r.spectrumVars}  ${k}`);
process.exit(0);
