'use strict';

const { TextDocument } = require('../types/text-document');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector } = require('../utils/selector');
const { atomPointToPosition, rangeToAtomRange } = require('../utils/position-range');

// pulsar-find-references' `find-references` service expects each provider to
// expose `isEditorSupported(editor)` / `findReferences(editor, atomPoint)`,
// and reads `reference.uri` as a plain fs path (compared against
// `editor.getPath()`) and `reference.range` as a real `atom.Range` (it calls
// `.containsPoint()` and `.toString()` on it, and passes it to
// `editor.markBufferRange()`), not a VSCode Range/Uri object.
const referenceProviders = [];

function registerFindReferencesProvider(documentSelector, vscodeProvider) {
  const entry = { documentSelector, provider: vscodeProvider };
  referenceProviders.push(entry);
  return () => {
    const idx = referenceProviders.indexOf(entry);
    if (idx >= 0) referenceProviders.splice(idx, 1);
  };
}

function providerForEditor(editor) {
  const grammar = editor && editor.getGrammar ? editor.getGrammar() : null;
  const grammarScopeName = grammar && grammar.scopeName;
  const entry = referenceProviders.find(({ documentSelector }) =>
    matchesSelector(grammarScopeName || '', documentSelector));
  return entry ? entry.provider : null;
}

async function vscodeLocationToReference(loc, sourceEditor, referencedSymbolName) {
  const uri = loc.uri || loc.targetUri;
  const range = loc.range || loc.targetSelectionRange || loc.targetRange;
  if (!uri || !range) return null;

  let atomRangeParts = rangeToAtomRange(range);
  if (!atomRangeParts) return null;

  const targetEditor = editorForReferenceUri(uri.fsPath, sourceEditor);
  const targetText = textForEditor(targetEditor);
  if (referencedSymbolName && targetText !== null) {
    const normalizedRange = findSymbolRangeWithin(atomRangeParts, referencedSymbolName, targetText);
    if (normalizedRange) {
      atomRangeParts = normalizedRange;
    } else if (targetEditor && targetEditor.isModified && targetEditor.isModified()) {
      // ElixirLS can merge stale on-disk locations into references for a dirty
      // document. A range that no longer contains the requested symbol cannot
      // safely be highlighted in the live buffer.
      return null;
    }
  }

  try {
    const { Range: AtomRange } = require('atom');
    return {
      uri: uri.fsPath,
      name: null,
      range: new AtomRange(atomRangeParts[0], atomRangeParts[1])
    };
  } catch (e) {
    return null;
  }
}

function editorForReferenceUri(filePath, sourceEditor) {
  if (!filePath) return null;
  if (sourceEditor && sourceEditor.getPath && sourceEditor.getPath() === filePath) {
    return sourceEditor;
  }
  try {
    const editors = atom.workspace && atom.workspace.getTextEditors
      ? atom.workspace.getTextEditors()
      : [];
    return editors.find(editor => editor.getPath && editor.getPath() === filePath) || null;
  } catch (e) {
    return null;
  }
}

function textForEditor(editor) {
  if (!editor) return null;
  try {
    const buffer = editor.getBuffer && editor.getBuffer();
    if (buffer && typeof buffer.getText === 'function') return buffer.getText();
    if (typeof editor.getText === 'function') return editor.getText();
  } catch (e) {
    return null;
  }
  return null;
}

function findSymbolRangeWithin(atomRangeParts, symbolName, text) {
  if (!symbolName || typeof text !== 'string') return null;
  const [start, end] = atomRangeParts;
  const lines = text.split(/\r?\n/);
  const startRow = Math.max(0, start[0]);
  const endRow = Math.min(end[0], lines.length - 1);

  for (let row = startRow; row <= endRow; row++) {
    const line = lines[row] || '';
    let from = 0;
    while (from <= line.length) {
      const column = line.indexOf(symbolName, from);
      if (column < 0) break;
      if (isSymbolOccurrence(line, column, symbolName)) {
        return [[row, column], [row, column + symbolName.length]];
      }
      from = column + Math.max(1, symbolName.length);
    }
  }
  return null;
}

function isSymbolOccurrence(line, column, symbolName) {
  const identifierChar = /[A-Za-z0-9_?!]/;
  const first = symbolName[0];
  const last = symbolName[symbolName.length - 1];
  if (identifierChar.test(first) && column > 0 && identifierChar.test(line[column - 1])) {
    return false;
  }
  const after = column + symbolName.length;
  if (identifierChar.test(last) && after < line.length && identifierChar.test(line[after])) {
    return false;
  }
  return true;
}

function provideFindReferences() {
  return {
    isEditorSupported(editor) {
      return !!providerForEditor(editor);
    },

    async findReferences(editor, atomPoint) {
      const vscodeProvider = providerForEditor(editor);
      if (!vscodeProvider || typeof vscodeProvider.provideReferences !== 'function') return null;

      const doc = new TextDocument(editor);
      const pos = atomPointToPosition(atomPoint);
      const tokenSource = new CancellationTokenSource();
      const ctx = { includeDeclaration: true };
      const referencedSymbolName = editor.getWordUnderCursor ? editor.getWordUnderCursor() : '';

      try {
        let locations = await vscodeProvider.provideReferences(doc, pos, ctx, tokenSource.token);
        if (!locations) return null;
        if (!Array.isArray(locations)) locations = [locations];

        const converted = (await Promise.all(locations.map(loc =>
          vscodeLocationToReference(loc, editor, referencedSymbolName)
        ))).filter(Boolean);
        const references = [];
        const seen = new Set();
        for (const reference of converted) {
          const key = `${reference.uri}\0${reference.range.toString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          references.push(reference);
        }
        if (!references.length) return null;

        return {
          type: 'data',
          baseUri: editor.getPath ? editor.getPath() : '',
          referencedSymbolName,
          references
        };
      } catch (e) {
        return { type: 'error', message: e && e.message ? e.message : String(e) };
      }
    }
  };
}

module.exports = { registerFindReferencesProvider, provideFindReferences };
