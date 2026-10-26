#!/usr/bin/env node
// Switches packages/spectrum-web-components-ssr/package.json between its two "faces":
//
//   workspace (committed): exports -> ./src/*.ts   (the demo, the tests and tsx run straight from the sources)
//   publish:               exports -> ./dist/*.js  with "types" + "default" conditions (what consumers install)
//
// Usage (from the repository root):
//   node scripts/prepare-publish.mjs [--allow-placeholders] [--name <npm-name>]   workspace -> publish
//   node scripts/prepare-publish.mjs --restore                                    publish -> workspace
//
// "prepare" first copies the committed package.json byte for byte to packages/spectrum-web-components-ssr/package.json.orig (gitignored,
// never packed: the package's "files" list is a whitelist) and "--restore" copies it back and deletes the copy, so the
// round trip is lossless. Run "npm run build:pkg" first: prepare refuses to run when dist is missing an entry point.
//
// The committed package.json carries the npm name and "private": true, so that nothing gets published by accident;
// "prepare" drops the flag. --name <npm-name> publishes under another name (a scoped fork, a test name).
// --allow-placeholders  skip the check that rejects the REPLACE_WITH_OWNER repository placeholders (used by
//                     scripts/verify-package.mjs, which never publishes).
import {copyFileSync, existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'spectrum-web-components-ssr');
const manifestPath = path.join(pkgDir, 'package.json');
const backupPath = path.join(pkgDir, 'package.json.orig');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
  return value;
};

function fail(message) {
  console.error(`prepare-publish: ${message}`);
  process.exit(1);
}

const unknown = args.filter((arg, i) => arg.startsWith('--') && !['--restore', '--name', '--allow-placeholders'].includes(arg) && args[i - 1] !== '--name');
if (unknown.length > 0) fail(`unknown option ${unknown.join(', ')}`);

if (flag('--restore')) {
  if (!existsSync(backupPath)) fail('nothing to restore (packages/spectrum-web-components-ssr/package.json.orig does not exist)');
  copyFileSync(backupPath, manifestPath);
  rmSync(backupPath);
  console.log('prepare-publish: restored packages/spectrum-web-components-ssr/package.json (workspace exports -> ./src)');
  process.exit(0);
}

if (existsSync(backupPath)) fail('already prepared (package.json.orig exists); run with --restore first');

const original = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(original);

// Map every "./src/<dir>/index.ts" export to its dist twin. "./package.json" and anything that is not a src path stays.
const exportsMap = {};
for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
  if (typeof target !== 'string' || !target.startsWith('./src/') || !target.endsWith('.ts')) {
    exportsMap[subpath] = target;
    continue;
  }
  const js = target.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  const types = js.replace(/\.js$/, '.d.ts');
  for (const file of [js, types]) {
    if (!existsSync(path.join(pkgDir, file))) fail(`${file} does not exist; run "npm run build:pkg" first`);
  }
  exportsMap[subpath] = {types, default: js};
}
if (Object.values(exportsMap).every((target) => typeof target === 'string')) {
  fail('no "./src/*.ts" export found: package.json already looks like a publish manifest');
}

const published = {...manifest, exports: exportsMap};
delete published.private;
const name = option('--name');
if (name !== undefined) published.name = name;

const placeholders = JSON.stringify([published.repository, published.bugs, published.homepage]).includes('REPLACE_WITH_OWNER');
if (placeholders && !flag('--allow-placeholders')) {
  fail('package.json still contains REPLACE_WITH_OWNER (repository, bugs, homepage): set the real repository URL first');
}

copyFileSync(manifestPath, backupPath);
writeFileSync(manifestPath, `${JSON.stringify(published, null, 2)}\n`);
console.log(
  `prepare-publish: packages/spectrum-web-components-ssr/package.json now points at ./dist` +
    `, name "${published.name}", public`,
);
console.log('prepare-publish: after packing or publishing run "npm run pkg:restore"');
