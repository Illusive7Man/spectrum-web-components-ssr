/**
 * swc-ssr/client: which elements hydrateSpectrum() collects, waits for and reports on (H2: not only `sp-*` tags, e.g.
 * Spectrum's `<overlay-trigger>`), and which declarative shadow roots the hydration hooks treat as server-rendered
 * (L6). Pure logic over DOM-like shapes, no browser needed.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  hasServerMarkers,
  isCustomElementName,
  isHydrationCandidate,
  tagsToDefine,
  type ElementLike,
} from '../src/client/elements.ts';

const el = (localName: string, options: {defer?: boolean; shadowRoot?: boolean} = {}): ElementLike => ({
  localName,
  hasAttribute: (name: string) => name === 'defer-hydration' && options.defer === true,
  shadowRoot: options.shadowRoot ? {} : null,
});

const nothingDefined = () => false;

test('custom element names: a hyphen, a lowercase first letter, not reserved', () => {
  for (const name of ['overlay-trigger', 'sp-button', 'app-root', 'x-a', 'my-element-2']) {
    assert.equal(isCustomElementName(name), true, name);
  }
  for (const name of ['div', 'section', 'font-face', 'annotation-xml', 'missing-glyph', '-x', '1-x', 'Sp-button']) {
    assert.equal(isCustomElementName(name), false, name);
  }
});

test('overlay-trigger is a candidate like sp-* elements (deferred, server-rendered or defined)', () => {
  // Server output with deferHydration: true - the case the agnostic path used to leave deferred.
  assert.equal(isHydrationCandidate(el('overlay-trigger', {defer: true}), nothingDefined), true);
  // deferHydration: false - a declarative shadow root, no defer-hydration.
  assert.equal(isHydrationCandidate(el('overlay-trigger', {shadowRoot: true}), nothingDefined), true);
  // Client-rendered and defined.
  assert.equal(isHydrationCandidate(el('overlay-trigger'), (name) => name === 'overlay-trigger'), true);
  // sp-* elements stay candidates even before they have a shadow root (definition still loading).
  assert.equal(isHydrationCandidate(el('sp-button'), nothingDefined), true);
});

test('framework component hosts that are never defined are not candidates (nothing to wait for)', () => {
  assert.equal(isHydrationCandidate(el('app-root'), nothingDefined), false);
  assert.equal(isHydrationCandidate(el('div'), nothingDefined), false);
  assert.equal(isHydrationCandidate(el('font-face', {shadowRoot: true}), () => true), false);
  // ... unless the server marked them for hydration.
  assert.equal(isHydrationCandidate(el('app-root', {defer: true}), nothingDefined), true);
});

test('tagsToDefine: candidate custom element tags only, de-duplicated, in document order', () => {
  const tags = tagsToDefine(
    [
      el('div'),
      el('sp-theme', {defer: true}),
      el('overlay-trigger', {defer: true}),
      el('app-root'),
      el('sp-button', {defer: true}),
      el('overlay-trigger', {defer: true}),
      el('div', {defer: true}), // not a valid custom element name: whenDefined() would reject
    ],
    nothingDefined,
  );
  assert.deepEqual(tags, ['sp-theme', 'overlay-trigger', 'sp-button']);
});

test('hasServerMarkers: a <!--lit-part--> comment among the shadow root children', () => {
  const comment = (data: string) => ({nodeType: 8, data});
  const style = {nodeType: 1};
  const text = {nodeType: 3, data: 'lit-part looks like a marker but is text'};
  assert.equal(hasServerMarkers({childNodes: [style, comment('lit-part AbC=='), comment('/lit-part')]}), true);
  assert.equal(hasServerMarkers({childNodes: [comment('lit-part')]}), true); // non-template render result
  assert.equal(hasServerMarkers({childNodes: [style, text, comment('just a comment')]}), false);
  assert.equal(hasServerMarkers({childNodes: []}), false);
});
