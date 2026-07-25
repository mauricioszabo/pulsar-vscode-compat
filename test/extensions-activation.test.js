'use strict';

const assert = require('assert');

const extensionApi = {
  environments: {
    onDidChangeActiveEnvironmentPath() {}
  }
};
let resolveActivation;
const activationPromise = new Promise(resolve => { resolveActivation = resolve; });
const pkg = {
  name: 'vscode-ms-python-python',
  path: '/tmp/vscode-ms-python-python',
  metadata: {
    name: 'vscode-ms-python-python',
    _vscodeExtension: { id: 'ms-python.python' }
  },
  mainModule: { activate() {}, deactivate() {} },
  isActive() { return true; }
};

global.__pulsarVscodeExtensionExports = new Map();
global.__pulsarVscodeExtensionActiveIds = new Set();
global.__pulsarVscodeExtensionActivationPromises = new Map([
  ['ms-python.python', activationPromise]
]);
global.atom = {
  packages: {
    getActivePackage() { return pkg; },
    getLoadedPackage() { return pkg; },
    getActivePackages() { return [pkg]; },
    getLoadedPackages() { return [pkg]; },
    getAvailablePackagePaths() { return []; },
    async activatePackage() {
      throw new Error('Pulsar wrapper is already active while its VSCode activation is still pending');
    }
  }
};

const extensions = require('../lib/namespaces/extensions');

(async () => {
  const extension = extensions.getExtension('ms-python.python');
  assert(extension, 'expected Python extension metadata');
  assert.strictEqual(extension.isActive, false, 'wrapper activation is not VSCode extension activation');
  assert.strictEqual(extension.exports, undefined);

  const exportsPromise = extension.activate();
  resolveActivation(extensionApi);
  global.__pulsarVscodeExtensionExports.set('ms-python.python', extensionApi);
  global.__pulsarVscodeExtensionActiveIds.add('ms-python.python');

  const exports = await exportsPromise;
  assert.strictEqual(exports, extensionApi);
  assert.strictEqual(extension.isActive, true);
  assert.strictEqual(extension.exports, extensionApi);
  assert.strictEqual(typeof exports.environments.onDidChangeActiveEnvironmentPath, 'function');

  console.log('extensions await in-flight wrapper activation and expose VSCode activation exports');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
