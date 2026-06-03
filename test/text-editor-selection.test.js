'use strict';

const assert = require('assert');

function clearCompatModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/lib/namespaces/window.js') || key.includes('/lib/vscode.js') || key.includes('/lib/types/text-document.js') || key.includes('/lib/types/text-editor.js')) {
      delete require.cache[key];
    }
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

function makeSelection(range, reversed = false) {
  const selection = {
    getBufferRange() {
      return {
        start: { row: range[0][0], column: range[0][1] },
        end: { row: range[1][0], column: range[1][1] }
      };
    },
    getCursor() {
      return { isAtEndOfSelection: !reversed };
    }
  };
  selection.cursor = selection.getCursor();
  return selection;
}

function makeEditor() {
  const listeners = [];
  const editor = {
    selection: makeSelection([[0, 0], [0, 0]]),
    selections: [],
    getLastSelection() { return this.selection; },
    getSelections() { return this.selections.length ? this.selections : [this.selection]; },
    setSelection(range, reversed) {
      this.selection = makeSelection(range, reversed);
      this.selections = [this.selection];
      listeners.forEach(listener => listener({ selection: this.selection }));
    },
    onDidChangeSelectionRange(callback) {
      listeners.push(callback);
      return { dispose() {} };
    },
    onDidDestroy() { return { dispose() {} }; },
    getPath() { return '/tmp/example.txt'; },
    getTitle() { return 'example.txt'; },
    getGrammar() { return { scopeName: 'source.js' }; },
    getTextInBufferRange(range) {
      if (range[0][0] === 0 && range[0][1] === 1 && range[1][0] === 0 && range[1][1] === 4) return 'ell';
      return '';
    },
    getText() { return 'hello'; },
    getBuffer() {
      return {
        changeCount: 0,
        getText() { return 'hello'; },
        getPreferredLineEnding() { return '\n'; }
      };
    },
    getLineCount() { return 1; },
    isModified() { return false; },
    isDestroyed() { return false; },
    lineTextForBufferRow() { return 'hello'; },
    getTabLength() { return 2; },
    getSoftTabs() { return true; }
  };
  editor.selections = [editor.selection];
  return editor;
}

test('window.onDidChangeTextEditorSelection fires VSCode-shaped selection events for Atom selections', () => {
  clearCompatModules();

  const editor = makeEditor();
  global.document = { hasFocus() { return true; } };
  global.window = {};
  global.atom = {
    workspace: {
      getActiveTextEditor() { return editor; },
      onDidChangeActiveTextEditor() { return { dispose() {} }; },
      observeTextEditors(callback) { callback(editor); return { dispose() {} }; },
      getTextEditors() { return [editor]; },
      getActivePaneItem() { return editor; },
      getPanes() { return []; }
    },
    themes: {
      onDidChangeActiveThemes() { return { dispose() {} }; },
      getActiveThemeNames() { return ['one-dark-ui']; }
    }
  };

  const vscode = require('../lib/vscode');
  vscode.window._init();

  const events = [];
  vscode.window.onDidChangeTextEditorSelection(event => events.push(event));

  editor.setSelection([[0, 1], [0, 4]]);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].textEditor, vscode.window.activeTextEditor);
  assert.strictEqual(events[0].selections.length, 1);
  assert.strictEqual(events[0].textEditor.document.getText(events[0].selections[0]), 'ell');
  assert.strictEqual(events[0].selections[0].start.line, 0);
  assert.strictEqual(events[0].selections[0].start.character, 1);
  assert.strictEqual(events[0].selections[0].end.character, 4);
});
