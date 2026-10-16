/**
 * The demo's side of `StyleOptions.dedupe: 'link'` (swc-ssr 0.3.0): the route that serves the linked stylesheets, and
 * the `?dedupe=` / `?hints=` query parameters of the SSR routes. Mounted by demo/src/server.ts:
 *
 *   app.use(styleSheetRoutes(acceptedCodings));        // GET / HEAD /swc-css/<hash>.css, BEFORE compression()
 *   options.dedupe = parseDedupe(req.query.dedupe);    // in parseStyles(); undefined -> 400
 *   head: headFor(result, req.query.hints)             // in the page shell, inside <head>, before <body>
 *
 * Contract (docs/API.md "Styles"): a hash names one text for ever, so the stylesheets are served with
 * `Cache-Control: public, max-age=31536000, immutable`; an unknown hash (never rendered by this process, or evicted from
 * `styleSheetStore`) is a 404 that must not be cached.
 *
 * Encoding (review finding, 0.3.0): the route used to sit behind the `compression` middleware, which compressed every
 * answer again and only for GET - a HEAD with `Accept-Encoding: br` reported the identity `Content-Length` and no
 * `Content-Encoding` while the GET was brotli, and a 304 carried no `Vary`. A text never changes under its hash, so
 * its brotli and gzip bodies are computed once (on the first request for the hash) and kept with it; GET and HEAD get
 * the same `Content-Encoding` / `Content-Length` / `ETag` (one per representation) / `Vary: Accept-Encoding`, and so
 * does a 304 (without the length). Texts under 1 KB are sent as they are (like every other response of the demo).
 */
import {brotliCompressSync, constants as zlibConstants, gzipSync} from 'node:zlib';
import express from 'express';
import type {Request, Response, Router} from 'express';
import {DEFAULT_STYLE_SHEET_PATH, getStyleSheet, styleHeadOf} from 'swc-ssr/server';
import type {RenderReport, StyleHeadHint} from 'swc-ssr/server';

/** URL path prefix the default `StyleOptions.dedupeUrl` writes (`/swc-css/`). */
export const STYLE_SHEET_PATH = DEFAULT_STYLE_SHEET_PATH;

const FILE_RE = /^([A-Za-z0-9_-]{16})\.css$/;

/** Content codings the route can send (the same ones `compression` and the /dist handler use). */
export type Coding = 'br' | 'gzip';

/** Smaller texts are sent uncompressed (the threshold of the demo's `compression` middleware). */
const MIN_COMPRESS_BYTES = 1024;
/** Encoded bodies kept for this many bytes in all (identity + br + gzip), least recently used out first. */
const ENCODED_BUDGET_BYTES = 16 * 1024 * 1024;

interface Representation {
  body: Buffer;
  etag: string;
}

interface Encoded {
  identity: Representation;
  br?: Representation;
  gzip?: Representation;
  bytes: number;
}

const encodedSheets = new Map<string, Encoded>();
let encodedBytes = 0;

/** The bodies of `css` (stored as `hash`): computed on first use (brotli q4 text mode like the dynamic responses, gzip 6). */
function encodedSheet(hash: string, css: string): Encoded {
  const cached = encodedSheets.get(hash);
  if (cached !== undefined) {
    encodedSheets.delete(hash);
    encodedSheets.set(hash, cached);
    return cached;
  }
  const raw = Buffer.from(css, 'utf8');
  const encoded: Encoded = {identity: {body: raw, etag: `"${hash}"`}, bytes: raw.length};
  if (raw.length >= MIN_COMPRESS_BYTES) {
    const br = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    const gzip = gzipSync(raw);
    if (br.length < raw.length) {
      encoded.br = {body: br, etag: `"${hash}-br"`};
      encoded.bytes += br.length;
    }
    if (gzip.length < raw.length) {
      encoded.gzip = {body: gzip, etag: `"${hash}-gz"`};
      encoded.bytes += gzip.length;
    }
  }
  encodedSheets.set(hash, encoded);
  encodedBytes += encoded.bytes;
  for (const [key, entry] of encodedSheets) {
    if (encodedBytes <= ENCODED_BUDGET_BYTES || key === hash) break;
    encodedSheets.delete(key);
    encodedBytes -= entry.bytes;
  }
  return encoded;
}

/** Whether `If-None-Match` lists `etag` (weak comparison) or `*`. */
function notModified(req: Request, etag: string): boolean {
  const header = req.get('if-none-match');
  if (!header) return false;
  return header.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || value === etag || value === `W/${etag}`;
  });
}

/**
 * `GET /swc-css/<hash>.css` and `HEAD`: the text `renderSpectrum` linked under that hash, in the best coding
 * `negotiate(Accept-Encoding)` allows. Mount it before any compression middleware: it encodes its answers itself.
 */
export function styleSheetRoutes(negotiate: (acceptEncoding: string | undefined) => Coding[]): Router {
  const router = express.Router();
  router.get(`${STYLE_SHEET_PATH}:file`, (req: Request, res: Response) => {
    const match = FILE_RE.exec(String(req.params.file ?? ''));
    const hash = match?.[1];
    const css = hash === undefined ? undefined : getStyleSheet(hash);
    if (hash === undefined || css === undefined) {
      if (hash !== undefined) {
        const stale = encodedSheets.get(hash);
        if (stale !== undefined) {
          encodedSheets.delete(hash);
          encodedBytes -= stale.bytes;
        }
      }
      res.status(404).set('Cache-Control', 'no-store').type('text/plain').send(`Not found: ${req.path}`);
      return;
    }
    const encoded = encodedSheet(hash, css);
    const coding = negotiate(req.get('accept-encoding')).find((candidate) => encoded[candidate] !== undefined);
    const representation = coding === undefined ? encoded.identity : encoded[coding]!;
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'text/css; charset=utf-8',
      ETag: representation.etag,
      Vary: 'Accept-Encoding',
    });
    if (coding !== undefined) res.set('Content-Encoding', coding);
    if (notModified(req, representation.etag)) {
      res.status(304).end();
      return;
    }
    res.set('Content-Length', String(representation.body.length));
    // HEAD (express routes it to the GET handler): the same headers, no body.
    if (req.method === 'HEAD') res.end();
    else res.end(representation.body);
  });
  return router;
}

/** `?dedupe=`: absent / '' / 'none' -> 'none', 'link' -> 'link'; anything else -> undefined (answer 400). */
export function parseDedupe(value: unknown): 'none' | 'link' | undefined {
  if (value === undefined || value === '' || value === 'none') return 'none';
  if (value === 'link') return 'link';
  return undefined;
}

/**
 * `?hints=` of the SSR routes (a measurement knob, tests/styles-dedupe.spec.ts): how the page's `<head>` announces the
 * linked stylesheets. Absent / 'preload' -> `result.head` (`<link rel="preload" as="style">`, what `renderSpectrum`
 * returns), 'not-all' -> `<link rel="stylesheet" media="not all">`, 'none' -> nothing.
 */
export function headFor(result: {head?: string; report: RenderReport}, hints: unknown): string {
  if (hints === 'none') return '';
  const hint: StyleHeadHint = hints === 'not-all' ? 'stylesheet-not-all' : 'preload';
  return hint === 'preload' && typeof result.head === 'string' ? result.head : styleHeadOf(result.report.styles, hint);
}
