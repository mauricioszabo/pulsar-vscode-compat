'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateWrapperMain } = require('../lib/ui/install-vsx');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wrapper-exports-'));
const wrapper = path.join(root, 'wrapper');
const compat = path.join(root, 'compat');
fs.mkdirSync(path.join(wrapper, 'lib'), { recursive: true });
fs.mkdirSync(path.join(wrapper, 'extension'), { recursive: true });
fs.mkdirSync(path.join(compat, 'lib'), { recursive: true });

fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({
  name: 'vscode-ms-python-python',
  _vscodeExtension: { id: 'ms-python.python', main: './index.js' }
}));
fs.writeFileSync(path.join(wrapper, 'lib', 'main.js'), generateWrapperMain());
fs.writeFileSync(path.join(wrapper, 'extension', 'index.js'), `
const api = { environments: { onDidChangeActiveEnvironmentPath() {} } };
exports.activate = async function() { return api; };
`);
fs.writeFileSync(path.join(compat, 'lib', 'vscode.js'), `
exports.ExtensionContext = class ExtensionContext {
  constructor() { this.globalState = { keys() { return []; } }; this.workspaceState = { keys() { return []; } }; }
  _dispose() {}
};
`);

global.atom = {
  packages: {
    async activatePackage(name) {
      assert.strictEqual(name, 'pulsar-vscode-compat');
      return { path: compat };
    }
  }
};
delete global.__pulsarVscodeExtensionExports;

(async () => {
  const main = require(path.join(wrapper, 'lib', 'main.js'));
  const activation = main.activate({});
  const pending = global.__pulsarVscodeExtensionActivationPromises;
  assert(pending && pending.get('ms-python.python'), 'generated wrapper should publish its in-flight activation promise');
  await activation;
  const registry = global.__pulsarVscodeExtensionExports;
  const activeIds = global.__pulsarVscodeExtensionActiveIds;
  const api = registry && (typeof registry.get === 'function' ? registry.get('ms-python.python') : registry['ms-python.python']);
  assert(api, 'generated wrapper should publish the original extension activation exports');
  assert(activeIds && activeIds.has('ms-python.python'), 'generated wrapper should mark original extension activation complete');
  assert.strictEqual(typeof api.environments.onDidChangeActiveEnvironmentPath, 'function');
  console.log('generated wrappers publish original VSCode extension activation exports');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
