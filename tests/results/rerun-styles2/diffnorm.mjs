import fs from 'node:fs';
const norm = (p) => fs.readFileSync(p, 'latin1').replace(/(sp-[a-z0-9-]+-)[0-9a-f]{8}\b/g, '$1X');
const [a, b] = process.argv.slice(2).map(norm);
console.log('lengths', a.length, b.length);
const n = Math.min(a.length, b.length); let runs = 0, bytes = 0; const samples = [];
for (let i = 0; i < n; i++) if (a[i] !== b[i]) { let j = i; while (j < n && a[j] !== b[j]) j++; runs++; bytes += j - i; if (samples.length < 4) samples.push(JSON.stringify(a.slice(Math.max(0, i - 60), j + 15)) + '\n   vs ' + JSON.stringify(b.slice(Math.max(0, i - 60), j + 15))); i = j; }
console.log('runs', runs, 'bytes', bytes); samples.forEach((s) => console.log('  ' + s));
