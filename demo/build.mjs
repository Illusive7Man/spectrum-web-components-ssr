// Bundles the demo's browser entry (demo/src/client.ts) into demo/public/dist/ the way a production build would:
//
//   dist/client.js                  the entry (minified ESM, a small bootstrap). It stays at this URL; the pages load it
//                                   with <script type="module">. It is served with `Cache-Control: no-cache` (revalidated).
//   dist/chunks/<name>-<hash>.js    code-split chunks: the application (client-app), one registration chunk per catalog
//                                   entry (register-<entry>-<hash>.js, see "Registration modules" below) and the modules
//                                   that several of them share. The hash covers the content, so a chunk never changes
//                                   under its name; the server sends them `immutable`.
//   dist/**/*.map                   source maps of all of the above.
//   dist/**/*.br, *.gz              build-time compressed siblings (brotli q11, gzip 9) of every .js/.css/.json/... file of
//                                   1 KB or more, which demo/src/server.ts serves with Content-Encoding to the clients
//                                   that accept them. Source maps are not precompressed (the server compresses them
//                                   on the fly when a debugger asks for one).
//
// Run through "npm run build:client" (also part of "npm run demo"). SWC_SSR_DEMO_DIST=<dir> writes (and wipes) another
// directory instead of demo/public/dist; the server reads the same variable.
import {readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {brotliCompress, constants as zlibConstants, gzip} from 'node:zlib';
import {build} from 'esbuild';

const demoRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(demoRoot, '..');
const outDir = process.env.SWC_SSR_DEMO_DIST
  ? path.resolve(process.env.SWC_SSR_DEMO_DIST)
  : path.join(demoRoot, 'public', 'dist');
const entrySource = path.join(demoRoot, 'src', 'client.ts');

// A clean output directory: nothing stale from earlier builds can be served.
await rm(outDir, {recursive: true, force: true});

/* -------------------------------------------------------------------------------------------------------------- *
 * Registration modules
 * -------------------------------------------------------------------------------------------------------------- */

// Every catalog entry (demo/src/catalog/<name>.ts) registers its custom elements in load():
//
//     async load() { await Promise.all([import('@spectrum-web-components/menu/sp-menu.js'), import('.../sp-menu-item.js')]); },
//
// Bundled as they are, each import() becomes a chunk of its own, and the browser evaluates a chunk as soon as it has
// arrived: `sp-sidenav-item` before `sp-sidenav` is a matter of which file is smaller, and an item that connects before
// its parent is defined throws ("startTrackingSelectionForItem is not a function"). The single-file bundle never had
// this problem because it evaluated the modules in the order load() lists them.
//
// The plugin below gives each entry ONE registration module instead (`import 'a'; import 'b'; ...` with the specifiers of
// its load(), in their order), and load() imports that module. ES modules evaluate their imports in order, once the whole
// graph has arrived, in one task: the elements of an entry are defined together, in the order the entry lists them,
// whatever the network does. The browser still fetches the entry's files in parallel. (The server, which runs the
// catalog from source with tsx, is not affected: this only rewrites what the browser bundle contains.)
const catalogDir = path.join(demoRoot, 'src', 'catalog');
const notEntries = new Set(['index', 'types', '_shared', 'page-theme', 'page-theme-register']);
const registrationModules = new Map(); // module id -> source
const LOAD_METHOD = /async load\(\) \{\r?\n([\s\S]*?)\r?\n {2}\},/;
const catalogRegistration = {
  name: 'catalog-registration',
  setup(pluginBuild) {
    pluginBuild.onLoad({filter: /\.ts$/}, async (args) => {
      const name = path.basename(args.path, '.ts');
      if (path.dirname(args.path) !== catalogDir || notEntries.has(name)) return undefined;
      const source = await readFile(args.path, 'utf8');
      const load = LOAD_METHOD.exec(source);
      const specifiers = load ? [...load[1].matchAll(/import\('([^']+)'\)/g)].map((match) => match[1]) : [];
      if (!load || specifiers.length === 0) {
        throw new Error(
          `build.mjs: ${path.relative(repoRoot, args.path)}: cannot find the import('...') calls of its "async load() { ... },". ` +
            'Catalog entries register their elements with plain dynamic imports of package modules there; ' +
            'the build turns them into one ordered registration module per entry (see "Registration modules").',
        );
      }
      const id = `register-${name}`;
      registrationModules.set(id, specifiers.map((specifier) => `import '${specifier}';`).join('\n') + '\n');
      const contents = source.replace(load[0], () => `async load() {\n    await import('catalog-registration:${id}');\n  },`);
      return {contents, loader: 'ts', resolveDir: path.dirname(args.path)};
    });
    pluginBuild.onResolve({filter: /^catalog-registration:/}, (args) => ({
      path: args.path.slice('catalog-registration:'.length),
      namespace: 'catalog-registration',
    }));
    pluginBuild.onLoad({filter: /.*/, namespace: 'catalog-registration'}, (args) => {
      const contents = registrationModules.get(args.path);
      if (contents === undefined) throw new Error(`build.mjs: no registration module "${args.path}"`);
      return {contents, loader: 'js', resolveDir: repoRoot};
    });
  },
};

const started = performance.now();
const result = await build({
  absWorkingDir: repoRoot,
  plugins: [catalogRegistration],
  entryPoints: {client: entrySource},
  outdir: outDir,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  // Code splitting turns the dynamic import()s (the application, the page theme, every catalog entry's registration
  // modules) into separate chunks. The entry itself only holds what it evaluates statically: swc-ssr/client.
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: true,
  metafile: true,
  // Deliberately without 'development': lit and @lit-labs/ssr-client then resolve to their production builds, which
  // is what the hydration markers of the production SSR output are meant for.
  conditions: ['browser', 'module', 'import', 'default'],
  logLevel: 'warning',
});
const builtMs = performance.now() - started;

/* -------------------------------------------------------------------------------------------------------------- *
 * Evaluation order
 * -------------------------------------------------------------------------------------------------------------- */

// lit-element-hydrate-support (imported first by swc-ssr/client) has to be evaluated BEFORE lit-element: it installs
// globalThis.litElementHydrateSupport, which lit-element reads once while it defines LitElement. With code splitting a
// bundler is free to move modules into shared chunks that the entry imports FIRST, so a static import of `lit` (or of
// a Spectrum module) in the entry's import graph would silently disable hydration support and make every element
// re-render its server markup. This fails the build in that case, instead of letting the pages flicker.
const evaluationOrder = checkEvaluationOrder(result.metafile);

/** Returns the files of the entry's STATIC import graph in the order a browser evaluates them in. */
function checkEvaluationOrder(metafile) {
  const outputs = metafile.outputs;
  // Dynamic-import chunks have an `entryPoint` in the metafile too: pick the output of demo/src/client.ts.
  const entryFile = Object.keys(outputs).find(
    (file) => outputs[file].entryPoint !== undefined && path.resolve(repoRoot, outputs[file].entryPoint) === entrySource,
  );
  if (entryFile === undefined) throw new Error('build.mjs: the entry output is not in the metafile');

  // Post-order depth-first walk over the static imports = ESM evaluation order (dependencies first, in import order).
  const seen = new Set();
  const order = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const imported of outputs[file].imports) {
      if (imported.kind === 'import-statement' && outputs[imported.path] !== undefined) visit(imported.path);
    }
    order.push(file);
  };
  visit(entryFile);

  const inputsOf = (file) => Object.keys(outputs[file].inputs);
  const forbidden = /^node_modules\/(?:lit|lit-element|@spectrum-web-components)\/|^demo\/src\/(?:client-app|page|catalog)/;
  for (const file of order) {
    const offending = inputsOf(file).filter((input) => forbidden.test(input));
    if (offending.length > 0) {
      throw new Error(
        `build.mjs: ${file} is part of the static import graph of the entry (it is evaluated before the entry's own code) ` +
          `and contains ${offending.slice(0, 3).join(', ')}${offending.length > 3 ? ', ...' : ''}. ` +
          "lit-element must be evaluated after swc-ssr/client has installed lit's hydration support: " +
          'load it with import() (demo/src/client.ts -> client-app.ts), not with a static import.',
      );
    }
  }
  if (!order.some((file) => inputsOf(file).some((input) => input.includes('@lit-labs/ssr-client/lit-element-hydrate-support')))) {
    throw new Error('build.mjs: lit-element-hydrate-support is not part of the entry graph (swc-ssr/client must be imported by the entry)');
  }
  return order;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Precompression
 * -------------------------------------------------------------------------------------------------------------- */

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);
const MIN_BYTES = 1024; // the server does not compress smaller responses either
const PRECOMPRESS = /\.(?:js|mjs|css|json|html|svg|txt)$/;

async function* walk(dir) {
  for (const dirent of await readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, dirent.name);
    if (dirent.isDirectory()) yield* walk(file);
    else yield file;
  }
}

const compressStarted = performance.now();
let rawTotal = 0;
let brTotal = 0;
let gzTotal = 0;
let compressed = 0;
const pending = [];
for await (const file of walk(outDir)) {
  if (!PRECOMPRESS.test(file)) continue;
  const raw = await readFile(file);
  if (raw.length < MIN_BYTES) continue;
  compressed++;
  rawTotal += raw.length;
  pending.push(
    (async () => {
      const [br, gz] = await Promise.all([
        brotli(raw, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        }),
        deflate(raw, {level: 9}),
      ]);
      // A sibling that is not smaller than the file is of no use: the server then falls back to the plain file.
      if (br.length < raw.length) {
        await writeFile(`${file}.br`, br);
        brTotal += br.length;
      } else {
        brTotal += raw.length;
      }
      if (gz.length < raw.length) {
        await writeFile(`${file}.gz`, gz);
        gzTotal += gz.length;
      } else {
        gzTotal += raw.length;
      }
    })(),
  );
}
await Promise.all(pending);
const compressMs = performance.now() - compressStarted;

/* -------------------------------------------------------------------------------------------------------------- *
 * Summary
 * -------------------------------------------------------------------------------------------------------------- */

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const jsOutputs = Object.keys(result.metafile.outputs).filter((file) => !file.endsWith('.map'));
const sizes = await Promise.all(jsOutputs.map(async (file) => (await stat(path.resolve(repoRoot, file))).size));
const entryIndex = jsOutputs.findIndex((file) => path.basename(file) === 'client.js');
const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
const staticFiles = evaluationOrder.map((file) => path.basename(file));
console.log(
  `[build] entry client.js ${kb(sizes[entryIndex] ?? 0)} + ${jsOutputs.length - 1} chunks (${kb(totalBytes)} JS in all), built in ${builtMs.toFixed(0)} ms`,
);
console.log(`[build] static import graph of the entry, in evaluation order: ${staticFiles.join(' -> ')}`);
console.log(
  `[build] precompressed ${compressed} files ${kb(rawTotal)} -> br ${kb(brTotal)} / gzip ${kb(gzTotal)} in ${compressMs.toFixed(0)} ms`,
);
