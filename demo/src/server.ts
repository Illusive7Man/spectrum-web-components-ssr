// The SSR shim must be installed before anything touches a Spectrum module, so this import has to stay first.
import './ssr-setup.js';
import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import type {ServerResponse} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {constants as zlibConstants, gzipSync} from 'node:zlib';
import compression from 'compression';
import express from 'express';
import type {NextFunction, Request, RequestHandler, Response} from 'express';
import {renderSpectrum} from 'swc-ssr/server';
import type {RenderReport, StyleOptions} from 'swc-ssr/server';
import {catalog, findEntry} from './catalog/index.js';
import type {CatalogEntry} from './catalog/types.js';
import {layoutCss, pageTemplate} from './page.js';
import {headFor, parseDedupe, STYLE_SHEET_PATH, styleSheetRoutes, type Coding} from './styles-routes.js';

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The client build (demo/build.mjs); SWC_SSR_DEMO_DIST points both at another directory. */
const distDir = process.env.SWC_SSR_DEMO_DIST
  ? path.resolve(process.env.SWC_SSR_DEMO_DIST)
  : path.join(demoRoot, 'public', 'dist');
const port = Number(process.env.PORT) || 3000;

/* -------------------------------------------------------------------------------------------------------------- *
 * Page shell
 * -------------------------------------------------------------------------------------------------------------- */

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface ShellOptions {
  title: string;
  mode: 'ssr' | 'csr';
  /** `<html lang>`. Must equal the language the page was server-rendered with (see `pageLanguage`). */
  lang: string;
  /** Names of the catalog entries on the page; the client reads them from `data-components`. */
  components: string[];
  /** Server-rendered markup (SSR) or '' (CSR). */
  body: string;
  /** Include the client bundle. */
  script: boolean;
  /**
   * Markup for `<head>` (after the favicon, before the layout CSS): with `?dedupe=link` the render's stylesheet hints
   * (`RenderSpectrumResult.head`, see `headFor`), '' otherwise.
   */
  head?: string;
}

/** `#app` has no whitespace around its content on purpose: SSR and CSR then produce the same child nodes. */
function shell({title, mode, lang, components, body, script, head}: ShellOptions): string {
  return (
    '<!doctype html>' +
    `<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(title)}</title>` +
    '<link rel="icon" href="data:,">' +
    (head ?? '') +
    `<style>${layoutCss}</style></head><body>` +
    `<div id="app" data-mode="${mode}" data-components="${escapeHtml(components.join(','))}">${body}</div>` +
    (script ? '<script type="module" src="/dist/client.js"></script>' : '') +
    '</body></html>'
  );
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Page language
 * -------------------------------------------------------------------------------------------------------------- */

/** A BCP 47 language tag in canonical form (`de-de` -> `de-DE`), or undefined when `value` is not one. */
function canonicalLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 35 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

/** The most preferred language of an `Accept-Language` header (highest q, first wins on ties; `*` ignored). */
function preferredLanguage(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const ranges = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
      return {tag: tag.trim(), q: q === undefined ? 1 : Number(q), index};
    })
    .filter((range) => range.tag !== '' && range.tag !== '*' && range.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const range of ranges) {
    const tag = canonicalLanguage(range.tag);
    if (tag) return tag;
  }
  return undefined;
}

/** Language of pages whose request names none (no `?lang=`, no usable `Accept-Language`). */
const DEFAULT_LANG = 'en';

/**
 * Language of a page: `?lang=<tag>` wins, else the request's most preferred `Accept-Language` language, else
 * `DEFAULT_LANG`. SSR routes pass it to `renderSpectrum({lang})` (number formatting / labels of components with a
 * `LanguageResolutionController`); SSR and CSR routes write it to `<html lang>`, where the client's components
 * resolve their locale from (through `<sp-theme>`), so the hydrating render formats like the server did. The
 * default is passed explicitly too: without a document language the server would resolve `navigator.language`
 * ('en-US') and report a `locale: no language is set` warning on every element that formats numbers.
 */
function pageLanguage(req: Request): string {
  return canonicalLanguage(req.query.lang) ?? preferredLanguage(req.get('accept-language')) ?? DEFAULT_LANG;
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Rendering
 * -------------------------------------------------------------------------------------------------------------- */

interface LoadFailure {
  name: string;
  message: string;
}

/** What /report.json returns: the RenderReport (with `styles` in trimmed mode), plus the entries that could not be loaded and were left out. */
type ServedReport = RenderReport & {loadErrors: LoadFailure[]};

/* -------------------------------------------------------------------------------------------------------------- *
 * ?styles= / ?refs=
 * -------------------------------------------------------------------------------------------------------------- */

/**
 * `?styles=`: 'full' (default) is today's output, 'trimmed' the trimmed CSS, 'minified' trimmed + short custom property names.
 * `?dedupe=link` (any mode) links every distinct stylesheet text (`/swc-css/<hash>.css`, demo/src/styles-routes.ts)
 * instead of repeating it in every shadow root; `?dedupe=none` / absent is the default. Other values are a 400 (which
 * tests/styles-dedupe.spec.ts uses to detect a server that supports the parameter).
 */
type StylesMode = 'full' | 'trimmed' | 'minified';
const STYLES_MODES: readonly StylesMode[] = ['full', 'trimmed', 'minified'];

interface StylesRequest {
  mode: StylesMode;
  options: StyleOptions;
}

/** A request the client got wrong (answered with 400, not 500). */
class BadRequestError extends Error {}

/** `?refs=--a,--b` (also repeated): custom property names / `--prefix-*` patterns the app's own CSS uses. */
function parseReferences(query: unknown): string[] {
  const values = Array.isArray(query) ? query : query === undefined ? [] : [query];
  const refs: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') throw new BadRequestError('?refs must be a comma separated list of custom property names');
    for (const part of value.split(',')) {
      const ref = part.trim();
      if (ref === '') continue;
      if (!/^--[A-Za-z0-9_*-]*$/.test(ref)) {
        throw new BadRequestError(`?refs: "${ref}" is not a custom property name (--name) or prefix (--prefix-*)`);
      }
      refs.push(ref);
    }
  }
  return refs;
}

function parseStyles(req: Request): StylesRequest {
  const raw = req.query.styles;
  const mode = raw === undefined || raw === '' ? 'full' : raw;
  if (typeof mode !== 'string' || !(STYLES_MODES as readonly string[]).includes(mode)) {
    throw new BadRequestError(`?styles must be one of ${STYLES_MODES.join(', ')}`);
  }
  const references = parseReferences(req.query.refs);
  const options: StyleOptions = {mode: mode === 'full' ? 'full' : 'trimmed'};
  if (mode === 'minified') options.minifyCustomProperties = true;
  if (references.length > 0) options.references = references;
  const dedupe = parseDedupe(req.query.dedupe);
  if (dedupe === undefined) throw new BadRequestError('?dedupe must be one of none, link');
  if (dedupe === 'link') options.dedupe = 'link';
  return {mode: mode as StylesMode, options};
}

const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

const ALL_KEY = '*';
let lastReport: ServedReport | undefined;
const reportsByKey = new Map<string, ServedReport>();

const loads = new Map<string, Promise<void>>();
/** `load()` registers custom elements, which must happen once; cache the promise (also a failed one). */
function loadOnce(entry: CatalogEntry): Promise<void> {
  let loading = loads.get(entry.name);
  if (loading === undefined) {
    loading = entry.load();
    loads.set(entry.name, loading);
  }
  return loading;
}

/**
 * Renders run one at a time: the DOM shim, the registered elements and the renderer's server tree are process-wide
 * state, and parallel e2e workers hit this server concurrently.
 */
let renderQueue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => undefined);
  return run;
}

interface SsrPage {
  html: string;
  /** `RenderSpectrumResult.head`: the stylesheet preload hints with `?dedupe=link`, '' otherwise. */
  head: string;
  /** The entries that are on the page (entries whose load() failed are left out when `tolerateLoadErrors`). */
  entries: CatalogEntry[];
  report: ServedReport;
  /** Wall time of load() + pageTemplate() + renderSpectrum(). */
  renderMs: number;
}

interface RenderSsrOptions {
  tolerateLoadErrors: boolean;
  lang: string;
  styles: StylesRequest;
  /** Store the report as "the last report" (/report.json); /styles.json renders on demand without touching it. */
  remember?: boolean;
}

function renderSsr(
  entries: CatalogEntry[],
  reportKey: string,
  {tolerateLoadErrors, lang, styles, remember = true}: RenderSsrOptions,
): Promise<SsrPage> {
  return exclusive(async () => {
    const started = performance.now();
    const loaded: CatalogEntry[] = [];
    const loadErrors: LoadFailure[] = [];
    for (const entry of entries) {
      try {
        await loadOnce(entry);
        loaded.push(entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!tolerateLoadErrors) throw error;
        loadErrors.push({name: entry.name, message});
        console.error(`[demo] load() of "${entry.name}" failed, leaving it out of the page: ${message}`);
      }
    }
    // deferHydration: nothing hydrates while the client is still loading definitions; hydrateSpectrum() then
    // enables the elements in document order (the order client-side rendering updates them in).
    const result = await renderSpectrum(pageTemplate(loaded), {deferHydration: true, lang, styles: styles.options});
    const report: ServedReport = {...result.report, loadErrors};
    if (remember) {
      lastReport = report;
      reportsByKey.set(reportKey, report);
    }
    return {html: result.html, head: result.head, entries: loaded, report, renderMs: performance.now() - started};
  });
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Server
 * -------------------------------------------------------------------------------------------------------------- */

const app = express();
app.disable('x-powered-by');

/**
 * Health checks: HEAD requests are answered with 200 right away and never render. Express would otherwise run the
 * GET handler for them - a full server render of the whole catalog for every `HEAD /` that a preview / uptime
 * monitor polls with. They are logged separately from the request log: the first one at once, then a count per
 * minute (only for minutes that had any).
 *
 * HEAD on `/dist/*` (the client bundle) is left to `express.static`, which answers it like the GET without the body:
 * with the file's `Content-Type` / `Content-Length` (404 for a missing file). Review finding (fixed): those requests
 * used to get the empty health-check answer, without a `Content-Type`. HEAD on `/swc-css/*` (`?dedupe=link`
 * stylesheets) is likewise answered by its route.
 */
const HEAD_LOG_INTERVAL_MS = 60_000;
let headRequests = 0;
let headLogged = false;
const headLog = setInterval(() => {
  if (headRequests > 0) {
    console.log(`[demo] health checks: ${headRequests} HEAD request(s) in the last minute (answered 200, no render)`);
    headRequests = 0;
  }
}, HEAD_LOG_INTERVAL_MS);
headLog.unref();

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'HEAD' || req.path.startsWith('/dist/') || req.path.startsWith(STYLE_SHEET_PATH)) {
    next();
    return;
  }
  res.status(200).set('Cache-Control', 'no-store').end();
  if (!headLogged) {
    headLogged = true;
    console.log(`[demo] health check: HEAD ${req.originalUrl} -> 200 (no render; further HEAD requests are counted per minute)`);
  } else {
    headRequests++;
  }
});

/** One line per request (static bundle files and linked stylesheets excluded); SSR routes add their render duration. */
app.use((req: Request, res: Response, next: NextFunction) => {
  const started = performance.now();
  res.on('finish', () => {
    if (req.path.startsWith('/dist/') || (req.path.startsWith(STYLE_SHEET_PATH) && res.statusCode === 200)) return;
    const render = typeof res.locals.renderLog === 'string' ? ` | ${res.locals.renderLog}` : '';
    console.log(
      `[demo] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${(performance.now() - started).toFixed(1)} ms${render}`,
    );
  });
  next();
});

/* -------------------------------------------------------------------------------------------------------------- *
 * Compression
 * -------------------------------------------------------------------------------------------------------------- */

/**
 * Responses are compressed the way a production server would, because the size of the markup is the point of the
 * exercise: a page repeats the same stylesheet in every shadow root of a class, which brotli's 4 MB window (quality 4,
 * about 20 ms for a 1.2 MB page) squeezes to a few percent while gzip's 32 KB window cannot (measured: a button page of
 * 1,252 KB is 43 KB with brotli, 120 KB with gzip).
 *
 *   dynamic    HTML, JSON and other compressible responses: `compression` negotiates `Accept-Encoding` and prefers brotli
 *              over gzip (unless the client's q-values say otherwise); responses below 1 KB are sent as they are.
 *              The middleware adds `Vary: Accept-Encoding` to every response it considers, compressed or not.
 *   /dist      the build (demo/build.mjs) wrote `<file>.br` and `<file>.gz` next to every script of 1 KB or more;
 *              `precompressed()` serves them (`Content-Encoding`, the original file's `Content-Type`) without compressing
 *              anything per request. Files without a sibling (source maps) fall through to the dynamic path.
 *   /swc-css   the `?dedupe=link` stylesheets (demo/src/styles-routes.ts) are mounted before the middleware: a text
 *              never changes under its hash, so the route compresses each one once and sets `Content-Encoding`,
 *              `Content-Length`, `ETag` and `Vary` itself, the same for GET, HEAD and 304 (review finding: behind the
 *              middleware a HEAD reported the identity length without `Content-Encoding`, and a 304 had no `Vary`).
 *              Unknown hashes are a 404 `no-store`; /dist requests never reach it.
 */
app.use(styleSheetRoutes(acceptedCodings));

app.use(
  compression({
    threshold: 1024,
    brotli: {params: {[zlibConstants.BROTLI_PARAM_QUALITY]: 4, [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT}},
  }),
);

const CODING_SUFFIX: Record<Coding, string> = {br: '.br', gzip: '.gz'};
/** Server preference when the client rates both the same. */
const CODING_ORDER: readonly Coding[] = ['br', 'gzip'];

/** The codings (br, gzip) an `Accept-Encoding` header allows, best first: by its q-values, then `CODING_ORDER`. */
function acceptedCodings(header: string | undefined): Coding[] {
  if (!header) return [];
  const quality = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((param) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
    quality.set(name.trim(), q === undefined ? 1 : Number(q));
  }
  const rated = CODING_ORDER.map((coding, index) => ({
    coding,
    index,
    q: quality.get(coding) ?? (coding === 'gzip' ? quality.get('x-gzip') : undefined) ?? quality.get('*') ?? 0,
  }));
  return rated
    .filter(({q}) => q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({coding}) => coding);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Which precompressed sibling `precompressed()` picked for a response (read by the static handler's `setHeaders`). */
const servedAs = new WeakMap<ServerResponse, {coding: Coding; suffix: string}>();

/**
 * Serves `<file>.br` / `<file>.gz` in place of `<file>` for clients that accept them: the request is handed on to the
 * static handler with the sibling's name (so ETag, Last-Modified, conditional requests, ranges and HEAD all work on the
 * file that is sent), and `setHeaders` below adds `Content-Encoding` and the original file's `Content-Type`.
 */
function precompressed(root: string): RequestHandler {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return async (req, res, next) => {
    try {
      const codings = req.method === 'GET' || req.method === 'HEAD' ? acceptedCodings(req.get('accept-encoding')) : [];
      if (codings.length > 0 && !req.path.endsWith('/')) {
        const file = path.join(root, decodeURIComponent(req.path));
        if (file.startsWith(prefix)) {
          for (const coding of codings) {
            const suffix = CODING_SUFFIX[coding];
            if (!(await isFile(file + suffix))) continue;
            servedAs.set(res, {coding, suffix});
            const query = req.url.indexOf('?');
            req.url = query < 0 ? req.url + suffix : req.url.slice(0, query) + suffix + req.url.slice(query);
            break;
          }
        }
      }
    } catch {
      // A malformed path: the static handler answers it.
    }
    next();
  };
}

/**
 * The build's files: chunks carry their content hash in the name and never change (`immutable`, a year); the entry
 * (`client.js`, its map) keeps its URL and is revalidated with its ETag on every load (`no-cache`: a conditional request
 * that is answered with 304 when nothing changed).
 */
function distHeaders(res: ServerResponse, file: string): void {
  const encoded = servedAs.get(res);
  const original = encoded ? file.slice(0, -encoded.suffix.length) : file;
  if (encoded) {
    res.setHeader('Content-Encoding', encoded.coding);
    // Without this the type would be the .br / .gz one; `send` leaves a Content-Type that is already set alone. The
    // same lookup `send` does for the plain file, so both variants carry the identical header.
    const {mime} = express.static;
    const type = mime.lookup(original, mime.default_type);
    const charset = mime.charsets.lookup(type, '');
    res.setHeader('Content-Type', type + (charset ? `; charset=${charset}` : ''));
  }
  const relative = path.relative(distDir, original).split(path.sep);
  res.setHeader('Cache-Control', relative[0] === 'chunks' ? 'public, max-age=31536000, immutable' : 'no-cache');
}

app.use('/dist', precompressed(distDir), express.static(distDir, {index: false, setHeaders: distHeaders}));

const route =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next);
  };

function sendHtml(res: Response, html: string): void {
  res.set('Cache-Control', 'no-store').type('html').send(html);
}

function notFound(res: Response, what: string): void {
  res.status(404).type('text/plain').send(`Not found: ${what}`);
}

async function serveSsr(
  req: Request,
  res: Response,
  entries: CatalogEntry[],
  reportKey: string,
  title: string,
  tolerateLoadErrors: boolean,
): Promise<void> {
  const lang = pageLanguage(req);
  const styles = parseStyles(req);
  const page = await renderSsr(entries, reportKey, {tolerateLoadErrors, lang, styles});
  const stylesReport = page.report.styles;
  const elementErrors = page.report.elements.reduce((sum, element) => sum + element.errors.length, 0);
  const fallbacks = page.report.elements.filter((element) => element.fallback).length;
  res.locals.renderLog =
    `render ${page.renderMs.toFixed(1)} ms (renderSpectrum ${page.report.durationMs.toFixed(1)} ms), ` +
    `${page.report.elements.length} elements, ${elementErrors} errors, ${fallbacks} fallbacks` +
    `, lang ${lang}` +
    `, styles ${styles.mode} ${stylesReport ? `${kb(stylesReport.trimmedBytes)}/${kb(stylesReport.fullBytes)} KB` : 'n/a'}` +
    (stylesReport?.dedupe
      ? `, linked ${stylesReport.dedupe.sheets.length} sheets ${kb(stylesReport.dedupe.linkedBytes)} KB (${stylesReport.dedupe.links} links)`
      : '') +
    (page.report.loadErrors.length > 0 ? `, ${page.report.loadErrors.length} entries skipped` : '');
  res.set('Server-Timing', `ssr;dur=${page.renderMs.toFixed(1)}`);
  sendHtml(
    res,
    shell({
      title,
      mode: 'ssr',
      lang,
      components: page.entries.map((entry) => entry.name),
      body: page.html,
      script: req.query.nohydrate !== '1',
      head: headFor(page, req.query.hints),
    }),
  );
}

function serveCsr(req: Request, res: Response, entries: CatalogEntry[], title: string): void {
  sendHtml(
    res,
    shell({
      title,
      mode: 'csr',
      lang: pageLanguage(req),
      components: entries.map((entry) => entry.name),
      body: '',
      script: true,
    }),
  );
}

// SSR of the whole catalog. An entry that fails to load is left out (and listed in /report.json) rather than
// taking the whole page down.
app.get(
  '/',
  route((req, res) => serveSsr(req, res, catalog, ALL_KEY, 'Spectrum SSR demo', true)),
);

app.get(
  '/component/:name',
  route(async (req, res) => {
    const entry = findEntry(req.params.name);
    if (!entry) return notFound(res, `component "${req.params.name}"`);
    await serveSsr(req, res, [entry], entry.name, `Spectrum SSR demo - ${entry.name}`, false);
  }),
);

// Client-only reference: same shell, empty #app, the client renders the same template with lit's render().
app.get(
  '/csr',
  route(async (req, res) => serveCsr(req, res, catalog, 'Spectrum SSR demo (CSR)')),
);

app.get(
  '/csr/:name',
  route(async (req, res) => {
    const entry = findEntry(req.params.name);
    if (!entry) return notFound(res, `component "${req.params.name}"`);
    serveCsr(req, res, [entry], `Spectrum SSR demo (CSR) - ${entry.name}`);
  }),
);

// The RenderReport of the last SSR render. `?component=<name>` (or `*` for the whole catalog) returns the last
// report of that particular page, which avoids races when several pages are rendered in parallel.
app.get('/report.json', (req, res) => {
  const key = typeof req.query.component === 'string' ? req.query.component : undefined;
  const report = key === undefined ? lastReport : reportsByKey.get(key);
  if (report === undefined) {
    res.status(404).json({error: key === undefined ? 'no SSR render has happened yet' : `no SSR render of "${key}" yet`});
    return;
  }
  res.set('Cache-Control', 'no-store').json(report);
});

/**
 * Size of the CSS a render produces, without a browser: `GET /styles.json?component=<name>&styles=<mode>` renders the
 * page on demand (the normal path; `component` omitted or `*` = the whole catalog; the "last report" of /report.json
 * is left alone) and returns
 *   fullBytes / trimmedBytes / sheets  from `report.styles` (what the trimmer says; both are the measured CSS size
 *                                      when the server core reports no styles),
 *   cssBytes                           measured: the text of every <style> element of the document,
 *   htmlBytes / gzipBytes              the whole document as served, raw and gzipped (gzip of the uncompressed
 *                                      document, unrelated to the response's own Content-Encoding),
 *   reported                           whether `report.styles` was present,
 *   dedupe                             with `?dedupe=link`: `report.styles.dedupe` (the linked texts: hash, url, bytes,
 *                                      links; `linkedBytes`, `inlineBytes`), else null; `sheets[].hash` names the
 *                                      linked text of a sheet. `cssBytes` then counts only the CSS left inline.
 */
app.get(
  '/styles.json',
  route(async (req, res) => {
    const name = typeof req.query.component === 'string' && req.query.component !== '' ? req.query.component : ALL_KEY;
    const entry = name === ALL_KEY ? undefined : findEntry(name);
    if (name !== ALL_KEY && !entry) return notFound(res, `component "${name}"`);
    const lang = pageLanguage(req);
    const styles = parseStyles(req);
    const page = await renderSsr(entry ? [entry] : catalog, name, {tolerateLoadErrors: !entry, lang, styles, remember: false});
    const document = shell({
      title: entry ? `Spectrum SSR demo - ${entry.name}` : 'Spectrum SSR demo',
      mode: 'ssr',
      lang,
      components: page.entries.map((loaded) => loaded.name),
      body: page.html,
      script: true,
      head: headFor(page, req.query.hints),
    });
    let cssBytes = 0;
    for (const match of document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) cssBytes += Buffer.byteLength(match[1] ?? '');
    const reported = page.report.styles;
    res.locals.renderLog = `styles ${styles.mode} ${reported ? `${kb(reported.trimmedBytes)}/${kb(reported.fullBytes)} KB` : 'n/a'}`;
    res.set('Cache-Control', 'no-store').json({
      component: name,
      styles: styles.mode,
      reported: reported !== undefined,
      fullBytes: reported?.fullBytes ?? cssBytes,
      trimmedBytes: reported?.trimmedBytes ?? cssBytes,
      cssBytes,
      htmlBytes: Buffer.byteLength(document),
      gzipBytes: gzipSync(document).length,
      sheets: reported?.sheets ?? [],
      dedupe: reported?.dedupe ?? null,
      durationMs: reported?.durationMs ?? null,
      elements: page.report.elements.length,
    });
  }),
);

app.get('/catalog.json', (_req, res) => {
  res.json(
    catalog.map((entry) => ({
      name: entry.name,
      interactive: entry.interactive === true,
      notes: entry.notes ?? null,
    })),
  );
});

app.use((req, res) => notFound(res, req.path));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BadRequestError && !res.headersSent) {
    res.status(400).type('text/plain').send(`Bad request: ${error.message}`);
    return;
  }
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[demo] ${req.method} ${req.originalUrl} failed:\n${text}`);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).type('text/plain').send(`Server-side rendering failed:\n\n${text}`);
});

if (!existsSync(path.join(distDir, 'client.js'))) {
  console.warn('[demo] demo/public/dist/client.js is missing - run "npm run build:client" (or "npm run demo"); pages will not hydrate.');
}

const server = app.listen(port, () => {
  console.log(`[demo] Spectrum SSR demo (${catalog.length} components) on http://localhost:${port}/`);
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`[demo] cannot listen on port ${port}: ${error.message}`);
  process.exit(1);
});
