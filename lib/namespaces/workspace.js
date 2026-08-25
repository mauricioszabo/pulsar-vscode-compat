'use strict';

const { EventEmitter } = require('../types/event-emitter');
const { Uri } = require('../types/uri');
const { getTextDocument, forgetTextDocument, bumpDocumentVersion } = require('../types/text-document');
const { WorkspaceEdit } = require('../types/workspace-edit');
const { FileSystemWatcher } = require('../types/file-system-watcher');
const { Disposable } = require('../types/disposable');
const { CancellationTokenSource } = require('../types/cancellation');
const { Range } = require('../types/range');
const { Position } = require('../types/position');
const { atomRangeToRange, rangeToAtomRange } = require('../utils/position-range');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { isDeepStrictEqual } = require('util');

const _onDidOpenTextDocument = new EventEmitter();
const _onDidCloseTextDocument = new EventEmitter();
const _onDidChangeTextDocument = new EventEmitter();
const _onDidSaveTextDocument = new EventEmitter();
const _onWillSaveTextDocument = new EventEmitter();
const _onDidChangeConfiguration = new EventEmitter();
const _onDidChangeWorkspaceFolders = new EventEmitter();
const _onDidCreateFiles = new EventEmitter();
const _onDidDeleteFiles = new EventEmitter();
const _onDidRenameFiles = new EventEmitter();
const _onWillCreateFiles = new EventEmitter();
const _onWillDeleteFiles = new EventEmitter();
const _onWillRenameFiles = new EventEmitter();
const _onDidGrantWorkspaceTrust = new EventEmitter();
const _onDidOpenNotebookDocument = new EventEmitter();
const _onDidCloseNotebookDocument = new EventEmitter();
const _onDidChangeNotebookDocument = new EventEmitter();
const _onDidSaveNotebookDocument = new EventEmitter();

// Defaults for VSCode's built-in configuration keys that extensions commonly
// read. These keys do not come from any extension manifest, but VSCode still
// provides stable values for them. Returning undefined can break extensions that
// feed these values into parser/formatter code during activation.
const VS_CODE_CONFIGURATION_DEFAULTS = Object.freeze({
  'editor.maxTokenizationLineLength': 20000,
  'editor.rulers': []
});

// Virtual document content providers: scheme → provider
const contentProviders = new Map();
// FileSystemProvider registrations: scheme → { provider, options }
const fileSystemProviders = new Map();

let _initialized = false;
let _configurationDefaults = null;
const openedDocumentLanguageIds = new WeakMap();
const observedBuffers = new WeakSet();

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return null; }
}

function cloneDefaultValue(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function configurationSections(contributes) {
  if (!contributes || !contributes.configuration) return [];
  return Array.isArray(contributes.configuration) ? contributes.configuration : [contributes.configuration];
}

function packageSearchPaths() {
  const paths = new Set();

  try {
    for (const pkg of atom.packages.getLoadedPackages()) {
      if (pkg && pkg.path) paths.add(pkg.path);
    }
  } catch (e) {}

  try {
    for (const pkgPath of atom.packages.getAvailablePackagePaths()) {
      paths.add(pkgPath);
    }
  } catch (e) {}

  const userPackagesPath = path.join(os.homedir(), '.pulsar', 'packages');
  try {
    for (const name of fs.readdirSync(userPackagesPath)) {
      paths.add(path.join(userPackagesPath, name));
    }
  } catch (e) {}

  return Array.from(paths);
}

function loadConfigurationDefaults() {
  if (_configurationDefaults) return _configurationDefaults;

  _configurationDefaults = new Map();
  for (const packagePath of packageSearchPaths()) {
    const manifest = readJSON(path.join(packagePath, 'extension', 'package.json'));
    if (!manifest || !manifest.contributes) continue;

    for (const section of configurationSections(manifest.contributes)) {
      const properties = section && section.properties;
      if (!properties) continue;

      for (const [key, schema] of Object.entries(properties)) {
        if (schema && Object.prototype.hasOwnProperty.call(schema, 'default') && !_configurationDefaults.has(key)) {
          _configurationDefaults.set(key, schema.default);
        }
      }
    }
  }

  return _configurationDefaults;
}

function getConfigurationDefault(fullKey) {
  if (Object.prototype.hasOwnProperty.call(VS_CODE_CONFIGURATION_DEFAULTS, fullKey)) {
    return cloneDefaultValue(VS_CODE_CONFIGURATION_DEFAULTS[fullKey]);
  }

  const defaults = loadConfigurationDefaults();
  if (!defaults.has(fullKey)) return undefined;
  return cloneDefaultValue(defaults.get(fullKey));
}

function textDocumentContentChanges(editor, changes) {
  const normalizedChanges = Array.isArray(changes)
    ? changes
    : (changes && Array.isArray(changes.changes) ? changes.changes : []);
  const buffer = editor.getBuffer && editor.getBuffer();

  // A single buffer transaction can carry several changes (multiple cursors,
  // auto-indent, snippet expansion, undo...). TextBuffer reports them in
  // ascending order with every range expressed against the pre-transaction
  // document, but consumers apply contentChanges one after another, so those
  // ranges go stale as soon as an earlier change resizes the text before them.
  // VSCode avoids this by ordering contentChanges from the end of the document
  // backwards, which keeps every range valid; do the same.
  let precedingLengthDelta = 0;
  const contentChanges = normalizedChanges.map(change => {
    const oldRange = change.oldRange || change.range;
    const newRange = change.newRange || oldRange;
    const text = typeof change.newText === 'string'
      ? change.newText
      : (newRange && editor.getTextInBufferRange ? editor.getTextInBufferRange(newRange) : '');
    const oldText = typeof change.oldText === 'string' ? change.oldText : undefined;
    const range = oldRange ? atomRangeToRange(oldRange) : new Range(new Position(0, 0), new Position(0, 0));

    // characterIndexForPosition reads the already-updated buffer, so subtract
    // what the changes ahead of this one added, to land on the offset in the
    // document this change is actually applied to.
    const offsetPoint = newRange && newRange.start;
    const rangeOffset = offsetPoint && buffer && buffer.characterIndexForPosition
      ? buffer.characterIndexForPosition(offsetPoint) - precedingLengthDelta
      : 0;
    if (oldText !== undefined) precedingLengthDelta += text.length - oldText.length;

    return {
      range,
      rangeOffset,
      rangeLength: oldText !== undefined
        ? oldText.length
        : (oldRange && typeof oldRange.getExtent === 'function'
          ? oldRange.getExtent().row === 0 ? oldRange.getExtent().column : undefined
          : undefined),
      text
    };
  });

  return contentChanges.reverse();
}

function configurationSectionOwners(section) {
  const owners = [];
  try {
    for (const pkg of atom.packages.getLoadedPackages()) {
      const meta = pkg.metadata && pkg.metadata._vscodeExtension;
      if (meta && Array.isArray(meta.configSections) && meta.configSections.includes(section)) {
        owners.push(pkg.name);
      }
    }
  } catch (_) {}
  return owners;
}

function valueAtKeyPath(object, keyPath) {
  return String(keyPath).split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

function configurationChangeEvent(atomEvent) {
  if (!atomEvent || !Object.prototype.hasOwnProperty.call(atomEvent, 'oldValue') ||
      !Object.prototype.hasOwnProperty.call(atomEvent, 'newValue')) {
    return { affectsConfiguration: () => true };
  }

  return {
    affectsConfiguration(section) {
      const parts = String(section || '').split('.');
      const root = parts.shift();
      const remainder = parts.join('.');
      const owners = configurationSectionOwners(root);
      const keyPaths = owners.length
        ? owners.flatMap(owner => remainder
          ? [`${owner}.${remainder}`, `${owner}.${root}.${remainder}`]
          : [owner, `${owner}.${root}`])
        : [section];
      return keyPaths.some(keyPath =>
        !isDeepStrictEqual(
          valueAtKeyPath(atomEvent.oldValue, keyPath),
          valueAtKeyPath(atomEvent.newValue, keyPath)
        )
      );
    }
  };
}

// The editor a buffer's events are reported through. Buffer subscriptions
// outlive the editor that happened to register them, so fall back to any other
// live editor still showing the same buffer.
function liveEditorForBuffer(buffer, registeredEditor) {
  if (!registeredEditor || !registeredEditor.isDestroyed || !registeredEditor.isDestroyed()) {
    return registeredEditor;
  }
  try {
    return atom.workspace.getTextEditors().find(other => other.getBuffer() === buffer) || registeredEditor;
  } catch (e) {
    return registeredEditor;
  }
}

function _init() {
  if (_initialized) return;
  _initialized = true;

  atom.workspace.observeTextEditors(editor => {
    const document = getTextDocument(editor);
    let lastLanguageId = document && document.languageId;
    fireDidOpenTextDocument(document);

    if (typeof editor.onDidChangeGrammar === 'function') {
      editor.onDidChangeGrammar(() => {
        const changedDocument = getTextDocument(editor);
        const nextLanguageId = changedDocument && changedDocument.languageId;
        if (nextLanguageId && nextLanguageId !== lastLanguageId) {
          lastLanguageId = nextLanguageId;
          fireDidOpenTextDocument(changedDocument);
        }
      });
    }

    const buffer = editor.getBuffer();

    // Several TextEditors can share one TextBuffer (split panes, or the same
    // file opened in two tabs). Change and save events belong to the buffer, so
    // subscribing once per editor would emit one VSCode event per editor for a
    // single edit — and a language server that applies both copies of the same
    // incremental change ends up with a corrupted document.
    if (!buffer || !observedBuffers.has(buffer)) {
      if (buffer) observedBuffers.add(buffer);

      const onDidChange = changes => {
        const changedEditor = liveEditorForBuffer(buffer, editor);
        // Bump before building the event: consumers read document.version off
        // the event and expect the version the change produced.
        bumpDocumentVersion(buffer);
        _onDidChangeTextDocument.fire({
          document: getTextDocument(changedEditor),
          contentChanges: textDocumentContentChanges(changedEditor, changes),
          reason: undefined
        });
      };

      if (buffer && typeof buffer.onDidChange === 'function') {
        buffer.onDidChange(onDidChange);
      } else {
        editor.onDidChange(onDidChange);
      }

      buffer.onWillSave(() => {
        _onWillSaveTextDocument.fire({
          document: getTextDocument(liveEditorForBuffer(buffer, editor)),
          reason: 1
        });
      });

      buffer.onDidSave(() => {
        _onDidSaveTextDocument.fire(getTextDocument(liveEditorForBuffer(buffer, editor)));
      });
    }

    editor.onDidDestroy(() => {
      const closedDocument = getTextDocument(editor);
      if (closedDocument) openedDocumentLanguageIds.delete(closedDocument);
      _onDidCloseTextDocument.fire(closedDocument);
      forgetTextDocument(editor, closedDocument);
    });
  });

  atom.config.onDidChange(atomEvent => {
    _onDidChangeConfiguration.fire(configurationChangeEvent(atomEvent));
  });

  atom.project.onDidChangePaths(paths => {
    _onDidChangeWorkspaceFolders.fire({
      added: paths.map(p => ({ uri: Uri.file(p), name: path.basename(p), index: 0 })),
      removed: []
    });
  });
}

function fireDidOpenTextDocument(document) {
  if (!document) return;
  openedDocumentLanguageIds.set(document, document.languageId);
  _onDidOpenTextDocument.fire(document);
}

function _ensureTextDocument(editor) {
  const document = getTextDocument(editor);
  if (!document) return document;

  const languageId = document.languageId;
  if (openedDocumentLanguageIds.get(document) !== languageId) {
    fireDidOpenTextDocument(document);
  }

  return document;
}

function makeVirtualTextEditor(uri, content) {
  const editor = atom.workspace.buildTextEditor({ autoHeight: false });
  editor._vscodeUri = uri;
  editor._vscodeTitle = path.basename(uri.path || '') || uri.authority || uri.scheme;
  editor.getURI = () => uri.toString();
  editor.getTitle = () => editor._vscodeTitle;
  editor.setText(content || '');

  // VSCode TextDocumentContentProvider documents are readonly virtual
  // documents. They should be scrollable/selectable, but not user-editable.
  if (typeof editor.setReadOnly === 'function') editor.setReadOnly(true);

  // Atom/Pulsar considers any non-empty untitled buffer modified, even if it is
  // readonly. Virtual provider documents do not have a real file to save, so they
  // must also opt out of dirty/save prompting at the pane item level.
  editor.isModified = () => false;
  editor.shouldPromptToSave = () => false;
  editor.save = () => Promise.resolve(editor);
  editor.saveAs = () => Promise.resolve(editor);

  return editor;
}

function missingVsCodeUserKeybindingsPath(filePath) {
  const atomHome = process.env.ATOM_HOME || path.join(os.homedir(), '.pulsar');
  return path.resolve(filePath) === path.resolve(atomHome, 'User', 'keybindings.json');
}

function openTextDocument(uriOrPathOrOptions) {
  // VSCode's workspace.openTextDocument creates an in-memory TextDocument
  // model without opening a visible editor — display only happens via
  // window.showTextDocument. atom.workspace.open always attaches the editor
  // to a pane (the {activatePane:false} flags only suppress focus, not the
  // tab itself), so we use atom.workspace.buildTextEditor (for new/untitled)
  // or createItemForURI (for path-backed) to materialize the editor without
  // adding it to a pane.
  let filePath;
  if (!uriOrPathOrOptions) {
    return Promise.resolve(getTextDocument(atom.workspace.buildTextEditor()));
  } else if (typeof uriOrPathOrOptions === 'string') {
    filePath = uriOrPathOrOptions;
  } else if (uriOrPathOrOptions.scheme && uriOrPathOrOptions.scheme !== 'file') {
    const uri = uriOrPathOrOptions;

    const provider = contentProviders.get(uri.scheme);
    const contentPromise = provider && typeof provider.provideTextDocumentContent === 'function'
      ? Promise.resolve(provider.provideTextDocumentContent(uri, new CancellationTokenSource().token))
      : Promise.resolve(uri.query || '');

    return contentPromise.then(content => getTextDocument(makeVirtualTextEditor(uri, content)));
  } else if (uriOrPathOrOptions.fsPath) {
    filePath = uriOrPathOrOptions.fsPath;
  } else if (uriOrPathOrOptions.content !== undefined || uriOrPathOrOptions.language) {
    // Untitled document with content
    const editor = atom.workspace.buildTextEditor();
    if (uriOrPathOrOptions.content) editor.setText(uriOrPathOrOptions.content);
    if (uriOrPathOrOptions.language) {
      const grammar = atom.grammars.grammarForScopeName(`source.${uriOrPathOrOptions.language}`);
      if (grammar) editor.setGrammar(grammar);
    }
    return Promise.resolve(getTextDocument(editor));
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      const error = new Error(`EISDIR: illegal operation on a directory, open '${filePath}'`);
      error.code = 'EISDIR';
      error.path = filePath;
      return Promise.reject(error);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      if (missingVsCodeUserKeybindingsPath(filePath)) {
        return Promise.resolve(getTextDocument(makeVirtualTextEditor(Uri.file(filePath), '[]')));
      }
      error.path = filePath;
      return Promise.reject(error);
    }
    if (error && error.code === 'EISDIR') return Promise.reject(error);
    return Promise.reject(error);
  }

  return Promise.resolve(atom.workspace.createItemForURI(filePath))
    .then(editor => getTextDocument(editor));
}

function saveAll(includeUntitled) {
  const editors = atom.workspace.getTextEditors();
  const saves = editors
    .filter(e => e.isModified() && (includeUntitled || !e.isUntitled()))
    .map(e => e.getBuffer().save().catch(() => {}));
  return Promise.all(saves).then(() => undefined);
}

function normalizeGlobPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

const GLOB_REGEX_SPECIALS = /[|\\{}()[\]^$+?.]/g;

function globToRegExp(pattern) {
  const normalizedPattern = normalizeGlobPath(pattern || '**/*');
  let source = '^';

  for (let i = 0; i < normalizedPattern.length; i++) {
    const char = normalizedPattern[i];
    const next = normalizedPattern[i + 1];

    if (char === '*') {
      if (next === '*') {
        const afterGlobstar = normalizedPattern[i + 2];
        if (afterGlobstar === '/') {
          source += '(?:.*\/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    if (char === '{') {
      const end = normalizedPattern.indexOf('}', i + 1);
      if (end !== -1) {
        const alternatives = normalizedPattern.slice(i + 1, end)
          .split(',')
          .map(part => part.replace(GLOB_REGEX_SPECIALS, '\\$&'));
        source += `(?:${alternatives.join('|')})`;
        i = end;
        continue;
      }
    }

    source += char.replace(GLOB_REGEX_SPECIALS, '\\$&');
  }

  source += '$';
  return new RegExp(source, process.platform === 'win32' ? 'i' : '');
}

function basePathFromGlobPattern(globPattern) {
  if (!globPattern || typeof globPattern === 'string') return null;
  const base = globPattern.baseUri || globPattern.base;
  if (!base) return null;
  if (typeof base === 'string') return base;
  if (base.fsPath) return base.fsPath;
  if (base.uri && base.uri.fsPath) return base.uri.fsPath;
  return null;
}

function patternFromGlobPattern(globPattern) {
  if (typeof globPattern === 'string') return globPattern;
  return (globPattern && globPattern.pattern) || '**/*';
}

function isExcludedByPattern(relativePath, absolutePath, excludePattern) {
  if (!excludePattern) return false;
  const patterns = Array.isArray(excludePattern) ? excludePattern : [excludePattern];
  return patterns.some(pattern => {
    if (!pattern) return false;
    const re = globToRegExp(String(pattern));
    return re.test(normalizeGlobPath(relativePath)) || re.test(normalizeGlobPath(absolutePath));
  });
}

function walkFiles(root, visitor, token) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return false; }
  for (const entry of entries) {
    if (token && token.isCancellationRequested) return true;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (walkFiles(fullPath, visitor, token)) return true;
    } else if (entry.isFile()) {
      if (visitor(fullPath)) return true;
    }
  }
  return false;
}

function findFiles(include, exclude, maxResults, token) {
  return new Promise(resolve => {
    const pattern = patternFromGlobPattern(include);
    const excludePattern = typeof exclude === 'string' ? exclude : (exclude && exclude.pattern) || null;
    const basePath = basePathFromGlobPattern(include);
    const projectPaths = basePath ? [basePath] : atom.project.getPaths();
    const matcher = globToRegExp(pattern);
    const results = [];

    for (const projectPath of projectPaths) {
      const root = path.resolve(projectPath);
      const maybeExact = path.resolve(root, pattern);
      if (!/[\*\?\{]/.test(pattern) && fs.existsSync(maybeExact) && fs.statSync(maybeExact).isFile()) {
        if (!isExcludedByPattern(path.relative(root, maybeExact), maybeExact, excludePattern)) results.push(maybeExact);
      } else {
        walkFiles(root, filePath => {
          const relativePath = normalizeGlobPath(path.relative(root, filePath));
          if (matcher.test(relativePath) && !isExcludedByPattern(relativePath, filePath, excludePattern)) {
            results.push(filePath);
            return !!(maxResults && results.length >= maxResults);
          }
          return false;
        }, token);
      }
      if (maxResults && results.length >= maxResults) break;
    }

    resolve(results.slice(0, maxResults || results.length).map(f => Uri.file(f)));
  });
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textSearchRegex(query) {
  const pattern = typeof query === "string" ? query : (query.pattern || "");
  if (!pattern) return null;
  const flags = query.isCaseSensitive ? "g" : "gi";
  return query.isRegExp ? new RegExp(pattern, flags) : new RegExp(escapeRegExp(pattern), flags);
}

function rangeForTextMatch(line, start, length) {
  return new Range(new Position(line, start), new Position(line, start + length));
}

async function findTextInFilesFallback(query, options, callback) {
  const regex = textSearchRegex(query);
  if (!regex) return [];

  const results = [];
  const files = await findFiles(
    options.include || "**/*",
    options.exclude,
    options.maxResults
  );

  for (const uri of files) {
    let text;
    try { text = await fs.promises.readFile(uri.fsPath, "utf8"); } catch (e) { continue; }

    const lines = text.split(/\r?\n/);
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      const line = lines[lineNumber];
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line))) {
        const range = rangeForTextMatch(lineNumber, match.index, match[0].length);
        const result = {
          uri,
          ranges: [range],
          preview: { text: line, matches: [range] }
        };
        results.push(result);
        if (callback) callback(result);
        if (match[0].length === 0) regex.lastIndex++;
      }
    }
  }

  return results;
}

async function findTextInFiles(query, optionsOrCallback, callback) {
  const opts = typeof optionsOrCallback === "object" ? optionsOrCallback : {};
  const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
  const results = [];

  if (!atom.project || typeof atom.project.scan !== "function") {
    return findTextInFilesFallback(query, opts, cb);
  }

  await new Promise(resolve => {
    const pattern = typeof query === "string" ? query : (query.pattern || "");
    atom.project.scan(new RegExp(pattern, query.isRegExp ? "" : "i"), {}, (result) => {
      const match = {
        uri: Uri.file(result.filePath),
        ranges: result.matches ? result.matches.map(m => atomRangeToRange(m.range)) : [],
        preview: { text: result.line || "", matches: [] }
      };
      results.push(match);
      if (cb) cb(match);
    }).then(resolve).catch(resolve);
  });

  return results;
}

async function applyEdit(workspaceEdit) {
  const entries = workspaceEdit.entries ? workspaceEdit.entries() : [];
  for (const [uri, edits] of entries) {
    const filePath = uri.fsPath;
    // VSCode's applyEdit operates on the in-memory document, never on the
    // visible tab. atom.workspace.open would create a tab — use
    // createItemForURI so we get a TextEditor backed by the file's buffer
    // without attaching to a pane. If the file is already open in a tab,
    // its buffer is shared so edits still propagate.
    let editor;
    try {
      editor = await Promise.resolve(atom.workspace.createItemForURI(filePath));
    } catch (e) { continue; }
    if (!editor) continue;

    editor.transact(() => {
      const sorted = [...edits].sort((a, b) => {
        const bRow = b.range.start.line, aRow = a.range.start.line;
        return bRow !== aRow ? bRow - aRow : b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        editor.setTextInBufferRange(rangeToAtomRange(edit.range), edit.newText);
      }
    });
  }

  // File operations
  if (workspaceEdit._fileOps) {
    const fs = require('fs').promises;
    for (const op of workspaceEdit._fileOps) {
      try {
        if (op.type === 'create') await fs.writeFile(op.uri.fsPath, '', { flag: op.options && op.options.overwrite ? 'w' : 'wx' });
        else if (op.type === 'delete') await fs.unlink(op.uri.fsPath);
        else if (op.type === 'rename') await fs.rename(op.oldUri.fsPath, op.newUri.fsPath);
      } catch (e) {}
    }
  }

  return true;
}

// Cache: VSCode config-section (e.g. "calva") → Pulsar wrapper package name
// (e.g. "vscode-BetterTOML-calva"). Populated lazily; cleared on package load.
const _configSectionOwnerCache = new Map();

function _findOwnerPackage(section) {
  if (!section) return null;
  if (_configSectionOwnerCache.has(section)) return _configSectionOwnerCache.get(section);
  let owner = null;
  try {
    for (const pkg of atom.packages.getLoadedPackages()) {
      const meta = pkg.metadata && pkg.metadata._vscodeExtension;
      if (meta && Array.isArray(meta.configSections) && meta.configSections.includes(section)) {
        owner = pkg.name;
        break;
      }
    }
  } catch (_) {}
  _configSectionOwnerCache.set(section, owner);
  return owner;
}

class WorkspaceConfiguration {
  constructor(section, ownerPkg) {
    this._section  = section;
    this._ownerPkg = ownerPkg || null;
  }

  // Build Atom config keys. New wrappers expose a single VSCode configuration
  // section directly in the package UI as "{ownerPkg}.{key}". Older wrappers
  // stored values under "{ownerPkg}.{section}.{key}". Read both so existing
  // configs continue to work.
  _atomKeys(key) {
    const directKey = this._ownerPkg ? `${this._ownerPkg}.${key}` : key;
    const sectionKey = this._ownerPkg ? `${this._ownerPkg}.${this._section}.${key}` : (this._section ? `${this._section}.${key}` : key);
    return sectionKey === directKey ? [directKey] : [sectionKey, directKey];
  }

  _atomKey(key) {
    const keys = this._atomKeys(key);
    return this._ownerPkg && keys.length > 1 ? keys[1] : keys[0];
  }

  get(key, defaultValue) {
    const atomKeys = this._atomKeys(key);
    const fullKey = this._section ? `${this._section}.${key}` : key;

    for (const atomKey of atomKeys) {
      let val;
      try { val = atom.config.get(atomKey); } catch (_) {}
      if (val !== undefined) return val;
    }
    // For plain built-in VSCode keys (e.g. "editor.rulers") that have no owner
    if (!this._ownerPkg && atomKeys[0] !== fullKey) {
      let val;
      try { val = atom.config.get(fullKey); } catch (_) {}
      if (val !== undefined) return val;
    }

    const manifestDefault = getConfigurationDefault(fullKey);
    return manifestDefault !== undefined ? manifestDefault : defaultValue;
  }

  has(key) { return this.get(key) !== undefined; }

  inspect(key) {
    const atomKey = this._atomKey(key);
    const fullKey = this._section ? `${this._section}.${key}` : key;
    return {
      key: fullKey,
      globalValue: atom.config.get(atomKey),
      defaultValue: getConfigurationDefault(fullKey),
      workspaceValue: undefined,
      workspaceFolderValue: undefined,
      languageIds: [],
    };
  }

  async update(key, value, _target) {
    atom.config.set(this._atomKey(key), value);
  }
}

function getConfiguration(section, _scopeOrUri) {
  const owner = _findOwnerPackage(section);
  return new WorkspaceConfiguration(section, owner);
}

function getWorkspaceFolder(uri) {
  const filePath = uri.fsPath || '';
  const projectPaths = atom.project.getPaths();
  for (const p of projectPaths) {
    if (filePath.startsWith(p)) {
      return { uri: Uri.file(p), name: path.basename(p), index: projectPaths.indexOf(p) };
    }
  }
  return undefined;
}

function createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete) {
  return new FileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete);
}

function registerNotebookSerializer(notebookType, serializer, options) {
  return new Disposable(() => {});
}

function registerFileSystemProvider(scheme, provider, options = {}) {
  fileSystemProviders.set(scheme, { provider, options });
  return new Disposable(() => {
    const current = fileSystemProviders.get(scheme);
    if (current && current.provider === provider) fileSystemProviders.delete(scheme);
  });
}

function registeredFileSystemProvider(uriOrScheme) {
  const scheme = typeof uriOrScheme === 'string' ? uriOrScheme : uriOrScheme && uriOrScheme.scheme;
  return scheme && scheme !== 'file' ? fileSystemProviders.get(scheme) : null;
}

function requireProviderMethod(uri, method) {
  const registration = registeredFileSystemProvider(uri);
  if (!registration) return null;
  const fn = registration.provider && registration.provider[method];
  if (typeof fn !== 'function') {
    const error = new Error(`FileSystemProvider for scheme '${uri.scheme}' does not implement ${method}`);
    error.code = 'ENOSYS';
    throw error;
  }
  return { registration, fn };
}

function callProvider(uri, method, ...args) {
  const methodInfo = requireProviderMethod(uri, method);
  if (!methodInfo) return null;
  return Promise.resolve(methodInfo.fn.call(methodInfo.registration.provider, uri, ...args));
}

function registerTextDocumentContentProvider(scheme, provider) {
  contentProviders.set(scheme, provider);
  const opener = atom.workspace.addOpener(uri => {
    if (!uri.startsWith(scheme + ':')) return;
    const { Uri: UriClass } = require('../types/uri');
    const vsUri = UriClass.parse(uri);
    return provider.provideTextDocumentContent(vsUri, new (require('../types/cancellation').CancellationTokenSource)().token)
      .then(content => makeVirtualTextEditor(vsUri, content));
  });
  return new Disposable(() => {
    contentProviders.delete(scheme);
    opener.dispose();
  });
}

const FileType = Object.freeze({ Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 });

function uriToFsPath(uri) {
  return typeof uri === 'string' ? uri : uri.fsPath;
}

function statType(stats, targetStats) {
  if (stats.isSymbolicLink()) {
    if (targetStats && targetStats.isDirectory()) return FileType.SymbolicLink | FileType.Directory;
    if (targetStats && targetStats.isFile()) return FileType.SymbolicLink | FileType.File;
    return FileType.SymbolicLink;
  }
  if (stats.isDirectory()) return FileType.Directory;
  if (stats.isFile()) return FileType.File;
  return FileType.Unknown;
}

async function stat(uri) {
  const provided = callProvider(uri, 'stat');
  if (provided) return provided;
  const filePath = uriToFsPath(uri);
  const stats = await fs.promises.lstat(filePath);
  let targetStats;
  if (stats.isSymbolicLink()) {
    try { targetStats = await fs.promises.stat(filePath); } catch (e) {}
  }
  return {
    type: statType(stats, targetStats),
    ctime: stats.ctimeMs,
    mtime: stats.mtimeMs,
    size: stats.size
  };
}

const workspaceFileSystem = {
  stat,
  async readDirectory(uri) {
    const provided = callProvider(uri, 'readDirectory');
    if (provided) return provided;
    const entries = await fs.promises.readdir(uriToFsPath(uri), { withFileTypes: true });
    return entries.map(entry => {
      let type = FileType.Unknown;
      if (entry.isDirectory()) type = FileType.Directory;
      else if (entry.isFile()) type = FileType.File;
      else if (entry.isSymbolicLink()) type = FileType.SymbolicLink;
      return [entry.name, type];
    });
  },
  async createDirectory(uri) {
    const provided = callProvider(uri, 'createDirectory');
    if (provided) return provided;
    await fs.promises.mkdir(uriToFsPath(uri), { recursive: true });
  },
  async readFile(uri) {
    const provided = callProvider(uri, 'readFile');
    if (provided) return provided;
    return fs.promises.readFile(uriToFsPath(uri));
  },
  async writeFile(uri, content, options = {}) {
    const provided = callProvider(uri, 'writeFile', content, options);
    if (provided) return provided;
    await fs.promises.writeFile(uriToFsPath(uri), Buffer.from(content));
  },
  async delete(uri, options = {}) {
    const provided = callProvider(uri, 'delete', options);
    if (provided) return provided;
    await fs.promises.rm(uriToFsPath(uri), {
      recursive: !!options.recursive,
      force: !!options.useTrash
    });
  },
  async rename(source, target, options = {}) {
    const provided = callProvider(source, 'rename', target, options);
    if (provided) return provided;
    if (!options.overwrite && fs.existsSync(uriToFsPath(target))) {
      const error = new Error('File exists: ' + uriToFsPath(target));
      error.code = 'EEXIST';
      throw error;
    }
    if (options.overwrite) {
      await fs.promises.rm(uriToFsPath(target), { recursive: true, force: true });
    }
    await fs.promises.rename(uriToFsPath(source), uriToFsPath(target));
  },
  async copy(source, target, options = {}) {
    const provided = callProvider(source, 'copy', target, options);
    if (provided) return provided;
    if (!options.overwrite && fs.existsSync(uriToFsPath(target))) {
      const error = new Error('File exists: ' + uriToFsPath(target));
      error.code = 'EEXIST';
      throw error;
    }
    await fs.promises.cp(uriToFsPath(source), uriToFsPath(target), {
      recursive: true,
      force: !!options.overwrite,
      errorOnExist: !options.overwrite
    });
  },
  isWritableFileSystem(scheme) {
    if (scheme === 'file') return true;
    const registration = fileSystemProviders.get(scheme);
    if (!registration) return undefined;
    return !registration.options || registration.options.isReadonly !== true;
  }
};

function asRelativePath(pathOrUri, includeWorkspaceFolder) {
  const filePath = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
  const projectPaths = atom.project.getPaths();
  for (const p of projectPaths) {
    if (filePath.startsWith(p + path.sep)) {
      const rel = filePath.slice(p.length + 1);
      if (includeWorkspaceFolder) return path.basename(p) + path.sep + rel;
      return rel;
    }
  }
  return filePath;
}

module.exports = {
  get name() {
    const paths = atom.project.getPaths();
    return paths.length ? path.basename(paths[0]) : undefined;
  },
  get rootPath() { return atom.project.getPaths()[0] || undefined; },
  get workspaceFolders() {
    return atom.project.getPaths().map((p, i) => ({ uri: Uri.file(p), name: path.basename(p), index: i }));
  },
  get isTrusted() { return true; },
  get textDocuments() { return atom.workspace.getTextEditors().map(e => getTextDocument(e)); },
  get notebookDocuments() { return []; },
  fs: workspaceFileSystem,

  openTextDocument,
  saveAll,
  findFiles,
  findTextInFiles,
  applyEdit,
  getConfiguration,
  getWorkspaceFolder,
  createFileSystemWatcher,
  registerNotebookSerializer,
  registerFileSystemProvider,
  registerTextDocumentContentProvider,
  asRelativePath,

  onDidOpenTextDocument: _onDidOpenTextDocument.event,
  onDidCloseTextDocument: _onDidCloseTextDocument.event,
  onDidChangeTextDocument: _onDidChangeTextDocument.event,
  onDidSaveTextDocument: _onDidSaveTextDocument.event,
  onWillSaveTextDocument: _onWillSaveTextDocument.event,
  onDidChangeConfiguration: _onDidChangeConfiguration.event,
  onDidChangeWorkspaceFolders: _onDidChangeWorkspaceFolders.event,
  onDidGrantWorkspaceTrust: _onDidGrantWorkspaceTrust.event,
  onDidCreateFiles: _onDidCreateFiles.event,
  onDidDeleteFiles: _onDidDeleteFiles.event,
  onDidRenameFiles: _onDidRenameFiles.event,
  onWillCreateFiles: _onWillCreateFiles.event,
  onWillDeleteFiles: _onWillDeleteFiles.event,
  onWillRenameFiles: _onWillRenameFiles.event,
  onDidOpenNotebookDocument: _onDidOpenNotebookDocument.event,
  onDidCloseNotebookDocument: _onDidCloseNotebookDocument.event,
  onDidChangeNotebookDocument: _onDidChangeNotebookDocument.event,
  onDidSaveNotebookDocument: _onDidSaveNotebookDocument.event,

  _init,
  _ensureTextDocument
};
