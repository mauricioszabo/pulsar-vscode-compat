'use strict';

const assert = require('assert');
const { makeAutocompleteProvider } = require('../lib/adapters/completion-adapter');
const { Range } = require('../lib/types/range');
const { Position } = require('../lib/types/position');

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
})();
