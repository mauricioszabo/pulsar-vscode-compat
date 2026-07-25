'use strict';

const assert = require('assert');

function fakeElement(tagName) {
  return {
    tagName,
    classList: { add() {}, remove() {} },
    style: {},
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    textContent: ''
  };
}

function installFakeAtom() {
  const panels = [];
  global.document = {
    body: fakeElement('body'),
    head: fakeElement('head'),
    createElement: fakeElement
  };
  global.atom = {
    workspace: {
      addBottomPanel(options) {
        const panel = {
          item: options.item,
          visible: !!options.visible,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          destroy() { this.destroyed = true; }
        };
        panels.push(panel);
        return panel;
      }
    },
    views: { getView() { return fakeElement('workspace'); } },
    commands: { dispatch() {} }
  };
  return panels;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

const panels = installFakeAtom();
const windowNamespace = require('../lib/namespaces/window');
const commands = require('../lib/namespaces/commands');

(async () => {
  await test('OutputChannel.show reveals an appended output panel', () => {
    const channel = windowNamespace.createOutputChannel('Python');
    channel.appendLine('Jedi could not be loaded');

    channel.show(true);

    assert.strictEqual(panels.length, 1);
    assert.strictEqual(panels[0].visible, true);
    assert.strictEqual(panels[0].item.dataset.name, 'Python');
    assert.match(panels[0].item.textContent, /Jedi could not be loaded/);
  });

  await test('LogOutputChannel exposes the VSCode onDidChangeLogLevel event', () => {
    const channel = windowNamespace.createOutputChannel('Mypy Test Log', { log: true });
    assert.strictEqual(typeof channel.onDidChangeLogLevel, 'function');
    const disposable = channel.onDidChangeLogLevel(() => {});
    assert.strictEqual(typeof disposable.dispose, 'function');
    disposable.dispose();
  });

  await test('workbench.action.output.show reveals an output channel by name', async () => {
    const channel = windowNamespace.createOutputChannel('Python Language Server');
    channel.appendLine('Language server failed');

    await commands.executeCommand('workbench.action.output.show', 'Python Language Server');

    const panel = panels.find(panel => panel.item.dataset.name === 'Python Language Server');
    assert(panel);
    assert.strictEqual(panel.visible, true);
    assert.match(panel.item.textContent, /Language server failed/);
  });

  await test('python.viewLanguageServerOutput reveals the Python language server channel as a fallback', async () => {
    const pythonChannel = windowNamespace.createOutputChannel('Python');
    const languageServerChannel = windowNamespace.createOutputChannel('Python Language Server');
    pythonChannel.appendLine('General Python output');
    languageServerChannel.appendLine('Jedi could not be loaded');
    languageServerChannel.show(true);
    languageServerChannel.hide();

    const panel = panels.find(panel => panel.item.dataset.name === 'Python Language Server');
    assert(panel);
    assert.strictEqual(panel.visible, false);

    await commands.executeCommand('python.viewLanguageServerOutput');

    assert.strictEqual(panel.visible, true);
    assert.match(panel.item.textContent, /Jedi could not be loaded/);
  });

  await test('workbench.action.output.show without a name prefers the Python language server channel', async () => {
    const pythonChannel = windowNamespace.createOutputChannel('Python');
    const languageServerChannel = windowNamespace.createOutputChannel('Python Language Server');
    pythonChannel.appendLine('General Python output');
    languageServerChannel.appendLine('Language server stderr');
    languageServerChannel.show(true);
    languageServerChannel.hide();

    const panel = panels.find(panel => panel.item.dataset.name === 'Python Language Server');
    assert(panel);
    assert.strictEqual(panel.visible, false);

    await commands.executeCommand('workbench.action.output.show');

    assert.strictEqual(panel.visible, true);
    assert.match(panel.item.textContent, /Language server stderr/);
  });
})();
