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
  // Measured 69.6% (trimmed) and 38.3% (minified + --mod-) with @spectrum-web-components 1.12.4. 0.2.0 renamed more
  // (23.9%, budget 30%): since 0.2.1 the minifier keeps Spectrum's public --system-* / --highcontrast-* / --mod-* names
  // and the names one element class defines for another (docs/API.md "Styles"), which costs 14 points here; since
  // 0.2.2 also the names other classes' complete stylesheets use (37.9 -> 38.3 %).
  assert.ok(a.trimmedBytes < 0.75 * a.fullBytes, `trimmed keeps ${a.trimmedBytes} of ${a.fullBytes}`);
  assert.ok(b.trimmedBytes < 0.42 * b.fullBytes, `minified keeps ${b.trimmedBytes} of ${b.fullBytes}`);
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

test('catalog (0.2.1, M1 / M2): every renamed name a component reads is defined in its own <style> or the theme; public names are never renamed', () => {
  // A component restored by the client switches every name of its own <style> at once, and the bridged theme keeps
  // the theme's short names defined: a short name a component reads must come from one of the two. A short name
  // defined by another element class (`sp-tabs` for `sp-tab`) would vanish when that element is restored first.
  const styles = hostStyles(minified.html);
  const themeDefinitions = new Set<string>();
  for (const {tag, text} of styles) {
    if (tag === 'sp-theme') {
      addDefinitions(text, themeDefinitions);
    }
  }
  const isShort = (name: string) => /^--[A-Za-z]{1,3}$/.test(name);
  const foreign = new Set<string>();
  let shortReads = 0;
  for (const {tag, text} of styles) {
    if (tag === 'sp-theme') {
      continue;
    }
    const own = new Set<string>();
    addDefinitions(text, own);
    for (const name of scanCustomPropertyReferences(text)) {
      if (!isShort(name)) {
        continue;
      }
      shortReads++;
      if (!own.has(name) && !themeDefinitions.has(name)) {
        foreign.add(`<${tag}> reads ${name}`);
      }
    }
  }
  assert.ok(shortReads > 1000, `${shortReads} reads of renamed names`);
  assert.deepEqual([...foreign].slice(0, 20), []);
  // Spectrum's public customisation names (--system-*, --highcontrast-*; --mod-* are collapsed by undefinedPrefixes
  // here) stay readable: every one the trimmed page has, the minified page has too.
  const publicNames = (output: string) => {
    const names = new Set<string>();
    for (const match of output.matchAll(/(?<![\w-])--(?:system|highcontrast)-[\w-]+/g)) {
      names.add(match[0]);
    }
    return names;
  };
  const before = publicNames(trimmed.html);
  const after = publicNames(minified.html);
  assert.ok(before.size > 500, `${before.size} --system-* / --highcontrast-* names on the trimmed page`);
  assert.deepEqual([...before].filter((name) => !after.has(name)).slice(0, 20), []);
});

test('catalog (0.2.2): every renamed name is owned in the COMPLETE stylesheets too (what the client restores)', () => {
  // The client restores an element's complete `elementStyles` (original names). A name the trimmed texts showed in one
  // element class only can still be read by a rule the trimmer dropped from another class's sheet (sp-menu ->
  // sp-menu-item's disabled icon colour): with the defining parent defined late, the restored child reads the original
  // name while the parent's minified CSS defines only the short one. 0.2.1 renamed 48 such names on the catalog.
  const trimmedRoots = hostStyles(trimmed.html);
  const minifiedRoots = hostStyles(minified.html);
  assert.equal(minifiedRoots.length, trimmedRoots.length, 'the same shadow roots in both renders');
  // Short -> original, token by token. `minifiedOptions` also collapses undefined `--mod-*` references
  // (undefinedPrefixes): such a token is missing from the minified text, and `--mod-*` names are never renamed.
  const TOKEN = /(?<![\w-])--[\w-]+/g;
  const originals = new Map<string, string>();
  const inconsistent = new Set<string>();
  let misaligned = 0;
  minifiedRoots.forEach((root, index) => {
    const before = trimmedRoots[index]!;
    assert.equal(root.tag, before.tag);
    if (root.tag === 'sp-theme') {
      return; // the theme closure may differ with collapsed references; its names are judged by definition below
    }
    const a = before.text.match(TOKEN) ?? [];
    const b = root.text.match(TOKEN) ?? [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
      } else if (a[i]!.startsWith('--mod-')) {
        i++;
      } else {
        const previous = originals.get(b[j]!);
        if (previous !== undefined && previous !== a[i]) {
          inconsistent.add(b[j]!);
        }
        originals.set(b[j]!, a[i]!);
        i++;
        j++;
      }
    }
    if (j < b.length || a.slice(i).some((token) => !token.startsWith('--mod-'))) {
      misaligned++;
    }
  });
  assert.equal(misaligned, 0, 'minified texts align with the trimmed texts token by token');
  assert.deepEqual([...inconsistent], []);
  assert.ok(originals.size > 1000, `${originals.size} renamed names`);

  const themeDefines = new Set<string>();
  for (const {tag, text} of minifiedRoots) {
    if (tag === 'sp-theme') {
      addDefinitions(text, themeDefines);
    }
  }
  // Complete stylesheets of every element class on the page, per stylesheet object (shared objects count once).
  const registry = (globalThis as {customElements?: {get(tag: string): unknown}}).customElements!;
  const mentionedBy = new Map<string, {classes: Set<string>; sheets: Set<unknown>}>();
  const definedByClass = new Set<string>();
  for (const tag of new Set(minifiedRoots.map((root) => root.tag))) {
    if (tag === 'sp-theme') {
      continue;
    }
    const styles = (registry.get(tag) as {elementStyles?: Array<{cssText?: string}>} | undefined)?.elementStyles ?? [];
    for (const style of styles) {
      const text = style.cssText ?? '';
      for (const match of text.matchAll(TOKEN)) {
        let entry = mentionedBy.get(match[0]);
        if (!entry) {
          entry = {classes: new Set(), sheets: new Set()};
          mentionedBy.set(match[0], entry);
        }
        entry.classes.add(tag);
        entry.sheets.add(style);
      }
      addDefinitions(text, definedByClass);
    }
  }
  const foreign: string[] = [];
  let themeOwned = 0;
  for (const [short, original] of originals) {
    if (themeDefines.has(short)) {
      themeOwned++;
      // Theme-owned: no element class may define the name (it would override the theme under the original name).
      if (definedByClass.has(original)) {
        foreign.push(`${original} (${short}): theme name an element class's complete sheet defines`);
      }
      continue;
    }
    const users = mentionedBy.get(original);
    if (users && users.classes.size > 1 && users.sheets.size > 1) {
      foreign.push(`${original} (${short}): complete sheets of ${[...users.classes].join(', ')}`);
    }
  }
  assert.ok(themeOwned > 500, `${themeOwned} theme-owned renamed names`);
  assert.deepEqual(foreign.slice(0, 20), [], `${foreign.length} renamed names other classes' complete sheets use`);
});
