/**
 * Test helpers: parse SSR output with parse5 (htmlparser2 tree adapter) and inspect it.
 */
import {parseFragment} from 'parse5';
import {adapter} from 'parse5-htmlparser2-tree-adapter';
import type {AnyNode, Document, Element} from 'domhandler';

export function parseHtml(html: string): Document {
  return parseFragment(html, {treeAdapter: adapter}) as unknown as Document;
}

export const isElement = (node: AnyNode | undefined | null): node is Element =>
  !!node && (node.type === 'tag' || node.type === 'script' || node.type === 'style');

/** Walks elements in document order, descending into declarative shadow roots (template content). */
export function* walkElements(node: AnyNode): Generator<Element> {
  const children = (node as {children?: AnyNode[]}).children ?? [];
  for (const child of children) {
    if (isElement(child)) {
      yield child;
    }
    yield* walkElements(child);
  }
}

/** The declarative shadow root template of a host (first element child `<template shadowrootmode>`). */
export function shadowTemplateOf(host: Element): Element | undefined {
  const first = host.children.find(isElement);
  return first && first.name === 'template' && first.attribs.shadowrootmode !== undefined ? first : undefined;
}

/** Content root of a template (the htmlparser2 adapter stores it as the template's only child). */
export function templateContent(template: Element): AnyNode {
  return template.children[0];
}

/** Text content of a node, skipping comments and nested (shadow) templates. */
export function textOf(node: AnyNode): string {
  if (node.type === 'text') {
    return (node as {data: string}).data;
  }
  if (isElement(node) && node.name === 'template') {
    return '';
  }
  const children = (node as {children?: AnyNode[]}).children ?? [];
  return children.map(textOf).join('');
}

export function findElement(root: AnyNode, predicate: (element: Element) => boolean): Element | undefined {
  for (const element of walkElements(root)) {
    if (predicate(element)) {
      return element;
    }
  }
  return undefined;
}

export function formatReport(report: unknown): string {
  return JSON.stringify(report, null, 2);
}
