import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Random 8-hex-digit id suffixes (sp-field-label-3e99d42d, pass-through-help-text-94d16331, ...) differ between any two
// renders of the catalog, whatever the source; everything else must be byte-identical.
const norm = (p) =>
  createHash('sha256')
    .update(fs.readFileSync(p, 'latin1').replace(/-[0-9a-f]{8}(?![0-9a-z])/g, '-X'))
    .digest('hex')
    .slice(0, 16);
for (const name of process.argv.slice(3)) console.log(name.padEnd(18), process.argv[2].split(',').map((d) => norm(`${d}/${name}.html`)).join('  '));
