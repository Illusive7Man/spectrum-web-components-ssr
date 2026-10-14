// Bundles the demo's browser entry (demo/src/client.ts) into demo/public/dist/client.js.
// Run through "npm run build:client" (also part of "npm run demo").
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const demoRoot = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(demoRoot, 'public', 'dist');

// A clean output directory: nothing stale from earlier builds can be served.
await rm(outDir, {recursive: true, force: true});

await build({
  entryPoints: [path.join(demoRoot, 'src', 'client.ts')],
  outfile: path.join(outDir, 'client.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  // Deliberately without 'development': lit and @lit-labs/ssr-client then resolve to their production builds, which
  // is what the hydration markers of the production SSR output are meant for.
  conditions: ['browser', 'module', 'import', 'default'],
  logLevel: 'info',
});
