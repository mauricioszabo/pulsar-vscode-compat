'use strict';

const { rangeToAtomRange } = require('../utils/position-range');

const DiagnosticSeverity = Object.freeze({ Error: 0, Warning: 1, Information: 2, Hint: 3 });
const DiagnosticTag = Object.freeze({ Unnecessary: 1, Deprecated: 2 });

class DiagnosticRelatedInformation {
  constructor(location, message) {
    this.location = location;
    this.message = message;
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity !== undefined ? severity : DiagnosticSeverity.Error;
    this.source = undefined;
    this.code = undefined;
    this.relatedInformation = undefined;
    this.tags = undefined;
    this.codeDescription = undefined;
  }
}

class DiagnosticCollection {
  constructor(name, linterIndie, onDidChange) {
    this.name = name;
    this._linterIndie = linterIndie;
    this._onDidChange = onDidChange;
    this._map = new Map();
  }

  set(uri, diagnostics) {
    if (Array.isArray(uri) && diagnostics === undefined) {
      const changed = [];
      for (const entry of uri) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        this._setOne(entry[0], entry[1], changed);
      }
      this._sync();
      this._fireChange(changed);
      return;
    }

    const changed = [];
    this._setOne(uri, diagnostics, changed);
    this._sync();
    this._fireChange(changed);
  }

  _setOne(uri, diagnostics, changed) {
    if (!uri) return;
    const key = uri.toString();
    if (!diagnostics) {
      this._map.delete(key);
    } else {
      this._map.set(key, diagnostics);
    }
    changed.push(uri);
  }

  delete(uri) {
    this._map.delete(uri.toString());
    this._sync();
    this._fireChange([uri]);
  }

  clear() {
    const uris = [];
    this.forEach(uri => uris.push(uri));
    this._map.clear();
    if (this._linterIndie) this._linterIndie.setAllMessages([]);
    this._fireChange(uris);
  }

  forEach(callback, thisArg) {
    this._map.forEach((diags, uriStr) => {
      const { Uri } = require('./uri');
      callback.call(thisArg, Uri.parse(uriStr), diags, this);
    });
  }

  get(uri) { return this._map.get(uri.toString()); }
  has(uri) { return this._map.has(uri.toString()); }

  get size() { return this._map.size; }

  [Symbol.iterator]() {
    const { Uri } = require('./uri');
    const entries = [...this._map.entries()].map(([k, v]) => [Uri.parse(k), v]);
    return entries[Symbol.iterator]();
  }

  dispose() {
    this.clear();
  }

  _fireChange(uris) {
    if (!this._onDidChange || !uris || !uris.length) return;
    try { this._onDidChange(uris); } catch (e) {}
  }

  _sync() {
    if (!this._linterIndie) return;
    const messages = [];
    const severityMap = ['error', 'warning', 'info', 'info'];
    this._map.forEach((diags, uriStr) => {
      const { Uri } = require('./uri');
      const filePath = Uri.parse(uriStr).fsPath;
      for (const d of diags) {
        messages.push({
          severity: severityMap[d.severity] || 'error',
          location: {
            file: filePath,
            position: rangeToAtomRange(d.range)
          },
          excerpt: d.message,
          description: d.relatedInformation ? d.relatedInformation.map(r => r.message).join('\n') : undefined,
          url: d.codeDescription ? d.codeDescription.href : undefined,
          linterName: d.source || this.name
        });
      }
    });
    this._linterIndie.setAllMessages(messages);
  }
}

module.exports = { DiagnosticSeverity, DiagnosticTag, Diagnostic, DiagnosticRelatedInformation, DiagnosticCollection };
