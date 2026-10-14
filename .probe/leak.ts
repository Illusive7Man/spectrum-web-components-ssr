// Scratch: render the full catalog repeatedly and print heap after a forced GC.
import '../demo/src/ssr-setup.ts';
import {renderSpectrum} from 'swc-ssr/server';
import {catalog} from '../demo/src/catalog/index.ts';
import {pageTemplate} from '../demo/src/page.ts';
const names = (process.env.NAMES ?? '').split(',').filter(Boolean);
const entries = names.length ? names.map(n => catalog.find(e => e.name === n)!) : catalog;
await Promise.all(entries.map(e => e.load()));
const gc = (globalThis as any).gc as (() => void) | undefined;
const mb = (n: number) => (n / 1048576).toFixed(0);
for (let i = 1; i <= Number(process.env.N ?? 8); i++) {
  const t = Date.now();
  const r = await renderSpectrum(pageTemplate(entries), {deferHydration: true});
  gc?.(); gc?.();
  const m = process.memoryUsage();
  console.log(`render ${i}: ${Date.now() - t} ms, ${r.html.length} chars, ${r.report.elements.length} elements | heapUsed ${mb(m.heapUsed)} MB, rss ${mb(m.rss)} MB`);
}
