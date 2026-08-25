'use strict';

const assert = require('assert');
const { getActivationEvents, buildPulsarActivationMetadata } = require('../lib/ui/install-vsx');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

test('maps VSCode onCommand activation events to Pulsar activationCommands', () => {
  assert.deepStrictEqual(buildPulsarActivationMetadata({
    activationEvents: ['onCommand:claude-code.open', 'onCommand:claude-code.newSession']
  }), {
    activationCommands: { 'atom-workspace': ['claude-code.open', 'claude-code.newSession'] },
    activationHooks: undefined,
  });
});

test('maps VSCode onLanguage activation events to Pulsar grammar activation hooks', () => {
  assert.deepStrictEqual(buildPulsarActivationMetadata({
    activationEvents: ['onLanguage:typescript', 'onLanguage:clojure']
  }), {
    activationCommands: undefined,
    activationHooks: ['source.ts:root-scope-used', 'source.tsx:root-scope-used', 'source.clojure:root-scope-used'],
  });
});

test('infers modern VSCode command and language activation events from contributes', () => {
  const extMeta = {
    contributes: {
      commands: [{ command: 'calva.connect' }],
      languages: [{ id: 'clojure' }]
    }
  };
  assert.deepStrictEqual(getActivationEvents(extMeta), ['onCommand:calva.connect', 'onLanguage:clojure']);
  assert.deepStrictEqual(buildPulsarActivationMetadata(extMeta), {
    activationCommands: { 'atom-workspace': ['calva.connect'] },
    activationHooks: ['source.clojure:root-scope-used'],
  });
});

test('keeps mapped language activation when another VSCode event is unsupported', () => {
  assert.deepStrictEqual(buildPulsarActivationMetadata({
    activationEvents: ['onLanguage:python', 'onNotebook:jupyter-notebook']
  }), {
    activationCommands: undefined,
    activationHooks: ['source.python:root-scope-used'],
  });
});

test('uses immediate activation for wildcard and a guarded startup hook for workspaceContains', () => {
  assert.deepStrictEqual(buildPulsarActivationMetadata({ activationEvents: ['*', 'onCommand:x.y'] }), {
    activationCommands: undefined,
    activationHooks: undefined,
  });
  assert.deepStrictEqual(buildPulsarActivationMetadata({ activationEvents: ['workspaceContains:**/Gemfile'] }), {
    activationCommands: undefined,
    activationHooks: ['core:loaded-shell-environment'],
  });
});
