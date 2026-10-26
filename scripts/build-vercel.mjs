// Builds what Vercel runs ("npm run build:vercel", the build command in vercel.json):
//
//   public/dist/**               the demo's browser bundle (demo/build.mjs). Vercel serves public/** from its CDN and
//                                ignores express.static(), so the client has to live here, not in demo/public/dist.
//   .vercel-server/shim.mjs      spectrum-web-components-ssr/dom-shim, bundled, and a call to installSpectrumDomShim(): the browser globals
//                                Lit and Spectrum need, installed before anything else is loaded.
//   .vercel-server/server.mjs    the demo server (demo/src/server.ts) and the package sources bundled into one JavaScript
//                                file. Every node_modules package stays external and is loaded from node_modules at
//                                runtime, so Lit, @lit-labs/ssr and the Spectrum packages exist exactly once.
//
// The root server.mjs - the file Vercel detects as the Express app - loads the two in that order. Two files because
// esbuild hoists a bundle's external imports to its top: the Spectrum modules the demo imports statically would be
// evaluated before the shim code inside the same bundle could run.
//
// The demo normally runs its TypeScript through tsx, and the workspace package points at its .ts sources; neither
// exists on Vercel's Node.js runtime, hence the bundles.
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, '.vercel-server');
const packageSrc = path.join(repoRoot, 'packages', 'spectrum-web-components-ssr', 'src');

// 1. Browser bundle into public/dist (demo/build.mjs honours SWC_SSR_DEMO_DIST and wipes the directory first).
process.env.SWC_SSR_DEMO_DIST = path.join(repoRoot, 'public', 'dist');
await import('../demo/build.mjs');

// 2. Server bundles.
rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bare imports (express, lit, @lit-labs/ssr, @spectrum-web-components/*, ...) stay external; the workspace package
  // spectrum-web-components-ssr is aliased to its sources so that it is bundled (its package.json exports point at .ts files).
  packages: 'external',
  alias: {
    'spectrum-web-components-ssr/server': path.join(packageSrc, 'server', 'index.ts'),
    'spectrum-web-components-ssr/client': path.join(packageSrc, 'client', 'index.ts'),
    'spectrum-web-components-ssr/dom-shim': path.join(packageSrc, 'dom-shim', 'index.ts'),
  },
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};
await build({
  ...common,
  stdin: {
    contents: "import {installSpectrumDomShim} from 'spectrum-web-components-ssr/dom-shim';\ninstallSpectrumDomShim();\n",
    resolveDir: repoRoot,
    sourcefile: 'vercel-shim-entry.ts',
    loader: 'ts',
  },
  outfile: path.join(outDir, 'shim.mjs'),
});
await build({
  ...common,
  entryPoints: [path.join(repoRoot, 'demo', 'src', 'server.ts')],
  outfile: path.join(outDir, 'server.mjs'),
});

if (!existsSync(path.join(repoRoot, 'public', 'dist', 'client.js'))) throw new Error('public/dist/client.js was not built');
console.log(`[build:vercel] ${path.relative(repoRoot, outDir)}/{shim,server}.mjs and public/dist/ are ready`);
