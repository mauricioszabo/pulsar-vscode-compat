'use strict';

const assert = require('assert');

function installFakeAtom() {
  global.atom = {
    project: { getPaths() { return []; }, getDirectories() { return []; }, onDidChangePaths() { return { dispose() {} }; } },
    workspace: { getTextEditors() { return []; } },
    packages: { getLoadedPackages() { return []; }, getAvailablePackagePaths() { return []; } },
    config: { get() {}, observe() { return { dispose() {} }; }, onDidChange() { return { dispose() {} }; } }
  };
}

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

installFakeAtom();
const workspace = require('../lib/namespaces/workspace');

test('workspace trust API reports trusted and exposes onDidGrantWorkspaceTrust event', () => {
  assert.strictEqual(workspace.isTrusted, true);
  assert.strictEqual(typeof workspace.onDidGrantWorkspaceTrust, 'function');
  const disposable = workspace.onDidGrantWorkspaceTrust(() => {});
  assert.strictEqual(typeof disposable.dispose, 'function');
  disposable.dispose();
});
