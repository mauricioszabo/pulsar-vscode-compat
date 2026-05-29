'use strict';

const assert = require('assert');

function installFakeAtom() {
  global.atom = {
    project: {
      getPaths() { return []; },
      onDidChangePaths() { return { dispose() {} }; }
    },
    workspace: {
      observeTextEditors() { return { dispose() {} }; },
      getTextEditors() { return []; }
    },
    config: { onDidChange() { return { dispose() {} }; } }
  };
}

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`), error => {
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
}

installFakeAtom();
const workspace = require('../lib/namespaces/workspace');
const { Uri } = require('../lib/types/uri');

test('registerFileSystemProvider registers custom scheme used by workspace.fs', async () => {
  const calls = [];
  const provider = {
    stat(uri) { calls.push(['stat', uri.toString()]); return Promise.resolve({ type: 1, ctime: 1, mtime: 2, size: 3 }); },
    readFile(uri) { calls.push(['readFile', uri.toString()]); return Promise.resolve(Buffer.from('hello')); },
    writeFile(uri, content, options) { calls.push(['writeFile', uri.toString(), Buffer.from(content).toString('utf8'), options]); return Promise.resolve(); },
    readDirectory(uri) { calls.push(['readDirectory', uri.toString()]); return Promise.resolve([['file.txt', 1]]); },
    createDirectory(uri) { calls.push(['createDirectory', uri.toString()]); return Promise.resolve(); },
    delete(uri, options) { calls.push(['delete', uri.toString(), options]); return Promise.resolve(); },
    rename(source, target, options) { calls.push(['rename', source.toString(), target.toString(), options]); return Promise.resolve(); }
  };

  const disposable = workspace.registerFileSystemProvider('mem', provider, { isReadonly: false });
  const uri = Uri.parse('mem:/folder/file.txt');

  assert.deepStrictEqual(await workspace.fs.stat(uri), { type: 1, ctime: 1, mtime: 2, size: 3 });
  assert.strictEqual(Buffer.from(await workspace.fs.readFile(uri)).toString('utf8'), 'hello');
  await workspace.fs.writeFile(uri, Buffer.from('updated'), { create: true, overwrite: true });
  assert.deepStrictEqual(await workspace.fs.readDirectory(Uri.parse('mem:/folder')), [['file.txt', 1]]);
  await workspace.fs.createDirectory(Uri.parse('mem:/new'));
  await workspace.fs.delete(uri, { recursive: false, useTrash: false });
  await workspace.fs.rename(uri, Uri.parse('mem:/folder/other.txt'), { overwrite: true });
  assert.strictEqual(workspace.fs.isWritableFileSystem('mem'), true);

  disposable.dispose();
  assert.strictEqual(workspace.fs.isWritableFileSystem('mem'), undefined);
  assert.deepStrictEqual(calls.map(call => call[0]), ['stat', 'readFile', 'writeFile', 'readDirectory', 'createDirectory', 'delete', 'rename']);
});
