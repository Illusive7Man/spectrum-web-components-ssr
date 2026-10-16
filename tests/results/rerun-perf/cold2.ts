process.env.PORT = '3108';
await import('../../../demo/src/server.ts');
await new Promise((r) => setTimeout(r, 1500));
import {writeFileSync} from 'node:fs';
for (let i = 1; i <= 4; i++) {
  const res = await fetch(`http://localhost:3108/component/picker?styles=trimmed`, {headers: {'accept-encoding': 'identity'}});
  const body = (await res.text()).replace(/-[0-9a-f]{8}/g, '-ID');
  writeFileSync(`C:/Users/illus/AppData/Local/Temp/claude/C--Users-illus-OneDrive-Desktop-Spectrum-SSR/d4d4c78b-bdf4-44d0-9f9e-a162ed2a8e6d/scratchpad/picker-${i}.html`, body.replace(/></g, '>\n<'));
}
process.exit(0);
