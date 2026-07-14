'use strict';

const { TextDocument } = require('../types/text-document');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector, toAtomSelector } = require('../utils/selector');
const { atomPointToPosition, rangeToAtomRangeObject } = require('../utils/position-range');

function createHoverService(hoverProviders) {
  return {
    name: 'pulsar-vscode-compat',
    priority: 1,
    get grammarScopes() { return registeredGrammarScopes(hoverProviders); },
    async hover(editor, atomPosition) {
      const grammar = editor && editor.getGrammar ? editor.getGrammar() : null;
      const grammarScopeName = grammar && grammar.scopeName;
      const matching = hoverProviders.filter(h => matchesSelector(grammarScopeName || '', h.documentSelector));
      if (!matching.length) return null;

      const doc = new TextDocument(editor);
      const pos = atomPointToPosition(atomPosition);

      for (const { provider } of matching) {
        if (!provider || typeof provider.provideHover !== 'function') continue;
        try {
          const tokenSource = new CancellationTokenSource();
          const hover = await Promise.resolve(provider.provideHover(doc, pos, tokenSource.token));
          const converted = vscodeHoverToPulsarHover(hover);
          if (converted) return converted;
        } catch (e) {}
      }

      return null;
    }
  };
}

function registeredGrammarScopes(hoverProviders) {
  const scopes = [];
  for (const { documentSelector } of hoverProviders) {
    const selector = toAtomSelector(documentSelector);
    for (const scope of String(selector).split(/\s*,\s*/)) {
      if (!scope || scope === '*') continue;
      if (!scopes.includes(scope)) scopes.push(scope);
    }
  }
  return scopes.length ? scopes : undefined;
}

function vscodeHoverToPulsarHover(hover) {
  if (!hover) return null;
  const rawContents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  const markdown = rawContents
    .map(markedStringToMarkdown)
    .filter(text => text && text.trim().length > 0)
    .join('\n\n');

  if (!markdown.trim()) return null;

  const result = {
    contents: {
      kind: 'markdown',
      value: markdown
    }
  };

  const range = rangeToAtomRangeObject(hover.range);
  if (range) result.range = range;

  return result;
}

function markedStringToMarkdown(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item.value !== 'string') return '';
  if (item.language) return '```' + item.language + '\n' + item.value + '\n```';
  return item.value;
}

module.exports = { createHoverService };
