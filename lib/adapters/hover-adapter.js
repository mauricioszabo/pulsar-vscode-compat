'use strict';

const { Position } = require('../types/position');
const { TextDocument } = require('../types/text-document');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector, toAtomSelector } = require('../utils/selector');

// Registry of VSCode hover providers: {documentSelector, provider}
const hoverProviders = [];

function registerHoverProvider(documentSelector, provider) {
  const entry = { documentSelector, provider };
  hoverProviders.push(entry);
  return {
    dispose() {
      const index = hoverProviders.indexOf(entry);
      if (index !== -1) hoverProviders.splice(index, 1);
    }
  };
}

function provideHover() {
  return {
    name: 'pulsar-vscode-compat',
    priority: 1,
    get grammarScopes() { return registeredGrammarScopes(); },
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
          const converted = convertHover(hover);
          if (converted) return converted;
        } catch (e) {}
      }

      return null;
    }
  };
}

function registeredGrammarScopes() {
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

function atomPointToPosition(point) {
  if (point instanceof Position) return point;
  if (point && typeof point.row === 'number') return new Position(point.row, point.column || 0);
  if (Array.isArray(point)) return new Position(point[0] || 0, point[1] || 0);
  return new Position(0, 0);
}

function convertHover(hover) {
  if (!hover) return null;
  const rawContents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  const markdown = rawContents
    .map(contentToMarkdown)
    .filter(text => text && text.trim().length > 0)
    .join('\n\n');

  if (!markdown.trim()) return null;

  const result = {
    contents: {
      kind: 'markdown',
      value: markdown
    }
  };

  const range = rangeToAtomRange(hover.range);
  if (range) result.range = range;

  return result;
}

function contentToMarkdown(content) {
  if (content == null) return '';

  if (typeof content === 'string') return normalizeHoverMarkdown(content);

  if (content.language && content.value !== undefined) {
    const value = String(content.value);
    const fence = '`'.repeat(longestBacktickRun(value) + 1);
    const language = String(content.language || '').trim();
    return `${fence}${language}\n${value}\n${fence}`;
  }

  if (content.value !== undefined) return normalizeHoverMarkdown(String(content.value));

  return normalizeHoverMarkdown(String(content));
}

function rangeToAtomRange(range) {
  if (!range || !range.start || !range.end) return null;
  return {
    start: positionToAtomPoint(range.start),
    end: positionToAtomPoint(range.end),
    containsPoint(point) {
      const pos = point && typeof point.row === 'number' ? point : { row: point[0] || 0, column: point[1] || 0 };
      return compareAtomPoints(this.start, pos) <= 0 && compareAtomPoints(pos, this.end) <= 0;
    },
    intersectsWith(other) {
      if (!other || !other.start || !other.end) return false;
      return compareAtomPoints(this.start, other.end) <= 0 && compareAtomPoints(other.start, this.end) <= 0;
    }
  };
}

function positionToAtomPoint(position) {
  return { row: position.line || 0, column: position.character || 0 };
}

function compareAtomPoints(a, b) {
  if (a.row < b.row) return -1;
  if (a.row > b.row) return 1;
  return (a.column || 0) - (b.column || 0);
}

function normalizeHoverMarkdown(markdown) {
  // markdown-it intentionally refuses `file:` URLs in normal link syntax, which
  // makes LSP hover locations such as `[core.clj](file:///tmp/core.clj)` render
  // literally as Markdown source. VSCode hovers do render these as links. Convert
  // only that specific inline-link shape to sanitized HTML before handing the
  // rest of the hover body to Pulsar Hover's Markdown renderer.
  return String(markdown).replace(/\[([^\]\n]+)\]\((file:\/\/[^\s)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtmlAttribute(href)}">${escapeHtml(label)}</a>`;
  });
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

function longestBacktickRun(text) {
  const matches = String(text).match(/`+/g);
  return matches ? Math.max(...matches.map(match => match.length)) : 2;
}

module.exports = { registerHoverProvider, provideHover };
