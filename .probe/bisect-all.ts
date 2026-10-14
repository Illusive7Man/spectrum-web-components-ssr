// Scratch: find the smallest set of catalog entries whose combined page fails to render.
import '../demo/src/ssr-setup.ts';
import {renderSpectrum} from 'swc-ssr/server';
import {catalog} from '../demo/src/catalog/index.ts';
import {pageTemplate} from '../demo/src/page.ts';
const names = (process.env.NAMES ?? '').split(',').filter(Boolean);
const entries = names.length ? names.map(n => catalog.find(e => e.name === n)!) : catalog;
await Promise.all(entries.map(e => e.load()));
try { const r = await renderSpectrum(pageTemplate(entries), {deferHydration: true}); console.log('OK', entries.map(e => e.name).join(','), r.html.length, 'chars, errors:', r.report.elements.filter(e => e.errors.length).map(e => e.tagName + ':' + e.errors[0]).slice(0, 3)); }
catch (e) { console.log('FAIL', entries.map(e => e.name).join(','), '->', String((e as Error).message).split('\n')[0]); }
