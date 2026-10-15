/**
 * `styles: {mode: 'trimmed'}` on the demo's button page (sp-theme + every sp-button variant, sp-close-button,
 * sp-clear-button): one shared trimmed text per element class, trimmed rules are a verbatim subset of the full
 * stylesheet whose selectors all parse, the trimmed theme keeps every custom property the kept rules use
 * (transitively), and renders are deterministic. Full mode stays byte-identical to the complete stylesheets. Every
 * `<style>` whose text changed carries `data-swc-styles="trimmed"` / `"minified"` (the client restores those).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse as parseSelector} from 'css-what';
import {
  installSpectrumSsr,
  renderSpectrum,
  scanCustomPropertyReferences,
  STYLE_MARKER_ATTRIBUTE,
} from '../src/server/index.ts';
import {addDefinitions, parseRules, splitBlock, type CssNode} from '../src/server/styles/css-text.ts';
import {isElement, parseHtml, shadowTemplateOf, templateContent, walkElements} from './helpers.ts';
import type {AnyNode, Element} from 'domhandler';

installSpectrumSsr();

const {findEntry} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');

/* eslint-disable @typescript-eslint/no-explicit-any */

const button = findEntry('button')!;
await button.load();
const template = () => pageTemplate([button]);

/** Style texts of the declarative shadow roots of every `<tag>` in the output. */
function shadowStyles(output: string, tag: string): string[] {
  const texts: string[] = [];
  for (const element of walkElements(parseHtml(output))) {
    if (element.name !== tag) {
      continue;
    }
    const template = shadowTemplateOf(element);
    if (!template) {
      continue;
    }
    const style = (templateContent(template) as any).children.find(
      (node: AnyNode) => isElement(node) && (node as Element).name === 'style'
    ) as Element | undefined;
    texts.push(style ? style.children.map((node: any) => node.data ?? '').join('') : '');
  }
  return texts;
}

/** The `<style>` of every declarative shadow root of the output, in document order, with its host's tag. */
function allShadowStyles(output: string): Array<{tag: string; text: string; marker: string | undefined}> {
  const out: Array<{tag: string; text: string; marker: string | undefined}> = [];
  for (const element of walkElements(parseHtml(output))) {
    const template = shadowTemplateOf(element);
    const style = template
      ? ((templateContent(template) as any).children.find(
          (node: AnyNode) => isElement(node) && (node as Element).name === 'style'
        ) as Element | undefined)
      : undefined;
    if (style) {
      out.push({
        tag: element.name,
        text: style.children.map((node: any) => node.data ?? '').join(''),
        marker: style.attribs[STYLE_MARKER_ATTRIBUTE],
      });
    }
  }
  return out;
}

/** Style rules (with their group preludes) of a stylesheet text. */
function styleRules(text: string): Array<{prelude: string; text: string; node: any}> {
  const out: Array<{prelude: string; text: string; node: any}> = [];
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'style') {
        out.push({prelude: node.prelude, text: text.slice(node.start, node.end), node});
      } else if (node.kind === 'group') {
        visit(node.children);
      }
    }
  };
  visit(parseRules(text));
  return out;
}

const full = await renderSpectrum(template(), {deferHydration: true});
const trimmed = await renderSpectrum(template(), {deferHydration: true, styles: {mode: 'trimmed'}});
const minified = await renderSpectrum(template(), {
  deferHydration: true,
  styles: {mode: 'trimmed', minifyCustomProperties: true},
});

test('full mode is byte-identical: explicit {mode: "full"} equals the default, styles are the elementStyles', async () => {
  const explicit = await renderSpectrum(template(), {deferHydration: true, styles: {mode: 'full'}});
  assert.equal(explicit.html, full.html);
  assert.equal(full.report.styles, undefined);
  const expected = (customElements.get('sp-button') as any).elementStyles.map((style: any) => style.cssText).join('');
  const texts = shadowStyles(full.html, 'sp-button');
  assert.ok(texts.length > 10);
  for (const text of texts) {
    assert.equal(text, expected);
  }
});

test('trimmed button page: one distinct sp-button text, smaller than the full one, a verbatim subset', () => {
  const texts = shadowStyles(trimmed.html, 'sp-button');
  const fullText = shadowStyles(full.html, 'sp-button')[0];
  assert.equal(texts.length, shadowStyles(full.html, 'sp-button').length);
  assert.equal(new Set(texts).size, 1, 'exactly one distinct sp-button style text');
  const text = texts[0];
  assert.ok(text.length < fullText.length, `trimmed ${text.length} < full ${fullText.length}`);
  const fullRules = new Set(styleRules(fullText).map((rule) => rule.text));
  for (const rule of styleRules(text)) {
    assert.ok(fullRules.has(rule.text), `kept rule is a rule of the full stylesheet: ${rule.text.slice(0, 120)}`);
    assert.doesNotThrow(() => parseSelector(rule.prelude), `selector parses: ${rule.prelude}`);
  }
  // Rules for variants nobody rendered are gone; those of rendered variants and states stay.
  assert.ok(text.includes(':host([variant=accent])'));
  assert.ok(text.includes(':host([static-color=white])'));
  assert.ok(text.includes(':host(:focus-visible)'));
  assert.ok(!text.includes(':host([size=xs])'), 'no xs button on the page');
  assert.ok(!text.includes('\u0001'));
  // The report.
  const styles = trimmed.report.styles!;
  assert.equal(styles.mode, 'trimmed');
  const sheet = styles.sheets.find((entry) => entry.id === 'sp-button:1');
  assert.ok(sheet, JSON.stringify(styles.sheets.map((entry) => entry.id)));
  assert.equal(sheet.instances, texts.length);
  assert.ok(styles.trimmedBytes < styles.fullBytes);
  assert.ok(styles.durationMs >= 0);
});

test('trimmed theme: keeps every theme property the kept rules use, transitively; its declarations are a subset', () => {
  const fullTheme = shadowStyles(full.html, 'sp-theme')[0];
  const theme = shadowStyles(trimmed.html, 'sp-theme')[0];
  assert.ok(theme.length < fullTheme.length / 5, `theme ${theme.length} vs ${fullTheme.length}`);
  // What the theme defines for its descendants: rules with :host (`.spectrum-Heading` & co. never match in its
  // shadow root, which only holds a <slot>).
  const definedFull = new Set<string>();
  for (const rule of styleRules(fullTheme)) {
    if (rule.prelude.includes(':host')) {
      addDefinitions(rule.text, definedFull);
    }
  }
  const definedTrimmed = new Set<string>();
  addDefinitions(theme, definedTrimmed);
  const missing = new Set<string>();
  // Every var() of every kept component rule on the page that the theme defines is still defined.
  for (const tag of ['sp-button', 'sp-close-button', 'sp-clear-button', 'sp-progress-circle']) {
    for (const text of new Set(shadowStyles(trimmed.html, tag))) {
      for (const name of scanCustomPropertyReferences(text)) {
        if (definedFull.has(name) && !definedTrimmed.has(name)) {
          missing.add(`${tag}: ${name}`);
        }
      }
    }
  }
  // Closure: every var() in a kept theme declaration that the full theme defines is kept.
  for (const rule of styleRules(theme)) {
    for (const item of splitBlock(theme, rule.node.bodyStart, rule.node.bodyEnd)) {
      for (const name of scanCustomPropertyReferences(theme.slice(item.start, item.end))) {
        if (definedFull.has(name) && !definedTrimmed.has(name)) {
          missing.add(`theme: ${name}`);
        }
      }
    }
  }
  assert.deepEqual([...missing], []);
  // Theme declarations are a subset of the full theme's.
  const fullDeclarations = new Set<string>();
  for (const rule of styleRules(fullTheme)) {
    for (const item of splitBlock(fullTheme, rule.node.bodyStart, rule.node.bodyEnd)) {
      fullDeclarations.add(fullTheme.slice(item.start, item.end));
    }
  }
  for (const rule of styleRules(theme)) {
    for (const item of splitBlock(theme, rule.node.bodyStart, rule.node.bodyEnd)) {
      assert.ok(fullDeclarations.has(theme.slice(item.start, item.end)), theme.slice(item.start, item.end));
    }
  }
});

test('references keep theme properties (and their dependencies) that no rendered rule uses', async () => {
  const name = '--spectrum-heading-size-xxl';
  assert.ok(!shadowStyles(trimmed.html, 'sp-theme')[0].includes(`${name}:`));
  const withReference = await renderSpectrum(template(), {styles: {mode: 'trimmed', references: [name]}});
  const theme = shadowStyles(withReference.html, 'sp-theme')[0];
  assert.ok(theme.includes(`${name}:`));
  const prefixed = await renderSpectrum(template(), {styles: {mode: 'trimmed', references: ['--spectrum-heading-*']}});
  assert.ok(shadowStyles(prefixed.html, 'sp-theme')[0].includes(`${name}:`));
  const untrimmed = await renderSpectrum(template(), {styles: {mode: 'trimmed', trimTheme: false}});
  assert.ok(shadowStyles(untrimmed.html, 'sp-theme')[0].length > theme.length * 3);
});

test('theme properties used only inside @keyframes or other at-rules are kept', async () => {
  const {LitElement, css, html} = await import('lit');
  class TrimKeyframes extends LitElement {
    static override styles = css`
      @keyframes trim-pulse { to { color: var(--spectrum-gray-800); } }
      #x { animation: trim-pulse 1s; }
    `;
    override render() {
      return html`<div id="x"></div>`;
    }
  }
  customElements.define('trim-keyframes', TrimKeyframes);
  const {html: output} = await renderSpectrum(
    html`<sp-theme system="spectrum" color="light" scale="medium"><trim-keyframes></trim-keyframes></sp-theme>`,
    {styles: {mode: 'trimmed'}}
  );
  assert.ok(shadowStyles(output, 'trim-keyframes')[0].includes('@keyframes trim-pulse'));
  assert.match(shadowStyles(output, 'sp-theme')[0], /--spectrum-gray-800:/);
});

test('minified button page: one distinct sp-button text under 15 KB, the trimmed page under one renaming', () => {
  const texts = shadowStyles(minified.html, 'sp-button');
  assert.equal(new Set(texts).size, 1);
  assert.ok(texts[0].length < 15 * 1024, `minified sp-button ${texts[0].length} bytes`);
  // Every <style> of the minified page is the trimmed one with custom-property names replaced, by one injective
  // mapping for the whole page.
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  const trimmedStyles = [...trimmed.html.matchAll(styleRe)].map((match) => match[1]);
  const minifiedStyles = [...minified.html.matchAll(styleRe)].map((match) => match[1]);
  assert.equal(minifiedStyles.length, trimmedStyles.length);
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  const nameRe = /((?<![\w\u0080-￿\\-])--[\w\u0080-￿-]+)/;
  trimmedStyles.forEach((original, index) => {
    const a = original.split(nameRe);
    const b = minifiedStyles[index].split(nameRe);
    assert.equal(b.length, a.length, `style ${index}: same number of names`);
    for (let i = 0; i < a.length; i++) {
      if (i % 2 === 0) {
        assert.equal(b[i], a[i], `style ${index}: text between names unchanged`);
        continue;
      }
      assert.equal(forward.get(a[i]) ?? b[i], b[i], `${a[i]} is renamed consistently`);
      assert.equal(backward.get(b[i]) ?? a[i], a[i], `${b[i]} stands for one name only`);
      forward.set(a[i], b[i]);
      backward.set(b[i], a[i]);
    }
  });
  const renamed = [...forward].filter(([from, to]) => from !== to);
  assert.ok(renamed.length > 100, `${renamed.length} names renamed`);
  // Names only referenced (never defined on the page) keep their names.
  const defined = new Set<string>();
  for (const text of trimmedStyles) {
    addDefinitions(text, defined);
  }
  for (const [from, to] of renamed) {
    assert.ok(defined.has(from), `${from} -> ${to} is defined on the page`);
  }
});

test('changed <style> elements are marked: data-swc-styles="trimmed" / "minified"; full mode marks nothing', () => {
  assert.equal(STYLE_MARKER_ATTRIBUTE, 'data-swc-styles');
  assert.ok(!full.html.includes(STYLE_MARKER_ATTRIBUTE));
  const fullStyles = allShadowStyles(full.html);
  const trimmedStyles = allShadowStyles(trimmed.html);
  const minifiedStyles = allShadowStyles(minified.html);
  assert.equal(trimmedStyles.length, fullStyles.length);
  assert.equal(minifiedStyles.length, fullStyles.length);
  const counts = {trimmed: 0, minified: 0, unmarked: 0};
  fullStyles.forEach((complete, index) => {
    const a = trimmedStyles[index];
    const b = minifiedStyles[index];
    assert.equal(a.tag, complete.tag);
    assert.equal(complete.marker, undefined);
    // Trimmed page: marked exactly when the text differs from the complete stylesheets.
    assert.equal(a.marker, a.text === complete.text ? undefined : 'trimmed', `<${a.tag}> #${index}`);
    // Minified page: "minified" exactly when names were renamed, else as on the trimmed page.
    assert.equal(b.marker, b.text !== a.text ? 'minified' : a.marker, `<${b.tag}> #${index} (minified)`);
    counts[(b.marker ?? 'unmarked') as keyof typeof counts]++;
  });
  for (const tag of ['sp-theme', 'sp-button']) {
    assert.deepEqual(new Set(trimmedStyles.filter((s) => s.tag === tag).map((s) => s.marker)), new Set(['trimmed']));
    assert.deepEqual(new Set(minifiedStyles.filter((s) => s.tag === tag).map((s) => s.marker)), new Set(['minified']));
  }
  assert.ok(counts.minified > 20, JSON.stringify(counts));
});

test('trimmed renders are deterministic', async () => {
  const again = await renderSpectrum(template(), {deferHydration: true, styles: {mode: 'trimmed'}});
  assert.equal(again.html, trimmed.html);
  const minifiedAgain = await renderSpectrum(template(), {
    deferHydration: true,
    styles: {mode: 'trimmed', minifyCustomProperties: true},
  });
  assert.equal(minifiedAgain.html, minified.html);
});

test('trimming time of the button page (warm) is reported and small', async (t) => {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await renderSpectrum(template(), {deferHydration: true, styles: {mode: 'trimmed'}});
    runs.push(result.report.styles!.durationMs);
  }
  t.diagnostic(`button page trimming: ${runs.join(' / ')} ms (render ${trimmed.report.durationMs} ms)`);
  assert.ok(Math.min(...runs) < 100, `trimming ${runs.join(', ')} ms`);
});
