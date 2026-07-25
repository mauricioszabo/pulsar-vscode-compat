'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-vscode-extension-'));
const wrapperPath = path.join(tmpRoot, 'vscode-ms-python-python');
fs.mkdirSync(path.join(wrapperPath, 'extension'), { recursive: true });
fs.writeFileSync(path.join(wrapperPath, 'package.json'), JSON.stringify({
  name: 'vscode-ms-python-python',
  _vscodeExtension: { id: 'ms-python.python' }
}));
fs.writeFileSync(path.join(wrapperPath, 'extension', 'package.json'), JSON.stringify({
  name: 'python',
  publisher: 'ms-python',
  enableTelemetry: false
}));

global.atom = {
  packages: {
    getActivePackage() { return null; },
    getLoadedPackage() { return null; },
    getActivePackages() { return []; },
    getLoadedPackages() { return []; },
    getAvailablePackagePaths() { return [wrapperPath]; }
  }
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

const extensions = require('../lib/namespaces/extensions');

test('getExtension finds inactive VSCode wrapper packages by original extension id', () => {
  const extension = extensions.getExtension('ms-python.python');
  assert(extension);
  assert.strictEqual(extension.id, 'ms-python.python');
  assert.strictEqual(extension.packageJSON.name, 'python');
  assert.strictEqual(extension.packageJSON.enableTelemetry, false);
  assert.strictEqual(extension.extensionPath, path.join(wrapperPath, 'extension'));
});
