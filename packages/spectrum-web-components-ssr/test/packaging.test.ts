/**
 * Review finding (low): the package manifest and the lock file.
 *  - `@lit-labs/ssr` is pinned to patch releases of 4.1 (`~4.1.0`): the renderers rely on 4.1.0 internals (the
 *    element-part marker passed as a static attribute, the host-stack behaviour of `custom-element-shadow`,
 *    `lib/render.js` `renderThunked`), which a minor release may change.
 *  - `package-lock.json` must describe the workspace package as its manifest does (it was left stale when
 *    dependencies / peers changed).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (url: URL): any => JSON.parse(readFileSync(url, 'utf8'));
const manifest = read(new URL('../package.json', import.meta.url));
const lock = read(new URL('../../../package-lock.json', import.meta.url));
const require = createRequire(import.meta.url);

test('@lit-labs/ssr is pinned to 4.1.x patch releases, and the installed version satisfies it', () => {
  assert.equal(manifest.peerDependencies['@lit-labs/ssr'], '~4.1.0');
  const installed = (require('@lit-labs/ssr/package.json') as {version: string}).version;
  assert.match(installed, /^4\.1\.\d+$/, `installed @lit-labs/ssr ${installed}`);
});

test('package-lock.json describes the workspace package like its manifest', () => {
  const entry = lock.packages?.['packages/spectrum-web-components-ssr'];
  assert.ok(entry, 'the lock file has an entry for packages/spectrum-web-components-ssr');
  assert.equal(entry.version, manifest.version);
  assert.deepEqual(entry.dependencies ?? {}, manifest.dependencies ?? {}, 'dependencies');
  assert.deepEqual(entry.peerDependencies ?? {}, manifest.peerDependencies ?? {}, 'peerDependencies');
  assert.deepEqual(entry.peerDependenciesMeta ?? {}, manifest.peerDependenciesMeta ?? {}, 'peerDependenciesMeta');
});
