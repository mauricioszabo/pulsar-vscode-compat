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
