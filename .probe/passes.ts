// Scratch: report pass count + untracked failing elements for a set of catalog entries.
import '../demo/src/ssr-setup.ts';
import {renderSpectrum} from 'swc-ssr/server';
import {catalog} from '../demo/src/catalog/index.ts';
import {pageTemplate} from '../demo/src/page.ts';
const names = (process.env.NAMES ?? '').split(',').filter(Boolean);
const skip = (process.env.SKIP ?? '').split(',').filter(Boolean);
let entries = names.length ? names.map(n => catalog.find(e => e.name === n)!) : catalog;
entries = entries.filter(e => !skip.includes(e.name));
await Promise.all(entries.map(e => e.load()));
try {
  const r = await renderSpectrum(pageTemplate(entries), {deferHydration: true});
  console.log('OK passes=', r.report.passes, entries.length, 'entries');
  for (const e of r.report.elements) {
    const w = e.warnings.filter(w => /pass 2:/.test(w) || /without/.test(w));
    if (e.errors.length || (process.env.V && w.length)) console.log(' ', e.id, e.tagName, JSON.stringify(e.errors.slice(0,3)), process.env.V ? JSON.stringify(w.slice(0,3)) : '');
  }
} catch (e) { console.log('FAIL', '->', String((e as Error).message).split('\n')[0]); }
