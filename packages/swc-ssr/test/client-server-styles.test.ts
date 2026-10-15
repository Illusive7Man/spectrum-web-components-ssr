/**
 * swc-ssr/client's handling of the server's `<style>`s (`src/client/server-styles.ts`) on fakes, without a browser
 * (Node has no `ShadowRoot`: the module takes its path for browsers without constructable stylesheets).
 *  - L3 (0.2.1): on a page without marked `<style>`s, an unmarked server `<style>` counts as partial only when its text
 *    is not the class's `elementStyles` text. That comparison used to concatenate and compare the complete CSS of
 *    every hydrated element (about 18 ms on the whole catalog); now the lengths are compared first and the text once
 *    per class.
 *  - The fallback still finds server CSS that differs (here: shorter, as after a build-time renamer on one side), and
 *    the path without constructable stylesheets then writes the class's complete text into the server `<style>`.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

(globalThis as any).CSSStyleSheet ??= class CSSStyleSheet {};
const {afterHydratingUpdate} = await import('../src/client/server-styles.ts');

let textReads = 0;

class FakeStyle {
  readonly nodeType = 1;
  readonly localName = 'style';
  removed = false;
  private readonly attributes = new Map<string, string>();
  constructor(private text: string) {}
  get firstChild(): {nodeType: number; length: number; nextSibling: null} {
    return {nodeType: 3, length: this.text.length, nextSibling: null};
  }
  get textContent(): string {
    textReads++;
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
  }
  get value(): string {
    return this.text;
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
}

const sheetA = [{cssText: ':host{display:block}'}, {cssText: '#a{color:var(--spectrum-gray-800)}'}];
const sheetB = [{cssText: ':host{display:inline-flex}#b{margin:var(--spectrum-spacing-100)}'}];
class FakeA {
  static elementStyles = sheetA;
}
class FakeB {
  static elementStyles = sheetB;
}
const fullText = (styles: Array<{cssText: string}>) => styles.map((style) => style.cssText).join('');

/** A hydrated instance of `ctor` whose declarative shadow root holds one server `<style>` with `text`. */
function hydratedElement(ctor: new () => object, text: string): {element: any; style: FakeStyle} {
  const style = new FakeStyle(text);
  const element: any = new ctor();
  element.localName = 'x-fake';
  element.shadowRoot = {childNodes: [style, {nodeType: 8, data: 'lit-part abc'}]};
  afterHydratingUpdate(element);
  return {element, style};
}

test('L3: complete unmarked server CSS is compared as text once per class, not once per element', () => {
  textReads = 0;
  const styles: FakeStyle[] = [];
  for (let i = 0; i < 40; i++) {
    styles.push(hydratedElement(FakeA, fullText(sheetA)).style);
    styles.push(hydratedElement(FakeB, fullText(sheetB)).style);
  }
  assert.ok(textReads <= 2, `server text read ${textReads} times for 80 elements of 2 classes`);
  for (const style of styles) {
    assert.equal(style.removed, false);
  }
  assert.equal(styles[0]!.value, fullText(sheetA), 'complete server CSS is left alone');
});

test('L3: server CSS of another length is partial without reading it, and gets the complete text', () => {
  textReads = 0;
  const renamed = fullText(sheetA).replace('--spectrum-gray-800', '--a');
  const {style} = hydratedElement(FakeA, renamed);
  assert.equal(textReads, 0, 'lengths differ: no text comparison');
  assert.equal(style.value, fullText(sheetA), 'the class text replaces the partial server CSS');
  assert.equal(style.removed, false);
});
