'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function fakeElement(tagName) {
  const classes = new Set();
  return {
    tagName,
    children: [],
    style: {},
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        enabled ? classes.add(name) : classes.delete(name);
        return enabled;
      }
    },
    appendChild(child) { this.children.push(child); return child; },
    textContent: ''
  };
}

global.document = { createElement: fakeElement };

const {
  createInlayHintCallout,
  setInlayHintCalloutPlacement,
  shouldPlaceInlayHintAbove
} = require('../lib/adapters/inlay-hint-adapter');

const callout = createInlayHintCallout(': float');
assert(callout.classList.contains('vscode-inlay-hint'));
assert(callout.classList.contains('vscode-inlay-hint-callout'));
assert(callout.classList.contains('below'));
assert.strictEqual(callout.style.pointerEvents, 'none');
assert.strictEqual(callout.children[0].textContent, ': float');
assert(callout.children[1].classList.contains('vscode-inlay-hint-callout-arrow'));
assert.strictEqual(callout.children[1].style.pointerEvents, 'none');
assert.match(callout.style.transform, /translateX\(-100%\)/);
assert.match(callout.style.transform, /- var\(--editor-line-height\)/, 'below placement is shifted one editor line upward');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 4), false, 'cursor on the hinted line keeps the callout below');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 5), true, 'cursor one line below moves the callout above');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 6), false, 'other cursor lines keep the callout below');

setInlayHintCalloutPlacement(callout, true);
assert(callout.classList.contains('above'));
assert(!callout.classList.contains('below'));
assert.match(callout.style.transform, /-100%/);
assert.match(callout.style.transform, /0\.15em/, 'above placement stays close to the text below it');
assert.match(callout.style.transform, /- var\(--editor-line-height\)/, 'above placement is also shifted one editor line upward');
assert.strictEqual(callout.children[1].style.bottom, '-4px');

setInlayHintCalloutPlacement(callout, false);
assert(callout.classList.contains('below'));
assert.strictEqual(callout.children[1].style.top, '-4px');

const calloutStyles = fs.readFileSync(path.join(__dirname, '../styles/inlay-hints.less'), 'utf8');
assert.match(calloutStyles, /font-family:\s*var\(--editor-font-family\)/);
assert.match(calloutStyles, /font-size:\s*var\(--editor-font-size\)/);
assert.match(calloutStyles, /color:\s*@text-color/);

console.log('inlay hints render as non-interactive callouts above or below their anchor');
