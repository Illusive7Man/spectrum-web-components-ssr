/**
 * ServerTree: parse5 + htmlparser2 adapter, declarative shadow roots detached from their hosts, marker lookup,
 * css-select queries, serialization of shadow content (used for the pass-1 fallback).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ServerTree} from '../src/server/server-tree.ts';

const html =
  '<!--lit-part abc--><x-host data-swc-ssr="0" slot="a">' +
  '<template shadowroot="open" shadowrootmode="open"><style>:host{}</style><div id="wrap"><slot name="icon"></slot><slot></slot></div>' +
  '<x-inner data-swc-ssr="1"><template shadowrootmode="open"><b>inner</b></template></x-inner></template>' +
  '<span slot="icon">i</span>text<!--lit-node 3--><x-child data-swc-ssr="2" label="c"><template shadowrootmode="open"><slot></slot></template>child</x-child>' +
  '</x-host><!--/lit-part-->';

test('marked elements are indexed in construction order', () => {
  const tree = new ServerTree(html);
  assert.deepEqual(
    tree.markedNodes().map((node) => node.name),
    ['x-host', 'x-inner', 'x-child']
  );
  assert.equal(tree.byId(2)?.attribs.label, 'c');
  assert.equal(tree.idOf(tree.byId(1)!), 1);
});

test('light children exclude the declarative shadow root and comments', () => {
  const tree = new ServerTree(html);
  const children = tree.lightChildren(0);
  assert.deepEqual(
    children.map((node) => (node.type === 'text' ? `#${(node as {data: string}).data}` : (node as {name: string}).name)),
    ['span', '#text', 'x-child']
  );
  assert.equal(tree.query(tree.byId(0)!, 'template'), null);
  assert.equal(tree.query(tree.byId(0)!, '[slot="icon"]')?.name, 'span');
});

test('shadow content is reachable and queryable separately', () => {
  const tree = new ServerTree(html);
  const shadow = tree.shadowRoot(0)!;
  assert.ok(shadow);
  assert.equal(tree.hostOf(shadow), tree.byId(0));
  assert.equal(tree.isShadowRoot(shadow), true);
  assert.equal(tree.queryAll(shadow, 'slot').length, 2);
  assert.equal(tree.query(shadow, 'x-inner'), tree.byId(1));
  assert.equal(tree.query(shadow, 'b'), null, 'nested shadow roots are not part of the outer shadow');
  assert.equal(tree.query(tree.shadowRoot(1)!, 'b')?.name, 'b');
});

test('shadow serialization re-attaches nested declarative shadow roots', () => {
  const tree = new ServerTree(html);
  const markup = tree.serializeShadow(0)!;
  assert.match(markup, /^<style>:host\{\}<\/style><div id="wrap">/);
  assert.match(markup, /<x-inner data-swc-ssr="1"><template shadowrootmode="open"><b>inner<\/b><\/template><\/x-inner>$/);
});

test('whole documents are parsed as documents', () => {
  const tree = new ServerTree('<!-- c --><!doctype html><html><body><x-a data-swc-ssr="0"></x-a></body></html>');
  assert.equal(tree.byId(0)?.name, 'x-a');
});

test('source locations map back to the HTML the tree was built from (long <style> bodies replaced)', () => {
  // Render speed (0.3.0): light-mutations.ts edits the page at the offsets of the tree the renderer parsed anyway.
  const css = (n: number) => `.rule-${n} { color: red; }`.repeat(n);
  const page =
    `<x-a data-swc-ssr="0"><template shadowrootmode="open"><style>${css(9)}</style><p id="p1" class="c">a</p>` +
    `<style>.short{}</style><input type="checkbox" tabindex="0"><style>${css(40)}</style></template>` +
    `<h2 slot="heading">T</h2></x-a><style>${css(3)}</style><span title="x &amp; y">s</span>`;
  const tree = new ServerTree(page, {locations: true});
  assert.equal(tree.hasLocations, true);
  type Range = {startOffset: number; endOffset: number};
  const startTag = (node: unknown) =>
    (node as {sourceCodeLocation: {startTag: Range & {attrs: Record<string, Range>}}}).sourceCodeLocation.startTag;
  const text = (location: Range) =>
    page.slice(tree.sourceOffset(location.startOffset), tree.sourceOffset(location.endOffset));
  const shadow = tree.shadowRoot(0)!;
  assert.equal(text(startTag(tree.query(shadow, '#p1'))), '<p id="p1" class="c">');
  assert.equal(text(startTag(tree.query(shadow, '#p1')).attrs.class), 'class="c"');
  assert.equal(text(startTag(tree.query(shadow, 'input'))), '<input type="checkbox" tabindex="0">');
  assert.equal(text(startTag(tree.query(shadow, 'input')).attrs.tabindex), 'tabindex="0"');
  assert.equal(text(startTag(tree.query(tree.byId(0)!, 'h2'))), '<h2 slot="heading">');
  assert.equal(text(startTag(tree.query(tree.root, 'span'))), '<span title="x &amp; y">');
  // Without locations nothing is kept.
  assert.equal(new ServerTree(page).hasLocations, false);
});

test('the content hash covers the markup but not the long <style> bodies', () => {
  const page = (css: string, text: string) =>
    `<x-a data-swc-ssr="0"><template shadowrootmode="open"><style>${css}</style></template>${text}</x-a>`;
  const long = (color: string) => `.a { color: ${color}; }`.repeat(10);
  assert.equal(new ServerTree(page(long('red'), 'a')).contentHash, new ServerTree(page(long('blue'), 'a')).contentHash);
  assert.notEqual(new ServerTree(page(long('red'), 'a')).contentHash, new ServerTree(page(long('red'), 'b')).contentHash);
  assert.notEqual(new ServerTree(page('.a{}', 'a')).contentHash, new ServerTree(page('.b{}', 'a')).contentHash);
});
