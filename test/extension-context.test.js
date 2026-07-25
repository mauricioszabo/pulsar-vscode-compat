'use strict';

const assert = require('assert');
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

test('ExtensionContext logUri has VSCode-like depth for extensions that derive User/keybindings.json', () => {
  const atomHome = path.join(os.tmpdir(), `pulsar-vscode-compat-home-${Date.now()}`);
  const oldAtomHome = process.env.ATOM_HOME;
  process.env.ATOM_HOME = atomHome;
  delete require.cache[require.resolve('../lib/types/extension-context')];
  const { ExtensionContext } = require('../lib/types/extension-context');

  try {
    const context = new ExtensionContext('kahole.magit', '/tmp/extension', 1, {});
    const derivedKeybindingsPath = path.resolve(path.join(
      context.logUri.fsPath,
      '..', '..', '..', '..', '..',
      'User',
      'keybindings.json'
    ));
    assert.strictEqual(derivedKeybindingsPath, path.join(atomHome, 'User', 'keybindings.json'));
  } finally {
    if (oldAtomHome === undefined) delete process.env.ATOM_HOME;
    else process.env.ATOM_HOME = oldAtomHome;
    delete require.cache[require.resolve('../lib/types/extension-context')];
  }
});

run();
