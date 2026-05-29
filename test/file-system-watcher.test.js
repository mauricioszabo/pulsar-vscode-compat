'use strict';

const assert = require('assert');

function withFakeAtom(run) {
  const previousAtom = global.atom;
  global.atom = { project: { getPaths() { return []; } } };
  try {
    return run();
  } finally {
    global.atom = previousAtom;
  }
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

test('file-system-watcher module loads without external minimatch dependency', () => {
  const watcherModule = require('../lib/types/file-system-watcher');
  assert.strictEqual(typeof watcherModule.FileSystemWatcher, 'function');
  assert.deepStrictEqual(watcherModule.FileChangeType, { Changed: 1, Created: 2, Deleted: 3 });
});

test('file-system-watcher matches common VSCode glob patterns', () => {
  const { FileSystemWatcher } = require('../lib/types/file-system-watcher');
  withFakeAtom(() => {
    const watcher = new FileSystemWatcher('**/*.js');
    try {
      assert.strictEqual(watcher._matches('/workspace/src/index.js', '/workspace'), true);
      assert.strictEqual(watcher._matches('/workspace/src/index.ts', '/workspace'), false);
    } finally {
      watcher.dispose();
    }
  });
});
