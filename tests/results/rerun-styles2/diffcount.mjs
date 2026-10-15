import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'latin1'));
if (a.length !== b.length) { console.log('LENGTH DIFFERS', a.length, b.length); }
const n = Math.min(a.length, b.length);
let runs = 0, bytes = 0, first = -1; const samples = [];
for (let i = 0; i < n; i++) {
  if (a[i] !== b[i]) {
    if (first < 0) first = i;
    let j = i; while (j < n && a[j] !== b[j]) j++;
    runs++; bytes += j - i;
    if (samples.length < 3) samples.push(JSON.stringify(a.slice(Math.max(0, i - 40), j + 10)) + '  vs  ' + JSON.stringify(b.slice(Math.max(0, i - 40), j + 10)));
    i = j;
  }
}
console.log(`diff runs ${runs}, bytes ${bytes}, first ${first}`);
for (const s of samples) console.log('  ' + s);
