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

test('NotebookCellOutputItem.error creates VSCode-compatible error output item', () => {
  assert.strictEqual(typeof vscode.NotebookCellOutputItem.error, 'function');
  const error = new Error('boom');
  error.name = 'Exploded';
  const item = vscode.NotebookCellOutputItem.error(error);
  assert.strictEqual(item.mime, 'application/vnd.code.notebook.error');
  assert.deepStrictEqual(JSON.parse(Buffer.from(item.data).toString('utf8')), {
    name: 'Exploded',
    message: 'boom',
    stack: error.stack
  });
});
