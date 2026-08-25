'use strict';

const { TextDocument } = require('../types/text-document');
const { CancellationTokenSource } = require('../types/cancellation');
const {
  CompletionItemKind,
  CompletionTriggerKind,
  CompletionItemInsertTextRule
} = require('../types/completion');
const { matchesSelector } = require('../utils/selector');
const { atomPointToPosition, rangeToAtomRange } = require('../utils/position-range');

const KIND_MAP = {
  [CompletionItemKind.Text]: 'text',
  [CompletionItemKind.Method]: 'method',
  [CompletionItemKind.Function]: 'function',
  [CompletionItemKind.Constructor]: 'function',
  [CompletionItemKind.Field]: 'field',
  [CompletionItemKind.Variable]: 'variable',
  [CompletionItemKind.Class]: 'class',
  [CompletionItemKind.Interface]: 'type',
  [CompletionItemKind.Module]: 'module',
  [CompletionItemKind.Property]: 'property',
  [CompletionItemKind.Unit]: 'value',
  [CompletionItemKind.Value]: 'value',
  [CompletionItemKind.Enum]: 'enum',
  [CompletionItemKind.Keyword]: 'keyword',
  [CompletionItemKind.Snippet]: 'snippet',
  [CompletionItemKind.Color]: 'value',
  [CompletionItemKind.File]: 'import',
  [CompletionItemKind.Reference]: 'reference',
  [CompletionItemKind.Folder]: 'import',
  [CompletionItemKind.Constant]: 'constant',
  [CompletionItemKind.Struct]: 'type',
  [CompletionItemKind.Event]: 'function',
  [CompletionItemKind.Operator]: 'keyword',
  [CompletionItemKind.TypeParameter]: 'type'
};

function completionContext(triggerCharacter, activatedManually) {
  const isTriggerCharacter = !!triggerCharacter && !activatedManually;
  return {
    triggerKind: isTriggerCharacter ? CompletionTriggerKind.TriggerCharacter : CompletionTriggerKind.Invoke,
    triggerCharacter: isTriggerCharacter ? triggerCharacter : undefined
  };
}

function normalizeCompletionResult(result) {
  if (!result) return { items: [], isIncomplete: false };
  if (Array.isArray(result)) return { items: result, isIncomplete: false };
  return {
    items: Array.isArray(result.items) ? result.items : [],
    isIncomplete: !!result.isIncomplete
  };
}

function makeAutocompleteProvider(documentSelector, vscodeProvider, triggerChars) {
  const selector = buildAtomSelector(documentSelector);
  const atomProvider = {
    selector,
    triggerCharacters: triggerChars || [],
    inclusionPriority: 1,
    excludeLowerPriority: false,
    _vscodeDocumentSelector: documentSelector,
    _vscodeProvider: vscodeProvider,

    async _provideVSCodeCompletionItems(doc, pos, triggerCharacter, token) {
      const editor = doc && doc._editor;
      const grammar = editor && editor.getGrammar && editor.getGrammar();
      if (grammar && !matchesSelector(grammar.scopeName, documentSelector)) return { items: [], isIncomplete: false };
      const result = await vscodeProvider.provideCompletionItems(
        doc,
        pos,
        token,
        completionContext(triggerCharacter, false)
      );
      return normalizeCompletionResult(result);
    },

    async getSuggestions({ editor, bufferPosition, prefix: autocompletePrefix, triggerCharacter, activatedManually }) {
      const grammar = editor.getGrammar();
      if (!matchesSelector(grammar.scopeName, documentSelector)) return null;

      const doc = new TextDocument(editor);
      const pos = atomPointToPosition(bufferPosition);
      const tokenSource = new CancellationTokenSource();
      const context = completionContext(triggerCharacter, activatedManually);

      try {
        let result = await vscodeProvider.provideCompletionItems(doc, pos, tokenSource.token, context);
        if (!result) return null;

        const { items } = normalizeCompletionResult(result);
        const prefixRange = getCompletionPrefixRange(editor, bufferPosition, autocompletePrefix)
        const pulsarItems = items.map(item => convertItem(item, editor, bufferPosition, atomProvider, prefixRange))
        const prefix = typeof autocompletePrefix === 'string'
          ? autocompletePrefix
          : editor.getTextInBufferRange(prefixRange)
        const filterCandidates = pulsarItems.map(item => item._vscodeItem.filterText || item.displayText || item.text || '')
        const candidates = atom.ui.fuzzyMatcher.setCandidates(filterCandidates)
        const matches = candidates.match(prefix)
        return matches.map(m => pulsarItems[m.id])
      } catch (e) {
        console.error('[vscode-compat] completion error:', e);
        return null;
      }
    },

    async resolveCompletionItem(suggestion) {
      if (!vscodeProvider.resolveCompletionItem || !suggestion._vscodeItem) return suggestion;
      try {
        const tokenSource = new CancellationTokenSource();
        const resolved = await vscodeProvider.resolveCompletionItem(suggestion._vscodeItem, tokenSource.token);
        if (resolved) {
          return convertItem(
            resolved,
            suggestion._editor,
            suggestion._bufferPosition,
            atomProvider,
            suggestion._prefixRange
          );
        }
      } catch (e) {}
      return suggestion;
    },

    onDidInsertSuggestion({ editor, suggestion }) {
      if (suggestion._vscodeItem && suggestion._vscodeItem.command) {
        executeVSCodeCommand(suggestion._vscodeItem.command);
      }
    }
  };

  return atomProvider;
}

function convertItem(item, editor, bufferPosition, atomProvider, prefixRange) {
  const label = typeof item.label === 'string' ? item.label : (item.label && item.label.label) || '';
  let insertText;
  if (item.insertText) {
    insertText = typeof item.insertText === 'string' ? item.insertText : item.insertText.value;
  } else {
    insertText = label;
  }

  const isSnippet = !!item.insertText && (
    typeof item.insertText !== 'string' ||
    (item.insertTextRules & CompletionItemInsertTextRule.InsertAsSnippet) !== 0
  );
  const insertionRange = completionItemRangesToAtomRanges(item, editor, prefixRange);

  const documentationMarkdown = completionDocumentationToMarkdown(item.documentation);
  const suggestion = {
    text: isSnippet ? undefined : insertText,
    snippet: isSnippet ? insertText : undefined,
    textEdit: isSnippet ? { range: insertionRange, newText: insertText } : undefined,
    displayText: label,
    type: KIND_MAP[item.kind] || 'value',
    description: documentationMarkdown || '',
    descriptionMarkdown: documentationMarkdown || undefined,
    rightLabel: item.detail || '',
    ranges: isSnippet ? undefined : [insertionRange],
    sortIndex: item.sortText,
    _vscodeItem: item,
    _vscodeAtomProvider: atomProvider,
    _editor: editor,
    _bufferPosition: bufferPosition,
    _prefixRange: prefixRange
  };

  return suggestion;
}

function completionItemRangesToAtomRanges(item, editor, prefixRange) {
  if(!item.range) {
    return prefixRange || getCurrentPrefixRange(editor);
  } else if(item.range.inserting) {
    return rangeToAtomRange(item.range.inserting);
  } else {
    return rangeToAtomRange(item.range);
  }
}

function getCompletionPrefixRange(editor, bufferPosition, prefix) {
  if (typeof prefix !== 'string') return getCurrentPrefixRange(editor);

  const row = bufferPosition && (bufferPosition.row ?? bufferPosition[0]);
  const column = bufferPosition && (bufferPosition.column ?? bufferPosition[1]);
  if (typeof row !== 'number' || typeof column !== 'number') return getCurrentPrefixRange(editor);

  return [[row, Math.max(0, column - prefix.length)], [row, column]];
}

function getCurrentPrefixRange(editor) {
  const wordRange = editor.getLastCursor().getCurrentWordBufferRange()
  wordRange.end = editor.getSelectedBufferRange().end
  return wordRange
}

function completionDocumentationToMarkdown(documentation) {
  if (documentation == null) return '';

  if (documentation.language && documentation.value !== undefined) {
    const language = String(documentation.language || '').trim();
    const value = String(documentation.value);
    const fence = '`'.repeat(longestBacktickRun(value) + 1);
    return normalizeCompletionMarkdown(`${fence}${language}\n${value}\n${fence}`);
  }

  const value = documentation.value !== undefined ? documentation.value : documentation;
  if (value == null) return '';
  return normalizeCompletionMarkdown(String(value));
}

function normalizeCompletionMarkdown(markdown) {
  return String(markdown).replace(/\[([^\]\n]+)\]\((file:\/\/[^\s)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtmlAttribute(href)}">${escapeHtml(label)}</a>`;
  });
}

function longestBacktickRun(text) {
  const matches = String(text).match(/`+/g);
  return matches ? Math.max(...matches.map(match => match.length)) : 2;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  }[char]));
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/["']/g, char => ({
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function buildAtomSelector(documentSelector) {
  const entries = Array.isArray(documentSelector) ? documentSelector : [documentSelector];
  const scopes = [];
  for (const entry of entries) {
    if (entry === '*') return '*';
    const lang = typeof entry === 'string' ? entry : (entry && entry.language);
    if (!lang || lang === '*') return '*';
    const { languageToScope } = require('../utils/selector');
    const scope = languageToScope(lang);
    scopes.push(...scope.split(', '));
  }
  return scopes.map(s => `.${s.replace(/\./g, '\\.')}`).join(', ');
}

function executeVSCodeCommand(command) {
  if (!command) return;
  try {
    atom.commands.dispatch(atom.views.getView(atom.workspace), command.command, command.arguments);
  } catch (e) {}
}

module.exports = { makeAutocompleteProvider };
