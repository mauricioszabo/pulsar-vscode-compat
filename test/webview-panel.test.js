'use strict';

const assert = require('assert');
const fs = require('fs');
const { fileURLToPath } = require('url');

function fakeElement(tag) {
  const element = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    attributes: {},
    className: '',
    classList: {
      add(name) { element.className = [element.className, name].filter(Boolean).join(' '); },
      remove(name) { element.className = element.className.split(/\s+/).filter(value => value && value !== name).join(' '); }
    },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = value; this[name] = value; },
    removeAttribute(name) { delete this[name]; delete this.attributes[name]; },
    dataset: {},
    contentWindow: {
      messages: [],
      postMessage(message) { this.messages.push(message); }
    }
  };
  return element;
}

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

test('createWebviewPanel opens a registered pane-item URI instead of a raw object', () => {
  const openCalls = [];
  const openers = [];
  const themeListeners = [];
  global.document = {
    createElement: fakeElement,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    querySelector(selector) {
      if (selector === 'atom-workspace') return this.body;
      if (selector === 'atom-text-editor:not([mini])') return null;
      return null;
    },
    getElementById() { return null; }
  };
  global.window = {
    addEventListener() {},
    getComputedStyle() {
      return {
        color: 'rgb(220, 221, 222)',
        backgroundColor: 'rgb(30, 31, 32)',
        fontSize: '13px',
        fontFamily: 'system-ui',
        borderColor: 'rgb(70, 71, 72)',
        getPropertyValue(name) {
          if (name === '--syntax-background-color') return 'rgb(10, 11, 12)';
          if (name === '--syntax-text-color') return 'rgb(230, 231, 232)';
          return '';
        }
      };
    }
  };
  let blobUrlCreated = false;
  global.Blob = class Blob { constructor(parts, options) { this.parts = parts; this.options = options; } };
  global.URL = { createObjectURL() { blobUrlCreated = true; return 'blob:test'; } };
  global.atom = {
    workspace: {
      addOpener(opener) { openers.push(opener); return { dispose() {} }; },
      open(target, options) { openCalls.push([target, options]); return Promise.resolve(target); },
      getActivePaneItem() { return null; },
      paneForItem() { return null; }
    },
    themes: {
      getActiveThemeNames() { return ['one-dark-ui']; },
      onDidChangeActiveThemes(callback) { themeListeners.push(callback); return { dispose() {} }; }
    }
  };

  const windowApi = require('../lib/namespaces/window');
  const panel = windowApi.createWebviewPanel('claudeVSCodePanel', 'Claude', { viewColumn: 1 }, { enableScripts: true });

  assert.strictEqual(typeof panel.webview.postMessage, 'function');
  assert.strictEqual(panel.webview.cspSource, 'file:');
  assert.strictEqual(openCalls.length, 1);
  assert.strictEqual(typeof openCalls[0][0], 'string');
  assert.match(openCalls[0][0], /^pulsar:\/\/pulsar-vscode-compat\/webview\//);
  const paneElement = openers[0](openCalls[0][0]).getElement();
  assert.strictEqual(typeof paneElement, 'object');
  assert.match(paneElement.style.cssText, /min-height:0/);
  assert.strictEqual(typeof paneElement.children[0], 'object');
  panel.webview.html = '<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-abc123\';"><script nonce="abc123">window.beforeModule = true;</script></head><body><script nonce="abc123" type="module">window.appStarted = typeof acquireVsCodeApi === "function";</script>Claude</body></html>';
  const iframe = paneElement.children[0];
  assert.strictEqual(iframe.sandbox, 'allow-scripts allow-same-origin');
  assert.match(iframe.style.cssText, /height:100%/);
  assert.ok(!Object.prototype.hasOwnProperty.call(iframe, 'srcdoc'));
  assert.match(iframe.src, /^file:\/\/.*\/pulsar-vscode-compat-webviews\/webview-\d+\.html$/);
  const renderedHtml = fs.readFileSync(fileURLToPath(iframe.src), 'utf8');
  assert.match(renderedHtml, /<script nonce="abc123">\(function\(\) \{/);
  assert.doesNotMatch(renderedHtml, /src="file:\/\/.*\/lib\/webview-api\.js/);
  assert.ok(renderedHtml.indexOf('globalThis.acquireVsCodeApi') < renderedHtml.indexOf('window.appStarted'));
  assert.match(renderedHtml, /<meta charset="utf-8">/);
  assert.match(renderedHtml, /<title>Claude<\/title>/);
  assert.match(renderedHtml, /<style id="pulsar-vscode-compat-theme" nonce="abc123">/);
  assert.match(renderedHtml, /--vscode-foreground:\s*rgb\(220, 221, 222\)/);
  assert.match(renderedHtml, /--vscode-editor-background:\s*rgb\(30, 31, 32\) !important/);
  assert.match(renderedHtml, /class="vscode-dark"/);
  assert.ok(renderedHtml.indexOf('pulsar-vscode-compat-theme') < renderedHtml.indexOf('window.beforeModule'));
  assert.match(renderedHtml, /style-src 'nonce-abc123' file:/);
  assert.match(renderedHtml, /font-src file: data:/);
  assert.strictEqual(blobUrlCreated, false);

  assert.strictEqual(themeListeners.length, 1);
  themeListeners[0]();
  assert.strictEqual(iframe.contentWindow.messages.length, 1);
  assert.strictEqual(iframe.contentWindow.messages[0].type, 'pulsar-vscode-compat:update-theme');
  assert.match(iframe.contentWindow.messages[0].css, /--vscode-editor-background/);
  assert.strictEqual(iframe.contentWindow.messages[0].themeClass, 'vscode-dark');

  panel.reveal();
  assert.strictEqual(openCalls.length, 2);
  assert.strictEqual(openCalls[1][0], openCalls[0][0]);
});

test('webview panels honor ViewColumn splits, reveal targets, viewColumn, and tabGroups', () => {
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith('/lib/namespaces/window.js') || key.endsWith('/lib/vscode.js')) delete require.cache[key];
  }

  const openCalls = [];
  const openers = [];
  const paneItems = new Map();
  const panes = [];
  const makePane = () => {
    const pane = {
      items: [],
      getItems() { return this.items; },
      getActiveItem() { return this.items[this.items.length - 1] || null; }
    };
    panes.push(pane);
    return pane;
  };
  const firstPane = makePane();
  let activePane = firstPane;

  global.document = {
    createElement: fakeElement,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    hasFocus() { return true; },
    querySelector(selector) {
      if (selector === 'atom-workspace') return this.body;
      if (selector === 'atom-text-editor:not([mini])') return null;
      return null;
    },
    getElementById() { return null; }
  };
  global.window = {
    addEventListener() {},
    getComputedStyle() {
      return {
        color: 'rgb(220, 221, 222)',
        backgroundColor: 'rgb(30, 31, 32)',
        fontSize: '13px',
        fontFamily: 'system-ui',
        borderColor: 'rgb(70, 71, 72)',
        getPropertyValue() { return ''; }
      };
    }
  };
  global.atom = {
    workspace: {
      addOpener(opener) { openers.push(opener); return { dispose() {} }; },
      open(target, options) {
        openCalls.push([target, options]);
        const item = openers[0](target);
        let pane = activePane;
        if (options && options.split === 'right') pane = makePane();
        pane.items.push(item);
        paneItems.set(item, pane);
        activePane = pane;
        return Promise.resolve(item);
      },
      getActivePane() { return activePane; },
      getActivePaneItem() { return activePane.getActiveItem(); },
      getPanes() { return panes; },
      paneForItem(item) { return paneItems.get(item) || null; }
    },
    themes: {
      getActiveThemeNames() { return ['one-dark-ui']; },
      onDidChangeActiveThemes() { return { dispose() {} }; }
    }
  };

  const vscode = require('../lib/vscode');
  const panel = vscode.window.createWebviewPanel('claudeVSCodePanel', 'Claude', vscode.ViewColumn.Beside, { enableScripts: true });

  assert.strictEqual(openCalls.length, 1);
  assert.strictEqual(openCalls[0][1].split, 'right');
  assert.strictEqual(openCalls[0][1].searchAllPanes, false);
  assert.strictEqual(panel.viewColumn, vscode.ViewColumn.Two);

  const groups = vscode.window.tabGroups.all;
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[1].viewColumn, vscode.ViewColumn.Two);
  assert.strictEqual(groups[1].tabs.length, 1);
  assert.ok(groups[1].tabs[0].input instanceof vscode.TabInputWebview);
  assert.strictEqual(groups[1].tabs[0].input.viewType, 'claudeVSCodePanel');
  assert.strictEqual(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two);

  panel.reveal(vscode.ViewColumn.Active, true);
  assert.strictEqual(openCalls.length, 2);
  assert.strictEqual(openCalls[1][1].split, undefined);
  assert.strictEqual(openCalls[1][1].activatePane, false);
  assert.strictEqual(openCalls[1][1].searchAllPanes, true);
});
