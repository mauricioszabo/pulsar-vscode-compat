(function() {
  'use strict';

  if (globalThis.__pulsarVscodeCompatAcquireVsCodeApi) return;
  globalThis.__pulsarVscodeCompatAcquireVsCodeApi = true;

  var state;
  var api = {
    postMessage: function(message) {
      window.parent.postMessage(message, '*');
    },
    setState: function(newState) {
      state = newState;
      return state;
    },
    getState: function() {
      return state;
    }
  };

  globalThis.acquireVsCodeApi = function() { return api; };
  window.acquireVsCodeApi = globalThis.acquireVsCodeApi;

  if (window && typeof window.addEventListener === 'function') {
    window.addEventListener('message', function(event) {
      var message = event && event.data;
      if (!message || message.type !== 'pulsar-vscode-compat:update-theme') return;
      try {
        var style = document.getElementById('pulsar-vscode-compat-theme');
        if (!style) {
          style = document.createElement('style');
          style.id = 'pulsar-vscode-compat-theme';
          (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = String(message.css || '');
        applyThemeVariablesInline(message.css);
      } catch (error) {}
      try {
        if (document.body && message.themeClass) {
          document.body.classList.remove('vscode-dark');
          document.body.classList.remove('vscode-light');
          document.body.classList.remove('vscode-high-contrast');
          document.body.classList.add(message.themeClass);
        }
      } catch (error) {}
    });
  }

  function applyThemeVariablesInline(css) {
    try {
      if (!document || !document.documentElement || !document.documentElement.style) return;
      var source = String(css || '');
      var pattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+?)(?:\s*!important)?\s*;/g;
      var match;
      while ((match = pattern.exec(source))) {
        document.documentElement.style.setProperty(match[1], match[2].trim(), 'important');
      }
      if (document.body && document.body.style) {
        document.body.style.setProperty('background-color', 'var(--vscode-editor-background)', 'important');
        document.body.style.setProperty('color', 'var(--vscode-foreground)', 'important');
      }
    } catch (error) {}
  }

  try {
    var initialThemeStyle = document && document.getElementById && document.getElementById('pulsar-vscode-compat-theme');
    if (initialThemeStyle) applyThemeVariablesInline(initialThemeStyle.textContent || '');
  } catch (error) {}

  // Make DOM AbortSignal acceptable to Node's events.setMaxListeners even when
  // Node's internal EventTarget brand check does not recognize this iframe's
  // DOM realm. events.setMaxListeners falls back to target.setMaxListeners(n),
  // so a no-op method is enough and mirrors browser semantics where this is
  // only listener-warning bookkeeping.
  try {
    if (globalThis.AbortSignal && globalThis.AbortSignal.prototype) {
      if (typeof globalThis.AbortSignal.prototype.setMaxListeners !== 'function') {
        Object.defineProperty(globalThis.AbortSignal.prototype, 'setMaxListeners', {
          configurable: true,
          value: function() { return this; }
        });
      }
      if (typeof globalThis.AbortSignal.prototype.getMaxListeners !== 'function') {
        Object.defineProperty(globalThis.AbortSignal.prototype, 'getMaxListeners', {
          configurable: true,
          value: function() { return 0; }
        });
      }
    }
  } catch (error) {}

  // Electron/Pulsar can expose Node's events module inside a DOM iframe. Some
  // bundled browser code calls events.setMaxListeners(n, signal), but Node's
  // internal EventTarget check can reject a DOM AbortSignal from this frame. For
  // DOM-like targets, setting max listeners is only warning bookkeeping, so make
  // setMaxListeners ignore those targets instead of throwing before the UI boots.
  try {
    if (typeof require === 'function') {
      var events = require('events');
      try {
        var nodeEvents = require('node:events');
        if (nodeEvents && nodeEvents !== events) patchEventsModule(nodeEvents);
      } catch (error) {}
      patchEventsModule(events);
    }
  } catch (error) {}

  function patchEventsModule(events) {
    if (events && events.setMaxListeners && !events.__pulsarVscodeCompatPatched) {
      var originalSetMaxListeners = events.setMaxListeners;
      events.setMaxListeners = function(maxListeners) {
        var targets = Array.prototype.slice.call(arguments, 1);
        if (targets.length === 0) return originalSetMaxListeners.call(events, maxListeners);
        try {
          return originalSetMaxListeners.apply(events, arguments);
        } catch (error) {
          var retryTargets = targets.filter(function(target) {
            var isDomEventTarget = target &&
              typeof target.addEventListener === 'function' &&
              typeof target.removeEventListener === 'function';
            return !isDomEventTarget;
          });
          if (retryTargets.length === targets.length) throw error;
          if (retryTargets.length === 0) return;
          return originalSetMaxListeners.apply(events, [maxListeners].concat(retryTargets));
        }
      };
      events.__pulsarVscodeCompatPatched = true;
    }
  }

  // Electron/Pulsar can expose Node's events helpers alongside DOM AbortSignal
  // objects from another realm. Some Node helpers validate arguments with
  // `instanceof EventTarget` and reject AbortSignal even though it has the
  // EventTarget shape. Make that validation accept the current realm's
  // AbortSignal before extension bundles start.
  try {
    var eventTarget = globalThis.EventTarget;
    var abortController = globalThis.AbortController;
    var abortSignal = globalThis.AbortSignal;
    if (eventTarget && abortController && abortSignal) {
      var signal = new abortController().signal;
      if (!(signal instanceof eventTarget)) {
        var originalHasInstance = eventTarget[Symbol.hasInstance];
        Object.defineProperty(eventTarget, Symbol.hasInstance, {
          configurable: true,
          value: function(instance) {
            if (instance instanceof abortSignal) return true;
            if (originalHasInstance) return originalHasInstance.call(this, instance);
            return Function.prototype[Symbol.hasInstance].call(this, instance);
          }
        });
      }
    }
  } catch (error) {}
}());
