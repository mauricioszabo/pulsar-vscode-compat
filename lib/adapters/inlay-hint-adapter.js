'use strict';

const { TextDocument } = require('../types/text-document');
const { Range } = require('../types/range');
const { Position } = require('../types/position');
const { CancellationTokenSource } = require('../types/cancellation');
const { matchesSelector } = require('../utils/selector');
const { Disposable } = require('../types/disposable');

const inlayHintProviders = [];
const editorHintState = new WeakMap();

function setInlayHintCalloutPlacement(element, above) {
  element.classList.toggle('above', above);
  element.classList.toggle('below', !above);
  element.style.transform = above
    ? 'translateX(-100%) translateY(calc(-100% - 0.15em - var(--editor-line-height)))'
    : 'translateX(-100%) translateY(calc(1.4em + 3px - var(--editor-line-height)))';

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
    whiteSpace: 'nowrap',
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
        if (!setInlayHintOverlayZIndexAuto(el)) {
          setTimeout(() => setInlayHintOverlayZIndexAuto(el), 0);
        }
        decorations.push({ row, element: el, destroy() { marker.destroy(); } });
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

module.exports = { registerInlayHintsProvider, createInlayHintCallout, setInlayHintCalloutPlacement, shouldPlaceInlayHintAbove, setInlayHintOverlayZIndexAuto };
