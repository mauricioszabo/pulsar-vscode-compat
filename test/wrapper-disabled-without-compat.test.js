'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateWrapperMain } = require('../lib/ui/install-vsx');

function makeWrapper() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wrapper-disabled-'));
  const wrapper = path.join(root, 'wrapper');
  fs.mkdirSync(path.join(wrapper, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wrapper, 'extension'), { recursive: true });
  fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({
    name: 'vscode-test-extension',
    _vscodeExtension: { id: 'test.extension', main: './index.js' }
  }));
  fs.writeFileSync(path.join(wrapper, 'lib', 'main.js'), generateWrapperMain());
  fs.writeFileSync(path.join(wrapper, 'extension', 'index.js'), `
    global.__testVscodeExtensionLoaded = true;
    exports.activate = function() { global.__testVscodeExtensionActivated = true; };
  `);
  return { root, wrapper };
}

(async () => {
  const { root, wrapper } = makeWrapper();
  let compatActivationAttempted = false;
  delete global.__testVscodeExtensionLoaded;
  delete global.__testVscodeExtensionActivated;

  global.atom = {
    packages: {
      isPackageDisabled(name) {
        assert.strictEqual(name, 'pulsar-vscode-compat');
        return true;
      },
      async activatePackage() {
        compatActivationAttempted = true;
        throw new Error('a disabled compatibility package must not be activated');
      }
    }
  };

  try {
    const main = require(path.join(wrapper, 'lib', 'main.js'));
    await main.activate({});

    assert.strictEqual(compatActivationAttempted, false,
      'the wrapper must not try to activate a disabled compatibility package');
    assert.strictEqual(global.__testVscodeExtensionLoaded, undefined,
      'the original VSCode extension must not be loaded');
    assert.strictEqual(global.__testVscodeExtensionActivated, undefined,
      'the original VSCode extension must not be activated');
    console.log('generated wrappers stay inactive when pulsar-vscode-compat is disabled');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
