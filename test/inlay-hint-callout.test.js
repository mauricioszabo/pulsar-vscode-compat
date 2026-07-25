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
    offsetWidth: 0,
    _closest: {},
    _rect: { left: 0, width: 0 },
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
    closest(selector) { return this._closest[selector] || null; },
    getBoundingClientRect() { return this._rect; },
    textContent: ''
  };
}

global.document = { createElement: fakeElement };

const {
  createInlayHintCallout,
  setInlayHintCalloutPlacement,
  setInlayHintCalloutEmphasis,
  shouldPlaceInlayHintAbove,
  setInlayHintOverlayZIndexAuto,
  clampInlayHintCallout
} = require('../lib/adapters/inlay-hint-adapter');

const callout = createInlayHintCallout(': float');
assert(callout.classList.contains('vscode-inlay-hint'));
assert(callout.classList.contains('vscode-inlay-hint-callout'));
assert(callout.classList.contains('below'));
assert.strictEqual(callout.style.pointerEvents, 'none');
assert.strictEqual(callout.style.visibility, 'hidden', 'callout stays hidden until the first clamp positions it');
assert.strictEqual(callout.children[0].textContent, ': float');
assert(callout.children[1].classList.contains('vscode-inlay-hint-callout-arrow'));
assert.strictEqual(callout.children[1].style.pointerEvents, 'none');
assert.match(callout.style.transform, /translateX\(-100%\)/);
assert.match(callout.style.transform, /- var\(--editor-line-height\)/, 'below placement is shifted one editor line upward');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 4), false, 'cursor on the hinted line keeps the callout below');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 5), true, 'hints above the cursor line open upward');
assert.strictEqual(shouldPlaceInlayHintAbove(4, 6), true, 'hints further above the cursor line also open upward');
assert.strictEqual(shouldPlaceInlayHintAbove(5, 4), false, 'hints below the cursor line open downward');
assert.strictEqual(shouldPlaceInlayHintAbove(4, undefined), false, 'no cursor keeps the callout below');

setInlayHintCalloutPlacement(callout, true);
assert(callout.classList.contains('above'));
assert(!callout.classList.contains('below'));
assert.match(callout.style.transform, /-100%/);
assert.match(callout.style.transform, /0\.15em/, 'above placement stays close to the text below it');
assert.match(callout.style.transform, /- var\(--editor-line-height\)/, 'above placement is also shifted one editor line upward');

setInlayHintCalloutPlacement(callout, false);
assert(callout.classList.contains('below'));

const overlay = { style: { zIndex: '4' } };
const calloutInOverlay = { closest(selector) { return selector === 'atom-overlay' ? overlay : null; } };
assert.strictEqual(setInlayHintOverlayZIndexAuto(calloutInOverlay), true);
assert.strictEqual(overlay.style.zIndex, 'auto');
assert.strictEqual(setInlayHintOverlayZIndexAuto({ closest() { return null; } }), false);

// Viewport clamping: pins escaping callouts to the editor's left edge, arrow stays on the anchor.
function calloutInEditor({ anchorLeft, anchorTop = 300, viewLeft, viewWidth, calloutWidth }) {
  const el = createInlayHintCallout('a long value');
  el.offsetWidth = calloutWidth;
  const scrollView = fakeElement('div');
  scrollView._rect = { left: viewLeft, top: 100, width: viewWidth, height: 600 };
  const editorEl = { querySelector(selector) { return selector === '.scroll-view' ? scrollView : null; } };
  const wrapper = fakeElement('atom-overlay');
  wrapper._rect = { left: anchorLeft, top: anchorTop, width: 0 };
  wrapper._closest['atom-text-editor'] = editorEl;
  el._closest['atom-overlay'] = wrapper;
  el._rect = { left: 0, top: 310, height: 22 };
  return el;
}

assert.strictEqual(clampInlayHintCallout(createInlayHintCallout('x')), false, 'no atom-overlay wrapper is a no-op');

const fitting = calloutInEditor({ anchorLeft: 610, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
assert.strictEqual(clampInlayHintCallout(fitting), true);
assert.strictEqual(fitting.style.visibility, 'visible', 'clamping reveals the callout');
assert.strictEqual(fitting._closest['atom-overlay'].style.zIndex, 'auto', 'wrapper z-index forced to auto');
assert.strictEqual(fitting._closest['atom-overlay'].style.pointerEvents, 'none', 'wrapper never swallows clicks meant for the line');
assert.match(fitting.style.transform, /translateX\(-100%\)/, 'callout that fits keeps the default shift');
assert.strictEqual(fitting.children[1].style.left, 'calc(100% - 4px)');
assert.strictEqual(fitting.style.maxWidth, '784px', 'max width leaves a margin on both sides');

const escaping = calloutInEditor({ anchorLeft: 60, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
assert.strictEqual(clampInlayHintCallout(escaping), true);
assert.match(escaping.style.transform, /translateX\(-42px\)/, 'box left edge pinned to editor margin');
assert.strictEqual(escaping.children[1].style.left, '38px', 'arrow stays under the anchor');

setInlayHintCalloutPlacement(escaping, true);
assert.match(escaping.style.transform, /translateX\(-42px\)/, 'placement changes preserve the clamp');
assert.match(escaping.style.transform, /0\.15em/);

const reclamped = escaping;
reclamped._closest['atom-overlay']._rect.left = 610;
clampInlayHintCallout(reclamped);
assert.match(reclamped.style.transform, /translateX\(-100%\)/, 'clamp is undone once the anchor fits again');
assert.strictEqual(reclamped.children[1].style.left, 'calc(100% - 4px)');

const atColumnZero = calloutInEditor({ anchorLeft: 10, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
assert.strictEqual(clampInlayHintCallout(atColumnZero), true);
assert.match(atColumnZero.style.transform, /translateX\(0px\)/, 'anchor left of the margin never shifts the box off-screen');
assert.strictEqual(atColumnZero.children[1].style.left, '2px', 'arrow never leaves the box');

// Anchors scrolled out of the editor's visible rows must not render at all (a fixed-position
// wrapper would otherwise cover the tab bar / status bar).
const scrolledAbove = calloutInEditor({ anchorLeft: 610, anchorTop: 40, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
assert.strictEqual(clampInlayHintCallout(scrolledAbove), true);
assert.strictEqual(scrolledAbove.style.visibility, 'hidden', 'anchor above the viewport hides the callout');

const scrolledBelow = calloutInEditor({ anchorLeft: 610, anchorTop: 750, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
assert.strictEqual(clampInlayHintCallout(scrolledBelow), true);
assert.strictEqual(scrolledBelow.style.visibility, 'hidden', 'anchor below the viewport hides the callout');

scrolledAbove._closest['atom-overlay']._rect.top = 300;
clampInlayHintCallout(scrolledAbove);
assert.strictEqual(scrolledAbove.style.visibility, 'visible', 'callout reappears once its anchor scrolls back into view');

// A visible anchor whose box still pokes out of the editor (e.g. flipped above the first
// visible line) must also hide instead of covering the tab bar / status bar.
const pokingAbove = calloutInEditor({ anchorLeft: 610, anchorTop: 110, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
setInlayHintCalloutPlacement(pokingAbove, true);
pokingAbove._rect = { left: 0, top: 60, height: 30 };
assert.strictEqual(clampInlayHintCallout(pokingAbove), true);
assert.strictEqual(pokingAbove.style.visibility, 'hidden', 'box escaping above the editor is hidden');

const pokingBelow = calloutInEditor({ anchorLeft: 610, anchorTop: 690, viewLeft: 10, viewWidth: 800, calloutWidth: 100 });
pokingBelow._rect = { left: 0, top: 690, height: 40 };
assert.strictEqual(clampInlayHintCallout(pokingBelow), true);
assert.strictEqual(pokingBelow.style.visibility, 'hidden', 'box escaping below the editor is hidden');

// Emphasis is expressed as classes so stylesheets decide how each state looks.
const dimmed = createInlayHintCallout(': str');
setInlayHintCalloutEmphasis(dimmed, false);
assert(dimmed.classList.contains('other-line'), 'callouts away from the cursor line get other-line');
assert(!dimmed.classList.contains('current-line'));
setInlayHintCalloutEmphasis(dimmed, true);
assert(dimmed.classList.contains('current-line'), 'the cursor line callout gets current-line');
assert(!dimmed.classList.contains('other-line'));

// All cosmetic styling lives in the stylesheet so users can override it from their own styles.
// package.json's styleSheets array makes Pulsar load ONLY the listed files — inlay-hints.less
// must be in it or none of these rules ever apply.
const packageMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
assert(packageMeta.styleSheets.includes('inlay-hints.less'), 'inlay-hints.less is registered in package.json styleSheets');

const calloutStyles = fs.readFileSync(path.join(__dirname, '../styles/inlay-hints.less'), 'utf8');
assert.doesNotMatch(calloutStyles, /@[a-z-]+-color/, 'theme LESS variables resolve against the wrong theme at compile time (and fail the whole file without an import) — keep the stylesheet self-contained');
assert.match(calloutStyles, /font-family:\s*var\(--editor-font-family\)/);
assert.match(calloutStyles, /font-size:\s*calc\(var\(--editor-font-size\)\s*\*\s*0\.8\)/, 'text scales down from the editor font size so boxes stay shorter than a line');
assert.match(calloutStyles, /background:\s*var\(--tool-panel-background-color,\s*#252525\)/, 'box keeps its own dark neutrals with a var() escape hatch');
assert.match(calloutStyles, /&\.other-line/, 'off-cursor-line emphasis is a stylesheet rule');
assert.match(calloutStyles, /&\.below \.vscode-inlay-hint-callout-arrow[\s\S]*?rotate\(45deg\)/, 'below arrow orientation is a stylesheet rule');
assert.match(calloutStyles, /&\.above \.vscode-inlay-hint-callout-arrow[\s\S]*?rotate\(225deg\)/, 'above arrow orientation is a stylesheet rule');

console.log('inlay hints render as non-interactive callouts above or below their anchor');
