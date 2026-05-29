'use strict';

const assert = require('assert');
const { patchEventsModule, isDomEventTargetWithoutNodeSupport } = require('../lib/shims/node-event-target');

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

// A Chromium/Blink-style AbortSignal: it is a DOM EventTarget (add/remove
// EventListener) but carries neither Node's EventTarget brand nor a Node-style
// setMaxListeners(), which is exactly what makes Node's setMaxListeners throw.
function makeDomAbortSignal() {
  function AbortSignal() {}
  const signal = Object.create(AbortSignal.prototype);
  signal.addEventListener = function() {};
  signal.removeEventListener = function() {};
  Object.defineProperty(signal, 'aborted', { get() { return false; } });
  return signal;
}

test('real Node events.setMaxListeners rejects a DOM AbortSignal before patching', () => {
  // Use an isolated copy of the events module so the test does not depend on
  // patch ordering. We require a fresh module object by clearing the cache.
  delete require.cache[require.resolve('events')];
  const events = require('events');
  const domSignal = makeDomAbortSignal();
  assert.throws(() => events.setMaxListeners(20, domSignal), /eventTargets|EventTarget/);
});

test('patched setMaxListeners tolerates a DOM AbortSignal (no throw, no-op)', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  patchEventsModule(events);
  const domSignal = makeDomAbortSignal();
  assert.doesNotThrow(() => events.setMaxListeners(20, domSignal));
});

test('patched setMaxListeners still applies to real Node EventEmitters', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  const { EventEmitter } = events;
  patchEventsModule(events);
  const emitter = new EventEmitter();
  events.setMaxListeners(42, emitter);
  assert.strictEqual(emitter.getMaxListeners(), 42);
});

test('patched setMaxListeners still applies to real Node EventTargets (AbortSignal)', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  patchEventsModule(events);
  // A genuine Node AbortController().signal IS a Node EventTarget here.
  const nodeSignal = new AbortController().signal;
  assert.doesNotThrow(() => events.setMaxListeners(7, nodeSignal));
});

test('patched setMaxListeners with no targets sets the process-wide default', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  const { EventEmitter } = events;
  patchEventsModule(events);
  const previous = EventEmitter.defaultMaxListeners;
  try {
    events.setMaxListeners(99);
    assert.strictEqual(EventEmitter.defaultMaxListeners, 99);
  } finally {
    EventEmitter.defaultMaxListeners = previous;
  }
});

test('a mix of Node and DOM targets applies to Node ones and skips DOM ones', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  const { EventEmitter } = events;
  patchEventsModule(events);
  const emitter = new EventEmitter();
  const domSignal = makeDomAbortSignal();
  assert.doesNotThrow(() => events.setMaxListeners(33, emitter, domSignal));
  assert.strictEqual(emitter.getMaxListeners(), 33);
});

test('patching twice is idempotent (flag guard)', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  assert.strictEqual(patchEventsModule(events), true);
  const patchedFn = events.setMaxListeners;
  assert.strictEqual(patchEventsModule(events), true);
  assert.strictEqual(events.setMaxListeners, patchedFn, 'should not re-wrap an already-patched module');
});

test('a non-DOM, non-Node bogus target still throws (no over-tolerance)', () => {
  delete require.cache[require.resolve('events')];
  const events = require('events');
  patchEventsModule(events);
  // {} is neither a Node emitter/target nor a DOM EventTarget: Node should still
  // reject it so genuine programming errors are not silently swallowed.
  assert.throws(() => events.setMaxListeners(5, {}), /eventTargets|EventTarget/);
});

test('isDomEventTargetWithoutNodeSupport classifies targets correctly', () => {
  assert.strictEqual(isDomEventTargetWithoutNodeSupport(makeDomAbortSignal()), true);
  assert.strictEqual(isDomEventTargetWithoutNodeSupport({}), false);
  assert.strictEqual(isDomEventTargetWithoutNodeSupport(null), false);
  // Something with a Node-style setMaxListeners is left for Node to handle.
  assert.strictEqual(isDomEventTargetWithoutNodeSupport({
    addEventListener() {}, removeEventListener() {}, setMaxListeners() {}
  }), false);
});

// Restore a clean cached events module for any later test files in the run.
delete require.cache[require.resolve('events')];
