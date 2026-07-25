'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateWrapperMain } = require('../lib/ui/install-vsx');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wrapper-missing-'));
const wrapper = path.join(root, 'wrapper');
fs.mkdirSync(path.join(wrapper, 'lib'), { recursive: true });
fs.mkdirSync(path.join(wrapper, 'extension'), { recursive: true });
fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({
  name: 'vscode-test-extension',
  _vscodeExtension: { id: 'test.missing-compat', main: './index.js' }
}));
fs.writeFileSync(path.join(wrapper, 'lib', 'main.js'), generateWrapperMain());
fs.writeFileSync(path.join(wrapper, 'extension', 'index.js'), `
  global.__testMissingCompatExtensionLoaded = true;
  exports.activate = function() { global.__testMissingCompatExtensionActivated = true; };
`);

let compatActivationAttempted = false;
delete global.__testMissingCompatExtensionLoaded;
delete global.__testMissingCompatExtensionActivated;
global.atom = {
  packages: {
    getAvailablePackageNames() { return ['autocomplete-plus', 'tree-view']; },
    isPackageDisabled() { return false; },
    async activatePackage() {
      compatActivationAttempted = true;
      throw new Error('a missing compatibility package must not be activated');
    }
  }
};

(async () => {
  try {
    const main = require(path.join(wrapper, 'lib', 'main.js'));
    await main.activate({});

    assert.strictEqual(compatActivationAttempted, false,
      'the wrapper must not try to activate a compatibility package that is not installed');
    assert.strictEqual(global.__testMissingCompatExtensionLoaded, undefined,
      'the original VSCode extension must not be loaded');
    assert.strictEqual(global.__testMissingCompatExtensionActivated, undefined,
      'the original VSCode extension must not be activated');
    console.log('generated wrappers stay inactive when pulsar-vscode-compat is not installed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
