# HERMES.md

Project: `pulsar-vscode-compat`

This repository is a VSCode API compatibility layer for the Pulsar editor, which is a fork of Atom. The goal is pragmatic compatibility with real VSCode extensions, not a complete VSCode extension host clone.

## Current user/project preferences

- Keep VSCode compatibility work contained in this repository / package.
- Do not patch Pulsar core or generated/runtime copies unless the user explicitly asks.
- Prefer practical compatibility fixes driven by real extensions and workflows.
- Current practical target extensions include:
  - Calva
  - Anthropic Claude Code VSCode extension
  - Shopify Ruby LSP
- When changing runtime behavior, add or update focused tests under `test/` when feasible.
- For verification, a useful baseline is:

```sh
git diff --check
for f in test/*.test.js; do
  echo "== $f =="
  node "$f" || exit 1
done
```

## Recent work completed in this session

The README was expanded to document the implemented and partial VSCode APIs, including:

- Extension wrapping and activation shim.
- Open VSX / VSIX browser and wrapper package installation.
- VSCode activation event translation for command/language/startup/implicit activation cases.
- Command registration/execution and command palette metadata from `contributes.commands`.
- Workspace/document APIs, configuration mapping, workspace edits, `workspace.fs`, file-system providers, text document content providers, file watching, `findFiles`, and `findTextInFiles`.
- Language adapters for completion, hover, diagnostics, definitions/references/symbols, code actions, rename, formatting, signature help, document highlights, CodeLens, inlay hints, and folding placeholder registration.
- Integrations with Pulsar services such as autocomplete-plus, symbols-view, linter-indie, status-bar, atom-select-list, notifications, commands, and workspace APIs.
- QuickPick/InputBox, output channels, status bar, dialogs, notifications/messages, and pseudoterminal-backed terminals.
- Text editor wrapper identity, selection events, decorations, tab groups, `TabInputText`, and `TabInputWebview`.
- Iframe-backed webview panels with `acquireVsCodeApi`, message passing, CSP/resource handling, theme variable injection, live theme updates, `ViewColumn`, `panel.viewColumn`, and `panel.reveal(...)`.
- Extension discovery, URI handlers, notebook output data types, and DOM/Node compatibility shims needed by bundled SDK/browser code.

Tests were run and passed earlier in the session with the loop shown above.

## Clarification about basic tree view support

The phrase “tree view rendering for basic VSCode tree data providers” refers to code in:

- `lib/namespaces/window.js`
- `lib/types/tree-item.js`

Implemented API shape:

```js
vscode.window.registerTreeDataProvider(viewId, provider)
vscode.window.createTreeView(viewId, options)
vscode.TreeItem
vscode.TreeItemCollapsibleState
vscode.TreeItemCheckboxState
```

Current behavior:

- Stores a VSCode-style tree data provider by `viewId`.
- `createTreeView(viewId, { treeDataProvider })` creates a simple custom Pulsar dock item, usually in the left dock.
- Calls `provider.getChildren(element?)` and `provider.getTreeItem(element)`.
- Renders returned items as a simple nested HTML `<ul>/<li>` list.
- Uses `TreeItem.label` or `TreeItem.resourceUri` for display text.
- Shows simple disclosure glyphs for expanded/collapsed state.
- Recursively renders children only when `collapsibleState === Expanded`.
- Uses `TreeItem.tooltip` as the DOM `title`.
- If `TreeItem.command` exists, clicking the row dispatches that command through Pulsar.
- Listens to `provider.onDidChangeTreeData` and refreshes the rendered tree.

Important limitations:

- No real expand/collapse interaction.
- No persisted tree state.
- `treeView.selection` currently returns `[]`.
- `treeView.reveal(...)` is a stub that resolves.
- No checkbox behavior, icons, badges, drag/drop, context menus, or proper visibility lifecycle.
- Event emitters exist for expand/collapse/selection/visibility/checkbox, but the current UI does not really fire them.
- `registerTreeDataProvider(...)` only stores the provider; it does not render anything unless `createTreeView(...)` is called.

A more accurate changelog bullet would be:

```text
- Added basic `createTreeView` / `TreeDataProvider` support, rendering simple tree items into a Pulsar dock with command-click handling and refresh on `onDidChangeTreeData`.
```

## Relevant files for future sessions

Core API/export surface:

- `lib/vscode.js`
- `lib/namespaces/window.js`
- `lib/namespaces/workspace.js`
- `lib/namespaces/languages.js`
- `lib/types/*`

Important recent compatibility areas:

- `lib/types/file-system-watcher.js`
- `lib/namespaces/workspace.js`
- `lib/types/text-editor.js`
- `lib/types/webview-panel.js`
- `lib/types/tree-item.js`
- `lib/shims/*` if present

Tests currently present:

- `test/activation-events.test.js`
- `test/config-schema.test.js`
- `test/file-system-provider.test.js`
- `test/file-system-watcher.test.js`
- `test/node-event-target.test.js`
- `test/notebook-output-item.test.js`
- `test/text-editor-selection.test.js`
- `test/vscode-theme-css.test.js`
- `test/webview-api.test.js`
- `test/webview-panel.test.js`
- `test/workspace-find-files.test.js`

All packages live in `~/.pulsar/packages`. VSCode packages are prefixed with `vscode-`.

## Common pitfalls / reminders

- Avoid adding undeclared runtime dependencies. A recent failure was caused by `require('minimatch')` from `lib/types/file-system-watcher.js`; compatibility code should avoid dependencies unless they are declared and bundled correctly.
- For file watching, prefer Pulsar’s global `atom.watchPath` when available. Do not silently disable external file change events if `require('atom').watchPath` is unavailable.
- For VSCode compat work, stable wrapper identity matters. Some extensions compare object identity, e.g. `event.textEditor === vscode.window.activeTextEditor`.
- For Claude Code, practical webview compatibility includes CSP handling, iframe sizing, local resources, `acquireVsCodeApi` messaging, theme variables, live theme updates, `ViewColumn`, tab groups, and selection/file lookup APIs.
- For Calva, practical compatibility includes readable command palette names, REPL connection flows, QuickPick/InputBox, pseudoterminals, workspace APIs, and language-client-ish APIs.
- Do not inject Pulsar source theme variables into host compat CSS in a way that contaminates later theme snapshots; use VSCode-style variables for webviews.

## Suggested next steps

If continuing compatibility implementation work:

1. Reproduce the failing extension behavior or error first.
2. Locate the compat API gap in `lib/`.
3. Add a focused test if possible.
4. Implement the smallest pragmatic adapter/shim.
5. Run the relevant test plus the full `test/*.test.js` loop.
