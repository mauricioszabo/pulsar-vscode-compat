'use strict';

const assert = require('assert');

function installFakeAtom() {
  global.atom = {
    getVersion() { return 'test'; },
    project: { getPaths() { return []; }, getDirectories() { return []; }, onDidChangePaths() { return { dispose() {} }; } },
    workspace: {
      getActiveTextEditor() { return null; },
      observeTextEditors() { return { dispose() {} }; },
      onDidChangeActiveTextEditor() { return { dispose() {} }; },
      getTextEditors() { return []; },
      addOpener() { return { dispose() {} }; },
      open() { return Promise.resolve(); }
    },
    themes: { onDidChangeActiveThemes() { return { dispose() {} }; } },
    commands: { add() { return { dispose() {} }; } },
    config: { get() {}, set() {}, observe() { return { dispose() {} }; }, onDidChange() { return { dispose() {} }; } },
    notifications: { addInfo(){}, addWarning(){}, addError(){} }
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
const vscode = require('../lib/vscode');

test('FileSystemError exposes VSCode-style static factories with distinct error names', () => {
  assert.strictEqual(typeof vscode.FileSystemError, 'function');

  const errors = [
    vscode.FileSystemError.FileNotFound('/missing.py'),
    vscode.FileSystemError.FileExists('/existing.py'),
    vscode.FileSystemError.FileIsADirectory('/a-dir'),
    vscode.FileSystemError.FileNotADirectory('/not-a-dir'),
    vscode.FileSystemError.NoPermissions('/private.py'),
    vscode.FileSystemError.Unavailable('/offline.py')
  ];

  for (const error of errors) {
    assert(error instanceof Error);
    assert(error instanceof vscode.FileSystemError);
    assert.strictEqual(typeof error.name, 'string');
    assert(error.name.includes('FileSystemError'));
    assert.strictEqual(typeof error.message, 'string');
  }

  assert.strictEqual(new Set(errors.map(error => error.name)).size, errors.length);
});
