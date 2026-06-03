'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function clearCompatModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/lib/namespaces/workspace.js') || key.includes('/lib/vscode.js')) delete require.cache[key];
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

test('findFiles resolves RelativePattern matches without external glob dependency', async () => {
  clearCompatModules();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-vscode-find-files-'));
  const nested = path.join(root, 'src');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'selected.js'), 'const selected = true;');
  fs.writeFileSync(path.join(root, 'other.txt'), 'not selected');

  global.atom = {
    project: {
      getPaths() { return [root]; },
      scan() { return { catch() {} }; }
    },
    workspace: {
      getTextEditors() { return []; },
      observeTextEditors() { return { dispose() {} }; }
    },
    config: { get() {}, set() {}, observe() { return { dispose() {} }; }, onDidChange() { return { dispose() {} }; } }
  };

  const vscode = require('../lib/vscode');
  const folder = vscode.workspace.workspaceFolders[0];
  const relativePattern = new vscode.RelativePattern(folder, 'src/selected.js');
  const matches = await vscode.workspace.findFiles(relativePattern, undefined, 1);

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].fsPath, path.join(nested, 'selected.js'));
});
