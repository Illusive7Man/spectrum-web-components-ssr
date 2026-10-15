/**
 * `styles: {mode: 'trimmed'}` on small synthetic Lit elements: which rules survive (`:host()`, `:host-context()`,
 * `::slotted()` incl. forwarded slots, state pseudo-classes, `:not()`, pseudo-elements, `@media` nesting,
 * `@keyframes` references, `@font-face`), `undefinedPrefixes`, `minifyCustomProperties` and `keep`, plus the CSS
 * text helpers (`scanCustomPropertyReferences`, the slice-preserving parser).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installSpectrumSsr, renderSpectrum, scanCustomPropertyReferences} from '../src/server/index.ts';
import {collapseVars, parseRules, splitBlock} from '../src/server/styles/css-text.ts';
import {isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';
import type {AnyNode, Element} from 'domhandler';

installSpectrumSsr();

const {LitElement, css, html} = await import('lit');

/* eslint-disable @typescript-eslint/no-explicit-any */

const sheet = css`
  :host { display: block; }
  :host([variant=a]) #inner { color: red; }
  :host([variant=b]) #inner { color: blue; }
  #inner { padding: 1px; }
  .missing { margin: 0; }
  slot[name=icon]::slotted(*) { width: 1px; }
  slot[name=nothing]::slotted(*) { width: 2px; }
  ::slotted(.used) { color: green; }
  ::slotted(.unused) { color: pink; }
  :host(:hover) #inner { color: orange; }
  #inner:focus-visible { outline: 1px solid; }
  :host(:not([variant=b])) #inner { font-weight: bold; }
  :host(:not([variant=a])) #inner { font-style: italic; }
  :host(:is(:active, [active])) #inner { opacity: .5; }
  #inner > slot:first-child { order: 1; }
  #inner > slot:last-child + .missing { order: 2; }
  @media (min-width: 10px) { #inner { margin: 1px; } .missing { margin: 2px; } }
  @media print { .missing { margin: 3px; } }
  @keyframes used-anim { to { opacity: 1; } }
  @keyframes unused-anim { to { opacity: 0; } }
  #inner { animation: used-anim 1s; }
  .missing { animation: unused-anim 1s; }
  #inner::before { content: ''; }
  :host-context(.ctx-present) #inner { color: teal; }
  :host-context(.ctx-absent) #inner { color: olive; }
  #inner { color: var(--mod-x, var(--spectrum-y, red)); }
  #inner { border-color: var(--mod-defined, black); }
  :host([variant=a]) { --mod-defined: 2px; }
  .kept-by-option { color: gold; }
  :is(:host([variant=b])) #inner { letter-spacing: 1px; }
  :host:not(.foo) .missing { word-spacing: 1px; }
  @font-face { font-family: trim-test; src: url(trim-test.woff); }
`;

class TrimA extends LitElement {
  static override styles = sheet;
  override render() {
    return html`<div id="inner"><slot name="icon"></slot><slot></slot></div>`;
  }
}
customElements.define('trim-a', TrimA);

/** Forwards its light DOM into a nested element's default slot. */
class TrimInner extends LitElement {
  static override styles = css`
    ::slotted(.fwd) { color: red; }
    ::slotted(.nope) { color: blue; }
    :host { display: block; }
  `;
  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('trim-inner', TrimInner);

class TrimOuter extends LitElement {
  static override styles = css`
    trim-inner { display: block; }
    trim-missing { display: none; }
  `;
  override render() {
    return html`<trim-inner><slot></slot></trim-inner>`;
  }
}
customElements.define('trim-outer', TrimOuter);

class TrimVars extends LitElement {
  static override styles = css`
    :host { --my-color: red; --keep-me: blue; --attr-var: green; --prefixed-one: 1px; }
    #x { color: var(--my-color); background: var(--keep-me); border-color: var(--attr-var); }
    #x { outline-color: var(--only-referenced, black); margin: var(--prefixed-one); }
  `;
  override render() {
    return html`<div id="x" style="--attr-var: pink"></div>`;
  }
}
customElements.define('trim-vars', TrimVars);

/** SVG keeps camelCased tag and attribute names (`viewBox`, `linearGradient`). */
class TrimSvg extends LitElement {
  static override styles = css`
    ::slotted(svg[viewBox]) { width: 100%; }
    ::slotted(svg[preserveAspectRatio]) { height: 1px; }
    linearGradient { color: red; }
    radialGradient { color: blue; }
  `;
  override render() {
    return html`<svg viewBox="0 0 1 1"><defs><linearGradient id="g"></linearGradient></defs></svg><slot></slot>`;
  }
}
customElements.define('trim-svg', TrimSvg);

/** Identical instances that only differ by their position among their siblings. */
class TrimSibling extends LitElement {
  static override styles = css`
    :host(:first-child) { order: 1; }
    :host(:last-child) { order: 2; }
    :host(:nth-child(5)) { order: 5; }
  `;
  override render() {
    return html`<b></b>`;
  }
}
customElements.define('trim-sibling', TrimSibling);

/** The text of the `<style>` in the declarative shadow root of the n-th `<tag>` of the output. */
function shadowStyles(output: string, tag: string): string[] {
  const texts: string[] = [];
  for (const element of walkElements(parseHtml(output))) {
    if (element.name !== tag) {
      continue;
    }
    const template = shadowTemplateOf(element);
    assert.ok(template, `<${tag}> has a declarative shadow root`);
    const style = (templateContent(template) as any).children.find(
      (node: AnyNode) => isElement(node) && (node as Element).name === 'style'
    ) as Element | undefined;
    texts.push(style ? style.children.map((node: any) => node.data ?? '').join('') : '');
  }
  return texts;
}

const page = () => html`<div class="ctx-present">
  <trim-a variant="a"><span slot="icon"></span><b class="used">x</b></trim-a>
  <trim-a variant="a"><b class="used">y</b></trim-a>
</div>`;

test('full mode: the shadow roots carry the complete stylesheets, byte for byte', async () => {
  const plain = await renderSpectrum(page());
  const full = await renderSpectrum(page(), {styles: {mode: 'full'}});
  assert.equal(full.html, plain.html);
  assert.equal(plain.report.styles, undefined);
  for (const text of shadowStyles(plain.html, 'trim-a')) {
    assert.equal(text, TrimA.elementStyles.map((style: any) => style.cssText).join(''));
  }
});

test('trimmed: rules are kept by what the instances can match', async () => {
  const {html: output, report} = await renderSpectrum(page(), {
    styles: {mode: 'trimmed', undefinedPrefixes: ['--mod-'], keep: ['.kept-by-option']},
  });
  const texts = shadowStyles(output, 'trim-a');
  assert.equal(texts.length, 2);
  assert.equal(new Set(texts).size, 1, 'all instances share one trimmed text');
  const text = texts[0];
  const has = (fragment: string) => text.includes(fragment);
  // :host() evaluated against the host's attributes.
  assert.ok(has(':host([variant=a]) #inner'));
  assert.ok(!has(':host([variant=b]) #inner'));
  assert.ok(has(':host(:not([variant=b])) #inner'));
  assert.ok(!has(':host(:not([variant=a])) #inner'));
  // Plain selectors in the shadow content.
  assert.ok(has('#inner { padding: 1px; }'));
  assert.ok(!has('.missing { margin: 0; }'));
  // ::slotted(): the slot exists and an assigned element matches.
  assert.ok(has('slot[name=icon]::slotted(*)'));
  assert.ok(!has('slot[name=nothing]::slotted(*)'));
  assert.ok(has('::slotted(.used)'));
  assert.ok(!has('::slotted(.unused)'));
  // States may match; pseudo-elements are ignored for matching.
  assert.ok(has(':host(:hover) #inner'));
  assert.ok(has('#inner:focus-visible'));
  assert.ok(has(':host(:is(:active, [active])) #inner'));
  assert.ok(has('#inner::before'));
  // Structural pseudo-classes are evaluated; combinators too.
  assert.ok(has('#inner > slot:first-child'));
  assert.ok(!has('slot:last-child + .missing'));
  // @media blocks are filtered recursively and dropped when empty.
  assert.ok(has('@media (min-width: 10px) {'));
  assert.ok(!has('margin: 2px'));
  assert.ok(!has('@media print'));
  // @keyframes only when a kept rule names them; @font-face always.
  assert.ok(has('@keyframes used-anim'));
  assert.ok(!has('@keyframes unused-anim'));
  assert.ok(has('@font-face'));
  // :host-context(): ancestors outside a rendered fragment are unknown, so both are kept here.
  assert.ok(has(':host-context(.ctx-present) #inner'));
  assert.ok(has(':host-context(.ctx-absent) #inner'));
  // undefinedPrefixes: --mod-x is defined nowhere, --mod-defined is (by a kept rule).
  assert.ok(has('color: var(--spectrum-y, red)'));
  assert.ok(!has('--mod-x'));
  assert.ok(has('var(--mod-defined, black)'));
  // keep option.
  assert.ok(has('.kept-by-option'));
  // :host inside another pseudo-class cannot be evaluated: may match (kept).
  assert.ok(has(':is(:host([variant=b])) #inner'));
  // ... but the rest of the selector still decides.
  assert.ok(!has(':host:not(.foo) .missing'));
  // Report.
  assert.ok(report.styles);
  const entry = report.styles.sheets.find((sheet) => sheet.tag === 'trim-a');
  assert.ok(entry);
  assert.equal(entry.id, 'trim-a:0');
  assert.equal(entry.instances, 2);
  assert.equal(entry.fullBytes, Buffer.byteLength((TrimA.elementStyles[0] as any).cssText));
  assert.equal(entry.trimmedBytes, Buffer.byteLength(text));
  assert.equal(report.styles.fullBytes, 2 * entry.fullBytes);
  assert.equal(report.styles.trimmedBytes, 2 * entry.trimmedBytes);
  assert.ok(!output.includes('\u0001'), 'no placeholder left');
});

test('trimmed: :host-context() is decided by the ancestors of a whole document', async () => {
  const doc = await renderSpectrum(
    html`<!doctype html><html><head></head><body><div class="ctx-present"><trim-a variant="a"></trim-a></div></body></html>`,
    {styles: {mode: 'trimmed'}}
  );
  const [text] = shadowStyles(doc.html, 'trim-a');
  assert.ok(text.includes(':host-context(.ctx-present) #inner'));
  assert.ok(!text.includes(':host-context(.ctx-absent) #inner'));
});

test('trimmed: ::slotted() sees elements forwarded through an enclosing shadow root slot', async () => {
  const {html: output} = await renderSpectrum(html`<trim-outer><i class="fwd">a</i></trim-outer>`, {
    styles: {mode: 'trimmed'},
  });
  const [inner] = shadowStyles(output, 'trim-inner');
  assert.ok(inner.includes('::slotted(.fwd)'));
  assert.ok(!inner.includes('::slotted(.nope)'));
  const [outer] = shadowStyles(output, 'trim-outer');
  assert.ok(outer.includes('trim-inner { display: block; }'));
  assert.ok(!outer.includes('trim-missing'));
});

test('trimmed: SVG tag and attribute names match regardless of case (parse5 keeps them camelCased)', async () => {
  const {html: output} = await renderSpectrum(
    html`<trim-svg><svg viewBox="0 0 2 2"></svg></trim-svg>`,
    {styles: {mode: 'trimmed'}}
  );
  const [text] = shadowStyles(output, 'trim-svg');
  assert.ok(text.includes('::slotted(svg[viewBox])'), text);
  assert.ok(!text.includes('::slotted(svg[preserveAspectRatio])'));
  assert.ok(text.includes('linearGradient { color: red; }'));
  assert.ok(!text.includes('radialGradient'));
});

test('trimmed: structural pseudo-classes in :host() see the host siblings of every instance', async () => {
  const {html: output} = await renderSpectrum(html`<div><trim-sibling></trim-sibling><trim-sibling></trim-sibling></div>`, {
    styles: {mode: 'trimmed'},
  });
  const [text] = shadowStyles(output, 'trim-sibling');
  assert.ok(text.includes(':host(:first-child)'));
  assert.ok(text.includes(':host(:last-child)'), 'the second (otherwise identical) instance is the last child');
  assert.ok(!text.includes(':host(:nth-child(5))'));
});

test('trimmed: an element without instances on the page keeps nothing; hosts without shadow are ignored', async () => {
  const {report} = await renderSpectrum(html`<p>no elements</p>`, {styles: {mode: 'trimmed'}});
  assert.deepEqual(report.styles?.sheets, []);
  assert.equal(report.styles?.fullBytes, 0);
});

test('minifyCustomProperties renames consistently and never touches references or style attributes', async () => {
  const options = {
    styles: {
      mode: 'trimmed' as const,
      minifyCustomProperties: true,
      references: ['--keep-me', '--prefixed-*'],
    },
  };
  const {html: output} = await renderSpectrum(html`<trim-vars></trim-vars>`, options);
  const [text] = shadowStyles(output, 'trim-vars');
  assert.ok(!text.includes('--my-color'), text);
  const defined = /(--[A-Za-z]+): red/.exec(text)?.[1];
  assert.ok(defined && defined.length <= 4, `short name for --my-color: ${defined}`);
  assert.ok(text.includes(`color: var(${defined})`), 'definition and use renamed together');
  assert.ok(text.includes('--keep-me: blue') && text.includes('var(--keep-me)'), 'references are not renamed');
  assert.ok(text.includes('--prefixed-one: 1px') && text.includes('var(--prefixed-one)'), 'reference prefixes');
  assert.ok(text.includes('--attr-var: green') && text.includes('var(--attr-var)'), 'style attribute names');
  assert.ok(output.includes('style="--attr-var: pink"'));
  assert.ok(text.includes('var(--only-referenced, black)'), 'names without a definition are not renamed');
  // Deterministic.
  const again = await renderSpectrum(html`<trim-vars></trim-vars>`, options);
  assert.equal(again.html, output);
  // Short names never take a `references` name or prefix (the application's own, e.g. already minified, CSS).
  const {html: avoiding} = await renderSpectrum(html`<trim-vars></trim-vars>`, {
    styles: {...options.styles, references: [...options.styles.references, '--a', '--b*']},
  });
  const [avoidingText] = shadowStyles(avoiding, 'trim-vars');
  assert.equal(/(--[A-Za-z]+): red/.exec(avoidingText)?.[1], '--c', avoidingText);
});

test('markers: data-swc-styles="trimmed" / "minified" only on <style> elements whose text changed', async () => {
  class TrimComplete extends LitElement {
    static override styles = css`:host { display: block; } #y { color: red; }`;
    override render() {
      return html`<i id="y"></i>`;
    }
  }
  customElements.define('trim-complete', TrimComplete);
  class TrimNoVars extends LitElement {
    static override styles = css`:host { display: block; } #y { color: red; } .absent { color: blue; }`;
    override render() {
      return html`<i id="y"></i>`;
    }
  }
  customElements.define('trim-no-vars', TrimNoVars);
  const markerOf = (output: string, tag: string) => {
    const match = new RegExp(`<${tag}[^>]*><template [^>]*><style( [^>]*)?>`).exec(output);
    assert.ok(match, `<${tag}> has a declarative shadow root with a <style>`);
    return /data-swc-styles="([^"]*)"/.exec(match[1] ?? '')?.[1];
  };
  const content = html`<trim-complete></trim-complete><trim-no-vars></trim-no-vars><trim-vars></trim-vars>`;
  const plain = await renderSpectrum(content);
  assert.ok(!plain.html.includes('data-swc-styles'));
  const trimmed = await renderSpectrum(content, {styles: {mode: 'trimmed'}});
  assert.equal(markerOf(trimmed.html, 'trim-complete'), undefined, 'nothing left out: no marker');
  assert.equal(markerOf(trimmed.html, 'trim-no-vars'), 'trimmed');
  assert.equal(markerOf(trimmed.html, 'trim-vars'), undefined, 'every rule of trim-vars matches: no marker');
  const minified = await renderSpectrum(content, {styles: {mode: 'trimmed', minifyCustomProperties: true}});
  assert.equal(markerOf(minified.html, 'trim-complete'), undefined);
  assert.equal(markerOf(minified.html, 'trim-no-vars'), 'trimmed', 'trimmed, but nothing of it renamed');
  assert.equal(markerOf(minified.html, 'trim-vars'), 'minified');
});

test('scanCustomPropertyReferences finds var() names, fallbacks included', () => {
  assert.deepEqual(
    scanCustomPropertyReferences('a{color:var(--x, var(--y))} b{--z:1;margin:VAR( --w )} const s = "var(--js-ref)";'),
    ['--x', '--y', '--w', '--js-ref']
  );
  assert.deepEqual(scanCustomPropertyReferences('no references'), []);
});

test('the CSS parser keeps slices verbatim and understands strings, url(), comments and nesting', () => {
  const text =
    '/* c */:host{a:b;--x:{y:z};&:lang(ar){c:d}}@media (x){.a{content:"}"}.b{background:url(data:x{y})}}' +
    '@keyframes k{to{opacity:1}}@import url(x.css);@font-face{font-family:f}.c[title="{"]{e:f}';
  const nodes = parseRules(text);
  assert.deepEqual(
    nodes.map((node) => node.kind),
    ['style', 'group', 'keyframes', 'other', 'other', 'style']
  );
  const host = nodes[0] as any;
  assert.equal(text.slice(host.start, host.end), ':host{a:b;--x:{y:z};&:lang(ar){c:d}}');
  const items = splitBlock(text, host.bodyStart, host.bodyEnd);
  assert.deepEqual(
    items.map((item) => `${item.kind}:${text.slice(item.start, item.end)}`),
    ['decl:a:b', 'decl:--x:{y:z}', 'nested:&:lang(ar){c:d}']
  );
  const media = nodes[1] as any;
  assert.deepEqual(
    media.children.map((node: any) => text.slice(node.start, node.end)),
    ['.a{content:"}"}', '.b{background:url(data:x{y})}']
  );
  assert.equal((nodes[2] as any).name, 'k');
  assert.equal((nodes[5] as any).prelude, '.c[title="{"]');
});

test('collapseVars replaces var(--prefix-x, V) by V, recursively, and leaves the rest alone', () => {
  const collapse = (name: string) => name.startsWith('--mod-');
  assert.equal(collapseVars('var(--mod-a, var(--mod-b, var(--c)))', collapse), 'var(--c)');
  assert.equal(collapseVars('1px var(--mod-a, 2px) var(--c, var(--mod-d, 3px))', collapse), '1px 2px var(--c, 3px)');
  assert.equal(collapseVars('var(--mod-a)', collapse), 'var(--mod-a)', 'no fallback: unchanged');
  assert.equal(collapseVars('var(--mod-a,)', collapse), 'var(--mod-a,)', 'empty fallback: unchanged');
  const same = 'calc(var(--c) * 2)';
  assert.equal(collapseVars(same, collapse), same);
});
