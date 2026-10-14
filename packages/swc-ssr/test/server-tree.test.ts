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
