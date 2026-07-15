'use strict';

const { TextDocument } = require('../types/text-document');
const { Range } = require('../types/range');
const { Position } = require('../types/position');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector } = require('../utils/selector');
const { Disposable } = require('../types/disposable');

const inlayHintProviders = [];
const editorHintState = new WeakMap();

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

  const arrow = element._inlayHintArrow;
  if (arrow) {
    arrow.style.top = above ? '' : '-4px';
    arrow.style.bottom = above ? '-4px' : '';
    arrow.style.transform = above ? 'translateX(-50%) rotate(225deg)' : 'translateX(-50%) rotate(45deg)';
  }
}

function setInlayHintOverlayZIndexAuto(element) {
  const overlay = element && element.closest && element.closest('atom-overlay');
  if (!overlay) return false;
  overlay.style.zIndex = 'auto';
  return true;
}

// The callout is shifted translateX(-100%), so wide labels can escape past the editor's left
// edge. Pin the box to the editor content area instead, keeping the arrow under the anchor.
function clampInlayHintCallout(element) {
  const wrapper = element && element.closest && element.closest('atom-overlay');
  if (!wrapper) return false;
  const editorElement = wrapper.closest && wrapper.closest('atom-text-editor');
  const scrollView = editorElement && editorElement.querySelector && editorElement.querySelector('.scroll-view');
  if (!scrollView) return false;

  const viewRect = scrollView.getBoundingClientRect();
  const anchorX = wrapper.getBoundingClientRect().left;
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
  element.style.visibility = 'visible';
  return true;
}

function shouldPlaceInlayHintAbove(hintRow, cursorRow) {
  return cursorRow === hintRow + 1;
}

function createInlayHintCallout(labelText) {
  const element = document.createElement('span');
  element.classList.add('vscode-inlay-hint', 'vscode-inlay-hint-callout');
  Object.assign(element.style, {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--tool-panel-background-color, #252525)',
    border: '1px solid var(--base-border-color, #666)',
    borderRadius: '3px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
    opacity: '0.92',
    padding: '2px 5px',
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
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
  Object.assign(arrow.style, {
    position: 'absolute',
    left: 'calc(100% - 4px)',
    width: '7px',
    height: '7px',
    background: 'var(--tool-panel-background-color, #252525)',
    borderLeft: '1px solid var(--base-border-color, #666)',
    borderTop: '1px solid var(--base-border-color, #666)',
    pointerEvents: 'none'
  });
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
    if (hint.element) setInlayHintCalloutPlacement(hint.element, shouldPlaceInlayHintAbove(hint.row, cursorRow));
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

function setupForEditors() {
  atom.workspace.observeTextEditors(editor => {
    if (editorHintState.has(editor)) return;
    const grammar = editor.getGrammar();
    const matching = inlayHintProviders.filter(p => matchesSelector(grammar.scopeName, p.documentSelector));
    if (!matching.length) return;

    editorHintState.set(editor, []);
    let debounce = null;

    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderInlayHints(editor, matching), 600);
    };

    const d1 = editor.onDidStopChanging(refresh);
    const d2 = editor.onDidChangeCursorPosition(() => updateHintPlacements(editor));
    editor.onDidDestroy(() => { clearHints(editor); d1.dispose(); d2.dispose(); });
    refresh();
  });
}

async function renderInlayHints(editor, providers) {
  clearHints(editor);
  const doc = new TextDocument(editor);
  const visibleRanges = editor.getVisibleRowRange ? editor.getVisibleRowRange() : [0, editor.getLineCount()];
  const viewRange = new Range(
    new Position(visibleRanges[0] || 0, 0),
    new Position(visibleRanges[1] || editor.getLineCount(), 0)
  );
  const decorations = [];

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
        const cursor = editor.getCursorBufferPosition && editor.getCursorBufferPosition();
        setInlayHintCalloutPlacement(el, !!cursor && shouldPlaceInlayHintAbove(row, cursor.row));
        const marker = editor.markBufferRange([[row, col], [row, col]], { invalidate: 'touch' });
        editor.decorateMarker(marker, { type: 'overlay', position: 'tail', item: el, avoidOverflow: false });
        const decoration = {
          row,
          element: el,
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
        // Pulsar attaches the overlay wrapper asynchronously (and not necessarily within one
        // tick), so keep retrying until it shows up; a missed attach would leave the callout
        // unclamped forever.
        const setupOverlay = (attempt) => {
          if (decoration.destroyed) return;
          if (!setInlayHintOverlayZIndexAuto(el)) {
            if (attempt < 50) setTimeout(() => setupOverlay(attempt + 1), 20);
            return;
          }
          clampInlayHintCallout(el);
          // Pulsar rewrites the wrapper's style.left/top on every render pass (scroll, edits,
          // re-measure); re-clamp whenever that happens. MutationObserver callbacks run as
          // microtasks, before paint, so the intermediate position is never visible. The clamp
          // only writes to the item and arrow styles, never the wrapper, so this cannot loop.
          if (typeof MutationObserver === 'function') {
            const wrapper = el.closest('atom-overlay');
            decoration.observer = new MutationObserver(() => clampInlayHintCallout(el));
            decoration.observer.observe(wrapper, { attributes: true, attributeFilter: ['style'] });
          }
        };
        setupOverlay(0);
        decorations.push(decoration);
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
  shouldPlaceInlayHintAbove,
  setInlayHintOverlayZIndexAuto,
  clampInlayHintCallout
};
