'use strict';

// VSCode extensions normally run in a Node-only extension host. In Pulsar they
// currently execute in the renderer, where `globalThis.AbortController` /
// `AbortSignal` / `EventTarget` are Chromium's (Blink) implementations rather
// than Node's. Node's `events.setMaxListeners(n, ...targets)` validates each
// target with an internal brand check (`target.constructor[kIsEventTarget]`),
// which a Blink AbortSignal does not carry. Such targets also lack a Node-style
// `setMaxListeners()` method, so the call falls through to:
//   throw new ERR_INVALID_ARG_TYPE('eventTargets', ['EventEmitter','EventTarget'], target)
// producing:
//   The "eventTargets" argument must be an instance of EventEmitter or
//   EventTarget. Received an instance of AbortSignal
//
// The Claude Code extension's bundled Agent SDK calls
// `require('events').setMaxListeners(50, abortController.signal)` when spawning
// the Claude process, so this throws and the failure is forwarded to the webview
// (surfacing as an "Uncaught (in promise)" in its message loop). For a DOM-like
// EventTarget, raising the max-listeners threshold is only listener-warning
// bookkeeping and the DOM has no such concept, so silently skipping those
// targets restores browser semantics without changing behaviour for real Node
// emitters/targets.

const PATCH_FLAG = '__pulsarVscodeCompatSetMaxListenersPatch';

// A DOM EventTarget (including AbortSignal) has add/removeEventListener but no
// Node-style setMaxListeners. Real Node EventEmitters/EventTargets that Node can
// already handle are left untouched and still flow through the original.
function isDomEventTargetWithoutNodeSupport(target) {
  return !!target &&
    typeof target.addEventListener === 'function' &&
    typeof target.removeEventListener === 'function' &&
    typeof target.setMaxListeners !== 'function';
}

function patchEventsModule(events) {
  if (!events || typeof events.setMaxListeners !== 'function') return false;
  if (events[PATCH_FLAG]) return true;

  const originalSetMaxListeners = events.setMaxListeners;

  function setMaxListeners(maxListeners, ...targets) {
    // No targets: this only sets the process-wide default; nothing to filter.
    if (targets.length === 0) return originalSetMaxListeners.call(events, maxListeners);

    // Fast path: let Node handle everything it can. Only intervene if it throws
    // because of a DOM target, so behaviour is identical for valid inputs.
    try {
      return originalSetMaxListeners.call(events, maxListeners, ...targets);
    } catch (error) {
      const nodeTargets = targets.filter(target => !isDomEventTargetWithoutNodeSupport(target));
      // The failure was not caused by a DOM target we know how to ignore.
      if (nodeTargets.length === targets.length) throw error;
      // Every remaining target was a DOM target: nothing for Node to do.
      if (nodeTargets.length === 0) return undefined;
      return originalSetMaxListeners.call(events, maxListeners, ...nodeTargets);
    }
  }

  events.setMaxListeners = setMaxListeners;

  Object.defineProperty(events, PATCH_FLAG, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: true
  });

  return true;
}

function install() {
  // `require('events')` and `require('node:events')` resolve to the same cached
  // singleton, so patching it once covers every consumer in this process,
  // including the wrapped extension's own `require('events')`.
  try {
    const events = require('events');
    patchEventsModule(events);
    try {
      const nodeEvents = require('node:events');
      if (nodeEvents && nodeEvents !== events) patchEventsModule(nodeEvents);
    } catch (error) {}
  } catch (error) {}
}

module.exports = {
  install,
  patchEventsModule,
  isDomEventTargetWithoutNodeSupport
};
