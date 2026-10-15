#!/usr/bin/env node
// Proves that what "npm publish" would upload actually works, without publishing anything:
//
//   1. builds packages/swc-ssr/dist (tsc -p packages/swc-ssr/tsconfig.build.json)
//   2. switches package.json to its publish form (scripts/prepare-publish.mjs) and runs "npm pack" on it, then
//      restores the workspace form right away
//   3. checks the tarball's file list (dist, README, CHANGELOG, LICENSE in; src, tests, tsconfig out) and that every
//      bare import in dist/ names a declared dependency / peer dependency
//   4. unpacks the tarball into .pack-check/node_modules/<name>, like an installed package, and from there
//        - renders a small Spectrum page through "<name>/server" + "<name>/dom-shim" in plain node, renders the same
//          page from the workspace sources (node --import tsx, "swc-ssr/server") and requires identical output
//        - bundles "<name>/client" with esbuild for the browser
//        - type-checks a consumer that imports the three entry points (the emitted .d.ts files)
//   5. removes .pack-check, the tarball and (if it did not exist before) dist
//
// Usage: node scripts/verify-package.mjs [--keep-dist]      (or: npm run pkg:verify)
// Exit code 0 only when every step passed.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'swc-ssr');
const distDir = path.join(pkgDir, 'dist');
const manifestBackup = path.join(pkgDir, 'package.json.orig');
const work = path.join(root, '.pack-check');
const PUBLISH_NAME = 'spectrum-web-components-ssr';
const keepDist = process.argv.includes('--keep-dist');

const problems = [];
const fail = (message) => problems.push(message);
const step = (message) => console.log(`\n== ${message}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options});
  if (result.error) throw result.error;
  return result;
}
const node = (args, options) => run(process.execPath, args, options);

function npmCli() {
  const bin = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => candidate && /npm-cli\.js$/.test(candidate) && existsSync(candidate));
  if (!found) throw new Error('cannot locate npm-cli.js (run this through "npm run pkg:verify")');
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const hadDist = existsSync(distDir);

try {
  // 1. build
  step('build (tsc -p packages/swc-ssr/tsconfig.build.json)');
  rmSync(distDir, {recursive: true, force: true});
  const tsc = node([path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'packages/swc-ssr/tsconfig.build.json']);
  if (tsc.status !== 0) throw new Error(`tsc failed:\n${tsc.stdout}${tsc.stderr}`);
  const distFiles = [...walk(distDir)];
  console.log(`dist: ${distFiles.length} files, ${(distFiles.reduce((sum, f) => sum + statSync(f).size, 0) / 1024).toFixed(0)} KiB`);

  // 2. publish manifest + npm pack
  step('npm pack (publish manifest)');
  rmSync(work, {recursive: true, force: true});
  mkdirSync(work, {recursive: true});
  const prepare = node(['scripts/prepare-publish.mjs', '--name', PUBLISH_NAME, '--allow-placeholders']);
  if (prepare.status !== 0) throw new Error(`prepare-publish failed:\n${prepare.stdout}${prepare.stderr}`);
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const pack = node([npmCli(), 'pack', './packages/swc-ssr', '--json', '--pack-destination', work]);
  const restore = node(['scripts/prepare-publish.mjs', '--restore']);
  if (restore.status !== 0) throw new Error(`restore failed:\n${restore.stdout}${restore.stderr}`);
  if (pack.status !== 0) throw new Error(`npm pack failed:\n${pack.stdout}${pack.stderr}`);
  const [packed] = JSON.parse(pack.stdout);
  const listed = packed.files.map((file) => file.path.replace(/\\/g, '/'));
  console.log(`${packed.filename}: ${listed.length} files, ${(packed.size / 1024).toFixed(0)} KiB packed, ${(packed.unpackedSize / 1024).toFixed(0)} KiB unpacked`);

  // 3. file list + declared dependencies
  step('tarball contents');
  for (const required of ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md', 'dist/server/index.js', 'dist/server/index.d.ts', 'dist/client/index.js', 'dist/client/index.d.ts', 'dist/dom-shim/index.js', 'dist/dom-shim/index.d.ts']) {
    if (!listed.includes(required)) fail(`tarball lacks ${required}`);
  }
  for (const file of listed) {
    if (!/^(dist\/|package\.json$|LICENSE$|README\.md$|CHANGELOG\.md$)/.test(file)) fail(`tarball contains unexpected file ${file}`);
  }
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  const builtins = new Set(builtinModules);
  const undeclared = new Map();
  for (const file of walk(distDir)) {
    if (!/\.(js|d\.ts)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:') || builtins.has(specifier)) continue;
      const parts = specifier.split('/');
      const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      if (!declared.has(name)) undeclared.set(name, path.relative(distDir, file));
    }
  }
  for (const [name, where] of undeclared) fail(`dist imports "${name}" (first seen in ${where}) but package.json does not declare it`);
  console.log(`${listed.length} files listed, ${declared.size} declared (peer) dependencies, ${undeclared.size} undeclared imports`);

  // 4. unpack like an installed package
  step('unpack and consume');
  const installed = path.join(work, 'node_modules', PUBLISH_NAME);
  mkdirSync(path.join(work, 'node_modules'), {recursive: true});
  const tar = run('tar', ['-xzf', packed.filename], {cwd: work});
  if (tar.status !== 0) throw new Error(`tar failed:\n${tar.stdout}${tar.stderr}`);
  renameSync(path.join(work, 'package'), installed);

  const consumer = (specifier) => `
import {installSpectrumSsr, renderSpectrum} from '${specifier}/server';
import * as server from '${specifier}/server';
import * as domShim from '${specifier}/dom-shim';
import {html} from 'lit';

installSpectrumSsr();
await import('@spectrum-web-components/theme/sp-theme.js');
await import('@spectrum-web-components/theme/src/themes.js');
await import('@spectrum-web-components/button/sp-button.js');
await import('@spectrum-web-components/picker/sp-picker.js');
await import('@spectrum-web-components/menu/sp-menu-item.js');

const page = html\`<sp-theme system="spectrum" color="light" scale="medium">
  <sp-button variant="accent">Save</sp-button>
  <sp-picker label="Fruit" value="b"><sp-menu-item value="a">Apple</sp-menu-item><sp-menu-item value="b">Banana</sp-menu-item></sp-picker>
</sp-theme>\`;
const {html: output, report} = await renderSpectrum(page, {deferHydration: true, lang: 'en'});
process.stdout.write(JSON.stringify({
  server: Object.keys(server).sort(),
  domShim: Object.keys(domShim).sort(),
  passes: report.passes,
  errors: report.elements.flatMap((element) => element.errors),
  html: output,
}));
`;
  writeFileSync(path.join(work, 'consumer-dist.mjs'), consumer(PUBLISH_NAME));
  writeFileSync(path.join(work, 'consumer-src.mjs'), consumer('swc-ssr'));

  const parse = (label, result) => {
    if (result.status !== 0) {
      fail(`${label} render failed:\n${result.stdout}${result.stderr}`);
      return undefined;
    }
    return JSON.parse(result.stdout);
  };
  const fromDist = parse('dist', node([path.join(work, 'consumer-dist.mjs')]));
  const fromSrc = parse('src', node(['--import', 'tsx', path.join(work, 'consumer-src.mjs')]));
  if (fromDist && fromSrc) {
    console.log(`dist render: ${fromDist.html.length} bytes, ${fromDist.passes} passes, ${fromDist.errors.length} errors; src render: ${fromSrc.html.length} bytes`);
    if (fromDist.errors.length > 0) fail(`dist render reported errors: ${fromDist.errors.join(' | ')}`);
    if (!/<sp-button[^>]*>\s*<template shadowroot/.test(fromDist.html)) fail('dist render has no declarative shadow root for sp-button');
    if (fromDist.html !== fromSrc.html) fail('rendered HTML differs between the packed dist and the workspace sources');
    if (JSON.stringify(fromDist.server) !== JSON.stringify(fromSrc.server)) fail('export names of "/server" differ between dist and src');
    if (JSON.stringify(fromDist.domShim) !== JSON.stringify(fromSrc.domShim)) fail('export names of "/dom-shim" differ between dist and src');
    console.log(`server exports: ${fromDist.server.join(', ')}`);
  }

  const bundle = await build({
    stdin: {contents: `export * from '${PUBLISH_NAME}/client';`, resolveDir: work, loader: 'js'},
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    metafile: true,
  }).catch((error) => {
    fail(`esbuild could not bundle "${PUBLISH_NAME}/client" for the browser: ${error.message}`);
    return undefined;
  });
  if (bundle) {
    const inputs = Object.keys(bundle.metafile.inputs);
    if (!inputs.some((input) => input.includes(`${PUBLISH_NAME}/dist/client/index.js`))) fail('client bundle does not contain dist/client/index.js');
    console.log(`client bundle: ${(bundle.outputFiles[0].contents.length / 1024).toFixed(0)} KiB from ${inputs.length} modules`);
  }

  writeFileSync(
    path.join(work, 'consumer.ts'),
    `import {installSpectrumSsr, renderSpectrum, registerAdapter} from '${PUBLISH_NAME}/server';
import type {RenderSpectrumOptions, RenderSpectrumResult, ElementAdapter, LifecycleMode} from '${PUBLISH_NAME}/server';
import {installSpectrumDomShim, configureRandomSource} from '${PUBLISH_NAME}/dom-shim';
import {hydrateSpectrum, registerHydrationAdapter} from '${PUBLISH_NAME}/client';
import type {HydrationReport, HydrateSpectrumOptions, HydrationAdapter} from '${PUBLISH_NAME}/client';

const mode: LifecycleMode = 'full';
const options: RenderSpectrumOptions = {deferHydration: true, lang: 'en', lifecycleByTag: {'sp-overlay': 'none'}};
const adapter: ElementAdapter = {tag: 'sp-x', lifecycle: mode};
const hydrationAdapter: HydrationAdapter = {tag: /^sp-/};
const hydrateOptions: HydrateSpectrumOptions = {whenDefined: true};
registerAdapter(adapter);
registerHydrationAdapter(hydrationAdapter);
installSpectrumSsr();
installSpectrumDomShim();
configureRandomSource({deterministicIds: false});
export const result: Promise<RenderSpectrumResult> = renderSpectrum('', options);
export const hydrated: Promise<HydrationReport> = hydrateSpectrum(document.body, hydrateOptions);
`,
  );
  writeFileSync(
    path.join(work, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['node'], experimentalDecorators: true, useDefineForClassFields: false,
      },
      files: ['consumer.ts'],
    }),
  );
  const check = node([path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(work, 'tsconfig.json'), '--pretty', 'false']);
  const diagnostics = `${check.stdout}${check.stderr}`.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
  const ours = diagnostics.filter((line) => line.includes(`node_modules/${PUBLISH_NAME}/`) || line.startsWith('consumer.ts'));
  for (const line of ours) fail(`type check: ${line}`);
  console.log(`type check of the three entry points: ${ours.length} errors in the package or the consumer (${diagnostics.length - ours.length} unrelated diagnostics in third-party typings)`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (existsSync(manifestBackup)) node(['scripts/prepare-publish.mjs', '--restore']);
  rmSync(work, {recursive: true, force: true});
  if (!hadDist && !keepDist) rmSync(distDir, {recursive: true, force: true});
}

if (problems.length > 0) {
  console.error(`\nverify-package: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('\nverify-package: ok');
