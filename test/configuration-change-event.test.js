'use strict';

const assert = require('assert');

let atomConfigurationListener;
const ownerPackage = {
  name: 'vscode-meta-pyrefly',
  metadata: { _vscodeExtension: { configSections: ['python'] } }
};

global.atom = {
  workspace: {
    observeTextEditors() { return { dispose() {} }; },
    getTextEditors() { return []; }
  },
  project: {
    getPaths() { return []; },
    getDirectories() { return []; },
    onDidChangePaths() { return { dispose() {} }; }
  },
  packages: {
    getLoadedPackages() { return [ownerPackage]; },
    getAvailablePackagePaths() { return []; }
  },
  config: {
    get() { return undefined; },
    observe() { return { dispose() {} }; },
    onDidChange(callback) {
      atomConfigurationListener = callback;
      return { dispose() {} };
    }
  }
};

const workspace = require('../lib/namespaces/workspace');
workspace._init();

let changeEvent;
workspace.onDidChangeConfiguration(event => { changeEvent = event; });

atomConfigurationListener({
  oldValue: { 'vscode-meta-pyrefly': { languageServer: 'Default', pyrefly: { disableLanguageServices: false } } },
  newValue: { 'vscode-meta-pyrefly': { languageServer: 'None', pyrefly: { disableLanguageServices: false } } }
});

assert(changeEvent, 'expected a VSCode configuration change event');
assert.strictEqual(changeEvent.affectsConfiguration('python.languageServer'), true);
assert.strictEqual(changeEvent.affectsConfiguration('python.pyrefly.disableLanguageServices'), false);
assert.strictEqual(changeEvent.affectsConfiguration('editor.fontSize'), false);

console.log('configuration change events only affect changed VSCode settings');
