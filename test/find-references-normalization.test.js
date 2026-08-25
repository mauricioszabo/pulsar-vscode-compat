'use strict';

const assert = require('assert');
const Module = require('module');

class FakeAtomRange {
  constructor(start, end) { this.start = start; this.end = end; }
  containsPoint() { return false; }
  toString() { return `${this.start}x${this.end}`; }
}

async function main() {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'atom') return { Range: FakeAtomRange };
    return originalLoad.apply(this, arguments);
  };

  const text = [
    'header',
    'stale location one',
    'stale location two',
    '  "ex" => format_error(kind)',
    '  "err" => format_error(kind)',
    '',
    'defp format_error(kind) do',
    '  kind',
    'end'
  ].join('\n');

  const matchingEditor = {
    getGrammar() { return { scopeName: 'source.elixir' }; },
    getPath() { return '/tmp/connection.ex'; },
    getText() { return text; },
    getWordUnderCursor() { return 'format_error'; },
    isModified() { return true; },
    getBuffer() {
      return {
        getText() { return text; },
        onDidChange() { return { dispose() {} }; }
      };
    }
  };

  global.atom = {
    config: { get() { return undefined; } },
    workspace: {
      observeTextEditors() {},
      getTextEditors() { return [matchingEditor]; }
    },
    views: { getView() { return {}; } }
  };

  try {
    const vscode = require('../lib/vscode');
    const mainModule = require('../lib/main');
    const uri = vscode.Uri.file('/tmp/connection.ex');

    vscode.languages.registerReferenceProvider('elixir', {
      provideReferences() {
        return [
          // ElixirLS can merge stale on-disk positions into dirty-buffer results.
          { uri, range: new vscode.Range(1, 0, 1, 12) },
          { uri, range: new vscode.Range(2, 0, 2, 12) },
          // A stale range can also land on a current reference line; after
          // normalization it must not duplicate the real current location.
          { uri, range: new vscode.Range(3, 0, 3, 5) },
          // Current call-site ranges.
          { uri, range: new vscode.Range(3, 10, 3, 22) },
          { uri, range: new vscode.Range(4, 11, 4, 23) },
          // ElixirLS reports the declaration as the whole function body.
          { uri, range: new vscode.Range(6, 0, 8, 3) }
        ];
      }
    });

    const result = await mainModule.provideFindReferences().findReferences(
      matchingEditor,
      { row: 3, column: 12 }
    );

    assert.strictEqual(result.type, 'data');
    assert.strictEqual(result.references.length, 3);
    assert.deepStrictEqual(result.references.map(ref => [ref.range.start, ref.range.end]), [
      [[3, 10], [3, 22]],
      [[4, 11], [4, 23]],
      [[6, 5], [6, 17]]
    ]);
    console.log('find-references dirty-buffer normalization tests passed');
  } finally {
    Module._load = originalLoad;
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
