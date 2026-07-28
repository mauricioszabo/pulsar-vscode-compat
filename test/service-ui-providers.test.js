'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch(error => {
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
}

function clearCompatRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/pulsar-vscode-compat/lib/')) delete require.cache[key];
  }
}

function fakeElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    classList: { add() {}, remove() {} },
    style: {},
    dataset: {}
  };
}

test('package advertises hover and outline-view providers instead of custom UI consumers', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));

  assert.strictEqual(manifest.providedServices.hover.versions['0.1.0'], 'provideHover');
  assert.strictEqual(manifest.providedServices['outline-view'].versions['0.1.0'], 'provideOutlines');
});

test('VSCode hover providers are exposed through the Pulsar hover service', async () => {
  clearCompatRequireCache();

  global.atom = {
    config: { get() { return 13; } },
    ui: { markdown: null },
    workspace: { observeTextEditors() {} },
    views: { getView() { return fakeElement(); } }
  };

  const vscode = require('../lib/vscode');
  const main = require('../lib/main');
  let receivedDocument = null;
  let receivedPosition = null;

  vscode.languages.registerHoverProvider('clojure', {
    provideHover(document, position) {
      receivedDocument = document;
      receivedPosition = position;
      return new vscode.Hover([
        { language: 'clojure', value: '(+ 1 2)' },
        { value: '**docs**' }
      ], new vscode.Range(new vscode.Position(3, 1), new vscode.Position(3, 4)));
    }
  });

  const serviceProvider = main.provideHover();
  assert.strictEqual(serviceProvider.name, 'pulsar-vscode-compat');
  assert.ok(serviceProvider.grammarScopes.includes('source.clojure'));

  const editor = {
    getGrammar() { return { scopeName: 'source.clojure' }; },
    getPath() { return '/tmp/core.clj'; },
    getText() { return '(+ 1 2)'; },
    getBuffer() { return { onDidChange() { return { dispose() {} }; } }; }
  };

  const hover = await serviceProvider.hover(editor, { row: 3, column: 2 });

  assert.strictEqual(receivedDocument.uri.fsPath, '/tmp/core.clj');
  assert.deepStrictEqual(receivedPosition, new vscode.Position(3, 2));
  assert.strictEqual(hover.contents.kind, 'markdown');
  assert.match(hover.contents.value, /```clojure\n\(\+ 1 2\)\n```/);
  assert.match(hover.contents.value, /\*\*docs\*\*/);
  assert.deepStrictEqual(hover.range.start, { row: 3, column: 1 });
  assert.deepStrictEqual(hover.range.end, { row: 3, column: 4 });
});

test('createTreeView registers an outline-view provider without opening custom dock UI', async () => {
  clearCompatRequireCache();

  const openCalls = [];
  global.atom = {
    workspace: {
      open(target, options) { openCalls.push([target, options]); return Promise.resolve(target); },
      getActivePaneItem() { return null; }
    },
    views: { getView() { return fakeElement(); } },
    commands: { dispatch() {} },
    config: { get() { return undefined; } }
  };
  global.document = { createElement: fakeElement };

  const vscode = require('../lib/vscode');
  const main = require('../lib/main');

  const provider = {
    async getChildren(element) {
      if (!element) return ['parent'];
      if (element === 'parent') return ['child'];
      return [];
    },
    getTreeItem(element) {
      if (element === 'parent') {
        const item = new vscode.TreeItem('Parent', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = vscode.ThemeIcon.Folder;
        return item;
      }
      const child = new vscode.TreeItem('Child');
      child.iconPath = new vscode.ThemeIcon('symbol-method');
      return child;
    }
  };

  const tree = vscode.window.createTreeView('calva.views.repl', { treeDataProvider: provider });
  assert.strictEqual(tree.title, 'calva.views.repl');
  assert.strictEqual(openCalls.length, 0);

  const outlineProvider = main.provideOutlines();
  assert.strictEqual(outlineProvider.name, 'pulsar-vscode-compat');
  assert.strictEqual(outlineProvider.updateOnEdit, true);

  const outline = await outlineProvider.getOutline({ getGrammar() { return { scopeName: 'source.clojure' }; } });
  assert.strictEqual(outline.outlineTrees.length, 1);
  assert.strictEqual(outline.outlineTrees[0].plainText, 'Parent');
  assert.strictEqual(outline.outlineTrees[0].icon, 'file-directory');
  assert.strictEqual(outline.outlineTrees[0].collapsed, true);
  assert.strictEqual(outline.outlineTrees[0].children[0].plainText, 'Child');
  assert.strictEqual(outline.outlineTrees[0].children[0].icon, 'type-method');
  assert.strictEqual(outline.outlineTrees[0].children[0].collapsed, false);
  assert.deepStrictEqual(outline.outlineTrees[0].startPosition, { row: 0, column: 0 });
});

test('VSCode reference providers are exposed through the pulsar-find-references service', async () => {
  clearCompatRequireCache();

  class FakeAtomRange {
    constructor(start, end) { this.start = start; this.end = end; }
    containsPoint() { return false; }
    toString() { return `${this.start}x${this.end}`; }
  }
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'atom') return { Range: FakeAtomRange };
    return originalLoad.apply(this, arguments);
  };

  global.atom = {
    config: { get() { return undefined; } },
    workspace: { observeTextEditors() {} },
    views: { getView() { return fakeElement(); } }
  };

  try {
    const vscode = require('../lib/vscode');
    const main = require('../lib/main');

    vscode.languages.registerReferenceProvider('clojure', {
      provideReferences(document, position, context, token) {
        return [
          {
            uri: vscode.Uri.file('/tmp/core.clj'),
            range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 3))
          }
        ];
      }
    });

    const manifest = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
    assert.strictEqual(manifest.providedServices['find-references'].versions['0.1.0'], 'provideFindReferences');

    const serviceProvider = main.provideFindReferences();

    const matchingEditor = {
      getGrammar() { return { scopeName: 'source.clojure' }; },
      getPath() { return '/tmp/core.clj'; },
      getText() { return 'foo\nbar\n'; },
      getWordUnderCursor() { return 'bar'; },
      getBuffer() { return { onDidChange() { return { dispose() {} }; } }; }
    };
    const nonMatchingEditor = {
      getGrammar() { return { scopeName: 'source.js' }; }
    };

    assert.strictEqual(serviceProvider.isEditorSupported(matchingEditor), true);
    assert.strictEqual(serviceProvider.isEditorSupported(nonMatchingEditor), false);

    const result = await serviceProvider.findReferences(matchingEditor, { row: 1, column: 1 });
    assert.strictEqual(result.type, 'data');
    assert.strictEqual(result.referencedSymbolName, 'bar');
    assert.strictEqual(result.references.length, 1);
    assert.strictEqual(result.references[0].uri, '/tmp/core.clj');
    assert.ok(result.references[0].range instanceof FakeAtomRange,
      'reference range must be a real atom.Range instance, not a plain object');
    assert.deepStrictEqual(result.references[0].range.start, [1, 0]);
    assert.deepStrictEqual(result.references[0].range.end, [1, 3]);
  } finally {
    Module._load = originalLoad;
  }
});
