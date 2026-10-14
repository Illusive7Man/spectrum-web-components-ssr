# API contract (binding for all implementation work)

## `swc-ssr/dom-shim`  (`packages/swc-ssr/src/dom-shim/index.ts`)

```ts
export function installSpectrumDomShim(): void;   // idempotent; installs @lit-labs/ssr global dom shim + Spectrum extras
export const isSpectrumDomShimInstalled: () => boolean;
```

## `swc-ssr/server`  (`packages/swc-ssr/src/server/index.ts`)

```ts
import type {TemplateResult} from 'lit';
import type {ElementRendererConstructor} from '@lit-labs/ssr/lib/element-renderer.js';

export function installSpectrumSsr(): void;      // = installSpectrumDomShim(); call before importing any @spectrum-web-components module

export type LifecycleMode = 'none' | 'connected' | 'full';
// 'none'      : Lit default (willUpdate + attribute reflection only)
// 'connected' : + element.connectedCallback() with enableUpdating no-op'd
// 'full'      : + firstUpdated/updated + rAF flush + bounded re-render (default)

export interface RenderSpectrumOptions {
  deferHydration?: boolean;          // forwarded to @lit-labs/ssr render(); default false
  debug?: boolean;                   // keep data-swc-ssr markers and log details; default false
  lifecycle?: LifecycleMode;         // default 'full'
  lifecycleByTag?: Record<string, LifecycleMode>;  // per-tag override, e.g. {'sp-overlay': 'none'}
  elementRenderers?: ElementRendererConstructor[]; // extra renderers tried BEFORE the Spectrum ones
}

export interface ElementReport {
  id: number;
  tagName: string;
  errors: string[];       // messages of exceptions caught for this element (pass 1 or 2)
  warnings: string[];
  fallback: boolean;      // true if pass-2 failed and pass-1 output was used for this element
}

export interface RenderReport {
  elements: ElementReport[];
  passes: number;         // 2 normally
  durationMs: number;
}

export interface RenderSpectrumResult { html: string; report: RenderReport; }

export function renderSpectrum(value: unknown, options?: RenderSpectrumOptions): Promise<RenderSpectrumResult>;

export class SpectrumElementRenderer /* extends LitElementRenderer */ {}
export class ThemeRenderer /* extends ElementRenderer */ {}
export const spectrumElementRenderers: ElementRendererConstructor[]; // [ThemeRenderer, SpectrumElementRenderer]

// adapters registry (Spectrum-specific behaviour lives ONLY here)
export interface ElementAdapter {
  tag: string | RegExp;
  lifecycle?: LifecycleMode;
  beforeRender?(element: HTMLElement, ctx: AdapterContext): void;   // pass 2, after lifecycle, before render()
  afterRender?(element: HTMLElement, ctx: AdapterContext): void;
}
export interface AdapterContext { id: number; pass: 1 | 2; tree: ServerTree | undefined; report: ElementReport; }
export function registerAdapter(adapter: ElementAdapter): void;
```

`ServerTree` (internal, `packages/swc-ssr/src/server/server-tree.ts`): parse5 (htmlparser2 adapter) document of the pass-1
HTML with lookup `byId(id)`, `lightChildren(id)`, `shadowRoot(id)`, `query(node, selector)`, `queryAll(node, selector)` via `css-select`.

## `swc-ssr/client`  (`packages/swc-ssr/src/client/index.ts`)

Must be the FIRST import of the client bundle (before `lit` and before any `@spectrum-web-components` import).

```ts
export interface HydrationReport {
  errors: string[];        // console.error / uncaught errors captured during hydration
  warnings: string[];      // console.warn captured during hydration
  deferred: string[];      // tag names of elements that still carry defer-hydration after hydration
  hydratedCount: number;   // number of sp-* elements that had a declarative shadow root and are now upgraded
  durationMs: number;
}

export interface HydrateSpectrumOptions {
  template?: unknown;      // a lit TemplateResult: if given, @lit-labs/ssr-client hydrate(template, root) is used
  whenDefined?: boolean;   // default true: await customElements.whenDefined for every sp-* tag found under root first
}

export function hydrateSpectrum(root?: Element, options?: HydrateSpectrumOptions): Promise<HydrationReport>;
export function hydrationReport(): HydrationReport;   // last report (empty report if none yet)
```

The demo client must set `window.__swcSsrHydration = hydrateSpectrum(...)` (a Promise<HydrationReport>) so tests can await it,
and `window.__swcSsrMode = 'ssr' | 'csr'`.

## Demo catalog entry  (`demo/src/catalog/types.ts`)

```ts
import type {TemplateResult} from 'lit';
export interface CatalogEntry {
  name: string;                 // kebab-case package name, e.g. 'action-button'; used in URLs and data-component
  packages: string[];           // @spectrum-web-components package names this entry needs
  load(): Promise<void>;        // dynamic bare-specifier imports of the registration modules (sp-*.js) + icons used
  render(): TemplateResult;     // the showcase for this component (several variants, realistic slotted content)
  notes?: string;               // known SSR caveats
  interactive?: boolean;        // true if the e2e interaction smoke test should click the first focusable control
}
```
`demo/src/catalog/index.ts` exports `export const catalog: CatalogEntry[]` (sorted by name) and `export function findEntry(name: string): CatalogEntry | undefined`.

## Demo server routes (`demo/src/server.ts`, port 3000, `PORT` env overrides)

| Route | Behaviour |
|---|---|
| `GET /` | SSR of the whole catalog + client bundle (hydrates) |
| `GET /component/:name` | SSR of one entry + client bundle |
| `GET /csr` , `GET /csr/:name` | same page shell, **no SSR**: empty `#app`, the client renders with lit `render()` (reference DOM) |
| `?nohydrate=1` on any SSR route | omit the client bundle `<script>` (pure SSR view) |
| `GET /report.json` | the `RenderReport` of the last SSR render |
| `GET /dist/*` | static from `demo/public/dist` |

Page shell: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>…</title><style>/* layout only */</style></head><body><div id="app">…</div><script type="module" src="/dist/client.js"></script></body></html>`.
The SSR'd content inside `#app` is `pageTemplate(entries)` = `<sp-theme system="spectrum" color="light" scale="medium">` + one `<section class="demo" data-component="<name>"><h2>…</h2>…render()…</section>` per entry.
The client reads `data-mode` and `data-components` attributes on `#app` to know what to hydrate/render.
