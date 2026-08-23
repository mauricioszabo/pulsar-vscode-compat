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

## Forbidden permissions

* **DO NOT, EVER, EVER**, touch ~/.pulsar/ configs unless you ask EXPLICTLY for
* permissions AND the places you can work are under `~/.pulsar/packages/vs-*`
* (that is, to patch VSCode packages already installed)

* **DO NOT, EVER, EVER**, clear session, start Pulsar with
* `--clear-window-state`, or anything like that.

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
- `SharedArrayBuffer is not defined` at extension load: Chrome gates this global per-renderer-`ExecutionContext` via cross-origin isolation (COOP/COEP), checked at the point of use, not just as a missing property. Recovering a constructor via `require('vm').runInNewContext('SharedArrayBuffer')` and copying it onto `globalThis` (the original fix in `generateWrapperMain()`'s `_restoreSharedArrayBuffer`) looked right and passed its original test, but does **not** work in the real Pulsar renderer — the recovered constructor can still throw when actually constructed back in the gated context. The working fix (see `lib/ui/install-vsx.js`) tries the vm-recovered constructor but verifies it actually constructs, falling back to a construct-only `class SharedArrayBuffer extends ArrayBuffer {}` polyfill otherwise. This is safe because extension bundles observed in practice (e.g. Claude Code's) only call `Atomics.wait` on these buffers behind a `process.platform === 'win32'` guard; elsewhere they're just `new Int32Array(new SharedArrayBuffer(n))` at module scope for bookkeeping, which the polyfill satisfies without needing real shared memory. If a future extension needs a genuinely working `Atomics.wait`/cross-context shared memory on Linux/Mac, that requires real COOP/COEP headers on Pulsar's `BrowserWindow`, which is main-process/Pulsar-core territory outside what this package can fix.
- Pulsar's `TextBuffer` (`@pulsar-edit/text-buffer`) has **no `changeCount`** property, so anything deriving `TextDocument.version` from it silently pins the version at a constant. That is not cosmetic: language servers key their caches on the document version. ElixirLS reuses its cached parse of a file whenever the cached version is `>=` the incoming one, so a frozen version makes every edit after `didOpen` invisible and completions get answered against the on-disk file — observed as "autocomplete is very slow and returns ~2000 irrelevant items", then "autocomplete returns nothing" once the stale position lands somewhere uninteresting. `lib/types/text-document.js` now keeps its own per-buffer counter, bumped from `lib/namespaces/workspace.js` *before* `onDidChangeTextDocument` fires.
- Useful technique for language-server bugs: drive the server directly with a standalone stdio LSP client (spawn `extension/elixir-ls-release/language_server.sh`, send `initialize`/`didOpen`/`didChange`/`textDocument/completion`) and compare against what the compat layer produces. It separates "the server returned junk" from "we mangled the response" in one run, without launching Pulsar.
- Buffer-level events (`onDidChange`, `onWillSave`, `onDidSave`) must be subscribed **once per TextBuffer**, not once per TextEditor. Several editors can share one buffer (split panes, same file in two tabs), and duplicate incremental `didChange` notifications corrupt the server's copy of the document.
- `contentChanges` for one transaction must be ordered from the end of the document backwards (VSCode does this too). TextBuffer reports changes ascending with ranges against the pre-transaction document, and consumers apply them sequentially, so ascending order invalidates every range after the first resizing edit.
- A crashed/never-activated VSCode extension (e.g. from the SharedArrayBuffer crash above) explains a second, seemingly unrelated symptom: command palette entries showing raw humanized ids like "Claude Vscode.blur" instead of `contributes.commands` titles like "Claude Code: Focus input". Pulsar auto-registers placeholder commands for every `activationCommands` entry in the wrapper's package.json *before* the package activates, purely so the palette can lazily trigger activation; those placeholders have no display-name metadata. `lib/namespaces/commands.js`'s `registerCommand` re-registers each command with a real `displayName` from `extension/package.json`'s `contributes.commands`, but only once the extension actually finishes activating. If commands still show raw/humanized ids after confirming activation succeeds (check devtools console for `[vscode-compat] Failed to load extension`), that's a distinct bug in `lib/namespaces/commands.js`; if activation was failing, fixing activation is very likely already the fix.

## Suggested next steps

If continuing compatibility implementation work:

1. Reproduce the failing extension behavior or error first.
2. Locate the compat API gap in `lib/`.
3. Add a focused test if possible.
4. Implement the smallest pragmatic adapter/shim.
5. Run the relevant test plus the full `test/*.test.js` loop.
