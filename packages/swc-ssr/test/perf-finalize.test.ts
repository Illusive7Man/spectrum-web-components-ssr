/**
 * Render speed (0.3.0): the end of a render builds the page in one copy (`finalizeHtml`: light-DOM attribute edits,
 * `data-swc-ssr` marker removal and raw DOM-node regions together) instead of three copies of it (19.5 M characters
 * on the full catalog). The result must be exactly what the separate steps give.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {finalizeHtml, RAW_CLOSE, RAW_OPEN} from '../src/server/materialize.ts';
import {applyEdits, type Edit} from '../src/server/light-mutations.ts';

const MARKER_RE = / data-swc-ssr="\d+"/g;

/** The separate steps: edits, then markers, then raw regions. */
const separately = (html: string, strip: boolean, edits: Edit[]) =>
  finalizeHtml(strip ? applyEdits(html, edits).replace(MARKER_RE, '') : applyEdits(html, edits));

test('raw regions: delimiters and template-level hydration markers removed, nested templates kept', () => {
  const region = '<!--lit-part abc--><x-a defer-hydration><template shadowrootmode="open"><!--lit-part q--></template></x-a><!--/lit-part-->';
  assert.equal(
    finalizeHtml(`<p>a</p>${RAW_OPEN}${region}${RAW_CLOSE}<p>b</p>`),
    '<p>a</p><x-a><template shadowrootmode="open"><!--lit-part q--></template></x-a><p>b</p>'
  );
  // An opening comment without a closing one after it stays as it is (as the regex replace left it).
  assert.equal(finalizeHtml(`a${RAW_OPEN}b${RAW_CLOSE}c${RAW_OPEN}d`), `abc${RAW_OPEN}d`);
  assert.equal(finalizeHtml(`${RAW_CLOSE}a${RAW_OPEN}${RAW_OPEN}b${RAW_CLOSE}`), `${RAW_CLOSE}a${RAW_OPEN}b`);
  assert.equal(finalizeHtml('<p>nothing to do</p>'), '<p>nothing to do</p>');
});

test('markers, edits and raw regions in one copy give what the separate steps give', () => {
  const page =
    '<sp-a data-swc-ssr="0" x="1"><h2 slot="heading">T</h2></sp-a>' +
    `<div id="d"><input type="checkbox" tabindex="0"></div>${RAW_OPEN}<b data-swc-ssr="7">r</b>${RAW_CLOSE}` +
    '<sp-b data-swc-ssr="12"><span class="c">s</span></sp-b>';
  const at = (text: string) => page.indexOf(text);
  const cases: Array<{name: string; edits: Edit[]}> = [
    {name: 'no edits', edits: []},
    {
      name: 'insert, replace, remove',
      edits: [
        {start: at('>T') , end: at('>T'), text: ' id="heading-1"'},
        {start: at(' tabindex'), end: at('tabindex="0"') + 'tabindex="0"'.length, text: ''},
        {start: at('class="c"'), end: at('class="c"') + 'class="c"'.length, text: 'class="c d"'},
      ],
    },
    {
      name: 'two insertions at one offset (reverse order, like one-at-a-time application)',
      edits: [
        {start: at('><input'), end: at('><input'), text: ' a="1"'},
        {start: at('><input'), end: at('><input'), text: ' b="2"'},
      ],
    },
    {name: 'edit next to a marker', edits: [{start: at(' x="1"'), end: at(' x="1"') + 6, text: ''}]},
    {name: 'edit inside a raw region (general path)', edits: [{start: at('>r<'), end: at('>r<'), text: ' z=""'}]},
    {
      name: 'edit overlapping a marker (general path)',
      edits: [{start: at(' data-swc-ssr="12"'), end: at(' data-swc-ssr="12"') + 4, text: ''}],
    },
    {name: 'edit text with a marker (general path)', edits: [{start: at('>T'), end: at('>T'), text: ' data-swc-ssr="3"'}]},
    {
      name: 'overlapping edits (general path)',
      edits: [
        {start: at('<div'), end: at('<div') + 8, text: 'X'},
        {start: at('<div') + 2, end: at('<div') + 4, text: 'Y'},
      ],
    },
  ];
  for (const {name, edits} of cases) {
    for (const strip of [true, false]) {
      assert.equal(finalizeHtml(page, strip, edits), separately(page, strip, edits), `${name} (stripMarkers: ${strip})`);
    }
  }
});

test('random pages: one copy equals the separate steps', () => {
  let seed = 7;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const pieces = ['<p>', '</p>', ' data-swc-ssr="5"', 'text ', RAW_OPEN, RAW_CLOSE, '<sp-x a="1">', '<!--lit-part-->', ' '];
  for (let round = 0; round < 300; round++) {
    let page = '';
    for (let i = 0; i < 12; i++) {
      page += pieces[random(pieces.length)];
    }
    const edits: Edit[] = [];
    for (let i = random(4); i > 0; i--) {
      const start = random(page.length + 1);
      const end = Math.min(page.length, start + random(3));
      edits.push({start, end, text: random(2) ? '' : ` e${i}="v"`});
    }
    for (const strip of [true, false]) {
      assert.equal(
        finalizeHtml(page, strip, edits),
        separately(page, strip, edits),
        `${JSON.stringify(page)} ${JSON.stringify(edits)} (stripMarkers: ${strip})`
      );
    }
  }
});

/**
 * 0.3.0 review: with many raw regions after the last `data-swc-ssr` marker, every region boundary scanned for the
 * next marker to the end of the page (quadratic: 5,000 regions took about 3 s, 10,000 about 30 s; 0.2.1 needed 36 ms).
 * Ratio-based: 2N regions must take less than 3x as long as N (quadratic gives about 4x), minimum of 3 runs each,
 * with and without a marker at the very end, and with edits between the regions (each edit is checked against the
 * regions).
 */
test('many raw regions: linear in the number of regions', () => {
  const page = (regions: number, markerAtEnd: boolean) => {
    const parts = ['<sp-theme data-swc-ssr="0"><template shadowrootmode="open"><style>x</style></template>'];
    for (let i = 0; i < regions; i++) {
      parts.push(`<div id="d${i}">${'t'.repeat(100)}${RAW_OPEN}<span>node ${i}</span>${RAW_CLOSE}</div>`);
    }
    if (markerAtEnd) parts.push('<sp-button data-swc-ssr="1"></sp-button>');
    parts.push('</sp-theme>');
    return parts.join('');
  };
  /** One edit in every region's `<div>` start tag (outside the region, away from the markers). */
  const editsOf = (html: string): Edit[] => {
    const edits: Edit[] = [];
    for (let at = html.indexOf('<div id="d'); at !== -1; at = html.indexOf('<div id="d', at + 1)) {
      edits.push({start: at + 4, end: at + 4, text: ' data-e=""'});
    }
    return edits;
  };
  const once = (html: string, edits: Edit[]) => {
    const started = performance.now();
    finalizeHtml(html, true, edits);
    return performance.now() - started;
  };
  // Unit test files run in parallel, so single timings are noisy: interleave the small and the large page and
  // keep the minimum of several runs for each, which is robust against bursts of load from other files.
  const timePair = (small: string, smallEdits: Edit[], large: string, largeEdits: Edit[]) => {
    let bestSmall = Infinity;
    let bestLarge = Infinity;
    for (let run = 0; run < 7; run++) {
      bestSmall = Math.min(bestSmall, once(small, smallEdits));
      bestLarge = Math.min(bestLarge, once(large, largeEdits));
    }
    return bestLarge / Math.max(bestSmall, 1);
  };
  const N = 6000;
  for (const markerAtEnd of [false, true]) {
    for (const withEdits of [false, true]) {
      const small = page(N, markerAtEnd);
      const large = page(2 * N, markerAtEnd);
      const smallEdits = withEdits ? editsOf(small) : [];
      const largeEdits = withEdits ? editsOf(large) : [];
      // correctness on the large page, against the separate steps
      assert.equal(finalizeHtml(large, true, largeEdits), separately(large, true, largeEdits));
      once(small, smallEdits); // warm-up
      once(large, largeEdits);
      const ratio = timePair(small, smallEdits, large, largeEdits);
      assert.ok(ratio < 3, `markerAtEnd ${markerAtEnd}, edits ${withEdits}: 2N/N = ${ratio.toFixed(2)} (quadratic: about 4)`);
    }
  }
});
