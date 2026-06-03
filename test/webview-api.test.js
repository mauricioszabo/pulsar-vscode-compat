'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

test('webview API shim makes AbortSignal acceptable to events.setMaxListeners fallback', () => {
  const events = {
    calls: [],
    setMaxListeners(maxListeners, ...targets) {
      this.calls.push([maxListeners, targets]);
      const target = targets[0];
      if (target && typeof target.setMaxListeners === 'function') return target.setMaxListeners(maxListeners);
      throw new TypeError('The "eventTargets" argument must be an instance of EventEmitter or EventTarget. Received an instance of AbortSignal');
    }
  };
  class AbortSignal {
    addEventListener() {}
    removeEventListener() {}
  }
  class AbortController {
    constructor() { this.signal = new AbortSignal(); }
  }
  function EventTarget() {}

  const context = {
    window: { parent: { postMessage() {} } },
    globalThis: null,
    AbortSignal,
    AbortController,
    EventTarget,
    Function,
    Object,
    Array,
    Symbol,
    require(name) {
      if (name === 'events' || name === 'node:events') return events;
      throw new Error(`unexpected require ${name}`);
    }
  };
  context.globalThis = context;
  context.window.acquireVsCodeApi = undefined;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'webview-api.js'), 'utf8');
  vm.runInContext(source, context);

  const signal = new context.AbortController().signal;
  assert.strictEqual(typeof signal.setMaxListeners, 'function');
  assert.doesNotThrow(() => events.setMaxListeners(20, signal));
  assert.strictEqual(typeof context.acquireVsCodeApi, 'function');
});

test('webview API shim applies live theme update messages', () => {
  let messageListener;
  const styleElement = { id: '', textContent: '' };
  const bodyClasses = [];
  const rootProperties = [];
  const bodyProperties = [];
  const context = {
    window: {
      parent: { postMessage() {} },
      addEventListener(type, listener) { if (type === 'message') messageListener = listener; }
    },
    document: {
      head: { appendChild(element) { this.child = element; } },
      documentElement: {
        style: { setProperty(name, value, priority) { rootProperties.push([name, value, priority]); } }
      },
      body: {
        style: { setProperty(name, value, priority) { bodyProperties.push([name, value, priority]); } },
        classList: {
          add(value) { bodyClasses.push(value); },
          remove(value) {
            const index = bodyClasses.indexOf(value);
            if (index >= 0) bodyClasses.splice(index, 1);
          }
        }
      },
      getElementById() { return null; },
      createElement(tag) { return tag === 'style' ? styleElement : {}; }
    },
    globalThis: null,
    require(name) { throw new Error(`unexpected require ${name}`); }
  };
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'webview-api.js'), 'utf8');
  vm.runInContext(source, context);

  assert.strictEqual(typeof messageListener, 'function');
  messageListener({ data: { type: 'pulsar-vscode-compat:update-theme', css: ':root{--vscode-foreground:red; --vscode-editor-background: rgb(1, 2, 3) !important;}', themeClass: 'vscode-dark' } });

  assert.strictEqual(context.document.head.child, styleElement);
  assert.strictEqual(styleElement.id, 'pulsar-vscode-compat-theme');
  assert.strictEqual(styleElement.textContent, ':root{--vscode-foreground:red; --vscode-editor-background: rgb(1, 2, 3) !important;}');
  assert.deepStrictEqual(bodyClasses, ['vscode-dark']);
  assert.deepStrictEqual(rootProperties, [
    ['--vscode-foreground', 'red', 'important'],
    ['--vscode-editor-background', 'rgb(1, 2, 3)', 'important']
  ]);
  assert.deepStrictEqual(bodyProperties, [
    ['background-color', 'var(--vscode-editor-background)', 'important'],
    ['color', 'var(--vscode-foreground)', 'important']
  ]);
});
