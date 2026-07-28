'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { generateWrapperMain } = require('../lib/ui/install-vsx');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wrapper-sab-'));
const wrapper = path.join(tmp, 'vscode-test-extension');
fs.mkdirSync(path.join(wrapper, 'lib'), { recursive: true });
fs.mkdirSync(path.join(wrapper, 'extension'), { recursive: true });
const compat = path.join(tmp, 'pulsar-vscode-compat');
fs.mkdirSync(path.join(compat, 'lib'), { recursive: true });
fs.writeFileSync(path.join(compat, 'lib', 'vscode.js'), `
  exports.ExtensionContext = class ExtensionContext {
    constructor() {
      this.globalState = { keys() { return []; }, get() {} };
      this.workspaceState = { keys() { return []; }, get() {} };
    }
    _dispose() {}
  };
`);
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({
  name: 'vscode-test-extension',
  _vscodeExtension: { id: 'test.shared-array-buffer', main: './index.js' }
}));
fs.writeFileSync(path.join(wrapper, 'lib', 'main.js'), generateWrapperMain());
fs.writeFileSync(path.join(wrapper, 'extension', 'index.js'), `
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  exports.waitBuffer = waitBuffer;
  exports.activate = function() { return { byteLength: waitBuffer.buffer.byteLength }; };
`);

const originalSharedArrayBuffer = global.SharedArrayBuffer;
const originalAtom = global.atom;

(async () => {
  try {
    delete global.SharedArrayBuffer;
    global.atom = {
      packages: {
        getAvailablePackageNames() { return ['pulsar-vscode-compat']; },
        isPackageDisabled() { return false; },
        activatePackage() {
          return Promise.resolve({ path: compat });
        },
        getActivePackage() { return { path: tmp }; }
      }
    };

    const main = require(path.join(wrapper, 'lib', 'main.js'));
    await main.activate({});

    assert.strictEqual(typeof global.SharedArrayBuffer, 'function');
    assert.strictEqual(global.__pulsarVscodeExtensionExports.get('test.shared-array-buffer').byteLength, 4);

    const generated = generateWrapperMain();
    const restoreSnippet = generated.match(/function _restoreSharedArrayBuffer\(\)[\s\S]*?_restoreSharedArrayBuffer\(\);/)[0];
    const rendererContext = vm.createContext({ global: {}, require, SharedArrayBuffer: undefined });
    vm.runInContext(restoreSnippet, rendererContext);
    assert.strictEqual(typeof rendererContext.SharedArrayBuffer, 'function',
      'bare renderer global should receive SharedArrayBuffer even when Node global is separate');
    new rendererContext.SharedArrayBuffer(4);

    // Real Chromium renderers gate SharedArrayBuffer per-ExecutionContext
    // (cross-origin isolation), checked at the point of use, not just as a
    // missing global. A vm.runInNewContext-recovered constructor can exist as
    // a function yet still throw when constructed back in the gated context.
    // Simulate that so the fallback polyfill path is actually exercised.
    const gatedContext = vm.createContext({
      global: {},
      require: function(id) {
        if (id === 'vm') {
          return {
            runInNewContext: function() {
              return function SharedArrayBuffer() { throw new TypeError('SharedArrayBuffer is not defined'); };
            }
          };
        }
        return require(id);
      },
      SharedArrayBuffer: undefined,
    });
    vm.runInContext(restoreSnippet, gatedContext);
    assert.strictEqual(typeof gatedContext.SharedArrayBuffer, 'function',
      'gated renderer should still receive a construct-only polyfill');
    gatedContext.__polyfilledBuffer = new gatedContext.SharedArrayBuffer(4);
    assert.strictEqual(gatedContext.__polyfilledBuffer.byteLength, 4);
    const polyfilledViewLength = vm.runInContext('new Int32Array(__polyfilledBuffer).length', gatedContext);
    assert.strictEqual(polyfilledViewLength, 1,
      'polyfill should satisfy new Int32Array(new SharedArrayBuffer(n)) call sites');

    console.log('ok - generated wrapper restores SharedArrayBuffer before loading the extension');
    console.log('ok - generated wrapper falls back to a construct-only polyfill when the recovered constructor is rejected at point of use');
  } finally {
    global.SharedArrayBuffer = originalSharedArrayBuffer;
    global.atom = originalAtom;
    delete global.__pulsarVscodeCompatApi;
    delete global.__pulsarVscodeExtensionExports;
    delete global.__pulsarVscodeExtensionActivationPromises;
    delete global.__pulsarVscodeExtensionActivationComplete;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
