import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const re = /^\s+(ok|x|-)\s+(\d+) \[chromium\] › tests[\\/]([a-z.-]+)\.spec\.ts:\d+:\d+ › (.*?) \(([\d.]+m?s)\)\s*$/;
const by = {};
const comps = new Map();
let n = 0;
for (const l of lines) {
  const m = re.exec(l);
  if (!m) continue;
  n++;
  const k = m[3] + ' ' + m[1];
  by[k] = (by[k] || 0) + 1;
  if (m[3] === 'styles') {
    const c = /^styles: ([^ ]+)/.exec(m[4]);
    if (c) {
      const s = comps.get(c[1]) ?? {ok: 0, bad: 0};
      if (m[1] === 'ok') s.ok++;
      else s.bad++;
      comps.set(c[1], s);
    }
  }
}
console.log(n, by);
console.log('styles.spec components', comps.size, 'with failures:', [...comps].filter(([, s]) => s.bad).map(([c]) => c));
console.log('styles.spec tests ok', [...comps.values()].reduce((a, s) => a + s.ok, 0));
