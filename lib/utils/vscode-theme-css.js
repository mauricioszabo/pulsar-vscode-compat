'use strict';

const THEME_STYLE_ID = 'pulsar-vscode-compat-theme';
const HOST_THEME_STYLE_ID = 'pulsar-vscode-compat-host-theme';
const UPDATE_MESSAGE_TYPE = 'pulsar-vscode-compat:update-theme';

const FALLBACKS = {
  foreground: '#333',
  subtleForeground: '#777',
  selectedForeground: '#111',
  errorForeground: '#c00',
  infoForeground: '#5293d8',
  warningForeground: '#f78a46',
  successForeground: '#1fe977',
  background: '#fff',
  appBackground: '#fff',
  border: '#eee',
  panelBackground: '#f4f4f4',
  inputBackground: '#fff',
  buttonBackground: '#ccc',
  selectedBackground: 'hsla(0,0%,0%,.1)',
  hoverBackground: 'hsla(0,0%,0%,.1)',
  editorForeground: '#333',
  editorBackground: '#fff',
  editorSelection: '#69c',
  fontSize: '13px',
  inputFontSize: '14px',
  fontFamily: 'system-ui',
  editorFontFamily: 'monospace',
  editorFontSize: '13px'
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeStyleText(value) {
  return String(value).replace(/<\/style/gi, '<\\/style');
}

function isUsableCssValue(value) {
  if (!value) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (/^(initial|inherit|unset|none)$/i.test(text)) return false;
  if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*0\s*)?\)$/i.test(text)) return false;
  if (/^transparent$/i.test(text)) return false;
  return true;
}

function cssValue(style, property, fallback) {
  if (!style) return fallback;
  let value = '';
  try {
    if (property.startsWith('--') && typeof style.getPropertyValue === 'function') value = style.getPropertyValue(property);
    else value = style[property];
  } catch (e) {}
  return isUsableCssValue(value) ? String(value).trim() : fallback;
}

function firstValue() {
  for (const value of arguments) {
    if (isUsableCssValue(value)) return String(value).trim();
  }
  return '';
}

function getStyle(env, element) {
  if (!element) return null;
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  if (!win || typeof win.getComputedStyle !== 'function') return null;
  try { return win.getComputedStyle(element); } catch (e) { return null; }
}

function query(doc, selector) {
  if (!doc || typeof doc.querySelector !== 'function') return null;
  try { return doc.querySelector(selector); } catch (e) { return null; }
}

function createProbe(doc, tag, className) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const body = doc.body || doc.documentElement;
  if (!body || typeof body.appendChild !== 'function') return null;
  try {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (element.style) {
      element.style.position = 'absolute';
      element.style.left = '-10000px';
      element.style.top = '-10000px';
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
    }
    body.appendChild(element);
    return element;
  } catch (e) {
    return null;
  }
}

function removeProbe(element) {
  try {
    if (element && typeof element.remove === 'function') element.remove();
    else if (element && element.parentNode && typeof element.parentNode.removeChild === 'function') element.parentNode.removeChild(element);
  } catch (e) {}
}

function parseColor(value) {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(/^#([0-9a-f]{3})$/i);
  if (match) {
    return match[1].split('').map(ch => parseInt(ch + ch, 16));
  }
  match = text.match(/^#([0-9a-f]{6})$/i);
  if (match) {
    return [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16));
  }
  match = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (match) {
    if (match[4] !== undefined && Number(match[4]) === 0) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return null;
}

function luminance(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const linear = rgb.map(channel => {
    const n = Math.max(0, Math.min(255, channel)) / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function inferThemeClass(background, atomLike) {
  const lum = luminance(background);
  if (lum != null) return lum < 0.5 ? 'vscode-dark' : 'vscode-light';
  try {
    const names = (atomLike && atomLike.themes && atomLike.themes.getActiveThemeNames && atomLike.themes.getActiveThemeNames()) || [];
    if (names.some(name => /dark/i.test(name))) return 'vscode-dark';
  } catch (e) {}
  return 'vscode-light';
}

function atomConfigValue(atomLike, key) {
  try {
    if (atomLike && atomLike.config && typeof atomLike.config.get === 'function') return atomLike.config.get(key);
  } catch (e) {}
  return undefined;
}

function pxValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function buildPulsarThemeSnapshot(env = {}) {
  const doc = env.document || (typeof document !== 'undefined' ? document : null);
  const atomLike = env.atom || (typeof atom !== 'undefined' ? atom : null);
  const rootStyle = getStyle(env, doc && doc.documentElement);
  const bodyStyle = getStyle(env, doc && doc.body);
  const workspaceStyle = getStyle(env, query(doc, 'atom-workspace')) || bodyStyle || rootStyle;
  const editorStyle = getStyle(env, query(doc, 'atom-text-editor:not([mini])')) || rootStyle || workspaceStyle;
  const paneStyle = getStyle(env, query(doc, '.pane-item, atom-pane .item-views > *, atom-pane-container .item-views > *')) || null;
  const panelStyle = getStyle(env, query(doc, '.tool-panel, .tree-view, atom-panel, atom-dock')) || workspaceStyle;
  let createdButtonProbe = false;
  let createdInputProbe = false;
  let createdListProbe = false;
  let buttonProbe = query(doc, '.btn, button');
  if (!buttonProbe) { buttonProbe = createProbe(doc, 'button', 'btn'); createdButtonProbe = true; }
  let inputProbe = query(doc, '.input-text, atom-text-editor[mini]');
  if (!inputProbe) { inputProbe = createProbe(doc, 'atom-text-editor', 'input-text'); createdInputProbe = true; }
  let listProbe = query(doc, '.list-group .selected, .selected');
  if (!listProbe) { listProbe = createProbe(doc, 'div', 'list-group selected'); createdListProbe = true; }
  const buttonStyle = getStyle(env, buttonProbe) || workspaceStyle;
  const inputStyle = getStyle(env, inputProbe) || workspaceStyle;
  const listStyle = getStyle(env, listProbe) || workspaceStyle;

  const text = firstValue(
    cssValue(rootStyle, '--text-color', ''),
    cssValue(bodyStyle, '--text-color', ''),
    cssValue(workspaceStyle, 'color', ''),
    FALLBACKS.foreground
  );
  const background = firstValue(
    cssValue(rootStyle, '--base-background-color', ''),
    cssValue(bodyStyle, '--base-background-color', ''),
    cssValue(workspaceStyle, 'backgroundColor', ''),
    FALLBACKS.background
  );
  const paneBackground = firstValue(
    cssValue(rootStyle, '--pane-item-background-color', ''),
    cssValue(paneStyle, 'backgroundColor', ''),
    background
  );
  const paneBorder = firstValue(
    cssValue(rootStyle, '--pane-item-border-color', ''),
    cssValue(paneStyle, 'borderColor', ''),
    cssValue(rootStyle, '--base-border-color', ''),
    FALLBACKS.border
  );
  const editorBackground = firstValue(
    paneBackground,
    cssValue(rootStyle, '--syntax-background-color', ''),
    cssValue(editorStyle, '--syntax-background-color', ''),
    cssValue(editorStyle, 'backgroundColor', ''),
    background,
    FALLBACKS.editorBackground
  );
  const editorForeground = firstValue(
    cssValue(rootStyle, '--syntax-text-color', ''),
    cssValue(editorStyle, '--syntax-text-color', ''),
    cssValue(editorStyle, 'color', ''),
    text,
    FALLBACKS.editorForeground
  );

  if (createdButtonProbe) removeProbe(buttonProbe);
  if (createdInputProbe) removeProbe(inputProbe);
  if (createdListProbe) removeProbe(listProbe);

  const values = {
    foreground: text,
    subtleForeground: firstValue(cssValue(rootStyle, '--text-color-subtle', ''), FALLBACKS.subtleForeground),
    selectedForeground: firstValue(cssValue(rootStyle, '--text-color-selected', ''), cssValue(rootStyle, '--text-color-highlight', ''), text),
    errorForeground: firstValue(cssValue(rootStyle, '--text-color-error', ''), FALLBACKS.errorForeground),
    infoForeground: firstValue(cssValue(rootStyle, '--text-color-info', ''), FALLBACKS.infoForeground),
    warningForeground: firstValue(cssValue(rootStyle, '--text-color-warning', ''), FALLBACKS.warningForeground),
    successForeground: firstValue(cssValue(rootStyle, '--text-color-success', ''), FALLBACKS.successForeground),
    background,
    appBackground: firstValue(cssValue(rootStyle, '--app-background-color', ''), background),
    paneBackground,
    paneBorder,
    border: firstValue(cssValue(rootStyle, '--base-border-color', ''), cssValue(workspaceStyle, 'borderColor', ''), FALLBACKS.border),
    panelBackground: firstValue(cssValue(rootStyle, '--tool-panel-background-color', ''), cssValue(panelStyle, 'backgroundColor', ''), background),
    panelBorder: firstValue(cssValue(rootStyle, '--tool-panel-border-color', ''), cssValue(panelStyle, 'borderColor', ''), FALLBACKS.border),
    inputBackground: firstValue(cssValue(rootStyle, '--input-background-color', ''), cssValue(inputStyle, 'backgroundColor', ''), FALLBACKS.inputBackground),
    inputBorder: firstValue(cssValue(rootStyle, '--input-border-color', ''), cssValue(inputStyle, 'borderColor', ''), FALLBACKS.border),
    buttonBackground: firstValue(cssValue(rootStyle, '--button-background-color', ''), cssValue(buttonStyle, 'backgroundColor', ''), FALLBACKS.buttonBackground),
    buttonHoverBackground: firstValue(cssValue(rootStyle, '--button-background-color-hover', ''), cssValue(buttonStyle, 'backgroundColor', ''), FALLBACKS.buttonBackground),
    buttonBorder: firstValue(cssValue(rootStyle, '--button-border-color', ''), cssValue(buttonStyle, 'borderColor', ''), FALLBACKS.border),
    buttonForeground: firstValue(cssValue(buttonStyle, 'color', ''), text),
    hoverBackground: firstValue(cssValue(rootStyle, '--background-color-highlight', ''), FALLBACKS.hoverBackground),
    selectedBackground: firstValue(cssValue(rootStyle, '--background-color-selected', ''), cssValue(listStyle, 'backgroundColor', ''), FALLBACKS.selectedBackground),
    editorForeground,
    editorBackground,
    editorSelection: firstValue(cssValue(rootStyle, '--syntax-selection-color', ''), cssValue(editorStyle, '--syntax-selection-color', ''), FALLBACKS.editorSelection),
    editorCursor: firstValue(cssValue(rootStyle, '--syntax-cursor-color', ''), editorForeground),
    editorGutterForeground: firstValue(cssValue(rootStyle, '--syntax-gutter-text-color', ''), FALLBACKS.subtleForeground),
    editorGutterBackground: firstValue(cssValue(rootStyle, '--syntax-gutter-background-color', ''), editorBackground),
    ansiGreen: firstValue(cssValue(rootStyle, '--syntax-color-added', ''), '#0dbc79'),
    ansiYellow: firstValue(cssValue(rootStyle, '--syntax-color-modified', ''), '#e5e510'),
    ansiRed: firstValue(cssValue(rootStyle, '--syntax-color-removed', ''), '#cd3131'),
    fontFamily: firstValue(pxValue(atomConfigValue(atomLike, 'editor.fontFamily')), cssValue(rootStyle, '--font-family', ''), cssValue(workspaceStyle, 'fontFamily', ''), FALLBACKS.fontFamily),
    fontSize: firstValue(pxValue(atomConfigValue(atomLike, 'editor.fontSize')), cssValue(rootStyle, '--font-size', ''), cssValue(workspaceStyle, 'fontSize', ''), FALLBACKS.fontSize),
    inputFontSize: firstValue(cssValue(rootStyle, '--input-font-size', ''), FALLBACKS.inputFontSize),
    editorFontFamily: firstValue(pxValue(atomConfigValue(atomLike, 'editor.fontFamily')), cssValue(editorStyle, 'fontFamily', ''), cssValue(rootStyle, '--editor-font-family', ''), FALLBACKS.editorFontFamily),
    editorFontSize: firstValue(pxValue(atomConfigValue(atomLike, 'editor.fontSize')), cssValue(editorStyle, 'fontSize', ''), cssValue(rootStyle, '--editor-font-size', ''), FALLBACKS.editorFontSize)
  };
  return { values, themeClass: inferThemeClass(editorBackground, atomLike) };
}

function cssVar(name, value) {
  return `  ${name}: ${value} !important;`;
}

function buildVscodeThemeCss(snapshot) {
  const v = (snapshot && snapshot.values) || buildPulsarThemeSnapshot().values;
  const lines = [
    ':root, body {',
    cssVar('--vscode-font-family', v.fontFamily),
    cssVar('--vscode-font-size', v.fontSize),
    cssVar('--vscode-chat-font-size', v.fontSize),
    cssVar('--vscode-font-weight', 'normal'),
    cssVar('--vscode-foreground', v.foreground),
    cssVar('--vscode-disabledForeground', v.subtleForeground),
    cssVar('--vscode-descriptionForeground', v.subtleForeground),
    cssVar('--vscode-errorForeground', v.errorForeground),
    cssVar('--vscode-focusBorder', v.infoForeground),
    cssVar('--vscode-editor-foreground', v.editorForeground),
    cssVar('--vscode-editor-background', v.editorBackground),
    cssVar('--vscode-editor-font-family', v.editorFontFamily),
    cssVar('--vscode-editor-font-size', v.editorFontSize),
    cssVar('--vscode-editor-selectionBackground', v.editorSelection),
    cssVar('--vscode-editorCursor-foreground', v.editorCursor),
    cssVar('--vscode-editorLineNumber-foreground', v.editorGutterForeground),
    cssVar('--vscode-editorGutter-background', v.editorGutterBackground),
    cssVar('--vscode-sideBar-background', v.panelBackground),
    cssVar('--vscode-sideBar-foreground', v.foreground),
    cssVar('--vscode-sideBarActivityBarTop-border', v.paneBorder),
    cssVar('--vscode-panel-background', v.panelBackground),
    cssVar('--vscode-panel-border', v.panelBorder),
    cssVar('--vscode-titleBar-activeBackground', v.background),
    cssVar('--vscode-titleBar-activeForeground', v.foreground),
    cssVar('--vscode-statusBar-background', v.panelBackground),
    cssVar('--vscode-statusBar-foreground', v.foreground),
    cssVar('--vscode-input-background', v.inputBackground),
    cssVar('--vscode-input-foreground', v.foreground),
    cssVar('--vscode-input-border', v.inputBorder),
    cssVar('--vscode-inlineChatInput-border', v.inputBorder),
    cssVar('--vscode-inputOption-activeBorder', v.paneBorder),
    cssVar('--vscode-input-placeholderForeground', v.subtleForeground),
    cssVar('--vscode-dropdown-background', v.inputBackground),
    cssVar('--vscode-dropdown-foreground', v.foreground),
    cssVar('--vscode-dropdown-border', v.inputBorder),
    cssVar('--vscode-menu-background', v.inputBackground),
    cssVar('--vscode-menu-foreground', v.foreground),
    cssVar('--vscode-button-background', v.buttonBackground),
    cssVar('--vscode-button-foreground', v.buttonForeground),
    cssVar('--vscode-button-hoverBackground', v.buttonHoverBackground),
    cssVar('--vscode-button-secondaryBackground', v.background),
    cssVar('--vscode-button-secondaryForeground', v.foreground),
    cssVar('--vscode-list-hoverBackground', v.hoverBackground),
    cssVar('--vscode-list-activeSelectionBackground', v.selectedBackground),
    cssVar('--vscode-list-activeSelectionForeground', v.selectedForeground),
    cssVar('--vscode-list-inactiveSelectionBackground', v.hoverBackground),
    cssVar('--vscode-terminal-background', v.editorBackground),
    cssVar('--vscode-terminal-foreground', v.editorForeground),
    cssVar('--vscode-terminal-ansiGreen', v.ansiGreen),
    cssVar('--vscode-terminal-ansiYellow', v.ansiYellow),
    cssVar('--vscode-terminal-ansiRed', v.ansiRed),
    cssVar('--text-color', v.foreground),
    cssVar('--text-color-subtle', v.subtleForeground),
    cssVar('--base-background-color', v.background),
    cssVar('--base-border-color', v.border),
    cssVar('--pane-item-background-color', v.paneBackground),
    cssVar('--pane-item-border-color', v.paneBorder),
    cssVar('--app-input-background', v.inputBackground),
    cssVar('--app-primary-border-color', v.paneBorder),
    cssVar('--tool-panel-background-color', v.panelBackground),
    cssVar('--tool-panel-border-color', v.panelBorder),
    cssVar('--button-background-color', v.buttonBackground),
    cssVar('--button-border-color', v.buttonBorder),
    cssVar('--editor-font-family', v.editorFontFamily),
    cssVar('--editor-font-size', v.editorFontSize),
    '}',
    'body {',
    '  color: var(--vscode-foreground) !important;',
    '  background-color: var(--vscode-editor-background) !important;',
    '  font-family: var(--vscode-font-family) !important;',
    '  font-size: var(--vscode-font-size) !important;',
    '}'
  ];
  return lines.join('\n');
}

function buildCurrentThemePayload(env = {}) {
  const snapshot = buildPulsarThemeSnapshot(env);
  return { type: UPDATE_MESSAGE_TYPE, css: buildVscodeThemeCss(snapshot), themeClass: snapshot.themeClass };
}

function styleTag(css, nonce) {
  const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
  return `<style id="${THEME_STYLE_ID}"${nonceAttr}>${escapeStyleText(css)}</style>`;
}

function injectIntoHead(html, markup) {
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, match => `${match}${markup}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, match => `${match}<head>${markup}</head>`);
  return `${markup}${html}`;
}

function addBodyThemeClass(html, themeClass) {
  if (!themeClass) return html;
  if (/<body\b[^>]*\bclass=(['"])([^'"]*)\1[^>]*>/i.test(html)) {
    return html.replace(/<body\b([^>]*?)\bclass=(['"])([^'"]*)\2([^>]*)>/i, (match, before, quote, className, after) => {
      const classes = className.split(/\s+/).filter(Boolean);
      const filtered = classes.filter(value => value !== 'vscode-dark' && value !== 'vscode-light' && value !== 'vscode-high-contrast');
      if (!filtered.includes(themeClass)) filtered.push(themeClass);
      return `<body${before}class=${quote}${filtered.join(' ')}${quote}${after}>`;
    });
  }
  if (/<body\b/i.test(html)) return html.replace(/<body\b([^>]*)>/i, `<body class="${themeClass}"$1>`);
  return html;
}

function ensureCspAllowsInlineStyle(csp, nonce) {
  if (!csp) return csp;
  const token = nonce ? `'nonce-${nonce}'` : "'unsafe-inline'";
  if (/\bstyle-src\b/i.test(csp)) {
    return csp.replace(/\bstyle-src\b([^;]*)/i, (match, sources) => {
      if (sources.includes(token) || /(?:^|\s)'unsafe-inline'(?:\s|$)/.test(sources)) return match;
      return `${match} ${token}${/(?:^|\s)file:(?:\s|$)/.test(sources) ? '' : ' file:'}`;
    });
  }
  const trimmed = csp.trim();
  return `${trimmed}${trimmed.endsWith(';') ? '' : ';'} style-src ${token} file:;`;
}

function applyCspStyleNonce(html, nonce) {
  return String(html || '').replace(
    /(<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*\bcontent=)(["'])([\s\S]*?)(\2)([^>]*>)/i,
    (match, prefix, quote, csp, closeQuote, suffix) => `${prefix}${quote}${ensureCspAllowsInlineStyle(csp, nonce)}${closeQuote}${suffix}`
  );
}

function injectThemeIntoHtml(html, options = {}) {
  const css = options.css || buildVscodeThemeCss(options.snapshot);
  const nonce = options.nonce || '';
  const themeClass = options.themeClass || (options.snapshot && options.snapshot.themeClass) || 'vscode-light';
  let source = String(html || '');
  if (!source.includes(`id="${THEME_STYLE_ID}"`) && !source.includes(`id='${THEME_STYLE_ID}'`)) {
    source = injectIntoHead(source, styleTag(css, nonce));
  }
  source = addBodyThemeClass(source, themeClass);
  source = applyCspStyleNonce(source, nonce);
  return source;
}

function hostSafeCss(css) {
  const declarations = [];
  const source = String(css || '');
  const pattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+?)(\s*!important)?\s*;/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1];
    if (!/^--(?:vscode|app)-/.test(name)) continue;
    declarations.push(`${name}: ${match[2].trim()}${match[3] || ''};`);
  }
  return declarations.length ? `:root { ${declarations.join(' ')} }` : '';
}

function applyHostThemeCss(doc, css) {
  if (!doc) return null;
  let style = null;
  try { style = doc.getElementById && doc.getElementById(HOST_THEME_STYLE_ID); } catch (e) {}
  if (!style && typeof doc.createElement === 'function') {
    style = doc.createElement('style');
    style.id = HOST_THEME_STYLE_ID;
    const head = doc.head || query(doc, 'head') || doc.documentElement;
    if (head && typeof head.appendChild === 'function') head.appendChild(style);
  }
  if (style) style.textContent = hostSafeCss(css);
  return style;
}

function applyCurrentHostTheme(env = {}) {
  const doc = env.document || (typeof document !== 'undefined' ? document : null);
  const payload = buildCurrentThemePayload(env);
  applyHostThemeCss(doc, payload.css);
  try {
    if (doc && doc.documentElement && doc.documentElement.classList) {
      doc.documentElement.classList.remove('vscode-dark');
      doc.documentElement.classList.remove('vscode-light');
      doc.documentElement.classList.add(payload.themeClass);
    }
  } catch (e) {}
  return payload;
}

module.exports = {
  THEME_STYLE_ID,
  HOST_THEME_STYLE_ID,
  UPDATE_MESSAGE_TYPE,
  buildPulsarThemeSnapshot,
  buildVscodeThemeCss,
  buildCurrentThemePayload,
  injectThemeIntoHtml,
  ensureCspAllowsInlineStyle,
  applyHostThemeCss,
  applyCurrentHostTheme,
  inferThemeClass,
  parseColor
};
