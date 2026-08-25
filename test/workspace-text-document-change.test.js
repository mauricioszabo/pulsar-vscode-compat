'use strict';

const assert = require('assert');

let observedEditor;
const bufferChangeListeners = [];
let editorDisplayChangeListener;

function atomRange(startRow, startColumn, endRow, endColumn) {
  return {
    start: { row: startRow, column: startColumn },
    end: { row: endRow, column: endColumn },
    getExtent() { return { row: endRow - startRow, column: endColumn - startColumn }; }
  };
}

// One TextBuffer, two TextEditors: the split-pane / same-file-twice case.
const buffer = {
  getText() { return 'current document containing IO.\n'; },
  getPreferredLineEnding() { return '\n'; },
  characterIndexForPosition(point) { return 9000 + point.column; },
  onDidChange(listener) {
    bufferChangeListeners.push(listener);
    return { dispose() {} };
  },
  onWillSave() { return { dispose() {} }; },
  onDidSave() { return { dispose() {} }; }
};

function makeEditor() {
  return {
    getPath() { return '/tmp/connection.ex'; },
    getTitle() { return 'connection.ex'; },
    getGrammar() { return { scopeName: 'source.elixir' }; },
    getBuffer() { return buffer; },
    getLineCount() { return 330; },
    getTextInBufferRange() {
      throw new Error('buffer change events already provide the exact inserted text');
    },
    isModified() { return true; },
    isDestroyed() { return false; },
    onDidChange(listener) {
      editorDisplayChangeListener = listener;
      return { dispose() {} };
    },
    onDidChangeGrammar() { return { dispose() {} }; },
    onDidDestroy() { return { dispose() {} }; }
  };
}

const editor = makeEditor();
const splitEditor = makeEditor();

global.atom = {
  workspace: {
    observeTextEditors(callback) {
      observedEditor = callback;
      callback(editor);
      callback(splitEditor);
      return { dispose() {} };
    },
    getTextEditors() { return [editor, splitEditor]; }
  },
  config: {
    onDidChange() { return { dispose() {} }; },
    get() { return undefined; }
  },
  project: {
    onDidChangePaths() { return { dispose() {} }; },
    getPaths() { return []; }
  },
  packages: {
    getLoadedPackages() { return []; },
    getAvailablePackagePaths() { return []; }
  }
};

delete require.cache[require.resolve('../lib/types/text-document')];
delete require.cache[require.resolve('../lib/namespaces/workspace')];
const workspace = require('../lib/namespaces/workspace');
workspace._init();

assert.strictEqual(typeof observedEditor, 'function');
assert.strictEqual(
  bufferChangeListeners.length,
  1,
  'editors sharing a TextBuffer must produce a single change subscription, otherwise every edit is reported twice'
);
assert.strictEqual(
  editorDisplayChangeListener,
  undefined,
  'workspace synchronization must not derive document content from display-layer changes'
);

const notify = bufferChangeListeners[0];
const events = [];
workspace.onDidChangeTextDocument(value => { events.push(value); });

assert.strictEqual(
  workspace.textDocuments[0].version,
  1,
  'a freshly opened document starts at version 1'
);

// --- a single insertion -----------------------------------------------------
notify({
  changes: [{
    oldRange: atomRange(328, 4, 328, 4),
    newRange: atomRange(328, 4, 329, 0),
    oldText: '',
    newText: '    IO.\n'
  }]
});

assert.strictEqual(events.length, 1, 'one edit must produce exactly one VSCode event');
const first = events[0];
assert.strictEqual(first.document.version, 2);
assert.strictEqual(first.contentChanges.length, 1);
assert.strictEqual(first.contentChanges[0].range.start.line, 328);
assert.strictEqual(first.contentChanges[0].range.start.character, 4);
assert.strictEqual(first.contentChanges[0].range.end.line, 328);
assert.strictEqual(first.contentChanges[0].range.end.character, 4);
assert.strictEqual(first.contentChanges[0].rangeOffset, 9004);
assert.strictEqual(first.contentChanges[0].rangeLength, 0);
assert.strictEqual(first.contentChanges[0].text, '    IO.\n');

// --- the version must keep moving, or servers reuse a cached parse ----------
notify({
  changes: [{
    oldRange: atomRange(329, 0, 329, 0),
    newRange: atomRange(329, 0, 329, 2),
    oldText: '',
    newText: 'in'
  }]
});

assert.strictEqual(events.length, 2);
assert.strictEqual(events[1].document.version, 3, 'each change must advance the document version');
assert.strictEqual(
  workspace.textDocuments[1].version,
  3,
  'every document view of a shared buffer reports the same version'
);

// --- multi-change transactions apply back-to-front --------------------------
// Two cursors editing the same line: TextBuffer reports them ascending, against
// the pre-transaction document.
notify({
  changes: [
    { oldRange: atomRange(10, 2, 10, 5), newRange: atomRange(10, 2, 10, 4), oldText: 'foo', newText: 'ab' },
    { oldRange: atomRange(10, 9, 10, 9), newRange: atomRange(10, 8, 10, 12), oldText: '', newText: 'quux' }
  ]
});

const multi = events[2];
assert.strictEqual(multi.contentChanges.length, 2);
assert.strictEqual(
  multi.contentChanges[0].range.start.character,
  9,
  'contentChanges must run from the end of the document backwards so earlier ranges stay valid'
);
assert.strictEqual(multi.contentChanges[1].range.start.character, 2);
assert.strictEqual(multi.contentChanges[0].text, 'quux');
assert.strictEqual(multi.contentChanges[1].text, 'ab');
// The trailing change is offset by the -1 the leading change already applied to
// the buffer; its offset must be stated against the document it is applied to.
assert.strictEqual(multi.contentChanges[0].rangeOffset, 9009);
assert.strictEqual(multi.contentChanges[1].rangeOffset, 9002);
assert.strictEqual(multi.contentChanges[0].rangeLength, 0);
assert.strictEqual(multi.contentChanges[1].rangeLength, 3);

console.log('workspace text document change tests passed');
