'use strict';

const assert = require('assert');

function installFakeAtom() {
  global.atom = {
    grammars: { getGrammars() { return []; } },
    workspace: { observeTextEditors() { return { dispose() {} }; } },
    commands: { add() { return { dispose() {} }; } },
    contextMenu: { add() {} }
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
const languages = require('../lib/namespaces/languages');
const { Diagnostic } = require('../lib/types/diagnostic');
const { Range } = require('../lib/types/range');
const { Position } = require('../lib/types/position');
const { Uri } = require('../lib/types/uri');

test('languages.onDidChangeDiagnostics fires with changed URIs when diagnostics change', () => {
  assert.strictEqual(typeof languages.onDidChangeDiagnostics, 'function');

  const events = [];
  const disposable = languages.onDidChangeDiagnostics(event => events.push(event));
  const collection = languages.createDiagnosticCollection('python');
  const uri = Uri.file('/tmp/example.py');
  const diagnostic = new Diagnostic(new Range(new Position(0, 0), new Position(0, 1)), 'boom');

  collection.set(uri, [diagnostic]);
  collection.delete(uri);

  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(events[0].uris.map(u => u.toString()), [uri.toString()]);
  assert.deepStrictEqual(events[1].uris.map(u => u.toString()), [uri.toString()]);
  disposable.dispose();
});
