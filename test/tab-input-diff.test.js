'use strict';

const assert = require('assert');

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

const vscode = require('../lib/vscode');

test('TabInputTextDiff is exported as a constructor for instanceof checks', () => {
  assert.strictEqual(typeof vscode.TabInputTextDiff, 'function');
  const input = new vscode.TabInputTextDiff(vscode.Uri.file('/tmp/a.py'), vscode.Uri.file('/tmp/b.py'));
  assert(input instanceof vscode.TabInputTextDiff);
  assert.strictEqual(input.original.fsPath, '/tmp/a.py');
  assert.strictEqual(input.modified.fsPath, '/tmp/b.py');
});
