/**
 * spectrum-web-components-ssr/client, theme-upgrade.ts, on fakes: `Element.prototype.attachShadow` hands an `<sp-theme>`
 * its existing (declarative) shadow root back instead of letting the browser empty it, swallows the one default
 * `<slot>` the Theme constructor appends next, and removes the server's complete theme CSS once the theme adopted its
 * sheets. Everything else reaches the native method.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeEl {
  readonly nodeType = 1;
  removed = false;
  private readonly attributes = new Map<string, string>();
  constructor(
    readonly localName: string,
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  remove(): void {
    this.removed = true;
  }
}

class FakeFragment {
  readonly nodeType = 11;
  constructor(readonly childNodes: unknown[]) {}
}

class FakeShadowRoot {
  children: FakeEl[] = [];
  adoptedStyleSheets: unknown[] = [];
  get childNodes(): FakeEl[] {
    return this.children;
  }
  appendChild<T>(node: T): T {
    if (node instanceof FakeFragment) this.children.push(...(node.childNodes as FakeEl[]));
    else this.children.push(node as unknown as FakeEl);
    return node;
  }
}

const nativeCalls: string[] = [];
class FakeElement {
  shadowRoot: FakeShadowRoot | null = null;
  updateComplete?: Promise<unknown>;
  constructor(readonly localName: string) {}
  attachShadow(init: {mode: string}): FakeShadowRoot {
    nativeCalls.push(`${this.localName}:${init.mode}`);
    this.shadowRoot = new FakeShadowRoot();
    return this.shadowRoot;
  }
}
(globalThis as any).Element = FakeElement;
(globalThis as any).CSSStyleSheet ??= class CSSStyleSheet {};

const {keepThemeShadowRoots} = await import('../src/client/theme-upgrade.ts');
keepThemeShadowRoots();
keepThemeShadowRoots(); // idempotent

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** An <sp-theme> as the server leaves it: a declarative root with the theme's styles and a slot, then what Spectrum's constructor does. */
function serverTheme(styles: FakeEl[]): {host: FakeElement; root: FakeShadowRoot; slot: FakeEl} {
  const host = new FakeElement('sp-theme');
  const root = new FakeShadowRoot();
  const slot = new FakeEl('slot');
  root.children.push(...styles, slot);
  host.shadowRoot = root;
  return {host, root, slot};
}

test('sp-theme keeps its declarative shadow root and the slot the constructor appends is dropped', async () => {
  const style = new FakeEl('style');
  const {host, root, slot} = serverTheme([style]);
  nativeCalls.length = 0;
  const returned = (host as any).attachShadow({mode: 'open'}); // what Theme's constructor does ...
  assert.equal(returned, root, 'the existing root is returned');
  assert.deepEqual(nativeCalls, [], 'the native attachShadow (which would empty the root) is not called');
  returned.appendChild(new FakeFragment([new FakeEl('slot')])); // ... followed by appendChild(importNode(template.content))
  assert.deepEqual(root.children, [style, slot], 'the server slot stays the only slot');
  assert.equal(Object.hasOwn(root, 'appendChild'), false, 'the one-shot override removed itself');
  const later = new FakeEl('style');
  root.appendChild(later);
  assert.equal(root.children.at(-1), later, 'later appends go through');
});

test('a slot appended when the root has none (or a non-slot node) goes through; the override expires with the microtask', async () => {
  const {host, root} = serverTheme([]);
  root.children.length = 0; // no slot at all
  (host as any).attachShadow({mode: 'open'});
  const slot = new FakeEl('slot');
  root.appendChild(slot);
  assert.deepEqual(root.children, [slot]);

  const second = serverTheme([]);
  (second.host as any).attachShadow({mode: 'open'});
  await tick();
  assert.equal(Object.hasOwn(second.root, 'appendChild'), false, 'nothing appended: the override still expires');
  const extra = new FakeEl('slot');
  second.root.appendChild(extra);
  assert.deepEqual(second.root.children, [second.slot, extra], 'after the constructor, appends are not intercepted');
});

test('other elements, closed roots and hosts without a root reach the native attachShadow', () => {
  nativeCalls.length = 0;
  const other = new FakeElement('x-other');
  other.shadowRoot = new FakeShadowRoot();
  const otherRoot = (other as any).attachShadow({mode: 'open'});
  assert.notEqual(otherRoot, undefined);
  const fresh = new FakeElement('sp-theme');
  (fresh as any).attachShadow({mode: 'open'});
  const closed = serverTheme([]);
  (closed.host as any).attachShadow({mode: 'closed'});
  assert.deepEqual(nativeCalls, ['x-other:open', 'sp-theme:open', 'sp-theme:closed']);
});

test('the server theme CSS goes once the theme adopted its sheets (an unbridged theme: all of it)', async () => {
  const complete = new FakeEl('style');
  const linkComplete = new FakeEl('link', {rel: 'stylesheet', 'data-swc-styles': 'complete'});
  const trimmed = new FakeEl('style', {'data-swc-styles': 'trimmed'});
  const minified = new FakeEl('style', {'data-swc-styles': 'minified'});
  const {host, root} = serverTheme([complete, linkComplete, trimmed, minified]);
  (host as any).attachShadow({mode: 'open'});
  // Theme.shouldAdoptStyles(): updateComplete resolves after adoptStyles() assigned adoptedStyleSheets.
  host.updateComplete = Promise.resolve().then(() => {
    root.adoptedStyleSheets = [{}];
  });
  await tick();
  assert.deepEqual(
    [complete.removed, linkComplete.removed, trimmed.removed, minified.removed],
    [true, true, true, true],
    'nothing depends on an unbridged theme: all of its server CSS goes (a bridged one keeps its trimmed / minified CSS until dropBridges)',
  );
});

test('a theme that adopted nothing keeps its server CSS', async () => {
  const complete = new FakeEl('style');
  const {host} = serverTheme([complete]);
  (host as any).attachShadow({mode: 'open'});
  host.updateComplete = Promise.resolve();
  await tick();
  assert.equal(complete.removed, false);
});
