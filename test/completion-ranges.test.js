'use strict';

const assert = require('assert');
const { makeAutocompleteProvider } = require('../lib/adapters/completion-adapter');
const { Range } = require('../lib/types/range');
const { Position } = require('../lib/types/position');
const { SnippetString } = require('../lib/types/text-edit');
const { CompletionItemInsertTextRule } = require('../lib/types/completion');

global.atom = {
  ui: {
    fuzzyMatcher: {
      setCandidates(candidates) {
        return {
          match(prefix) {
            return candidates
              .map((candidate, id) => ({ candidate, id }))
              .filter(({ candidate }) => candidate.startsWith(prefix));
          }
        };
      }
    }
  }
};

function fakeEditor() {
  return {
    getGrammar() { return { scopeName: 'source.python' }; },
    getPath() { return '/tmp/example.py'; },
    getTitle() { return 'example.py'; },
    getBuffer() { return { getPath() { return '/tmp/example.py'; } }; },
    getText() { return 'pri'; },
    getTextInBufferRange() { return 'pri'; },
    getLastCursor() {
      return {
        getCurrentWordBufferRange() {
          return { start: [0, 0], end: [0, 3] };
        }
      };
    },
    getSelectedBufferRange() { return { start: [0, 3], end: [0, 3] }; },
    lineTextForBufferRow() { return 'pri'; },
    getLineCount() { return 1; },
    isModified() { return false; },
    isDestroyed() { return false; }
  };
}

function fakeElixirEditor() {
  return {
    ...fakeEditor(),
    getGrammar() { return { scopeName: 'source.elixir' }; },
    getPath() { return '/tmp/connection.ex'; },
    getTitle() { return 'connection.ex'; },
    getBuffer() { return { getPath() { return '/tmp/connection.ex'; } }; },
    getText() { return 'de'; },
    getTextInBufferRange() { return 'de'; },
    getLastCursor() {
      return {
        getCurrentWordBufferRange() {
          return { start: [329, 4], end: [329, 6] };
        }
      };
    },
    getSelectedBufferRange() { return { start: [329, 6], end: [329, 6] }; },
    lineTextForBufferRow() { return '    de'; },
  };
}

function fakeRemoteElixirEditor() {
  return {
    ...fakeElixirEditor(),
    getText() { return 'IO.i'; },
    getTextInBufferRange() { return 'IO.i'; },
    getLastCursor() {
      return {
        getCurrentWordBufferRange() {
          return { start: [0, 0], end: [0, 4] };
        }
      };
    },
    getSelectedBufferRange() { return { start: [0, 4], end: [0, 4] }; },
    lineTextForBufferRow() { return 'IO.i'; }
  };
}

function fakeCodeElixirEditor() {
  return {
    ...fakeElixirEditor(),
    getText() { return 'Code.string_t'; },
    getTextInBufferRange() { return 'string_t'; },
    getLastCursor() {
      return {
        getCurrentWordBufferRange() {
          return { start: [0, 5], end: [0, 13] };
        }
      };
    },
    getSelectedBufferRange() { return { start: [0, 13], end: [0, 13] }; },
    lineTextForBufferRow() { return 'Code.string_t'; }
  };
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

(async () => {
  await test('completion item Range is converted to autocomplete-plus ranges', async () => {
    const provider = makeAutocompleteProvider('python', {
      provideCompletionItems() {
        return [{
          label: 'print',
          insertText: 'print',
          range: new Range(new Position(0, 0), new Position(0, 3))
        }];
      }
    }, []);

    const suggestions = await provider.getSuggestions({
      editor: fakeEditor(),
      bufferPosition: { row: 0, column: 3 },
      activatedManually: true
    });

    assert.strictEqual(suggestions.length, 1);
    assert.deepStrictEqual(suggestions[0].ranges, [ [[0, 0], [0, 3]] ]);
    assert.strictEqual(suggestions[0].range, undefined);
  });

  await test('completion item insert/replace ranges use inserting range for autocomplete-plus', async () => {
    const provider = makeAutocompleteProvider('python', {
      provideCompletionItems() {
        return [{
          label: 'print',
          insertText: 'print',
          range: {
            inserting: new Range(new Position(0, 1), new Position(0, 3)),
            replacing: new Range(new Position(0, 0), new Position(0, 4))
          }
        }];
      }
    }, []);

    const suggestions = await provider.getSuggestions({
      editor: fakeEditor(),
      bufferPosition: { row: 0, column: 3 },
      activatedManually: true
    });

    assert.strictEqual(suggestions.length, 1);
    assert.deepStrictEqual(suggestions[0].ranges, [ [[0, 1], [0, 3]] ]);
  });

  await test('snippet completion items are fuzzy-matched by their VSCode label', async () => {
    const provider = makeAutocompleteProvider('elixir', {
      provideCompletionItems() {
        return [{
          label: 'debug',
          insertText: new SnippetString('debug(${1:true}, ${2:label}, ${3:message})'),
          range: new Range(new Position(329, 4), new Position(329, 6))
        }];
      }
    }, []);

    const suggestions = await provider.getSuggestions({
      editor: fakeElixirEditor(),
      bufferPosition: { row: 329, column: 6 },
      activatedManually: true
    });

    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].displayText, 'debug');
    assert.strictEqual(suggestions[0].text, undefined);
    assert.strictEqual(suggestions[0].snippet, 'debug(${1:true}, ${2:label}, ${3:message})');
    assert.deepStrictEqual(suggestions[0].textEdit, {
      range: [[329, 4], [329, 6]],
      newText: 'debug(${1:true}, ${2:label}, ${3:message})'
    });
    assert.strictEqual(suggestions[0].ranges, undefined);
  });

  await test('remote completions use the autocomplete-plus prefix after the dot', async () => {
    const provider = makeAutocompleteProvider('elixir', {
      provideCompletionItems() {
        return {
          isIncomplete: true,
          items: [{
            label: 'inspect',
            insertText: new SnippetString('inspect($1)$0')
          }]
        };
      }
    }, []);

    const suggestions = await provider.getSuggestions({
      editor: fakeRemoteElixirEditor(),
      bufferPosition: { row: 0, column: 4 },
      prefix: 'i',
      activatedManually: true
    });

    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].displayText, 'inspect');
    assert.strictEqual(suggestions[0].snippet, 'inspect($1)$0');
    assert.deepStrictEqual(suggestions[0].textEdit, {
      range: [[0, 3], [0, 4]],
      newText: 'inspect($1)$0'
    });
    assert.strictEqual(suggestions[0].ranges, undefined);
  });

  await test('InsertAsSnippet string completions use autocomplete-plus snippet text edits', async () => {
    const provider = makeAutocompleteProvider('elixir', {
      provideCompletionItems() {
        return [{
          label: 'string_to_quoted',
          insertText: 'string_to_quoted($1)$0',
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range: new Range(new Position(0, 5), new Position(0, 13))
        }];
      }
    }, []);

    const suggestions = await provider.getSuggestions({
      editor: fakeCodeElixirEditor(),
      bufferPosition: { row: 0, column: 13 },
      prefix: 'string_t',
      activatedManually: true
    });

    assert.strictEqual(suggestions.length, 1);
    assert.strictEqual(suggestions[0].text, undefined);
    assert.strictEqual(suggestions[0].snippet, 'string_to_quoted($1)$0');
    assert.deepStrictEqual(suggestions[0].textEdit, {
      range: [[0, 5], [0, 13]],
      newText: 'string_to_quoted($1)$0'
    });
    assert.strictEqual(suggestions[0].ranges, undefined);
  });
})();
