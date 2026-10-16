// Verification scratch: are consecutive requests of the same demo page byte-identical (after id normalization)?
process.env.PORT = '3108';
await import(process.env.SERVER ?? '../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
import {createHash} from 'node:crypto';
const paths = (process.env.PATHS ?? '/component/picker?styles=trimmed').split(',');
for (const p of paths) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`http://localhost:3108${p}`, {headers: {'accept-encoding': 'identity'}});
    const body = await res.text();
    const norm = body.replace(/-[0-9a-f]{8}/g, '-ID');
    const css = [...body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
    console.log(`${p} #${i + 1}: ${res.status} len ${body.length} css ${css} norm ${createHash('sha1').update(norm).digest('hex').slice(0, 10)}`);
  }
}
process.exit(0);
