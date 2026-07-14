'use strict';

const assert = require('assert');

function disposable() { return { dispose() {} }; }
function fakeElement() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    dataset: {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    textContent: '',
    innerHTML: ''
  };
}

global.document = { createElement: fakeElement };
global.atom = {
  workspace: { addOpener() { return disposable(); }, open() { return Promise.resolve(); } },
  views: { getView() { return fakeElement(); } },
  commands: { add() { return disposable(); } },
  config: { get() {}, observe() { return disposable(); }, onDidChange() { return disposable(); } }
};

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

const windowNamespace = require('../lib/namespaces/window');

test('window exposes terminal shell integration proposal events as disposable events', () => {
  assert.strictEqual(typeof windowNamespace.onDidStartTerminalShellExecution, 'function');
  assert.strictEqual(typeof windowNamespace.onDidEndTerminalShellExecution, 'function');
  assert.strictEqual(typeof windowNamespace.registerTerminalLinkProvider, 'function');

  const start = windowNamespace.onDidStartTerminalShellExecution(() => {});
  const end = windowNamespace.onDidEndTerminalShellExecution(() => {});
  const links = windowNamespace.registerTerminalLinkProvider({});
  assert.strictEqual(typeof start.dispose, 'function');
  assert.strictEqual(typeof end.dispose, 'function');
  assert.strictEqual(typeof links.dispose, 'function');
  start.dispose();
  end.dispose();
  links.dispose();
});
