/**
 * (a) The DOM shim installs (idempotently), keeps Lit in server mode, and provides the extras with safe
 * defaults.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  installSpectrumDomShim,
  isSpectrumDomShimInstalled,
  setRafSink,
  setRandomSource,
  ServerElement,
  ServerText,
} from '../src/dom-shim/index.ts';

installSpectrumDomShim();
installSpectrumDomShim(); // idempotent

const {isServer, LitElement, html} = await import('lit');

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

test('shim is installed and Lit stays in server mode', () => {
  assert.equal(isSpectrumDomShimInstalled(), true);
  assert.equal(isServer, true);
  assert.equal(typeof g.customElements?.define, 'function');
  assert.equal(g.window, globalThis);
  assert.equal(g.Node.ELEMENT_NODE, 1);
  assert.equal(g.Node.DOCUMENT_FRAGMENT_NODE, 11);
  for (const name of ['KeyboardEvent', 'FocusEvent', 'MouseEvent', 'PointerEvent', 'InputEvent', 'TransitionEvent']) {
    assert.equal(typeof g[name], 'function', name);
  }
  assert.equal(typeof g.matchMedia('(min-width: 1px)').addEventListener, 'function');
  assert.equal(g.getComputedStyle(new ServerElement('div')).direction, 'ltr');
  assert.equal(typeof g.CSS.supports, 'function');
  assert.ok(g.document.documentElement && g.document.body && g.document.head);
  assert.equal(g.document.activeElement, null);
});

test('light-DOM API defaults never throw on elements without tree information', () => {
  class XProbe extends LitElement {
    found: unknown = 'unset';
    constructor() {
      super();
      // what @spectrum-web-components/shared/src/observe-slot-presence.js does in its constructor
      this.found = this.querySelector(':scope > [slot="icon"]');
    }
    override render() {
      return html`<slot></slot>`;
    }
  }
  customElements.define('x-probe', XProbe);
  const element = new XProbe() as any;
  assert.equal(element.found, null);
  assert.deepEqual([...element.querySelectorAll('*')], []);
  assert.deepEqual([...element.children], []);
  assert.deepEqual([...element.childNodes], []);
  assert.equal(element.textContent, '');
  assert.equal(element.parentElement, null);
  assert.equal(element.assignedSlot, null);
  assert.equal(element.closest('x-probe'), element);
  assert.equal(element.matches('x-probe'), true);
  assert.equal(element.isConnected, false);
  assert.equal(element.getBoundingClientRect().width, 0);
  element.focus();
  element.blur();
  element.scrollIntoView();
});

test('attribute facades: id, classList, dataset, style, hidden, tabIndex', () => {
  const element = new ServerElement('div') as any;
  element.id = 'a';
  assert.equal(element.getAttribute('id'), 'a');
  element.classList.add('one', 'two');
  element.classList.toggle('one');
  assert.equal(element.getAttribute('class'), 'two');
  assert.equal(element.classList.contains('two'), true);
  element.dataset.fooBar = 'x';
  assert.equal(element.getAttribute('data-foo-bar'), 'x');
  assert.deepEqual(Object.keys(element.dataset), ['fooBar']);
  element.style.setProperty('--swc-x', '1px');
  element.style.display = 'none';
  assert.equal(element.style.getPropertyValue('display'), 'none');
  assert.match(element.getAttribute('style'), /--swc-x: 1px;/);
  element.hidden = true;
  assert.equal(element.hasAttribute('hidden'), true);
  element.tabIndex = 2;
  assert.equal(element.getAttribute('tabindex'), '2');
  assert.deepEqual(element.getAttributeNames().sort(), ['class', 'data-foo-bar', 'hidden', 'id', 'style', 'tabindex']);
});

test('detached nodes support structure, cloning, innerHTML and selectors', () => {
  const root = g.document.createElement('div');
  root.innerHTML = '<span class="a" slot="icon">x</span><b>y</b> z';
  assert.equal(root.childNodes.length, 3);
  assert.equal(root.querySelector(':scope > [slot="icon"]').localName, 'span');
  assert.equal(root.querySelectorAll('b, span').length, 2);
  assert.equal(root.textContent, 'xy z');
  const clone = root.cloneNode(true);
  assert.equal(clone.innerHTML, '<span class="a" slot="icon">x</span><b>y</b> z');
  assert.equal(clone.firstElementChild.nextElementSibling.localName, 'b');
  assert.equal(root.querySelector('span').closest('div'), root);
  const text = new ServerText('t') as any;
  root.appendChild(text);
  assert.equal(text.parentNode, root);
  assert.equal(g.document.createElement('button') instanceof g.HTMLButtonElement, true);
});

test('requestAnimationFrame queues into the active sink and is dropped otherwise', () => {
  const entries: Array<{id: number; callback: FrameRequestCallback}> = [];
  let ran = 0;
  g.requestAnimationFrame(() => ran++); // no sink: dropped
  const previous = setRafSink({push: (entry) => entries.push(entry), cancel: () => {}});
  try {
    g.requestAnimationFrame(() => ran++);
  } finally {
    setRafSink(previous);
  }
  assert.equal(entries.length, 1);
  assert.equal(ran, 0);
  entries[0].callback(0);
  assert.equal(ran, 1);
});

test('crypto.getRandomValues is deterministic only while a random source is set', () => {
  const previous = setRandomSource((array) => array.fill(7));
  let fixed: Uint8Array;
  try {
    fixed = g.crypto.getRandomValues(new Uint8Array(4));
  } finally {
    setRandomSource(previous);
  }
  assert.deepEqual([...fixed], [7, 7, 7, 7]);
  const random = g.crypto.getRandomValues(new Uint8Array(16));
  assert.notDeepEqual([...random], new Array(16).fill(7));
});

test('event listeners are called with `this` = the current target', () => {
  const element = new ServerElement('div') as any;
  let receiver: unknown;
  function listener(this: unknown) {
    receiver = this;
  }
  element.addEventListener('ping', listener);
  element.dispatchEvent(new Event('ping'));
  assert.equal(receiver, element);
  receiver = undefined;
  element.removeEventListener('ping', listener);
  element.dispatchEvent(new Event('ping'));
  assert.equal(receiver, undefined);
});
