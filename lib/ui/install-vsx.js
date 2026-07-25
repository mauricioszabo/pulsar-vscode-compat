'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const { languageToScope } = require('../utils/selector');

const OPEN_VSX_API = 'https://open-vsx.org/api';

function openVsxTargetPlatform(platform = process.platform, arch = process.arch) {
  const platformName = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform;
  const archName = arch === 'arm' ? 'armhf' : arch;
  return `${platformName}-${archName}`;
}

function selectOpenVsxDownload(info, platform = process.platform, arch = process.arch) {
  const downloads = info && info.downloads;
  if (downloads && Object.keys(downloads).length) {
    const target = openVsxTargetPlatform(platform, arch);
    if (downloads[target]) return downloads[target];
    if (downloads.universal) return downloads.universal;
    throw new Error(`No Open VSX download is available for ${target}`);
  }
  return info && info.files && info.files.download;
}

// ─── Public entry point ──────────────────────────────────────────────────────

async function installFromOpenVsx(namespace, name, version, onProgress) {
  onProgress = onProgress || (() => {});

  onProgress('Fetching extension info…');
  const info = await fetchJson(`${OPEN_VSX_API}/${namespace}/${name}/${version || 'latest'}`);
  if (!info || info.error) throw new Error(`Extension not found: ${namespace}.${name}`);

  const vsixUrl = selectOpenVsxDownload(info);
  if (!vsixUrl) throw new Error('No download URL for this extension version');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-vsx-'));
  const vsixPath = path.join(tmpDir, `${namespace}.${name}-${info.version}.vsix`);
  try {
    onProgress(`Downloading v${info.version}…`);
    await downloadFile(vsixUrl, vsixPath);

    const destDir = path.join(os.homedir(), '.pulsar', 'packages');
    fs.mkdirSync(destDir, { recursive: true });

    onProgress('Extracting and installing…');
    const pkgName = await wrapAndInstall(vsixPath, destDir, onProgress);
    return pkgName;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  }
}

// ─── Core install logic (also used by wrap-vsix.js CLI) ──────────────────────

function wrapAndInstall(vsixPath, destDir, onProgress) {
  onProgress = onProgress || (() => {});
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-'));
    try {
      execSync(`unzip -q "${vsixPath}" -d "${tmpDir}"`, { stdio: 'pipe' });
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true });
      return reject(new Error('Failed to extract VSIX — is `unzip` installed?'));
    }

    try {
      const extensionDir = path.join(tmpDir, 'extension');
      const extPkgPath = path.join(extensionDir, 'package.json');
      if (!fs.existsSync(extPkgPath))
        throw new Error('Missing extension/package.json inside VSIX');

      const extMeta = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
      const extName      = extMeta.name        || 'unknown';
      const extPublisher = extMeta.publisher   || 'unknown';
      const extMain      = extMeta.main        || './extension';
      const extVersion   = extMeta.version     || '0.0.0';
      const extDesc      = extMeta.description || '';
      const activationEvents = getActivationEvents(extMeta);
      const icon = normalizeRelativePath(extMeta.icon);

      const pulsarPkgName = `vscode-${extPublisher}-${extName}`;
      const outDir = path.join(destDir, pulsarPkgName);

      if (fs.existsSync(outDir)) {
        onProgress('Removing previous version…');
        fs.rmSync(outDir, { recursive: true });
      }
      fs.mkdirSync(path.join(outDir, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(outDir, 'node_modules', 'vscode'), { recursive: true });

      onProgress('Copying extension files…');
      fs.cpSync(extensionDir, path.join(outDir, 'extension'), { recursive: true });

      const atomConfig    = buildAtomConfig(extMeta.contributes);
      const configSections = getConfigSections(extMeta.contributes);
      const activationMetadata = buildPulsarActivationMetadata(extMeta);
      const displayName = extMeta.displayName || extName;
      const repository = normalizeRepository(extMeta.repository);
      const bugs = normalizeBugs(extMeta.bugs);
      const homepage = extMeta.homepage || (repository && (typeof repository === 'string' ? repository : repository.url));

      const pulsarPkg = {
        name: pulsarPkgName,
        version: extVersion,
        description: `[VSCode compat] ${extDesc}`,
        main: './lib/main.js',
        engines: { atom: '>=1.0.0 <2.0.0' },
        activationCommands: activationMetadata.activationCommands,
        activationHooks: activationMetadata.activationHooks,
        displayName,
        author: extMeta.author,
        license: extMeta.license,
        repository,
        bugs,
        homepage,
        keywords: Array.isArray(extMeta.keywords) ? extMeta.keywords : undefined,
        categories: Array.isArray(extMeta.categories) ? extMeta.categories : undefined,
        icon: icon ? path.posix.join('extension', icon) : undefined,
        _vscodeExtension: {
          id: `${extPublisher}.${extName}`,
          name: extName,
          publisher: extPublisher,
          displayName,
          description: extDesc,
          icon,
          main: extMain,
          activationEvents,
          configSections,
        },
      };
      if (Object.keys(atomConfig).length) {
        // Pulsar/Atom reads package configuration schemas from package.json's
        // `configSchema` metadata during package load. A `config` key in
        // package.json is ignored; `config` is only read from the package's main
        // module after it has been required. Store the schema under
        // `configSchema` so Settings View can show VSCode extension settings as
        // soon as the wrapper package is loaded.
        pulsarPkg.configSchema = atomConfig;
      }

      pruneUndefined(pulsarPkg);
      fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pulsarPkg, null, 2));
      fs.writeFileSync(path.join(outDir, 'lib', 'main.js'), generateWrapperMain());
      fs.writeFileSync(path.join(outDir, 'node_modules', 'vscode', 'index.js'), generateVSCodeRequireShim());
      writePulsarReadme(extensionDir, outDir, extMeta, pulsarPkg);
      copyTopLevelDoc(extensionDir, outDir, ['CHANGELOG', 'HISTORY']);
      copyTopLevelDoc(extensionDir, outDir, ['LICENSE', 'LICENCE', 'COPYING']);

      onProgress(`Installed as ${pulsarPkgName}`);
      resolve(pulsarPkgName);
    } catch (e) {
      reject(e);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
    }
  });
}

// ─── Config schema conversion ─────────────────────────────────────────────────

function getConfigSections(contributes) {
  if (!contributes || !contributes.configuration) return [];
  const sections = Array.isArray(contributes.configuration)
    ? contributes.configuration : [contributes.configuration];
  const names = new Set();
  for (const s of sections)
    for (const key of Object.keys(s.properties || {})) {
      const prefix = key.split('.')[0];
      if (prefix) names.add(prefix);
    }
  return Array.from(names);
}

function getContributedCommandIds(contributes) {
  const commands = contributes && contributes.commands;
  if (!Array.isArray(commands)) return [];
  const ids = new Set();
  for (const contribution of commands) {
    if (contribution && typeof contribution.command === 'string' && contribution.command.trim()) {
      ids.add(contribution.command.trim());
    }
  }
  return Array.from(ids);
}

function getContributedLanguageIds(contributes) {
  const languages = contributes && contributes.languages;
  if (!Array.isArray(languages)) return [];
  const ids = new Set();
  for (const contribution of languages) {
    if (contribution && typeof contribution.id === 'string' && contribution.id.trim()) {
      ids.add(contribution.id.trim());
    }
  }
  return Array.from(ids);
}

function normalizeActivationEventList(events) {
  if (typeof events === 'string') return events.trim() ? [events.trim()] : [];
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const event of events) {
    if (typeof event === 'string' && event.trim()) out.push(event.trim());
  }
  return Array.from(new Set(out));
}

function getActivationEvents(extMeta) {
  const explicitEvents = normalizeActivationEventList(extMeta && extMeta.activationEvents);
  if (explicitEvents.length) return explicitEvents;

  // VS Code 1.74+ implicitly activates extension contributions such as commands
  // and languages even when package.json omits activationEvents. Preserve that
  // behaviour in generated Pulsar wrappers instead of forcing every extension to
  // activate at startup.
  const inferred = [];
  for (const commandId of getContributedCommandIds(extMeta && extMeta.contributes)) inferred.push(`onCommand:${commandId}`);
  for (const languageId of getContributedLanguageIds(extMeta && extMeta.contributes)) inferred.push(`onLanguage:${languageId}`);
  return inferred.length ? Array.from(new Set(inferred)) : ['*'];
}

function addLanguageActivationHooks(hooks, languageId) {
  const scopeSelector = languageToScope(languageId);
  if (!scopeSelector || scopeSelector === '*') return false;
  for (const scope of scopeSelector.split(',').map(s => s.trim()).filter(Boolean)) {
    hooks.add(`${scope}:root-scope-used`);
  }
  return true;
}

function buildPulsarActivationMetadata(extMeta) {
  const commands = new Set();
  const hooks = new Set();
  let activateImmediately = false;

  for (const event of getActivationEvents(extMeta)) {
    if (event === '*' || event === 'onStartupFinished') {
      activateImmediately = true;
      continue;
    }

    const commandMatch = event.match(/^onCommand:(.+)$/);
    if (commandMatch && commandMatch[1].trim()) {
      commands.add(commandMatch[1].trim());
      continue;
    }

    const languageMatch = event.match(/^onLanguage(?::(.+))?$/);
    if (languageMatch) {
      const languageId = languageMatch[1] && languageMatch[1].trim();
      if (!languageId || !addLanguageActivationHooks(hooks, languageId)) activateImmediately = true;
      continue;
    }

    // Pulsar can defer command and grammar activation natively. Other VS Code
    // events such as workspaceContains, onView, onUri, onDebug, onTaskType, and
    // onAuthenticationRequest have no package-manager trigger in Pulsar today.
    // Activating at startup is safer than silently missing those conditions.
    activateImmediately = true;
  }

  if (activateImmediately) return { activationCommands: undefined, activationHooks: undefined };

  const commandList = Array.from(commands);
  const hookList = Array.from(hooks);
  return {
    activationCommands: commandList.length ? { 'atom-workspace': commandList } : undefined,
    activationHooks: hookList.length ? hookList : undefined,
  };
}

function buildAtomConfig(contributes) {
  if (!contributes || !contributes.configuration) return {};
  const sections = Array.isArray(contributes.configuration)
    ? contributes.configuration : [contributes.configuration];
  const configSectionNames = getConfigSections(contributes);
  const singleSectionName = configSectionNames.length === 1 ? configSectionNames[0] : null;

  const result = {};
  for (const section of sections) {
    for (const [fullKey, schema] of Object.entries(section.properties || {})) {
      let configKey = fullKey;
      if (singleSectionName && fullKey.startsWith(`${singleSectionName}.`)) {
        // Settings View renders only the package namespace's immediate children
        // as nice controls. If we keep VSCode's section prefix here, every real
        // setting is hidden inside one object editor named after the section
        // (e.g. `claudeCode`). For the common one-section extension case, expose
        // the setting names directly in the wrapper package UI while
        // workspace.getConfiguration(section) maps VSCode reads back to them.
        configKey = fullKey.slice(singleSectionName.length + 1);
      }

      const parts = configKey.split('.');
      let cursor = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cursor[p]) cursor[p] = { type: 'object', properties: {} };
        else if (!cursor[p].properties) cursor[p].properties = {};
        cursor = cursor[p].properties;
      }
      cursor[parts[parts.length - 1]] = convertSchema(schema);
    }
  }
  return result;
}

function convertSchema(schema) {
  if (!schema) return { type: 'string' };
  const typeMap = { string: 'string', number: 'number', integer: 'integer', boolean: 'boolean', array: 'array', object: 'object' };
  const out = {};

  if (Array.isArray(schema.type)) {
    out.type = typeMap[schema.type.find(t => t !== 'null')] || inferAtomType(schema) || 'string';
  } else {
    out.type = typeMap[schema.type] || inferAtomType(schema) || 'string';
  }

  if (schema.default     !== undefined) out.default     = schema.default;
  else if (schema.type !== undefined || schema.enum || schema.properties || schema.items) out.default = defaultForSchemaType(out.type, schema);
  if (schema.title)                     out.title       = normalizeMarkdownText(schema.title);
  if (schema.description)               out.description = normalizeMarkdownText(schema.description);
  else if (schema.markdownDescription)  out.description = normalizeMarkdownText(schema.markdownDescription);
  if (schema.enum)                      out.enum        = schema.enum;
  if (schema.minimum     !== undefined) out.minimum     = schema.minimum;
  if (schema.maximum     !== undefined) out.maximum     = schema.maximum;
  if (schema.order       !== undefined) out.order       = schema.order;

  if (out.type === 'array' && schema.items) out.items = convertSchema(schema.items);
  if (out.type === 'object' && schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties))
      out.properties[k] = convertSchema(v);
  }
  return out;
}

function defaultForSchemaType(type, schema) {
  if (Array.isArray(schema && schema.enum) && schema.enum.length) {
    const firstDefined = schema.enum.find(v => v !== null && v !== undefined);
    if (firstDefined !== undefined) return firstDefined;
  }
  if (type === 'boolean') return false;
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return undefined;
}

function inferAtomType(schema) {
  if (Array.isArray(schema.enum) && schema.enum.length) {
    const firstDefined = schema.enum.find(v => v !== null && v !== undefined);
    if (Array.isArray(firstDefined)) return 'array';
    return typeof firstDefined;
  }
  if (schema.default !== undefined && schema.default !== null) {
    if (Array.isArray(schema.default)) return 'array';
    return typeof schema.default;
  }
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return null;
}

function normalizeMarkdownText(value) {
  if (Array.isArray(value)) return value.map(normalizeMarkdownText).join('\n\n');
  if (value == null) return '';
  return String(value);
}

// ─── Package metadata/readme conversion ───────────────────────────────────────

function normalizeRelativePath(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
  if (normalized.split('/').some(part => part === '..')) return null;
  return normalized;
}

function normalizeRepository(repository) {
  if (!repository) return undefined;
  if (typeof repository === 'string') return repository;
  if (typeof repository === 'object' && repository.url) {
    return {
      type: repository.type || 'git',
      url: repository.url,
    };
  }
  return undefined;
}

function normalizeBugs(bugs) {
  if (!bugs) return undefined;
  if (typeof bugs === 'string') return { url: bugs };
  if (typeof bugs === 'object' && bugs.url) return { url: bugs.url };
  return undefined;
}

function pruneUndefined(value) {
  if (!value || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
    else if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) pruneUndefined(value[key]);
  }
  return value;
}

function findTopLevelDoc(extensionDir, basenames) {
  for (const child of fs.readdirSync(extensionDir)) {
    const ext = path.extname(child);
    const base = path.basename(child, ext).toUpperCase();
    if (basenames.includes(base)) {
      const fullPath = path.join(extensionDir, child);
      if (fs.statSync(fullPath).isFile()) return fullPath;
    }
  }
  return null;
}

function copyTopLevelDoc(extensionDir, outDir, basenames) {
  const src = findTopLevelDoc(extensionDir, basenames);
  if (!src) return;
  const dest = path.join(outDir, path.basename(src));
  if (fs.existsSync(dest)) return;
  fs.copyFileSync(src, dest);
}

function writePulsarReadme(extensionDir, outDir, extMeta, pulsarPkg) {
  const readmePath = findTopLevelDoc(extensionDir, ['README']);
  let readme = readmePath ? fs.readFileSync(readmePath, 'utf8') : '';
  readme = rewriteReadmeResourceLinks(readme);

  const header = buildPulsarReadmeHeader(extMeta, pulsarPkg);
  fs.writeFileSync(path.join(outDir, 'README.md'), `${header}${readme || 'No README was included in the VSIX.\n'}`);
}

function buildPulsarReadmeHeader(extMeta, pulsarPkg) {
  const title = extMeta.displayName || extMeta.name || pulsarPkg.name;
  const icon = normalizeRelativePath(extMeta.icon);
  const iconHtml = icon ? `<p align="center"><img src="extension/${escapeHtmlAttribute(icon)}" alt="${escapeHtmlAttribute(title)} icon" width="96" height="96"></p>\n\n` : '';
  const description = extMeta.description ? `\n\n> ${String(extMeta.description).replace(/\n/g, ' ')}` : '';
  return `${iconHtml}# ${title}${description}\n\n---\n\n`;
}

function rewriteReadmeResourceLinks(markdown) {
  if (!markdown) return '';
  let out = markdown.replace(/(!?\[[^\]]*\]\()\s*([^\s)]+)(\s*(?:"[^"]*"|'[^']*')?\))/g, (match, prefix, target, suffix) => {
    return `${prefix}${prefixReadmeTarget(target)}${suffix}`;
  });
  out = out.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (match, attr, quote, target) => {
    return `${attr}=${quote}${prefixReadmeTarget(target)}${quote}`;
  });
  return out;
}

function prefixReadmeTarget(target) {
  const cleaned = String(target || '').replace(/^<|>$/g, '');
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//') || cleaned.startsWith('/')) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return target;
  if (cleaned.startsWith('extension/')) return cleaned;
  const match = cleaned.match(/^([^?#]*)([?#].*)?$/);
  const resource = normalizeRelativePath(match ? match[1] : cleaned);
  if (!resource) return target;
  return `extension/${resource}${match && match[2] ? match[2] : ''}`;
}

function escapeHtmlAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Generated wrapper main.js ────────────────────────────────────────────────

function generateWrapperMain() {
  return `'use strict';

const path = require('path');
const packageMeta = require('../package.json');
const meta = packageMeta._vscodeExtension;
const extensionPath = path.join(__dirname, '..', 'extension');

// Pulsar runs VSCode extensions in the renderer, where AbortSignal is Chromium's
// (Blink) implementation. Node's events.setMaxListeners(n, signal) rejects those
// because they lack Node's EventTarget brand and a setMaxListeners() method,
// throwing 'The "eventTargets" argument must be an instance of EventEmitter or
// EventTarget. Received an instance of AbortSignal'. Extensions such as Claude
// Code call this when spawning their process. Skipping DOM targets (max-listeners
// is only listener-warning bookkeeping, which the DOM lacks) restores browser
// semantics without changing behaviour for real Node emitters. Install this
// before requiring the extension so its own require('events') sees the patch.
function _patchSetMaxListeners() {
  var FLAG = '__pulsarVscodeCompatSetMaxListenersPatch';
  function patch(events) {
    if (!events || typeof events.setMaxListeners !== 'function' || events[FLAG]) return;
    var original = events.setMaxListeners;
    events.setMaxListeners = function(maxListeners) {
      var targets = Array.prototype.slice.call(arguments, 1);
      if (targets.length === 0) return original.call(events, maxListeners);
      try {
        return original.apply(events, arguments);
      } catch (error) {
        var nodeTargets = targets.filter(function(target) {
          var isDomTarget = target &&
            typeof target.addEventListener === 'function' &&
            typeof target.removeEventListener === 'function' &&
            typeof target.setMaxListeners !== 'function';
          return !isDomTarget;
        });
        if (nodeTargets.length === targets.length) throw error;
        if (nodeTargets.length === 0) return undefined;
        return original.apply(events, [maxListeners].concat(nodeTargets));
      }
    };
    Object.defineProperty(events, FLAG, { configurable: true, enumerable: false, value: true });
  }
  try {
    var events = require('events');
    patch(events);
    try { var nodeEvents = require('node:events'); if (nodeEvents && nodeEvents !== events) patch(nodeEvents); } catch (e) {}
  } catch (e) {}
}
_patchSetMaxListeners();

let _context = null;
let _vsext = null;
let _vscode = null;
let _compatActivationPromise = null;
let _warnedCompatActivation = false;

function publishExtensionExports(value) {
  let registry = global.__pulsarVscodeExtensionExports;
  if (!registry || typeof registry.set !== 'function') {
    registry = new Map();
    global.__pulsarVscodeExtensionExports = registry;
  }
  registry.set(meta.id, value);
  let activeIds = global.__pulsarVscodeExtensionActiveIds;
  if (!activeIds || typeof activeIds.add !== 'function') {
    activeIds = new Set();
    global.__pulsarVscodeExtensionActiveIds = activeIds;
  }
  activeIds.add(meta.id);
  return value;
}

function publishActivationPromise(promise) {
  let promises = global.__pulsarVscodeExtensionActivationPromises;
  if (!promises || typeof promises.set !== 'function') {
    promises = new Map();
    global.__pulsarVscodeExtensionActivationPromises = promises;
  }
  promises.set(meta.id, promise);
  return promise;
}

function warnCompatActivation(message, error) {
  if (_warnedCompatActivation) return;
  _warnedCompatActivation = true;
  if (error) console.warn('[vscode-compat] ' + message, error);
  else console.warn('[vscode-compat] ' + message);
}

function activateCompatPackage() {
  if (_vscode) return Promise.resolve(_vscode);
  if (_compatActivationPromise) return _compatActivationPromise;

  if (!global.atom || !atom.packages || typeof atom.packages.activatePackage !== 'function') {
    warnCompatActivation('Cannot activate pulsar-vscode-compat because atom.packages.activatePackage is unavailable; VSCode extension will not load.');
    return Promise.resolve(null);
  }

  if (typeof atom.packages.getAvailablePackageNames === 'function' &&
      !atom.packages.getAvailablePackageNames().includes('pulsar-vscode-compat')) {
    warnCompatActivation('pulsar-vscode-compat is not installed; VSCode extension will not load.');
    return Promise.resolve(null);
  }

  if (typeof atom.packages.isPackageDisabled === 'function' && atom.packages.isPackageDisabled('pulsar-vscode-compat')) {
    warnCompatActivation('pulsar-vscode-compat is disabled; VSCode extension will not load.');
    return Promise.resolve(null);
  }

  _compatActivationPromise = atom.packages.activatePackage('pulsar-vscode-compat').then(pkg => {
    if (!pkg || !pkg.path) {
      warnCompatActivation('pulsar-vscode-compat is unavailable or disabled; VSCode extension will not load.');
      return null;
    }

    const vscodePath = path.join(pkg.path, 'lib', 'vscode.js');
    try {
      _vscode = require(vscodePath);
      global.__pulsarVscodeCompatApi = _vscode;
      global.__pulsarVscodeCompatPath = vscodePath;
      return _vscode;
    } catch (e) {
      warnCompatActivation('Failed to load pulsar-vscode-compat API; VSCode extension will not load.', e);
      return null;
    }
  }, e => {
    warnCompatActivation('Failed to activate pulsar-vscode-compat; VSCode extension will not load.', e);
    return null;
  });

  return _compatActivationPromise;
}

module.exports = {
  // Pulsar also registers configuration schemas from the main module config
  // property when Settings View calls pack.activateConfig(). Keep this here as
  // a compatibility fallback for wrapper packages generated with older metadata
  // shapes, while new packages expose the schema as package.json configSchema.
  config: packageMeta.configSchema || packageMeta.config,

  activate(state) {
    return publishActivationPromise(activateCompatPackage().then(vscode => {
      if (!vscode) return;

      const mainFile = path.resolve(extensionPath, meta.main);
      try {
        _vsext = require(mainFile);
      } catch (e) {
        console.error('[vscode-compat] Failed to load extension:', mainFile, e.message);
        return;
      }

      try {
        _context = new vscode.ExtensionContext(meta.id, extensionPath, 1, state);
      } catch (e) {
        console.error('[vscode-compat] Failed to create extension context:', e);
        return;
      }

      if (_vsext && typeof _vsext.activate === 'function') {
        try {
          const result = _vsext.activate(_context);
          if (result && typeof result.then === 'function') {
            return result.then(publishExtensionExports).catch(e => console.error('[vscode-compat] activate error:', e));
          }
          return publishExtensionExports(result);
        } catch (e) {
          console.error('[vscode-compat] activate threw:', e);
        }
      }
    }));
  },

  deactivate() {
    if (_vsext && typeof _vsext.deactivate === 'function') {
      try { _vsext.deactivate(); } catch (_) {}
    }
    if (_context) { _context._dispose(); _context = null; }
  },

  serialize() {
    if (!_context) return {};
    return {
      global:     Object.fromEntries(_context.globalState.keys().map(k => [k, _context.globalState.get(k)])),
      workspace:  Object.fromEntries(_context.workspaceState.keys().map(k => [k, _context.workspaceState.get(k)])),
    };
  },
};
`;
}

function generateVSCodeRequireShim() {
  return `'use strict';

// Generated by pulsar-vscode-compat. The wrapper activates
// pulsar-vscode-compat before loading the original VSCode extension, then stores
// the real API on globalThis so this package-local module can satisfy
// require('vscode') synchronously using normal Node resolution. The shim also
// remains inert when the compatibility package is missing or disabled, even if
// stale globals remain from an earlier activation.
var packages = global.atom && global.atom.packages;
var compatUnavailable = !packages ||
  (typeof packages.getAvailablePackageNames === 'function' &&
    !packages.getAvailablePackageNames().includes('pulsar-vscode-compat')) ||
  (typeof packages.isPackageDisabled === 'function' &&
    packages.isPackageDisabled('pulsar-vscode-compat'));

if (compatUnavailable) {
  module.exports = {};
} else if (global.__pulsarVscodeCompatApi) {
  module.exports = global.__pulsarVscodeCompatApi;
} else if (global.__pulsarVscodeCompatPath) {
  module.exports = require(global.__pulsarVscodeCompatPath);
} else {
  console.warn('[vscode-compat] require(\\'vscode\\') was called before pulsar-vscode-compat activated; returning an empty API object.');
  module.exports = {};
}
`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const go = (u, hops) => {
      if (hops > 10) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'Pulsar-VSX/1.0', Accept: 'application/json' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return res.resume(), go(res.headers.location, hops + 1);
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
        res.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, hops) => {
      if (hops > 10) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'Pulsar-VSX/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return res.resume(), go(res.headers.location, hops + 1);
        if (res.statusCode !== 200)
          return res.resume(), reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
        res.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', reject);
    };
    go(url, 0);
  });
}

module.exports = { installFromOpenVsx, selectOpenVsxDownload, wrapAndInstall, buildAtomConfig, convertSchema, getConfigSections, getActivationEvents, buildPulsarActivationMetadata, generateWrapperMain, generateVSCodeRequireShim };
