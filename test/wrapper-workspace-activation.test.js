'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildPulsarActivationMetadata,
  generateWrapperMain,
} = require('../lib/ui/install-vsx');

function createDisposable() {
  return { dispose() {} };
}

async function runWorkspaceScenario(createMixFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wrapper-workspace-'));
  const wrapper = path.join(root, 'wrapper');
  const compat = path.join(root, 'compat');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(wrapper, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(wrapper, 'extension'), { recursive: true });
  fs.mkdirSync(path.join(compat, 'lib'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  if (createMixFile) fs.writeFileSync(path.join(project, 'mix.exs'), 'defmodule Example.MixProject do\nend\n');

  fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({
    name: 'vscode-elixir-lsp-elixir-ls',
    _vscodeExtension: {
      id: 'elixir-lsp.elixir-ls',
      main: './index.js',
      activationEvents: [
        'onLanguage:phoenix-heex',
        'onLanguage:surface',
        'workspaceContains:mix.exs',
        'onDebugResolve:elixir',
      ],
    },
  }));
  fs.writeFileSync(path.join(wrapper, 'lib', 'main.js'), generateWrapperMain());
  fs.writeFileSync(path.join(wrapper, 'extension', 'index.js'), `
    global.__workspaceActivationLoads = (global.__workspaceActivationLoads || 0) + 1;
    exports.activate = function() {
      global.__workspaceActivationCalls = (global.__workspaceActivationCalls || 0) + 1;
    };
  `);
  fs.writeFileSync(path.join(compat, 'lib', 'vscode.js'), `
    exports.ExtensionContext = class ExtensionContext {
      constructor() {}
      _dispose() {}
    };
  `);

  const previousAtom = global.atom;
  delete global.__workspaceActivationLoads;
  delete global.__workspaceActivationCalls;
  delete global.__pulsarVscodeExtensionActivationPromises;
  delete global.__pulsarVscodeExtensionExports;
  delete global.__pulsarVscodeExtensionActiveIds;

  global.atom = {
    packages: {
      getAvailablePackageNames() { return ['pulsar-vscode-compat']; },
      isPackageDisabled() { return false; },
      async activatePackage() { return { path: compat }; },
    },
    project: {
      getPaths() { return [project]; },
      onDidChangePaths() { return createDisposable(); },
    },
    workspace: {
      getActiveTextEditor() { return null; },
      observeActiveTextEditor() { return createDisposable(); },
    },
  };

  try {
    const mainPath = path.join(wrapper, 'lib', 'main.js');
    const main = require(mainPath);
    await main.activate({});
    return {
      loads: global.__workspaceActivationLoads || 0,
      activations: global.__workspaceActivationCalls || 0,
    };
  } finally {
    global.atom = previousAtom;
    delete global.__workspaceActivationLoads;
    delete global.__workspaceActivationCalls;
    delete global.__pulsarVscodeExtensionActivationPromises;
    delete global.__pulsarVscodeExtensionExports;
    delete global.__pulsarVscodeExtensionActiveIds;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  const metadata = buildPulsarActivationMetadata({
    activationEvents: [
      'onLanguage:phoenix-heex',
      'onLanguage:surface',
      'workspaceContains:mix.exs',
      'onDebugResolve:elixir',
    ],
  });
  assert.deepStrictEqual(metadata, {
    activationCommands: undefined,
    activationHooks: [
      'source.phoenix-heex:root-scope-used',
      'source.surface:root-scope-used',
      'core:loaded-shell-environment',
    ],
  }, 'workspaceContains must schedule a lightweight startup check even when other activation events map to Pulsar');

  const withoutMix = await runWorkspaceScenario(false);
  assert.deepStrictEqual(withoutMix, { loads: 0, activations: 0 },
    'the startup check must not load the extension outside a matching workspace');

  const withMix = await runWorkspaceScenario(true);
  assert.deepStrictEqual(withMix, { loads: 1, activations: 1 },
    'a project root containing mix.exs must load and activate ElixirLS');

  console.log('workspaceContains activation checks project roots before loading generated wrappers');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
