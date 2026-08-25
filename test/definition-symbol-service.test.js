'use strict';

const assert = require('assert');

function clearCompatRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/pulsar-vscode-compat/lib/')) delete require.cache[key];
  }
}

async function run() {
  clearCompatRequireCache();

  global.atom = {
    config: { get() { return undefined; } },
    workspace: { observeTextEditors() {} },
    views: { getView() { return {}; } }
  };

  const main = require('../lib/main');
  const languages = require('../lib/namespaces/languages');

  // Pulsar's service hub delivers the provided array once. Symbols View then
  // copies its entries into its provider broker, so registrations that happen
  // later must remain reachable through a stable provider object.
  const consumedProviders = [...main.provideSymbols()];

  const registration = languages.registerDefinitionProvider('python', {
    provideDefinition(document, position) {
      assert.strictEqual(document.uri.fsPath, '/tmp/example.py');
      assert.strictEqual(position.line, 4);
      assert.strictEqual(position.character, 7);
      return {
        uri: { fsPath: '/tmp/definition.py' },
        range: { start: { line: 10, character: 2 } }
      };
    }
  });

  assert.strictEqual(consumedProviders.length, 1,
    'symbol.provider must expose a stable provider before VSCode extensions register');

  const provider = consumedProviders[0];
  class Point {
    constructor(row, column) {
      this.row = row;
      this.column = column;
    }

    static fromObject(value) {
      if (Array.isArray(value)) return new Point(value[0], value[1]);
      return new Point(value.row, value.column);
    }
  }

  const editor = {
    getGrammar() { return { scopeName: 'source.python' }; },
    getPath() { return '/tmp/example.py'; },
    getCursorBufferPosition() { return new Point(4, 7); },
    getWordUnderCursor() { return 'target'; }
  };
  const meta = { type: 'project-find', editor, paths: ['/tmp'] };

  assert.strictEqual(await provider.canProvideSymbols(meta), 0.8);
  const symbols = await provider.getSymbols(meta);
  assert.strictEqual(symbols.length, 1);
  assert.strictEqual(symbols[0].name, 'target');
  assert.strictEqual(symbols[0].path, '/tmp/definition.py');
  assert.ok(symbols[0].position instanceof Point,
    'Symbols View requires symbol.position to be an Atom/Pulsar Point instance');
  assert.strictEqual(symbols[0].position.row, 10);
  assert.strictEqual(symbols[0].position.column, 2);

  registration.dispose();
  assert.strictEqual(await provider.canProvideSymbols(meta), false,
    'disposing the VSCode registration must remove it from the stable provider');
}

run()
  .then(() => console.log('ok - late VSCode definition providers reach Symbols View go-to-declaration'))
  .catch(error => {
    console.error('not ok - late VSCode definition providers reach Symbols View go-to-declaration');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
