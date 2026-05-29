'use strict';

const assert = require('assert');
const { buildAtomConfig } = require('../lib/ui/install-vsx');

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

test('single-section VSCode configuration is exposed as package-level Pulsar settings', () => {
  const schema = buildAtomConfig({
    configuration: {
      title: 'Claude Code',
      properties: {
        'claudeCode.allowDangerouslySkipPermissions': {
          type: 'boolean',
          description: 'Allow bypass permissions mode.'
        },
        'claudeCode.claudeProcessWrapper': {
          type: 'string',
          description: 'Executable path used to launch the Claude process.'
        },
        'claudeCode.initialPermissionMode': {
          type: 'string',
          default: 'default',
          enum: ['default', 'acceptEdits']
        }
      }
    }
  });

  assert.ok(schema.allowDangerouslySkipPermissions, 'missing package-level boolean setting');
  assert.ok(schema.claudeProcessWrapper, 'missing package-level string setting');
  assert.ok(schema.initialPermissionMode, 'missing package-level enum setting');
  assert.strictEqual(schema.allowDangerouslySkipPermissions.type, 'boolean');
  assert.strictEqual(schema.allowDangerouslySkipPermissions.default, false);
  assert.strictEqual(schema.claudeProcessWrapper.type, 'string');
  assert.strictEqual(schema.claudeProcessWrapper.default, '');
  assert.strictEqual(schema.initialPermissionMode.default, 'default');
  assert.ok(!schema.claudeCode, 'single-section config should not be hidden under a nested object in Settings View');
});

test('multi-section VSCode configuration keeps section prefixes to avoid collisions', () => {
  const schema = buildAtomConfig({
    configuration: [
      { properties: { 'one.enabled': { type: 'boolean', default: true } } },
      { properties: { 'two.enabled': { type: 'boolean', default: false } } }
    ]
  });

  assert.ok(schema.one.properties.enabled);
  assert.ok(schema.two.properties.enabled);
});
