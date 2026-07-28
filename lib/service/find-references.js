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

async function vscodeLocationToReference(loc) {
  const uri = loc.uri || loc.targetUri;
  const range = loc.range || loc.targetSelectionRange || loc.targetRange;
  if (!uri || !range) return null;

  const atomRangeParts = rangeToAtomRange(range);
  if (!atomRangeParts) return null;

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

      try {
        let locations = await vscodeProvider.provideReferences(doc, pos, ctx, tokenSource.token);
        if (!locations) return null;
        if (!Array.isArray(locations)) locations = [locations];

        const references = (await Promise.all(locations.map(vscodeLocationToReference))).filter(Boolean);
        if (!references.length) return null;

        return {
          type: 'data',
          baseUri: editor.getPath ? editor.getPath() : '',
          referencedSymbolName: editor.getWordUnderCursor ? editor.getWordUnderCursor() : '',
          references
        };
      } catch (e) {
        return { type: 'error', message: e && e.message ? e.message : String(e) };
      }
    }
  };
}

module.exports = { registerFindReferencesProvider, provideFindReferences };
