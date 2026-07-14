'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }
}

function resetWorkspaceModule() {
  delete require.cache[require.resolve('../lib/namespaces/workspace')];
  return require('../lib/namespaces/workspace');
}

test('openTextDocument rejects missing path-backed files instead of creating an empty document', async () => {
  const missingPath = path.join(os.tmpdir(), `pulsar-vscode-compat-missing-${Date.now()}.json`);
  let createItemForURICalled = false;

  global.atom = {
    workspace: {
      createItemForURI(filePath) {
        createItemForURICalled = true;
        return { getPath: () => filePath };
      },
      buildTextEditor() {
        return { getPath: () => null };
      },
      observeTextEditors() {}
    },
    project: { getPaths: () => [] },
    packages: { getLoadedPackages: () => [], getAvailablePackagePaths: () => [] },
    config: { get: () => undefined }
  };

  const workspace = resetWorkspaceModule();
  await assert.rejects(
    () => workspace.openTextDocument(missingPath),
    error => error && error.code === 'ENOENT' && error.path === missingPath
  );
  assert.strictEqual(createItemForURICalled, false);
});

test('openTextDocument supplies an empty VSCode User keybindings document when Pulsar has none', async () => {
  const atomHome = path.join(os.tmpdir(), `pulsar-vscode-compat-home-${Date.now()}`);
  const keybindingsPath = path.join(atomHome, 'User', 'keybindings.json');
  let createItemForURICalled = false;

  global.atom = {
    workspace: {
      createItemForURI(filePath) {
        createItemForURICalled = true;
        return { getPath: () => filePath };
      },
      buildTextEditor() {
        let text = '';
        return {
          _vscodeUri: null,
          getPath: () => null,
          getTitle: () => 'keybindings.json',
          getGrammar: () => null,
          getBuffer: () => ({ changeCount: 0, getPreferredLineEnding: () => '\n' }),
          setText(value) { text = value; },
          getText: () => text,
          isModified: () => false,
          isDestroyed: () => false,
          getLineCount: () => text.split(/\r?\n/).length,
          setReadOnly() {}
        };
      },
      observeTextEditors() {}
    },
    project: { getPaths: () => [] },
    packages: { getLoadedPackages: () => [], getAvailablePackagePaths: () => [] },
    config: { get: () => undefined }
  };

  const oldAtomHome = process.env.ATOM_HOME;
  process.env.ATOM_HOME = atomHome;
  try {
    const workspace = resetWorkspaceModule();
    const document = await workspace.openTextDocument(keybindingsPath);
    assert.strictEqual(document.uri.fsPath, keybindingsPath);
    assert.strictEqual(document.getText(), '[]');
    assert.strictEqual(createItemForURICalled, false);
  } finally {
    if (oldAtomHome === undefined) delete process.env.ATOM_HOME;
    else process.env.ATOM_HOME = oldAtomHome;
  }
});

test('openTextDocument still opens existing path-backed files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-vscode-compat-open-'));
  const filePath = path.join(dir, 'exists.txt');
  fs.writeFileSync(filePath, 'hello');

  global.atom = {
    workspace: {
      createItemForURI(requestedPath) {
        return {
          getPath: () => requestedPath,
          getTitle: () => path.basename(requestedPath),
          getGrammar: () => null,
          getBuffer: () => ({ changeCount: 0, getPreferredLineEnding: () => '\n' }),
          isModified: () => false,
          isDestroyed: () => false,
          getLineCount: () => 1,
          getText: () => 'hello'
        };
      },
      buildTextEditor() {
        return { getPath: () => null };
      },
      observeTextEditors() {}
    },
    project: { getPaths: () => [] },
    packages: { getLoadedPackages: () => [], getAvailablePackagePaths: () => [] },
    config: { get: () => undefined }
  };

  const workspace = resetWorkspaceModule();
  const document = await workspace.openTextDocument(filePath);
  assert.strictEqual(document.fileName, filePath);
});

run();
