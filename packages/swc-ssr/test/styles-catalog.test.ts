/**
 * `styles: {mode: 'trimmed'}` on the whole demo catalog (59 entries, ~1350 shadow roots): sizes and timing (printed
 * as test diagnostics), one trimmed text per element class, no placeholder left, and the theme closure at page scale.
 *
 * The catalog demos every variant and state of every component, so per-class trimming keeps most component rules
 * (the union over all instances, state pseudo-classes count as matching); custom-property renaming
 * (`minifyCustomProperties`) is what shrinks the repeated component stylesheets.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {constants, cpus, setPriority} from 'node:os';
import {installSpectrumSsr, renderSpectrum, scanCustomPropertyReferences} from '../src/server/index.ts';
import type {RenderSpectrumResult, StyleOptions} from '../src/server/index.ts';
import {addDefinitions, parseRules, type CssNode} from '../src/server/styles/css-text.ts';

// The catalog renders below take tens of seconds of CPU. At the lowest priority they do not starve the
// timing-sensitive tests the runner executes in parallel processes (e.g. server-session-scope's 30 ms timer race).
try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not permitted on this platform: run at normal priority.
}

/**
 * Priority alone is not enough on small laptops (measured on a 15 W i7-1255U: with every core busy the package
 * throttles, and server-session-scope's 30 ms timer race failed in about every other `npm run test:unit`): the
 * catalog is loaded and rendered only once the machine has been mostly idle for a second - when the runner's other
 * test processes are done - or after `maxMs` at the latest. Only the scheduling of this file changes, no assertion.
 */
async function waitForQuietMachine(maxMs = 45_000, busyBelow = 0.5): Promise<void> {
  const sample = () => {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus()) {
      const {user, nice, sys, irq} = cpu.times;
      idle += cpu.times.idle;
      total += user + nice + sys + irq + cpu.times.idle;
    }
    return {idle, total};
  };
  const started = Date.now();
  let previous = sample();
  let quietSamples = 0;
  while (Date.now() - started < maxMs && quietSamples < 4) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = sample();
    const busy = 1 - (next.idle - previous.idle) / Math.max(1, next.total - previous.total);
    previous = next;
    quietSamples = busy < busyBelow ? quietSamples + 1 : 0;
  }
}

await waitForQuietMachine();

installSpectrumSsr();

const {html} = await import('lit');
const {catalog, loadEntries} = await import('../../../demo/src/catalog/index.ts');
const {pageTemplate} = await import('../../../demo/src/page.ts');
await loadEntries(catalog);


/**
 * Style text (and `data-swc-styles` marker) per shadow host of the output (document order). The renderers emit
 * `<host ...><template shadowrootmode="open" ...><style>...</style>`; a string scan keeps this test light (parsing the
 * multi-megabyte outputs would load the machine for the timing-sensitive tests running in parallel).
 */
function hostStyles(output: string): Array<{tag: string; text: string; marker: string | undefined}> {
  const out: Array<{tag: string; text: string; marker: string | undefined}> = [];
  const re =
    /<template shadowroot="open" shadowrootmode="open"[^>]*><style(?: data-swc-styles="([a-z]+)")?>([\s\S]*?)<\/style>/g;
  for (let match = re.exec(output); match !== null; match = re.exec(output)) {
    // The host's start tag ends right before its declarative shadow root.
    let start = output.lastIndexOf('<', match.index - 1);
    while (start > 0 && !/^<[a-z][a-z0-9]*-[a-z0-9-]*[\s>]/.test(output.slice(start, start + 64))) {
      start = output.lastIndexOf('<', start - 1);
    }
    const tag = /^<([a-z][a-z0-9-]*)/.exec(output.slice(start, start + 64))?.[1] ?? '?';
    out.push({tag, text: match[2], marker: match[1]});
  }
  return out;
}

const render = (styles?: StyleOptions): Promise<RenderSpectrumResult> =>
  renderSpectrum(pageTemplate(catalog), {deferHydration: true, ...(styles ? {styles} : {})});

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

const trimmedOptions: StyleOptions = {mode: 'trimmed'};
const minifiedOptions: StyleOptions = {mode: 'trimmed', minifyCustomProperties: true, undefinedPrefixes: ['--mod-']};

// The first render of the process also parses the stylesheets and compiles their selectors ("cold").
const trimmed = await render(trimmedOptions);
const minified = await render(minifiedOptions);

test('catalog: sizes and timing of trimmed and minified renders', (t) => {
  const a = trimmed.report.styles!;
  const b = minified.report.styles!;
  const rows = [
    ['mode', 'sheets', 'css full', 'css kept', 'kept %', 'html', 'trimming ms', 'render ms'],
    [
      'trimmed',
      String(a.sheets.length),
      kb(a.fullBytes),
      kb(a.trimmedBytes),
      ((100 * a.trimmedBytes) / a.fullBytes).toFixed(1),
      kb(trimmed.html.length),
      `${a.durationMs} (cold)`,
      String(trimmed.report.durationMs),
    ],
    [
      'minified + --mod-',
      String(b.sheets.length),
      kb(b.fullBytes),
      kb(b.trimmedBytes),
      ((100 * b.trimmedBytes) / b.fullBytes).toFixed(1),
      kb(minified.html.length),
      String(b.durationMs),
      String(minified.report.durationMs),
    ],
  ];
  for (const row of rows) {
    t.diagnostic(row.map((cell, index) => cell.padEnd(index === 0 ? 18 : 12)).join(' '));
  }
  const top = [...a.sheets].sort((x, y) => y.trimmedBytes * y.instances - x.trimmedBytes * x.instances).slice(0, 8);
  for (const sheet of top) {
    const min = b.sheets.find((entry) => entry.id === sheet.id);
    t.diagnostic(
      `  ${sheet.id.padEnd(28)} x${String(sheet.instances).padStart(4)} ${kb(sheet.fullBytes).padStart(7)} -> ` +
        `${kb(sheet.trimmedBytes).padStart(6)} trimmed, ${kb(min?.trimmedBytes ?? 0).padStart(6)} minified`
    );
  }
  assert.equal(a.fullBytes, b.fullBytes);
  // Measured 69.6% (trimmed) and 23.9% (minified + --mod-) with @spectrum-web-components 1.12.4.
  assert.ok(a.trimmedBytes < 0.75 * a.fullBytes, `trimmed keeps ${a.trimmedBytes} of ${a.fullBytes}`);
  assert.ok(b.trimmedBytes < 0.3 * b.fullBytes, `minified keeps ${b.trimmedBytes} of ${b.fullBytes}`);
  // Trimming (warm: the second render) is a small part of the render (robust against machine load, unlike
  // absolute times).
  assert.ok(b.durationMs < 0.3 * minified.report.durationMs, `trimming ${b.durationMs} of ${minified.report.durationMs} ms`);
});

test('catalog: one trimmed text per element class, no placeholder, no trimming warning, changed texts marked', () => {
  for (const result of [trimmed, minified]) {
    assert.ok(!result.html.includes('\u0001'));
    // Every <style> whose text the trimmer changed is marked, the others are complete stylesheets.
    const expected = result === trimmed ? 'trimmed' : 'minified';
    const styles = hostStyles(result.html);
    assert.ok(styles.length > 1000, `${styles.length} shadow roots with styles`);
    const markers = new Set(styles.map((style) => style.marker));
    assert.ok(markers.has(expected), `${expected}: ${[...markers].join(', ')}`);
    for (const style of styles) {
      if (style.tag === 'sp-theme' || style.tag === 'sp-button') {
        assert.equal(style.marker, expected, `<${style.tag}>`);
      }
      if (result === trimmed) {
        assert.notEqual(style.marker, 'minified');
      }
    }
    const warnings = result.report.elements.flatMap((element) => element.warnings);
    assert.deepEqual(
      warnings.filter((warning) => warning.includes('trim')),
      []
    );
    const byTag = new Map<string, Set<string>>();
    for (const {tag, text} of hostStyles(result.html)) {
      let texts = byTag.get(tag);
      if (!texts) {
        texts = new Set();
        byTag.set(tag, texts);
      }
      texts.add(text);
    }
    // <sp-theme> carries different fragment sets (the theme entry nests dark / large themes): one text per set.
    assert.equal(byTag.get('sp-theme')?.size, 3);
    byTag.delete('sp-theme');
    for (const [tag, texts] of byTag) {
      assert.equal(texts.size, 1, `<${tag}>: ${texts.size} distinct style texts`);
    }
  }
});

test('catalog: the trimmed theme defines every theme property the trimmed component stylesheets use', async () => {
  const theme = await renderSpectrum(html`<sp-theme system="spectrum" color="light" scale="medium"></sp-theme>`);
  const fullTheme = hostStyles(theme.html)[0].text;
  // What the theme defines for its descendants: rules with :host (`.spectrum-Heading` & co. never match in its
  // shadow root, which only holds a <slot>).
  const definedFull = new Set<string>();
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') {
        visit(node.children);
      } else if (node.kind === 'style' && node.prelude.includes(':host')) {
        addDefinitions(fullTheme.slice(node.start, node.end), definedFull);
      }
    }
  };
  visit(parseRules(fullTheme));
  const styles = hostStyles(trimmed.html);
  const trimmedTheme = styles.find((entry) => entry.tag === 'sp-theme')!.text;
  const definedTrimmed = new Set<string>();
  addDefinitions(trimmedTheme, definedTrimmed);
  const missing = new Set<string>();
  for (const {tag, text} of styles) {
    for (const name of scanCustomPropertyReferences(text)) {
      if (definedFull.has(name) && !definedTrimmed.has(name)) {
        missing.add(`${tag}: ${name}`);
      }
    }
  }
  assert.deepEqual([...missing], []);
  assert.ok(trimmedTheme.length < fullTheme.length / 2, `theme ${kb(trimmedTheme.length)} of ${kb(fullTheme.length)}`);
});
