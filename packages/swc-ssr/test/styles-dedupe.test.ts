/**
 * `StyleOptions.dedupe: 'link'` (0.3.0, `src/server/styles/dedupe.ts`): every distinct stylesheet text is stored once
 * under a content hash (`styleSheetStore`) and the shadow roots link to it instead of carrying a copy.
 *  - Default output is unchanged byte for byte; `head` is ''.
 *  - Equivalence: per shadow root, the CSS behind its `<link>`s and `<style>`s (in order, links resolved through the
 *    store) is exactly the CSS the same render inlines without `dedupe`, in `full`, `trimmed` and minified mode, on
 *    synthetic elements and on the demo's button page; the markup outside the style elements is identical.
 *  - What stays inline: sheets under `INLINE_BELOW_BYTES`, sheets with relative `url()` / `@import`, minified theme
 *    fragments; the order of `<link>` / `<style>` follows `elementStyles`.
 *  - Markers on every link (`complete` / `trimmed` / `minified`), the report (`sheets[].hash`, `dedupe`), the head
 *    hints, `dedupeUrl`, the store's LRU budget and `getStyleSheet`'s input check.
 *  - Client (`src/client/server-styles.ts`): a server `<link data-swc-styles>` is restored and removed like a marked
 *    `<style>`; a minified one is kept until the bridges go; without constructable stylesheets a `<style>` with the
 *    complete text takes the link's place.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  getStyleSheet,
  installSpectrumSsr,
  renderSpectrum,
  styleHeadOf,
  styleSheetHash,
  styleSheetStore,
  StyleSheetStore,
  STYLE_SHEET_HASH_RE,
} from '../src/server/index.ts';
import {hasRelativeUrl, INLINE_BELOW_BYTES} from '../src/server/styles/dedupe.ts';
import {isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';
import type {AnyNode, Element} from 'domhandler';

installSpectrumSsr();

const {LitElement, css, html, unsafeCSS} = await import('lit');

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `rules` custom-property declarations on `:host` (~25 bytes each), so that a sheet stays well above
 * `INLINE_BELOW_BYTES` after trimming too (every instance matches `:host`).
 */
const padded = (prefix: string, rules: number) =>
  `:host { ${Array.from({length: rules}, (_, i) => `--pad-${prefix}-${i}: ${i}px;`).join(' ')} }`;

const bigOne = css`
  :host { display: block; }
  :host([variant=a]) #inner { color: red; }
  :host([variant=b]) #inner { color: blue; }
  #inner { padding: 1px; }
  ${unsafeCSS(padded('one', 24))}
`;
const tiny = css`:host{order:1}`;
const bigTwo = css`
  #inner { border: 1px solid var(--dd-color, black); }
  .never-rendered { margin: 3px; }
  ${unsafeCSS(padded('two', 24))}
`;

class DedupeA extends LitElement {
  static override styles = [bigOne, tiny, bigTwo];
  override render() {
    return html`<div id="inner"><slot></slot></div>`;
  }
}
customElements.define('dedupe-a', DedupeA);

class DedupeRelative extends LitElement {
  static override styles = css`
    #x { background-image: url(img/pattern.png); }
    ${unsafeCSS(padded('rel', 8))}
  `;
  override render() {
    return html`<i id="x"></i>`;
  }
}
customElements.define('dedupe-relative', DedupeRelative);

class DedupeAbsolute extends LitElement {
  static override styles = css`
    #x { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=), url(https://cdn.example/x.png); }
    ${unsafeCSS(padded('abs', 8))}
  `;
  override render() {
    return html`<i id="x"></i>`;
  }
}
customElements.define('dedupe-absolute', DedupeAbsolute);

/** Shares `bigTwo` with `dedupe-a`. */
class DedupeShared extends LitElement {
  static override styles = [bigTwo];
  override render() {
    return html`<div id="inner"></div>`;
  }
}
customElements.define('dedupe-shared', DedupeShared);

const page = () => html`<main>
  <dedupe-a variant="a"><b>1</b></dedupe-a>
  <dedupe-a variant="a"><b>2</b></dedupe-a>
  <dedupe-a variant="b"></dedupe-a>
  <dedupe-relative></dedupe-relative>
  <dedupe-absolute></dedupe-absolute>
  <dedupe-shared></dedupe-shared>
  <dedupe-shared></dedupe-shared>
</main>`;

interface RootStyles {
  tag: string;
  /** `link:<marker>` / `style:<marker>` per server style element, in order. */
  kinds: string[];
  /** The CSS of the root: style texts and the store texts of the links, in order. */
  css: string;
  hrefs: string[];
}

const LINK_RE = /^\/swc-css\/([A-Za-z0-9_-]{16})\.css$/;

/** Per declarative shadow root of the output (document order): its server style elements and their CSS. */
function rootStyles(output: string, resolve: (href: string) => string | undefined = defaultResolve): RootStyles[] {
  const roots: RootStyles[] = [];
  for (const element of walkElements(parseHtml(output))) {
    const template = shadowTemplateOf(element);
    if (!template) {
      continue;
    }
    const root: RootStyles = {tag: element.name, kinds: [], css: '', hrefs: []};
    for (const child of (templateContent(template) as any).children as AnyNode[]) {
      if (!isElement(child)) {
        continue;
      }
      const node = child as Element;
      if (node.name === 'style') {
        root.kinds.push(`style:${node.attribs['data-swc-styles'] ?? '-'}`);
        root.css += node.children.map((text: any) => text.data ?? '').join('');
      } else if (node.name === 'link' && node.attribs['data-swc-styles'] !== undefined) {
        const href = node.attribs.href!;
        root.kinds.push(`link:${node.attribs['data-swc-styles']}`);
        root.hrefs.push(href);
        const text = resolve(href);
        assert.ok(text !== undefined, `the store has ${href}`);
        root.css += text;
      }
    }
    roots.push(root);
  }
  return roots;
}

function defaultResolve(href: string): string | undefined {
  const hash = LINK_RE.exec(href)?.[1];
  return hash === undefined ? undefined : getStyleSheet(hash);
}

/** The output without the server style elements (what must not change between the modes). */
const withoutStyles = (output: string) =>
  output.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<link rel="stylesheet" href="[^"]*" data-swc-styles="[a-z]+">/g, '');

test('default output is unchanged: no links, head is empty, no styles report in full mode', async () => {
  const plain = await renderSpectrum(page());
  const none = await renderSpectrum(page(), {styles: {dedupe: 'none'}});
  const bogus = await renderSpectrum(page(), {styles: {dedupe: 'bogus' as any}});
  assert.equal(none.html, plain.html);
  assert.equal(bogus.html, plain.html);
  assert.equal(plain.head, '');
  assert.equal(plain.report.styles, undefined);
  assert.ok(!plain.html.includes('<link'));
  const trimmed = await renderSpectrum(page(), {styles: {mode: 'trimmed'}});
  assert.ok(!trimmed.html.includes('<link'));
  assert.equal(trimmed.head, '');
  assert.equal(trimmed.report.styles?.dedupe, undefined);
});

for (const variant of [
  {name: 'full', styles: {mode: 'full'}},
  {name: 'trimmed', styles: {mode: 'trimmed'}},
  {name: 'minified', styles: {mode: 'trimmed', minifyCustomProperties: true}},
] as const) {
  test(`${variant.name} + link: per shadow root the same CSS as inline, linked where linkable`, async () => {
    const inline = await renderSpectrum(page(), {styles: {...variant.styles}});
    const linked = await renderSpectrum(page(), {styles: {...variant.styles, dedupe: 'link'}});
    assert.equal(withoutStyles(linked.html), withoutStyles(inline.html), 'markup outside the style elements');
    const a = rootStyles(inline.html);
    const b = rootStyles(linked.html);
    assert.deepEqual(
      b.map((root) => [root.tag, root.css]),
      a.map((root) => [root.tag, root.css]),
    );
    const byTag = new Map(b.map((root) => [root.tag, root]));
    // dedupe-a: [bigOne, tiny, bigTwo] -> link, inline, link (order kept)
    const rootA = byTag.get('dedupe-a')!;
    assert.deepEqual(
      rootA.kinds.map((kind) => kind.split(':')[0]),
      ['link', 'style', 'link'],
    );
    assert.ok(rootA.kinds.every((kind) => kind.startsWith('style') || /^link:(complete|trimmed|minified)$/.test(kind)));
    // Relative url() stays inline, absolute / data: URLs are linked.
    assert.deepEqual(byTag.get('dedupe-relative')!.kinds.map((kind) => kind.split(':')[0]), ['style']);
    assert.deepEqual(byTag.get('dedupe-absolute')!.kinds.map((kind) => kind.split(':')[0]), ['link']);
    // Every instance of a class links the same URLs.
    const instancesOfA = b.filter((root) => root.tag === 'dedupe-a');
    assert.equal(instancesOfA.length, 3);
    assert.ok(instancesOfA.every((root) => root.hrefs.join() === rootA.hrefs.join()));
    if (variant.name === 'full') {
      assert.ok(b.every((root) => root.kinds.every((kind) => kind === 'link:complete' || kind === 'style:-')));
      // A sheet object two classes share is one URL in full mode.
      assert.equal(byTag.get('dedupe-shared')!.hrefs[0], rootA.hrefs[1]);
    } else {
      assert.ok(rootA.kinds.includes(`link:${variant.name === 'minified' ? 'minified' : 'trimmed'}`), rootA.kinds.join());
    }
    // The report.
    const report = linked.report.styles!;
    assert.equal(report.mode, variant.styles.mode);
    const dedupe = report.dedupe!;
    assert.equal(dedupe.mode, 'link');
    const allLinks = b.flatMap((root) => root.hrefs);
    assert.equal(dedupe.links, allLinks.length);
    assert.deepEqual(
      dedupe.sheets.map((sheet) => sheet.url),
      [...new Set(allLinks)],
      'distinct URLs in order of first use',
    );
    for (const sheet of dedupe.sheets) {
      assert.match(sheet.hash, STYLE_SHEET_HASH_RE);
      const text = getStyleSheet(sheet.hash)!;
      assert.equal(sheet.bytes, Buffer.byteLength(text));
      assert.equal(sheet.hash, styleSheetHash(text));
      assert.ok(sheet.bytes >= INLINE_BELOW_BYTES);
      assert.equal(sheet.links, allLinks.filter((href) => href === sheet.url).length);
    }
    assert.equal(dedupe.linkedBytes, dedupe.sheets.reduce((sum, sheet) => sum + sheet.bytes, 0));
    let inlineBytes = 0;
    for (const match of linked.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) inlineBytes += Buffer.byteLength(match[1]!);
    assert.equal(dedupe.inlineBytes, inlineBytes);
    const hashes = new Set(dedupe.sheets.map((sheet) => sheet.hash));
    for (const sheet of report.sheets) {
      if (sheet.hash !== undefined) {
        assert.ok(hashes.has(sheet.hash), `${sheet.id} links a reported hash`);
      }
    }
    assert.ok(report.sheets.some((sheet) => sheet.id.startsWith('dedupe-relative') && sheet.hash === undefined));
    // The head: one preload per distinct URL, in the same order.
    assert.equal(
      linked.head,
      dedupe.sheets.map((sheet) => `<link rel="preload" href="${sheet.url}" as="style">`).join(''),
    );
    assert.equal(
      styleHeadOf(report, 'stylesheet-not-all'),
      dedupe.sheets.map((sheet) => `<link rel="stylesheet" href="${sheet.url}" media="not all">`).join(''),
    );
    // Deterministic.
    const again = await renderSpectrum(page(), {styles: {...variant.styles, dedupe: 'link'}});
    assert.equal(again.html, linked.html);
    assert.equal(again.head, linked.head);
  });
}

test('dedupeUrl decides the URL (escaped in the markup) and receives the text', async () => {
  const seen = new Map<string, string>();
  const result = await renderSpectrum(page(), {
    styles: {
      dedupe: 'link',
      dedupeUrl: (hash, text) => {
        seen.set(hash, text);
        return `https://cdn.example/css/${hash}.css?v=1&q="x"`;
      },
    },
  });
  assert.ok(seen.size > 0);
  for (const [hash, text] of seen) {
    assert.equal(styleSheetHash(text), hash);
    assert.equal(getStyleSheet(hash), text, 'the store has the text as well');
    assert.ok(result.html.includes(`href="https://cdn.example/css/${hash}.css?v=1&amp;q=&quot;x&quot;"`));
    assert.ok(result.head.includes(`<link rel="preload" href="https://cdn.example/css/${hash}.css?v=1&amp;q=&quot;x&quot;" as="style">`));
  }
  const roots = rootStyles(result.html, (href) => getStyleSheet(/css\/([^.]+)\.css/.exec(href.replace(/&amp;/g, '&'))![1]!));
  const inline = rootStyles((await renderSpectrum(page())).html);
  assert.deepEqual(
    roots.map((root) => root.css),
    inline.map((root) => root.css),
  );
});

test('hasRelativeUrl: relative url() / @import stay inline; data:, absolute, protocol-relative and fragment-only URLs do not', () => {
  for (const text of [
    'a{background:url(img.png)}',
    'a{background:url("img.png")}',
    "a{background:url( 'x/y.png' )}",
    '@import "base.css";',
    '@import url(base.css);',
    'a{background:URL(../up.png)}',
    // Review finding (0.3.0): quoted URLs of image-set() / -webkit-image-set() / src()
    'a{background-image:image-set("img/a.png" 1x, "img/a@2x.png" 2x)}',
    "a{background-image:-webkit-image-set('a.png' 1x)}",
    'a{background-image:IMAGE-SET("https://cdn.example/a.png" 1x, "b.png" 2x)}',
    'a{background-image:image-set("a.avif" type("image/avif"))}',
    'a{background-image:src("img/a.png")}',
    'a{background-image:image-set("unterminated',
  ]) {
    assert.equal(hasRelativeUrl(text), true, text);
  }
  for (const text of [
    'a{color:red}',
    'a{fill:url(#checkerboard-primary)}',
    ':host{--fill:url( "#pattern" )}',
    'a{background:url(data:image/png;base64,AAAA)}',
    'a{background:url(https://cdn.example/x.png)}',
    'a{background:url("http://cdn.example/x.png")}',
    'a{background:url(//cdn.example/x.png)}',
    '@import url(https://cdn.example/base.css);',
    '@import "https://cdn.example/base.css";',
    'a{background-image:image-set("https://cdn.example/a.png" 1x, "data:image/png;base64,AAAA" 2x)}',
    'a{background-image:image-set("//cdn.example/a.avif" type("image/avif"))}',
    'a{background-image:image-set(url(https://cdn.example/a.png) 1x)}',
    'a{mask:src("#mask")}',
    'a{--my-src:x; background:mysrc("a.png")}',
  ]) {
    assert.equal(hasRelativeUrl(text), false, text);
  }
});

test('StyleSheetStore: content hashes, LRU eviction by bytes, a get counts as a use', () => {
  const store = new StyleSheetStore({minLifetimeMs: 0}); // a pure LRU (the protection period: next test)
  store.maxBytes = 100;
  const a = store.put('a'.repeat(40));
  const b = store.put('b'.repeat(40));
  assert.equal(store.put('a'.repeat(40)), a, 'same text, same hash');
  assert.equal(store.size, 2);
  assert.equal(store.bytes, 80);
  assert.equal(store.get(b), 'b'.repeat(40)); // b is now the most recently used
  const c = store.put('c'.repeat(40)); // 120 > 100: the least recently used (a) goes
  assert.equal(store.has(a), false);
  assert.equal(store.has(b), true);
  assert.equal(store.has(c), true);
  assert.equal(store.bytes, 80);
  const huge = store.put('h'.repeat(500)); // larger than the budget: stays alone
  assert.equal(store.size, 1);
  assert.equal(store.has(huge), true);
  store.maxBytes = Number.NaN; // ignored
  store.maxBytes = -1; // ignored
  assert.equal(store.maxBytes, 100);
  assert.equal(store.delete(huge), true);
  assert.equal(store.bytes, 0);
  store.put('x'.repeat(10));
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.bytes, 0);
  // UTF-8 bytes, not UTF-16 units.
  store.put('é'.repeat(10));
  assert.equal(store.bytes, 20);
});

test('StyleSheetStore: fresh texts are protected from eviction for minLifetimeMs, counted when evicted', () => {
  // Review finding (0.3.0): a pure LRU could evict the texts of a page that was just served before its browser fetched
  // them (a 404 leaves those elements unstyled until hydration).
  let now = 0;
  const store = new StyleSheetStore({maxBytes: 100, minLifetimeMs: 60_000, now: () => now});
  assert.equal(new StyleSheetStore().minLifetimeMs, 60_000, 'default: 60 s');
  const a = store.put('a'.repeat(40));
  const b = store.put('b'.repeat(40));
  now = 1_000;
  const c = store.put('c'.repeat(40)); // 120 > 100, but a and b are fresh: kept above the budget
  assert.deepEqual([store.has(a), store.has(b), store.has(c)], [true, true, true]);
  assert.equal(store.bytes, 120);
  assert.equal(store.evictions, 0);
  now = 60_000; // a and b (put at 0) are past their protection, c (put at 1000) is not
  store.put('b'.repeat(40)); // a put renews b's protection (and its place in the LRU order): a, c, b
  const d = store.put('d'.repeat(40)); // 160 > 100: a goes (past its protection); c, b, d are fresh
  assert.deepEqual([store.has(a), store.has(b), store.has(c), store.has(d)], [false, true, true, true]);
  assert.equal(store.evictions, 1);
  assert.equal(store.freshEvictions, 0);
  // Twice the budget is a hard limit: beyond it the least recently used texts go even when fresh.
  const e = store.put('e'.repeat(40)); // c, b, d, e: 160 > 100 but all fresh, and within twice the budget
  assert.equal(store.bytes, 160);
  const f = store.put('f'.repeat(50)); // 210 > 200: c (least recently used) goes although fresh
  assert.equal(store.has(c), false);
  assert.deepEqual([store.has(b), store.has(d), store.has(e), store.has(f)], [true, true, true, true]);
  assert.equal(store.evictions, 2);
  assert.equal(store.freshEvictions, 1);
  // Lowering the budget evicts what is past its protection; minLifetimeMs 0 is a pure LRU again.
  now = 200_000;
  store.maxBytes = 50;
  assert.equal(store.size, 1, 'everything but the most recently used went');
  assert.equal(store.has(f), true);
  store.minLifetimeMs = -1; // ignored
  store.minLifetimeMs = Number.NaN; // ignored
  assert.equal(store.minLifetimeMs, 60_000);
  store.minLifetimeMs = 0;
  now = 200_001;
  store.put('g'.repeat(50)); // 100 > 50: f goes at once
  assert.equal(store.has(f), false);
});

/** The trimmed text of `bigTwo` in an inline render: the CSS of a `dedupe-shared` shadow root (its only sheet). */
const bigTwoTrimmed = (output: string): string => rootStyles(output).find((root) => root.tag === 'dedupe-shared')!.css;

test('a dedupeUrl that throws keeps that text inline (trimmed), links the others and reports it', async () => {
  // Review finding (0.3.0): the exception aborted resolveStyles, and the whole page fell back to the complete,
  // untrimmed stylesheets.
  const calls = new Map<string, number>();
  const options = {mode: 'trimmed', dedupe: 'link'} as const;
  const result = await renderSpectrum(page(), {
    styles: {
      ...options,
      dedupeUrl: (hash: string, text: string) => {
        calls.set(hash, (calls.get(hash) ?? 0) + 1);
        if (text.includes('--pad-two-')) throw new Error('upload failed');
        return `/swc-css/${hash}.css`;
      },
    },
  });
  const inline = await renderSpectrum(page(), {styles: {mode: 'trimmed'}});
  const roots = rootStyles(result.html);
  assert.deepEqual(
    roots.map((root) => [root.tag, root.css]),
    rootStyles(inline.html).map((root) => [root.tag, root.css]),
    'the same (trimmed) CSS per shadow root as the inline render',
  );
  const rootA = roots.find((root) => root.tag === 'dedupe-a')!;
  // bigOne linked; tiny and bigTwo (its dedupeUrl threw) inline in one trimmed <style>, in elementStyles order
  assert.deepEqual(rootA.kinds, ['link:complete', 'style:trimmed']);
  assert.ok(rootA.css.endsWith(bigTwoTrimmed(inline.html)), 'the trimmed bigTwo is the inline text');
  assert.deepEqual(roots.find((root) => root.tag === 'dedupe-shared')!.kinds.map((kind) => kind.split(':')[0]), ['style']);
  assert.ok([...calls.values()].every((count) => count === 1), 'dedupeUrl called once per distinct text');
  const warnings = result.report.elements.flatMap((element) => element.warnings);
  const thrown = warnings.filter((warning) => warning.includes('dedupeUrl'));
  assert.equal(thrown.length, 1, warnings.join(' | '));
  assert.match(thrown[0]!, /dedupeUrl threw for stylesheet [A-Za-z0-9_-]{16} .*upload failed/);
  assert.ok(!warnings.some((warning) => warning.includes('could not trim')), 'no fallback to the complete stylesheets');
  const styles = result.report.styles!;
  assert.ok(styles.trimmedBytes < styles.fullBytes);
  assert.ok(styles.dedupe!.sheets.length > 0);
  assert.ok(styles.dedupe!.sheets.every((sheet) => !getStyleSheet(sheet.hash)!.includes('--pad-two-')));
  assert.ok(styles.sheets.some((sheet) => sheet.hash === undefined && sheet.id.startsWith('dedupe-shared')));
});

test('getStyleSheet accepts only hash-shaped keys', () => {
  const hash = styleSheetStore.put(`#known { margin: 0; } ${'x'.repeat(200)}`);
  assert.match(hash, STYLE_SHEET_HASH_RE);
  assert.ok(getStyleSheet(hash)?.startsWith('#known'));
  for (const key of ['', '../../etc/passwd', `${hash}.css`, hash.slice(1), `${hash}x`, 42 as any, undefined as any]) {
    assert.equal(getStyleSheet(key), undefined, String(key));
  }
});

test("styleHeadOf: '' without linked sheets", () => {
  assert.equal(styleHeadOf(undefined), '');
  assert.equal(styleHeadOf({mode: 'trimmed', sheets: [], fullBytes: 0, trimmedBytes: 0, durationMs: 0}), '');
});

/* -------------------------------------------------------------------------------------------------------------- *
 * The demo's button page (real Spectrum stylesheets and theme)
 * -------------------------------------------------------------------------------------------------------------- */

const {findEntry} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');
const button = findEntry('button')!;
await button.load();

for (const variant of [
  {name: 'full', styles: {mode: 'full'}},
  {name: 'trimmed', styles: {mode: 'trimmed'}},
  {name: 'minified', styles: {mode: 'trimmed', minifyCustomProperties: true}},
] as const) {
  test(`button page, ${variant.name} + link: same CSS per root; the minified theme stays inline`, async () => {
    const inline = await renderSpectrum(pageTemplate([button]), {styles: {...variant.styles}});
    const linked = await renderSpectrum(pageTemplate([button]), {styles: {...variant.styles, dedupe: 'link'}});
    assert.equal(withoutStyles(linked.html), withoutStyles(inline.html));
    const a = rootStyles(inline.html);
    const b = rootStyles(linked.html);
    assert.deepEqual(
      b.map((root) => [root.tag, root.css]),
      a.map((root) => [root.tag, root.css]),
    );
    const theme = b.find((root) => root.tag === 'sp-theme')!;
    if (variant.name === 'minified') {
      assert.ok(theme.kinds.length > 0 && theme.kinds.every((kind) => kind === 'style:minified'), theme.kinds.join());
    } else {
      assert.ok(theme.kinds.some((kind) => kind.startsWith('link:')), theme.kinds.join());
    }
    const buttons = b.filter((root) => root.tag === 'sp-button');
    assert.ok(buttons.length > 10);
    assert.ok(buttons.every((root) => root.hrefs.length > 0 && root.hrefs.join() === buttons[0]!.hrefs.join()));
    const htmlBytes = Buffer.byteLength(linked.html);
    assert.ok(htmlBytes * 10 < Buffer.byteLength(inline.html), `link mode HTML ${htmlBytes} bytes`);
  });
}

/* -------------------------------------------------------------------------------------------------------------- *
 * Client: server <link>s are marked server styles
 * -------------------------------------------------------------------------------------------------------------- */

const {afterHydratingUpdate} = await import('../src/client/server-styles.ts');

class FakeNode {
  readonly nodeType = 1;
  removed = false;
  inserted: FakeNode[] = [];
  textContent = '';
  private readonly attributes = new Map<string, string>();
  constructor(
    readonly localName: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }
  get firstChild(): null {
    return null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  remove(): void {
    this.removed = true;
  }
  before(node: FakeNode): void {
    this.inserted.push(node);
  }
  after(node: FakeNode): void {
    this.inserted.push(node);
  }
}

const classSheet = new CSSStyleSheet();
const classStyles = [{cssText: ':host{display:block}#a{color:var(--spectrum-gray-800)}', styleSheet: classSheet}];
class FakeHost {
  static elementStyles = classStyles;
}

function hydrate(children: FakeNode[]): {element: any; root: any} {
  const element: any = new FakeHost();
  element.localName = 'x-fake';
  const root = {childNodes: [...children, {nodeType: 8, data: 'lit-part abc'}], adoptedStyleSheets: [] as CSSStyleSheet[]};
  element.shadowRoot = root;
  afterHydratingUpdate(element);
  return {element, root};
}

test('client: a trimmed / complete server <link> is replaced by the adopted class sheets and removed', () => {
  for (const marker of ['trimmed', 'complete']) {
    const link = new FakeNode('link', {rel: 'stylesheet', href: '/swc-css/x.css', 'data-swc-styles': marker});
    const tinyStyle = new FakeNode('style');
    const {root} = hydrate([link, tinyStyle]);
    assert.deepEqual(root.adoptedStyleSheets, [classSheet], marker);
    assert.equal(link.removed, true, marker);
    assert.equal(tinyStyle.removed, true, `${marker}: the unmarked inline sheet next to it goes too`);
  }
});

test('client: an unmarked <link> is not a server style', () => {
  const link = new FakeNode('link', {rel: 'stylesheet', href: '/app.css'});
  const {root} = hydrate([link]);
  assert.equal(link.removed, false);
  assert.deepEqual(root.adoptedStyleSheets, [], 'no server style element: nothing to restore');
});

test('client: a minified server <link> takes the kept-minified path (dropped once no marked element is pending)', () => {
  // keepUntilSettled() keeps it, then the confirming scan of the document finds no other marked server style (the
  // fake element is not in the shim's document), so it goes with the bridges at once. tests/styles-dedupe.spec.ts
  // covers pending elements in a browser.
  const link = new FakeNode('link', {rel: 'stylesheet', href: '/swc-css/m.css', 'data-swc-styles': 'minified'});
  const {root} = hydrate([link]);
  assert.deepEqual(root.adoptedStyleSheets, [classSheet]);
  assert.equal(link.removed, true);
});

test('client: without constructable stylesheets a <style> with the complete text takes the link\'s place', () => {
  const saved = (globalThis as any).ShadowRoot;
  delete (globalThis as any).ShadowRoot;
  try {
    const link = new FakeNode('link', {rel: 'stylesheet', href: '/swc-css/t.css', 'data-swc-styles': 'trimmed'});
    const second = new FakeNode('link', {rel: 'stylesheet', href: '/swc-css/u.css', 'data-swc-styles': 'trimmed'});
    hydrate([link, second]);
    assert.equal(link.inserted.length, 1);
    const style = link.inserted[0] as any;
    assert.equal(style.localName, 'style');
    assert.equal(style.textContent, classStyles[0]!.cssText);
    assert.equal(link.removed, true);
    assert.equal(second.removed, true);
  } finally {
    (globalThis as any).ShadowRoot = saved;
  }
});
