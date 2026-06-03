'use strict';

const assert = require('assert');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function fakeStyle(values) {
  return {
    color: values.color || 'rgb(220, 220, 220)',
    backgroundColor: values.backgroundColor || 'rgb(30, 30, 30)',
    fontSize: values.fontSize || '13px',
    fontFamily: values.fontFamily || 'system-ui',
    borderColor: values.borderColor || 'rgb(80, 80, 80)',
    getPropertyValue(name) { return values[name] || ''; }
  };
}

function fakeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    className: '',
    classList: { add() {}, remove() {} },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; },
    setAttribute(name, value) { this[name] = value; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  };
}

test('theme bridge maps computed Pulsar theme values to VSCode CSS variables', () => {
  const theme = require('../lib/utils/vscode-theme-css');
  const documentElement = fakeElement('html');
  const body = fakeElement('body');
  const workspace = fakeElement('atom-workspace');
  const editor = fakeElement('atom-text-editor');
  const button = fakeElement('button');
  const checkbox = fakeElement('input');
  checkbox.type = 'checkbox';
  const miniEditor = fakeElement('atom-text-editor');
  const pane = fakeElement('div');
  const document = {
    documentElement,
    body,
    createElement(tag) { return fakeElement(tag); },
    querySelector(selector) {
      if (selector === 'atom-workspace') return workspace;
      if (selector === 'atom-text-editor:not([mini])') return editor;
      if (selector === '.btn, button') return button;
      if (selector === '.input-text, atom-text-editor[mini]') return miniEditor;
      if (selector === 'input') return checkbox;
      if (selector === '.pane-item, atom-pane .item-views > *, atom-pane-container .item-views > *') return pane;
      return null;
    }
  };
  const window = {
    getComputedStyle(element) {
      if (element === workspace) return fakeStyle({ color: 'rgb(210, 211, 212)', backgroundColor: 'rgb(20, 21, 22)', fontSize: '14px', fontFamily: 'Pulsar UI' });
      if (element === editor) return fakeStyle({ color: 'rgb(230, 231, 232)', backgroundColor: 'rgb(10, 11, 12)', fontSize: '15px', fontFamily: 'Pulsar Mono', '--syntax-selection-color': 'rgb(60, 70, 80)' });
      if (element === button) return fakeStyle({ color: 'rgb(240, 240, 240)', backgroundColor: 'rgb(40, 41, 42)', borderColor: 'rgb(70, 71, 72)' });
      if (element === checkbox) return fakeStyle({ color: 'rgb(220, 220, 220)', backgroundColor: 'rgb(0, 128, 255)', borderColor: 'rgb(0, 128, 255)' });
      if (element === miniEditor) return fakeStyle({ color: 'rgb(220, 220, 220)', backgroundColor: 'rgb(25, 26, 27)', borderColor: 'rgb(75, 76, 77)' });
      if (element === pane) return fakeStyle({ color: 'rgb(215, 216, 217)', backgroundColor: 'rgb(18, 19, 20)', borderColor: 'rgb(88, 89, 90)' });
      return fakeStyle({});
    }
  };

  const snapshot = theme.buildPulsarThemeSnapshot({ document, window, atom: { themes: { getActiveThemeNames() { return ['one-dark-ui']; } }, config: { get(key) { if (key === 'editor.fontSize') return 17; if (key === 'editor.fontFamily') return 'Configured Mono'; } } } });
  const css = theme.buildVscodeThemeCss(snapshot);

  assert.strictEqual(snapshot.themeClass, 'vscode-dark');
  assert.match(css, /--vscode-foreground:\s*rgb\(210, 211, 212\)/);
  assert.match(css, /--vscode-editor-background:\s*rgb\(18, 19, 20\) !important/);
  assert.match(css, /--vscode-editor-foreground:\s*rgb\(230, 231, 232\)/);
  assert.match(css, /--vscode-font-size:\s*17px/);
  assert.match(css, /--vscode-chat-font-size:\s*17px/);
  assert.match(css, /--vscode-font-family:\s*Configured Mono/);
  assert.match(css, /--vscode-editor-font-family:\s*Configured Mono/);
  assert.match(css, /--app-primary-border-color:\s*rgb\(88, 89, 90\)/);
  assert.match(css, /--vscode-sideBarActivityBarTop-border:\s*rgb\(88, 89, 90\)/);
  assert.match(css, /--vscode-inlineChatInput-border:\s*rgb\(75, 76, 77\)/);
  assert.match(css, /--vscode-inputOption-activeBorder:\s*rgb\(88, 89, 90\)/);
  assert.match(css, /--app-input-background:\s*rgb\(25, 26, 27\)/);
  assert.match(css, /--vscode-input-background:\s*rgb\(25, 26, 27\)/);
  assert.doesNotMatch(css, /--(?:app-input-background|vscode-input-background):\s*rgb\(0, 128, 255\)/);
  assert.match(css, /--vscode-editor-background:\s*rgb\(18, 19, 20\) !important/);
  assert.match(css, /--vscode-button-background:\s*rgb\(40, 41, 42\)/);
  assert.match(css, /--base-background-color:\s*rgb\(20, 21, 22\)/);
});

test('theme bridge injects nonced CSS, body class, and CSP style nonce into webview HTML', () => {
  const theme = require('../lib/utils/vscode-theme-css');
  const html = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-abc123\';"></head><body class="existing"><script nonce="abc123">window.started = true;</script></body></html>';
  const css = ':root{--vscode-foreground: rgb(1, 2, 3); --vscode-editor-background: rgb(4, 5, 6);}';

  const injected = theme.injectThemeIntoHtml(html, { css, themeClass: 'vscode-dark', nonce: 'abc123' });

  assert.match(injected, /<style id="pulsar-vscode-compat-theme" nonce="abc123">/);
  assert.match(injected, /class="existing vscode-dark"/);
  assert.match(injected, /style-src 'nonce-abc123' file:/);
  assert.ok(injected.indexOf('pulsar-vscode-compat-theme') < injected.indexOf('window.started'));
});

test('theme bridge updates host document CSS variables without iframe reload', () => {
  const theme = require('../lib/utils/vscode-theme-css');
  const head = fakeElement('head');
  const document = {
    head,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    createElement(tag) { return fakeElement(tag); },
    getElementById(id) { return head.children.find(child => child.id === id) || null; },
    querySelector(selector) { return selector === 'head' ? head : null; }
  };

  const unsafeCss = ':root, body { --vscode-foreground: red !important; --app-input-background: rgb(1, 2, 3) !important; --base-background-color: stale-base !important; --pane-item-background-color: stale-pane !important; }\nbody { font-size: 17px !important; background-color: red !important; }';
  const style = theme.applyHostThemeCss(document, unsafeCss);
  assert.strictEqual(head.children.length, 1);
  assert.strictEqual(style.textContent, ':root { --vscode-foreground: red !important; --app-input-background: rgb(1, 2, 3) !important; }');
  assert.doesNotMatch(style.textContent, /body\s*\{/);
  assert.doesNotMatch(style.textContent, /font-size:\s*17px/);
  assert.doesNotMatch(style.textContent, /--base-background-color/);
  assert.doesNotMatch(style.textContent, /--pane-item-background-color/);

  const updated = theme.applyHostThemeCss(document, ':root{--vscode-foreground: blue; --base-background-color: stale-base;} body { font-size: 22px !important; }');
  assert.strictEqual(head.children.length, 1);
  assert.strictEqual(updated, style);
  assert.strictEqual(style.textContent, ':root { --vscode-foreground: blue; }');
});
