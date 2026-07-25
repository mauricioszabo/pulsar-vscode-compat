'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateVSCodeRequireShim } = require('../lib/ui/install-vsx');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-require-shim-disabled-'));
const shimPath = path.join(root, 'node_modules', 'vscode', 'index.js');
fs.mkdirSync(path.dirname(shimPath), { recursive: true });
fs.writeFileSync(shimPath, generateVSCodeRequireShim());

const staleApi = { workspace: { name: 'must not leak' } };
global.__pulsarVscodeCompatApi = staleApi;
global.__pulsarVscodeCompatPath = '/tmp/compat-that-must-not-load.js';
global.atom = {
  packages: {
    getAvailablePackageNames() { return ['pulsar-vscode-compat']; },
    isPackageDisabled(name) {
      assert.strictEqual(name, 'pulsar-vscode-compat');
      return true;
    }
  }
};

try {
  const vscode = require(shimPath);
  assert.deepStrictEqual(vscode, {},
    "the package-local vscode shim must expose no API while pulsar-vscode-compat is disabled");
  assert.notStrictEqual(vscode, staleApi,
    'a stale global compatibility API must not leak into a disabled wrapper');
  console.log('the vscode require shim stays inert while pulsar-vscode-compat is disabled');
} finally {
  delete global.__pulsarVscodeCompatApi;
  delete global.__pulsarVscodeCompatPath;
  fs.rmSync(root, { recursive: true, force: true });
}
