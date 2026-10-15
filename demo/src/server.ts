// The SSR shim must be installed before anything touches a Spectrum module, so this import has to stay first.
import './ssr-setup.js';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import type {NextFunction, Request, RequestHandler, Response} from 'express';
import {renderSpectrum} from 'swc-ssr/server';
import type {RenderReport} from 'swc-ssr/server';
import {catalog, findEntry} from './catalog/index.js';
import type {CatalogEntry} from './catalog/types.js';
import {layoutCss, pageTemplate} from './page.js';

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(demoRoot, 'public', 'dist');
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
}

/** `#app` has no whitespace around its content on purpose: SSR and CSR then produce the same child nodes. */
function shell({title, mode, lang, components, body, script}: ShellOptions): string {
  return (
    '<!doctype html>' +
    `<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(title)}</title>` +
    '<link rel="icon" href="data:,">' +
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

/** What /report.json returns: the RenderReport, plus the entries that could not be loaded and were left out. */
type ServedReport = RenderReport & {loadErrors: LoadFailure[]};

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
  /** The entries that are on the page (entries whose load() failed are left out when `tolerateLoadErrors`). */
  entries: CatalogEntry[];
  report: ServedReport;
  /** Wall time of load() + pageTemplate() + renderSpectrum(). */
  renderMs: number;
}

function renderSsr(
  entries: CatalogEntry[],
  reportKey: string,
  tolerateLoadErrors: boolean,
  lang: string,
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
    const result = await renderSpectrum(pageTemplate(loaded), {deferHydration: true, lang});
    const report: ServedReport = {...result.report, loadErrors};
    lastReport = report;
    reportsByKey.set(reportKey, report);
    return {html: result.html, entries: loaded, report, renderMs: performance.now() - started};
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
 * used to get the empty health-check answer, without a `Content-Type`.
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
  if (req.method !== 'HEAD' || req.path.startsWith('/dist/')) {
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

/** One line per request (static bundle files excluded); SSR routes add their render duration. */
app.use((req: Request, res: Response, next: NextFunction) => {
  const started = performance.now();
  res.on('finish', () => {
    if (req.path.startsWith('/dist/')) return;
    const render = typeof res.locals.renderLog === 'string' ? ` | ${res.locals.renderLog}` : '';
    console.log(
      `[demo] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${(performance.now() - started).toFixed(1)} ms${render}`,
    );
  });
  next();
});

app.use('/dist', express.static(distDir, {index: false}));

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
  const page = await renderSsr(entries, reportKey, tolerateLoadErrors, lang);
  const elementErrors = page.report.elements.reduce((sum, element) => sum + element.errors.length, 0);
  const fallbacks = page.report.elements.filter((element) => element.fallback).length;
  res.locals.renderLog =
    `render ${page.renderMs.toFixed(1)} ms (renderSpectrum ${page.report.durationMs.toFixed(1)} ms), ` +
    `${page.report.elements.length} elements, ${elementErrors} errors, ${fallbacks} fallbacks` +
    `, lang ${lang}` +
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
