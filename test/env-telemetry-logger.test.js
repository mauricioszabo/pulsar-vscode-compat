'use strict';

const assert = require('assert');
const env = require('../lib/namespaces/env');

const sender = {
  sendEventData() { throw new Error('telemetry usage data must not be sent'); },
  sendErrorData() { throw new Error('telemetry error data must not be sent'); },
};

const logger = env.createTelemetryLogger(sender);

assert.strictEqual(logger.isUsageEnabled, false,
  'the compatibility telemetry logger must report usage telemetry disabled');
assert.strictEqual(logger.isErrorsEnabled, false,
  'the compatibility telemetry logger must report error telemetry disabled');
assert.strictEqual(typeof logger.onDidChangeEnableStates, 'function',
  'the compatibility telemetry logger must expose the VSCode enable-state event');

const subscription = logger.onDidChangeEnableStates(() => {
  throw new Error('a permanently disabled telemetry logger must not emit enable-state changes');
});
assert.strictEqual(typeof subscription.dispose, 'function');

assert.doesNotThrow(() => logger.logUsage('elixir-ls.activation', { enabled: true }));
assert.doesNotThrow(() => logger.logError(new Error('ignored telemetry error')));
subscription.dispose();
assert.doesNotThrow(() => logger.dispose());

console.log('env.createTelemetryLogger exposes a permanently disabled no-op VSCode telemetry logger');
