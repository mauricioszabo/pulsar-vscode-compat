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

test('workspace exposes notebook document lifecycle events as disposable event functions', () => {
  assert.strictEqual(typeof workspace.onDidOpenNotebookDocument, 'function');
  assert.strictEqual(typeof workspace.onDidCloseNotebookDocument, 'function');
  assert.strictEqual(typeof workspace.onDidChangeNotebookDocument, 'function');
  assert.strictEqual(typeof workspace.onDidSaveNotebookDocument, 'function');

  const openDisposable = workspace.onDidOpenNotebookDocument(() => {});
  const closeDisposable = workspace.onDidCloseNotebookDocument(() => {});
  const changeDisposable = workspace.onDidChangeNotebookDocument(() => {});
  const saveDisposable = workspace.onDidSaveNotebookDocument(() => {});

  for (const disposable of [openDisposable, closeDisposable, changeDisposable, saveDisposable]) {
    assert.strictEqual(typeof disposable.dispose, 'function');
    disposable.dispose();
  }
});
