'use strict';

const { TextDocument } = require('../types/text-document');
const { Range } = require('../types/range');
const { Position } = require('../types/position');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector } = require('../utils/selector');
const { Disposable } = require('../types/disposable');

const inlayHintProviders = [];
const editorHintState = new WeakMap();
const fetchedHintRanges = new WeakMap();

const INLAY_HINT_VIEWPORT_MARGIN = 8;

function applyInlayHintCalloutTransform(element) {
  const clampX = element._inlayHintClampX;
  const translateX = clampX == null ? 'translateX(-100%)' : `translateX(${-clampX}px)`;
  element.style.transform = element._inlayHintAbove
    ? `${translateX} translateY(calc(-100% - 0.15em - var(--editor-line-height)))`
    : `${translateX} translateY(calc(1.4em + 3px - var(--editor-line-height)))`;
}

function setInlayHintCalloutPlacement(element, above) {
  element._inlayHintAbove = !!above;
  element.classList.toggle('above', above);
  element.classList.toggle('below', !above);
  applyInlayHintCalloutTransform(element);
}

function setInlayHintOverlayZIndexAuto(element) {
  const overlay = element && element.closest && element.closest('atom-overlay');
  if (!overlay) return false;
  overlay.style.zIndex = 'auto';
  return true;
}

// Shared front half of the clamps: locate the overlay wrapper and editor viewport, neutralize
// the wrapper (z-index, click-through), and bail early when the overlay must stay hidden.
// Returns null when the element is not attached yet, or geometry when clamping should proceed;
// sets visibility itself (and returns 'hidden') for the inactive/offscreen cases.
function resolveInlayHintGeometry(element) {
  const wrapper = element && element.closest && element.closest('atom-overlay');
  if (!wrapper) return null;
  const editorElement = wrapper.closest && wrapper.closest('atom-text-editor');
  const scrollView = editorElement && editorElement.querySelector && editorElement.querySelector('.scroll-view');
  if (!scrollView) return null;

  wrapper.style.zIndex = 'auto';
  // The wrapper's layout box sits at the untransformed position (anchor extending rightward,
  // where nothing is visibly drawn) and would swallow clicks meant for the line beneath it.
  wrapper.style.pointerEvents = 'none';

  const viewRect = scrollView.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();

  // Pulsar positions overlays even for rows scrolled out of view, and the fixed-position
  // wrapper then lands on top of unrelated UI (tab bar, status bar). Hide those entirely.
  if (wrapperRect.top < viewRect.top || wrapperRect.top > viewRect.top + viewRect.height) {
    element.style.visibility = 'hidden';
    return 'hidden';
  }

  return { wrapper, viewRect, wrapperRect };
}

// The callout is shifted translateX(-100%), so wide labels can escape past the editor's left
// edge. Pin the box to the editor content area instead, keeping the arrow under the anchor.
function clampInlayHintCallout(element) {
  const geometry = resolveInlayHintGeometry(element);
  if (geometry == null) return false;
  if (geometry === 'hidden') return true;
  const { viewRect, wrapperRect } = geometry;

  const anchorX = wrapperRect.left;
  element.style.maxWidth = `${Math.max(viewRect.width - INLAY_HINT_VIEWPORT_MARGIN * 2, 0)}px`;

  const width = element.offsetWidth;
  const available = anchorX - viewRect.left - INLAY_HINT_VIEWPORT_MARGIN;
  const arrow = element._inlayHintArrow;
  if (width > available) {
    const clampX = Math.max(available, 0);
    element._inlayHintClampX = clampX;
    if (arrow) arrow.style.left = `${Math.max(clampX - 4, 2)}px`;
  } else {
    element._inlayHintClampX = null;
    if (arrow) arrow.style.left = 'calc(100% - 4px)';
  }
  applyInlayHintCalloutTransform(element);

  // Even with a visible anchor the box itself can poke out vertically (e.g. flipped above the
  // first visible line), landing on the tab bar or status bar. Hide it rather than cover UI.
  const boxRect = element.getBoundingClientRect();
  const boxBottom = boxRect.bottom != null ? boxRect.bottom : boxRect.top + boxRect.height;
  if (boxRect.top < viewRect.top - 1 || boxBottom > viewRect.top + viewRect.height + 1) {
    element.style.visibility = 'hidden';
    return true;
  }

  element.style.visibility = 'visible';
  return true;
}

// The cursor line's callout gets `current-line`, everything else `other-line` — how each state
// looks is decided entirely in styles/inlay-hints.less (and user stylesheets can override it).
function setInlayHintCalloutEmphasis(element, emphasized) {
  element.classList.toggle('current-line', !!emphasized);
  element.classList.toggle('other-line', !emphasized);
}

// Callouts move away from the cursor's line: hints on lines above it open upward, hints on
// the cursor's line or below it open downward.
function shouldPlaceInlayHintAbove(hintRow, cursorRow) {
  return Number.isFinite(cursorRow) && hintRow < cursorRow;
}

// All cosmetic styling lives in styles/inlay-hints.less so users can override it; only the
// functional properties stay inline (click-through, dynamic positioning, z-index).
function createInlayHintCallout(labelText) {
  const element = document.createElement('span');
  element.classList.add('vscode-inlay-hint', 'vscode-inlay-hint-callout');
  Object.assign(element.style, {
    pointerEvents: 'none',
    // Stays hidden until the first clamp runs, so the unclamped position is never painted.
    visibility: 'hidden',
    zIndex: '20'
  });

  const label = document.createElement('span');
  label.classList.add('vscode-inlay-hint-callout-label');
  label.textContent = labelText;
  label.style.pointerEvents = 'none';
  element.appendChild(label);

  const arrow = document.createElement('span');
  arrow.classList.add('vscode-inlay-hint-callout-arrow');
  arrow.style.left = 'calc(100% - 4px)';
  arrow.style.pointerEvents = 'none';
  element.appendChild(arrow);
  element._inlayHintArrow = arrow;
  element._inlayHintClampX = null;
  setInlayHintCalloutPlacement(element, false);
  return element;
}

function updateHintPlacements(editor) {
  const cursor = editor.getCursorBufferPosition && editor.getCursorBufferPosition();
  const cursorRow = cursor && cursor.row;
  for (const hint of editorHintState.get(editor) || []) {
    if (!hint.element) continue;
    setInlayHintCalloutEmphasis(hint.element, hint.row === cursorRow);
    setInlayHintCalloutPlacement(hint.element, shouldPlaceInlayHintAbove(hint.row, cursorRow));
    // Flipping above/below changes the box's vertical extent, so redo the viewport checks now
    // instead of waiting for the next wrapper reposition.
    clampInlayHintCallout(hint.element);
  }
}

function registerInlayHintsProvider(documentSelector, provider) {
  inlayHintProviders.push({ documentSelector, provider });
  setupForEditors();
  return new Disposable(() => {
    const idx = inlayHintProviders.findIndex(p => p.provider === provider);
    if (idx >= 0) inlayHintProviders.splice(idx, 1);
  });
}

let hintsEnabled = true;
let configObserved = false;
const trackedEditors = new Map();

function observeInlayHintConfig() {
  if (configObserved || typeof atom === 'undefined' || !atom.config) return;
  configObserved = true;
  atom.config.observe('pulsar-vscode-compat.showInlayHints', value => {
    hintsEnabled = value !== false;
    for (const [editor, renderNow] of trackedEditors) {
      if (hintsEnabled) renderNow();
      else clearHints(editor);
    }
  });
}

function setupForEditors() {
  observeInlayHintConfig();
  atom.workspace.observeTextEditors(editor => {
    if (editorHintState.has(editor)) return;
    const grammar = editor.getGrammar();
    const matching = inlayHintProviders.filter(p => matchesSelector(grammar.scopeName, p.documentSelector));
    if (!matching.length) return;

    editorHintState.set(editor, []);
    trackedEditors.set(editor, () => renderInlayHints(editor, matching));
    let debounce = null;

    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderInlayHints(editor, matching), 600);
    };

    const disposables = [
      editor.onDidStopChanging(refresh),
      editor.onDidChangeCursorPosition(() => updateHintPlacements(editor))
    ];
    const editorElement = editor.getElement && editor.getElement();
    if (editorElement) {
      // Background tabs are detached from the DOM and have no measured viewport; render once
      // the editor actually shows up, and re-fetch as vertical scrolling exposes new rows
      // (hints are only requested for the visible range).
      if (editorElement.onDidAttach) disposables.push(editorElement.onDidAttach(refresh));
      if (editorElement.onDidChangeScrollTop) {
        // Hints are fetched with a row buffer around the viewport; only re-fetch when the
        // scroll actually leaves that range, so ordinary scrolling doesn't churn overlays.
        disposables.push(editorElement.onDidChangeScrollTop(() => {
          const visible = editor.getVisibleRowRange && editor.getVisibleRowRange();
          if (!visible || !Number.isFinite(visible[0]) || !Number.isFinite(visible[1])) return;
          const fetched = fetchedHintRanges.get(editor);
          if (fetched && visible[0] >= fetched[0] && visible[1] <= fetched[1]) return;
          refresh();
        }));
      }
    }
    for (const { provider } of matching) {
      // Language servers signal readiness through this event; without it, hints requested
      // before the file is analyzed come back empty and nothing re-asks.
      if (typeof provider.onDidChangeInlayHints === 'function') {
        try { disposables.push(provider.onDidChangeInlayHints(refresh)); } catch (e) {}
      }
    }
    editor.onDidDestroy(() => {
      clearHints(editor);
      trackedEditors.delete(editor);
      clearTimeout(debounce);
      for (const d of disposables) { try { d.dispose(); } catch (e) {} }
    });
    refresh();
  });
}

function makeHintDecoration(editor, { row, col, element }) {
  const marker = editor.markBufferRange([[row, col], [row, col]], { invalidate: 'touch' });
  editor.decorateMarker(marker, { type: 'overlay', position: 'tail', item: element, avoidOverflow: false });
  const decoration = {
    row,
    element,
    observer: null,
    destroyed: false,
    destroy() {
      this.destroyed = true;
      if (this.observer) {
        try { this.observer.disconnect(); } catch (e) {}
        this.observer = null;
      }
      marker.destroy();
    }
  };
  // Pulsar attaches the overlay wrapper asynchronously — possibly much later, e.g. when the
  // editor sits in a background tab. Retry with backoff until it shows up (the decoration's
  // destroy stops the loop); giving up would leave the element visibility:hidden forever.
  const setupOverlay = (attempt) => {
    if (decoration.destroyed) return;
    if (!setInlayHintOverlayZIndexAuto(element)) {
      setTimeout(() => setupOverlay(attempt + 1), Math.min(20 * (attempt + 1), 500));
      return;
    }
    clampInlayHintCallout(element);
    // Pulsar rewrites the wrapper's style.left/top on every render pass (scroll, edits,
    // re-measure); re-clamp whenever that happens. MutationObserver callbacks run as
    // microtasks, before paint, so the intermediate position is never visible. The clamp
    // only writes to the item and arrow styles, never the wrapper, so this cannot loop.
    if (typeof MutationObserver === 'function') {
      const wrapper = element.closest('atom-overlay');
      decoration.observer = new MutationObserver(() => clampInlayHintCallout(element));
      decoration.observer.observe(wrapper, { attributes: true, attributeFilter: ['style'] });
    }
  };
  setupOverlay(0);
  return decoration;
}

const INLAY_HINT_ROW_BUFFER = 25;

async function renderInlayHints(editor, providers) {
  if (!hintsEnabled) {
    clearHints(editor);
    return;
  }

  const lineCount = editor.getLineCount();
  const visibleRanges = (editor.getVisibleRowRange && editor.getVisibleRowRange()) || [0, lineCount];
  const [firstRow, lastRow] = visibleRanges;
  // An unattached/unmeasured editor reports an empty visible range; keep whatever is rendered
  // and let the onDidAttach/scroll subscriptions trigger the render once it's real.
  if (!Number.isFinite(firstRow) || !Number.isFinite(lastRow) || (lastRow <= firstRow && lineCount > 1)) {
    return;
  }

  clearHints(editor);
  const doc = new TextDocument(editor);
  const fetchStart = Math.max(firstRow - INLAY_HINT_ROW_BUFFER, 0);
  const fetchEnd = Math.min(lastRow + INLAY_HINT_ROW_BUFFER, lineCount);
  fetchedHintRanges.set(editor, [fetchStart, fetchEnd]);
  const viewRange = new Range(new Position(fetchStart, 0), new Position(fetchEnd, 0));
  const decorations = [];
  const cursor = editor.getCursorBufferPosition && editor.getCursorBufferPosition();
  const cursorRow = cursor && cursor.row;

  for (const { provider } of providers) {
    try {
      const token = new CancellationTokenSource().token;
      let hints = await provider.provideInlayHints(doc, viewRange, token);
      if (!hints) continue;

      if (provider.resolveInlayHint) {
        hints = await Promise.all(hints.map(async h => {
          try {
            return await provider.resolveInlayHint(h, new CancellationTokenSource().token) || h;
          } catch (e) { return h; }
        }));
      }

      for (const hint of hints) {
        const labelText = Array.isArray(hint.label)
          ? hint.label.map(p => p.value || '').join('')
          : hint.label || '';
        if (!labelText) continue;

        const row = hint.position.line;
        const col = hint.position.character;
        const el = createInlayHintCallout(labelText);
        setInlayHintCalloutEmphasis(el, cursorRow === row);
        setInlayHintCalloutPlacement(el, !!cursor && shouldPlaceInlayHintAbove(row, cursorRow));
        decorations.push(makeHintDecoration(editor, { row, col, element: el }));
      }
    } catch (e) {}
  }

  editorHintState.set(editor, decorations);
}

function clearHints(editor) {
  const existing = editorHintState.get(editor) || [];
  for (const d of existing) { try { d.destroy(); } catch (e) {} }
  editorHintState.set(editor, []);
}

module.exports = {
  registerInlayHintsProvider,
  createInlayHintCallout,
  setInlayHintCalloutPlacement,
  setInlayHintCalloutEmphasis,
  shouldPlaceInlayHintAbove,
  setInlayHintOverlayZIndexAuto,
  clampInlayHintCallout
};
