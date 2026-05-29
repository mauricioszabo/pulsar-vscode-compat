'use strict';

const assert = require('assert');
const fs = require('fs');
const { fileURLToPath } = require('url');

function fakeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    classList: { add() {}, remove() {} },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    setAttribute() {},
    removeAttribute(name) { delete this[name]; },
    dataset: {},
    contentWindow: { postMessage() {} }
  };
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
  global.document = { createElement: fakeElement };
  global.window = { addEventListener() {} };
  let blobUrlCreated = false;
  global.Blob = class Blob { constructor(parts, options) { this.parts = parts; this.options = options; } };
  global.URL = { createObjectURL() { blobUrlCreated = true; return 'blob:test'; } };
  global.atom = {
    workspace: {
      addOpener(opener) { openers.push(opener); return { dispose() {} }; },
      open(target, options) { openCalls.push([target, options]); return Promise.resolve(target); },
      getActivePaneItem() { return null; },
      paneForItem() { return null; }
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
  assert.match(renderedHtml, /font-src file: data:/);
  assert.strictEqual(blobUrlCreated, false);

  panel.reveal();
  assert.strictEqual(openCalls.length, 2);
  assert.strictEqual(openCalls[1][0], openCalls[0][0]);
});
