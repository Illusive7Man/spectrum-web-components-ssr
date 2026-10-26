import {readdirSync, readFileSync, statSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import type {IncomingHttpHeaders} from 'node:http';
import path from 'node:path';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {expect, test} from '@playwright/test';
import {linkedHrefs, preloadHrefs} from './helpers/dedupe.ts';

/**
 * Demo server behaviour that is not about rendering (demo/src/server.ts, docs/API.md "Demo server routes"):
 *  - HEAD on an SSR route is a health check: 200, empty body, no render;
 *  - HEAD on a bundle file (`/dist/*`) is answered by the static file handler, with the file's Content-Type (review
 *    finding: it used to get the empty health-check answer without one);
 *  - compression: HTML and JSON are compressed on the fly (brotli q4, gzip fallback, nothing below 1 KB), the build's
 *    scripts are served from their precompressed `.br` / `.gz` siblings, chunks are `immutable`;
 *  - `?dedupe=link` (demo/src/styles-routes.ts): a 400 for unknown values, preload hints in `<head>` for exactly the
 *    linked URLs, `/swc-css/<hash>.css` immutable (and compressed), 404 `no-store` for unknown hashes, `/styles.json`
 *    reporting the linked texts;
 *  - the client build is code-split (a small entry, one registration chunk per catalog entry).
 */

interface Raw {
  status: number;
  headers: IncomingHttpHeaders;
  /** The body exactly as it came over the wire: not decoded. */
  body: Buffer;
}

/** A request that leaves `Content-Encoding` alone (Playwright's request API and browsers decode it). */
function fetchRaw(baseURL: string, pathname: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Raw> {
  const url = new URL(pathname, baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers}, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks)}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** The body with its `Content-Encoding` undone. */
function decoded(raw: Raw): Buffer {
  switch (raw.headers['content-encoding']) {
    case undefined:
      return raw.body;
    case 'br':
      return brotliDecompressSync(raw.body);
    case 'gzip':
      return gunzipSync(raw.body);
    default:
      throw new Error(`unexpected content-encoding ${String(raw.headers['content-encoding'])}`);
  }
}

const varies = (raw: Raw): boolean => /(?:^|,)\s*accept-encoding\s*(?:,|$)/i.test(String(raw.headers.vary ?? ''));

/** The build output the server serves (demo/build.mjs; SWC_SSR_DEMO_DIST moves both). */
const distDir = process.env.SWC_SSR_DEMO_DIST ? path.resolve(process.env.SWC_SSR_DEMO_DIST) : path.resolve('demo/public/dist');

/** A chunk of the build that is large enough to have precompressed siblings. */
function aChunk(): string {
  const dir = path.join(distDir, 'chunks');
  const names = readdirSync(dir).filter((name) => name.endsWith('.js') && statSync(path.join(dir, name)).size >= 20_000);
  expect(names.length, `chunks of 20 KB or more in ${dir}`).toBeGreaterThan(0);
  return names[0]!;
}

test.describe('demo server', () => {
  test('HEAD on a bundle file carries its Content-Type', async ({request}) => {
    const head = await request.head('/dist/client.js');
    expect(head.status()).toBe(200);
    expect(head.headers()['content-type']).toMatch(/javascript/);
    const get = await request.get('/dist/client.js');
    expect(head.headers()['content-type']).toBe(get.headers()['content-type']);
    expect(head.headers()['content-length']).toBe(get.headers()['content-length']);
  });

  test('HEAD on a missing bundle file is a 404', async ({request}) => {
    const head = await request.head('/dist/does-not-exist.js');
    expect(head.status()).toBe(404);
  });

  test('HEAD on an SSR route is a health check: 200 with an empty body', async ({request}) => {
    const head = await request.head('/component/button');
    expect(head.status()).toBe(200);
    expect((await head.body()).length).toBe(0);
    expect(head.headers()['cache-control']).toBe('no-store');
  });
});

test.describe('demo server: compression', () => {
  test('SSR page: Accept-Encoding br gives a brotli body that decodes to the identical HTML', async ({baseURL}) => {
    const identity = await fetchRaw(baseURL!, '/component/button', {'accept-encoding': 'identity'});
    expect(identity.status).toBe(200);
    expect(identity.headers['content-encoding'], 'identity request: no Content-Encoding').toBeUndefined();
    expect(identity.body.length, 'the page is well above the 1 KB threshold').toBeGreaterThan(10_000);
    expect(varies(identity), 'Vary: Accept-Encoding on the identity response too').toBe(true);

    const br = await fetchRaw(baseURL!, '/component/button', {'accept-encoding': 'br'});
    expect(br.status).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(varies(br)).toBe(true);
    expect(br.headers['content-type']).toBe(identity.headers['content-type']);
    expect(br.headers['content-length'], 'streamed: no Content-Length of the uncompressed body').toBeUndefined();
    expect(decoded(br).equals(identity.body), 'the decoded brotli body is byte-identical to the identity HTML').toBe(true);
    // A shadow root per element repeats its class's stylesheet: that is what brotli's long window removes.
    expect(br.body.length, 'brotli wire bytes vs identity').toBeLessThan(identity.body.length / 5);
  });

  test('SSR page: gzip is the fallback when brotli is not accepted', async ({baseURL}) => {
    const identity = await fetchRaw(baseURL!, '/component/button', {'accept-encoding': 'identity'});
    const gzip = await fetchRaw(baseURL!, '/component/button', {'accept-encoding': 'gzip'});
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(varies(gzip)).toBe(true);
    expect(decoded(gzip).equals(identity.body)).toBe(true);
    expect(gzip.body.length).toBeLessThan(identity.body.length / 2);

    const none = await fetchRaw(baseURL!, '/component/button', {});
    expect(none.headers['content-encoding'], 'no Accept-Encoding header: sent as it is').toBeUndefined();
    expect(none.body.equals(identity.body)).toBe(true);
  });

  test('negotiation: browsers get brotli, q-values and q=0 are honoured', async ({baseURL}) => {
    const encodingFor = async (header: string): Promise<string | undefined> => {
      const raw = await fetchRaw(baseURL!, '/catalog.json', {'accept-encoding': header});
      expect(raw.status).toBe(200);
      expect(varies(raw), `Vary for "${header}"`).toBe(true);
      return raw.headers['content-encoding'] as string | undefined;
    };
    expect(await encodingFor('gzip, deflate, br, zstd'), 'a Chromium Accept-Encoding').toBe('br');
    expect(await encodingFor('gzip, deflate, br'), 'a Playwright request Accept-Encoding').toBe('br');
    expect(await encodingFor('br, gzip')).toBe('br');
    expect(await encodingFor('gzip')).toBe('gzip');
    expect(await encodingFor('gzip, deflate')).toBe('gzip');
    expect(await encodingFor('br;q=0, gzip')).toBe('gzip');
    expect(await encodingFor('br;q=0.4, gzip;q=0.8')).toBe('gzip');
    expect(await encodingFor('*')).toBe('br');
    expect(await encodingFor('identity')).toBeUndefined();
    expect(await encodingFor('br;q=0, gzip;q=0')).toBeUndefined();
  });

  test('JSON is compressed and decodes to the identical document', async ({baseURL}) => {
    const identity = await fetchRaw(baseURL!, '/catalog.json', {'accept-encoding': 'identity'});
    const br = await fetchRaw(baseURL!, '/catalog.json', {'accept-encoding': 'br'});
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toMatch(/application\/json/);
    expect(decoded(br).equals(identity.body)).toBe(true);
    expect(JSON.parse(decoded(br).toString('utf8'))).toEqual(JSON.parse(identity.body.toString('utf8')));
    expect(br.body.length).toBeLessThan(identity.body.length);
  });

  test('responses below 1 KB are not compressed', async ({baseURL}) => {
    const raw = await fetchRaw(baseURL!, '/report.json?component=no-such-page', {'accept-encoding': 'br, gzip'});
    expect(raw.status).toBe(404);
    expect(raw.body.length).toBeLessThan(1024);
    expect(raw.headers['content-encoding']).toBeUndefined();
    expect(varies(raw), 'still varies: whether a response is compressed depends on its size, not only on the request').toBe(true);
    expect(JSON.parse(raw.body.toString('utf8'))).toHaveProperty('error');
  });

  test('/dist: scripts are served precompressed, with the plain file as the identity answer', async ({baseURL}) => {
    const file = readFileSync(path.join(distDir, 'client.js'));
    const identity = await fetchRaw(baseURL!, '/dist/client.js', {'accept-encoding': 'identity'});
    expect(identity.status).toBe(200);
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.body.equals(file), 'identity: the file as built').toBe(true);
    expect(varies(identity)).toBe(true);

    for (const [encoding, suffix] of [
      ['br', '.br'],
      ['gzip', '.gz'],
    ] as const) {
      const raw = await fetchRaw(baseURL!, '/dist/client.js', {'accept-encoding': encoding});
      expect(raw.status, encoding).toBe(200);
      expect(raw.headers['content-encoding'], encoding).toBe(encoding);
      expect(varies(raw), encoding).toBe(true);
      expect(raw.headers['content-type'], 'the original file type, not the sibling\'s').toBe(identity.headers['content-type']);
      expect(raw.headers['content-type']).toMatch(/javascript/);
      expect(raw.body.equals(readFileSync(path.join(distDir, `client.js${suffix}`))), `${encoding}: the sibling as built, not compressed again`).toBe(true);
      expect(raw.headers['content-length']).toBe(String(raw.body.length));
      expect(decoded(raw).equals(file), `${encoding}: decodes to the file`).toBe(true);
      expect(raw.headers.etag, 'each representation has its own ETag').not.toBe(identity.headers.etag);
    }
    const browser = await fetchRaw(baseURL!, '/dist/client.js', {'accept-encoding': 'gzip, deflate, br, zstd'});
    expect(browser.headers['content-encoding']).toBe('br');
  });

  test('/dist: chunks are immutable and revalidate to 304, the entry is always revalidated', async ({baseURL}) => {
    const chunk = `/dist/chunks/${aChunk()}`;
    const first = await fetchRaw(baseURL!, chunk, {'accept-encoding': 'br'});
    expect(first.status).toBe(200);
    expect(first.headers['content-encoding']).toBe('br');
    expect(first.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(first.headers.etag).toBeTruthy();
    const again = await fetchRaw(baseURL!, chunk, {'accept-encoding': 'br', 'if-none-match': String(first.headers.etag)});
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);

    const entry = await fetchRaw(baseURL!, '/dist/client.js', {'accept-encoding': 'br'});
    expect(entry.headers['cache-control']).toBe('no-cache');
    const entryAgain = await fetchRaw(baseURL!, '/dist/client.js', {'accept-encoding': 'br', 'if-none-match': String(entry.headers.etag)});
    expect(entryAgain.status).toBe(304);
  });

  test('/dist: HEAD answers like the GET without the body (precompressed too)', async ({baseURL}) => {
    const chunk = `/dist/chunks/${aChunk()}`;
    const get = await fetchRaw(baseURL!, chunk, {'accept-encoding': 'br'});
    const head = await fetchRaw(baseURL!, chunk, {'accept-encoding': 'br'}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.headers['content-length']).toBe(get.headers['content-length']);
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers.etag).toBe(get.headers.etag);
  });

  test('/dist: a source map has no sibling and is compressed on the fly', async ({baseURL}) => {
    const file = readFileSync(path.join(distDir, 'client.js.map'));
    const identity = await fetchRaw(baseURL!, '/dist/client.js.map', {'accept-encoding': 'identity'});
    expect(identity.body.equals(file)).toBe(true);
    const raw = await fetchRaw(baseURL!, '/dist/client.js.map', {'accept-encoding': 'br'});
    expect(raw.status).toBe(200);
    if (file.length >= 1024) {
      expect(raw.headers['content-encoding']).toBe('br');
      expect(decoded(raw).equals(file)).toBe(true);
    }
    expect(varies(raw)).toBe(true);
  });

  test('/dist: no path escapes the build directory, and nothing is compressed for a missing file', async ({baseURL}) => {
    for (const bad of ['/dist/..%2fpackage.json', '/dist/%2e%2e/package.json', '/dist/chunks/%00', '/dist/%zz']) {
      const raw = await fetchRaw(baseURL!, bad, {'accept-encoding': 'br'});
      expect(raw.status, bad).toBeGreaterThanOrEqual(400);
      expect(raw.status, bad).toBeLessThan(500);
      expect(raw.headers['content-encoding'], bad).not.toBe('br');
    }
    const missing = await fetchRaw(baseURL!, '/dist/chunks/does-not-exist.js', {'accept-encoding': 'br'});
    expect(missing.status).toBe(404);
  });
});

test.describe('demo server: ?dedupe=link', () => {
  test('an unknown ?dedupe value is a 400; none is the default', async ({baseURL}) => {
    const bad = await fetchRaw(baseURL!, '/component/button?dedupe=inline&nohydrate=1');
    expect(bad.status).toBe(400);
    const none = await fetchRaw(baseURL!, '/component/button?dedupe=none&nohydrate=1', {'accept-encoding': 'identity'});
    expect(none.status).toBe(200);
    const html = none.body.toString('utf8');
    expect(linkedHrefs(html)).toEqual([]);
    expect(preloadHrefs(html)).toEqual([]);
  });

  test('the head preloads every linked stylesheet once; /swc-css/ serves them immutable and compressed', async ({baseURL}) => {
    const page = await fetchRaw(baseURL!, '/component/button?styles=trimmed&dedupe=link&nohydrate=1', {'accept-encoding': 'identity'});
    expect(page.status).toBe(200);
    const html = page.body.toString('utf8');
    const linked = linkedHrefs(html);
    const distinct = [...new Set(linked)];
    expect(linked.length, 'one <link> per shadow root and linked sheet').toBeGreaterThan(distinct.length);
    expect(preloadHrefs(html), 'one preload per distinct URL, in order of first use').toEqual(distinct);
    for (const href of distinct) expect(href).toMatch(/^\/swc-css\/[A-Za-z0-9_-]{16}\.css$/);

    const href = distinct[0]!;
    const identity = await fetchRaw(baseURL!, href, {'accept-encoding': 'identity'});
    expect(identity.status).toBe(200);
    expect(identity.headers['content-type']).toMatch(/^text\/css/);
    expect(identity.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const largest = (
      await Promise.all(distinct.map(async (url) => ({url, raw: await fetchRaw(baseURL!, url, {'accept-encoding': 'identity'})})))
    ).sort((a, b) => b.raw.body.length - a.raw.body.length)[0]!;
    expect(largest.raw.body.length, 'the largest linked sheet is above the 1 KB compression threshold').toBeGreaterThan(1024);
    const br = await fetchRaw(baseURL!, largest.url, {'accept-encoding': 'br'});
    expect(br.headers['content-encoding']).toBe('br');
    expect(decoded(br).equals(largest.raw.body)).toBe(true);

    // HEAD is answered by the route (not the SSR health check), like the GET without the body.
    const head = await fetchRaw(baseURL!, href, {'accept-encoding': 'identity'}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers['content-type']).toBe(identity.headers['content-type']);
    expect(head.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    // Review finding (0.3.0): behind the compression middleware a HEAD with `Accept-Encoding: br` reported the identity
    // length without `Content-Encoding` while the GET was brotli, and a 304 had no `Vary`. Each coding: GET and HEAD
    // carry the same Content-Encoding / Content-Length / ETag / Vary, a GET with that ETag is a 304 with Vary.
    for (const [encoding, accept] of [
      ['identity', 'identity'],
      ['br', 'br'],
      ['gzip', 'gzip'],
      ['br', 'gzip, deflate, br, zstd'],
    ] as const) {
      const label = `Accept-Encoding: ${accept}`;
      const get = await fetchRaw(baseURL!, largest.url, {'accept-encoding': accept});
      expect(get.status, label).toBe(200);
      expect(get.headers['content-encoding'], label).toBe(encoding === 'identity' ? undefined : encoding);
      expect(get.headers['content-length'], label).toBe(String(get.body.length));
      expect(decoded(get).equals(largest.raw.body), `${label}: decodes to the text`).toBe(true);
      expect(varies(get), label).toBe(true);
      expect(get.headers.etag, label).toBeTruthy();
      const headOf = await fetchRaw(baseURL!, largest.url, {'accept-encoding': accept}, 'HEAD');
      expect(headOf.status, `HEAD ${label}`).toBe(200);
      expect(headOf.body.length, `HEAD ${label}`).toBe(0);
      for (const name of ['content-encoding', 'content-length', 'content-type', 'etag', 'vary', 'cache-control']) {
        expect(headOf.headers[name], `HEAD ${label}: ${name}`).toBe(get.headers[name]);
      }
      const again = await fetchRaw(baseURL!, largest.url, {'accept-encoding': accept, 'if-none-match': String(get.headers.etag)});
      expect(again.status, `conditional ${label}`).toBe(304);
      expect(again.body.length).toBe(0);
      expect(varies(again), `304 ${label}: Vary`).toBe(true);
      expect(again.headers.etag, `304 ${label}`).toBe(get.headers.etag);
      expect(again.headers['cache-control'], `304 ${label}`).toBe('public, max-age=31536000, immutable');
    }
    const etags = await Promise.all(
      ['identity', 'br', 'gzip'].map(async (accept) => (await fetchRaw(baseURL!, largest.url, {'accept-encoding': accept})).headers.etag),
    );
    expect(new Set(etags).size, 'one ETag per representation').toBe(3);
    // A small text (under the 1 KB threshold) is sent as it is, still with Vary.
    const smallest = (
      await Promise.all(distinct.map(async (url) => ({url, raw: await fetchRaw(baseURL!, url, {'accept-encoding': 'identity'})})))
    ).sort((a, b) => a.raw.body.length - b.raw.body.length)[0]!;
    if (smallest.raw.body.length < 1024) {
      const small = await fetchRaw(baseURL!, smallest.url, {'accept-encoding': 'br'});
      expect(small.headers['content-encoding']).toBeUndefined();
      expect(varies(small)).toBe(true);
    }

    for (const unknown of ['/swc-css/AAAAAAAAAAAAAAAA.css', '/swc-css/not-a-hash.css']) {
      const missing = await fetchRaw(baseURL!, unknown);
      expect(missing.status, unknown).toBe(404);
      expect(missing.headers['cache-control'], `${unknown}: a 404 must not be cached`).toBe('no-store');
    }
  });

  test('/styles.json reports what was linked', async ({request}) => {
    const response = await request.get('/styles.json?component=button&styles=trimmed&dedupe=link');
    expect(response.status()).toBe(200);
    const json = (await response.json()) as {
      dedupe: {mode: string; sheets: Array<{hash: string; url: string; bytes: number; links: number}>; links: number; linkedBytes: number} | null;
      sheets: Array<{hash?: string}>;
    };
    expect(json.dedupe?.mode).toBe('link');
    const sheets = json.dedupe!.sheets;
    expect(sheets.length).toBeGreaterThan(0);
    expect(json.dedupe!.links).toBe(sheets.reduce((sum, sheet) => sum + sheet.links, 0));
    expect(json.dedupe!.linkedBytes).toBe(sheets.reduce((sum, sheet) => sum + sheet.bytes, 0));
    const hashes = new Set(sheets.map((sheet) => sheet.hash));
    for (const sheet of json.sheets) if (sheet.hash !== undefined) expect(hashes.has(sheet.hash), sheet.hash).toBe(true);
    const inline = (await (await request.get('/styles.json?component=button&styles=trimmed')).json()) as {dedupe: unknown};
    expect(inline.dedupe).toBeNull();
  });
});

test.describe('client build', () => {
  test('is code-split: a small entry bootstrap and a registration chunk per catalog entry', async () => {
    const entry = statSync(path.join(distDir, 'client.js')).size;
    expect(entry, 'dist/client.js is a bootstrap, not the 2.5 MB bundle of old').toBeLessThan(20_000);
    const chunks = readdirSync(path.join(distDir, 'chunks')).filter((name) => name.endsWith('.js'));
    expect(chunks.length, 'chunks: the application, the page theme, one registration module per entry, shared modules').toBeGreaterThan(100);
    const app = chunks.find((name) => name.startsWith('client-app-'));
    expect(app, 'the application chunk (demo/src/client-app.ts)').toBeTruthy();
    // demo/build.mjs "Registration modules": one chunk per catalog entry, which defines its elements in the order its
    // load() lists them (separate import()s would race: sp-sidenav-item before sp-sidenav throws).
    const registrations = chunks.filter((name) => /^register-[a-z-]+-[A-Z0-9]{8}\.js$/.test(name));
    expect(registrations.length, 'register-<entry>-<hash>.js chunks').toBeGreaterThanOrEqual(59);
    expect(registrations.some((name) => name.startsWith('register-sidenav-'))).toBe(true);
  });

  test('spectrum-web-components-ssr/client is the first module the entry evaluates and lit-element is not in its static graph', async () => {
    const entry = readFileSync(path.join(distDir, 'client.js'), 'utf8');
    // The static imports of the entry: shared chunks only, every one of them evaluated before the entry's own code.
    const staticImports = [...entry.matchAll(/^import(?:\{[^}]*\}from|)"(\.\/chunks\/[^"]+)";?/gm)].map((match) => match[1]!);
    const seen = new Set<string>();
    const walk = (spec: string, from: string): void => {
      const file = path.join(path.dirname(from), spec);
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/(?:^|[;}])(?:import|export)(?:[^"';]*?from)?"(\.\/[^"]+)"/g)) walk(match[1]!, file);
    };
    for (const spec of staticImports) walk(spec, path.join(distDir, 'client.js'));
    expect(seen.size, 'the entry has static imports (spectrum-web-components-ssr/client and its modules)').toBeGreaterThan(0);
    let hydrateSupport = false;
    for (const file of seen) {
      const code = readFileSync(file, 'utf8');
      if (code.includes('litElementHydrateSupport=')) hydrateSupport = true;
      // lit-element reads `globalThis.litElementHydrateSupport` once, while it defines LitElement.
      expect(code.includes('litElementHydrateSupport?.'), `${path.basename(file)} must not evaluate lit-element before the entry`).toBe(false);
    }
    expect(hydrateSupport, 'lit-element-hydrate-support is part of the entry graph').toBe(true);
    expect(entry, 'the application is loaded with import() after spectrum-web-components-ssr/client ran').toMatch(/import\("\.\/chunks\/client-app-[A-Z0-9]+\.js"\)/);
  });
});
