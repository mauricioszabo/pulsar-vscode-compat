'use strict';

const path = require('path');
const { Disposable } = require('../types/disposable');
const { EventEmitter } = require('../types/event-emitter');
const { TreeItemCollapsibleState } = require('../types/tree-item');
const { positionToAtomPointObject } = require('../utils/position-range');

const treeDataProviders = new Map();

function registerTreeDataProvider(viewId, dataProvider) {
  treeDataProviders.set(viewId, dataProvider);
  return new Disposable(() => treeDataProviders.delete(viewId));
}

function createTreeView(viewId, options = {}) {
  const provider = options.treeDataProvider || treeDataProviders.get(viewId);
  if (provider) treeDataProviders.set(viewId, provider);

  const _onDidExpandElement = new EventEmitter();
  const _onDidCollapseElement = new EventEmitter();
  const _onDidChangeSelection = new EventEmitter();
  const _onDidChangeVisibility = new EventEmitter();
  const _onDidChangeCheckboxState = new EventEmitter();

  let _message = '';
  let _title = viewId;
  let _description = '';
  let _badge;
  let disposed = false;

  return {
    get selection() { return []; },
    get visible() { return true; },
    get message() { return _message; },
    set message(v) { _message = v; },
    get title() { return _title; },
    set title(v) { _title = v; },
    get description() { return _description; },
    set description(v) { _description = v || ''; },
    get badge() { return _badge; },
    set badge(v) { _badge = v; },
    canSelectMany: options.canSelectMany || false,
    showCollapseAll: options.showCollapseAll || false,
    reveal(element, opts) { return Promise.resolve(); },
    dispose() {
      disposed = true;
      if (treeDataProviders.get(viewId) === provider) treeDataProviders.delete(viewId);
    },
    get _disposed() { return disposed; },
    onDidExpandElement: _onDidExpandElement.event,
    onDidCollapseElement: _onDidCollapseElement.event,
    onDidChangeSelection: _onDidChangeSelection.event,
    onDidChangeVisibility: _onDidChangeVisibility.event,
    onDidChangeCheckboxState: _onDidChangeCheckboxState.event
  };
}

function provideOutlines() {
  return {
    name: 'pulsar-vscode-compat',
    priority: 1,
    updateOnEdit: true,
    grammarScopes: ['*'],
    async getOutline(editor) {
      const outlineTrees = [];
      for (const [viewId, provider] of treeDataProviders) {
        const children = await getTreeChildren(provider, undefined);
        for (const child of children) {
          const outlineTree = await treeElementToOutlineTree(provider, child, viewId);
          if (outlineTree) outlineTrees.push(outlineTree);
        }
      }
      return outlineTrees.length ? { outlineTrees } : null;
    }
  };
}

async function getTreeChildren(provider, element) {
  if (!provider || typeof provider.getChildren !== 'function') return [];
  const children = await Promise.resolve(provider.getChildren(element));
  return Array.isArray(children) ? children : [];
}

async function treeElementToOutlineTree(provider, element, viewId) {
  if (!provider || typeof provider.getTreeItem !== 'function') return null;
  const treeItem = await Promise.resolve(provider.getTreeItem(element));
  return treeItemToOutlineTree(treeItem, {
    element,
    viewId,
    loadChildren: async () => {
      if (!isTreeItemExpandable(treeItem)) return [];
      const childElements = await getTreeChildren(provider, element);
      const children = [];
      for (const childElement of childElements) {
        const childTree = await treeElementToOutlineTree(provider, childElement, viewId);
        if (childTree) children.push(childTree);
      }
      return children;
    }
  });
}

async function treeItemToOutlineTree(treeItem, options = {}) {
  if (!treeItem) return null;

  const label = treeItemLabel(treeItem) || String(options.viewId || 'Tree Item');
  const outlineTree = {
    plainText: label,
    startPosition: treeItemStartPosition(treeItem),
    collapsed: treeItem.collapsibleState === TreeItemCollapsibleState.Collapsed,
    children: typeof options.loadChildren === 'function' ? await options.loadChildren() : []
  };

  const icon = treeItemIcon(treeItem);
  if (icon) outlineTree.icon = icon;

  const tooltip = treeItemTooltip(treeItem);
  if (tooltip) outlineTree.tooltip = tooltip;

  return outlineTree;
}

function isTreeItemExpandable(treeItem) {
  return treeItem && treeItem.collapsibleState !== undefined && treeItem.collapsibleState !== TreeItemCollapsibleState.None;
}

function treeItemLabel(treeItem) {
  if (!treeItem) return '';
  if (typeof treeItem.label === 'string') return treeItem.label;
  if (treeItem.label && treeItem.label.label) return treeItem.label.label;
  if (treeItem.resourceUri && treeItem.resourceUri.fsPath) return path.basename(treeItem.resourceUri.fsPath);
  if (treeItem.resourceUri && treeItem.resourceUri.path) return path.basename(treeItem.resourceUri.path);
  return '';
}

function treeItemStartPosition(treeItem) {
  return positionToAtomPointObject(treeItem && treeItem.range && treeItem.range.start) || { row: 0, column: 0 };
}

function treeItemTooltip(treeItem) {
  if (!treeItem || treeItem.tooltip == null) return '';
  if (typeof treeItem.tooltip === 'string') return treeItem.tooltip;
  if (treeItem.tooltip.value !== undefined) return String(treeItem.tooltip.value);
  return String(treeItem.tooltip);
}

function treeItemIcon(treeItem) {
  if (!treeItem || !treeItem.iconPath) return undefined;
  if (treeItem.iconPath.id) return iconFor(treeItem.iconPath.id);
  return undefined;
}

function iconFor(id) {
  const direct = {
    file: 'icon-file-text',
    folder: 'file-directory',
    'file-directory': 'file-directory',
    library: 'icon-fold',
    'symbol-array': 'type-array',
    'symbol-boolean': 'type-boolean',
    'symbol-class': 'type-class',
    'symbol-color': 'type-property',
    'symbol-constant': 'type-constant',
    'symbol-constructor': 'type-constructor',
    'symbol-enum': 'type-enum',
    'symbol-enum-member': 'type-enum',
    'symbol-event': 'icon-package',
    'symbol-field': 'type-field',
    'symbol-file': 'icon-file-text',
    'symbol-function': 'icon-package',
    'symbol-interface': 'type-interface',
    'symbol-key': 'type-property',
    'symbol-keyword': 'type-keyword',
    'symbol-method': 'type-method',
    'symbol-module': 'type-module',
    'symbol-namespace': 'type-namespace',
    'symbol-null': 'type-constant',
    'symbol-number': 'type-number',
    'symbol-object': 'type-class',
    'symbol-operator': 'type-method',
    'symbol-package': 'type-package',
    'symbol-property': 'type-property',
    'symbol-reference': 'type-variable',
    'symbol-snippet': 'type-keyword',
    'symbol-string': 'type-string',
    'symbol-struct': 'type-class',
    'symbol-text': 'type-string',
    'symbol-type-parameter': 'type-parameter',
    'symbol-unit': 'type-number',
    'symbol-value': 'type-variable',
    'symbol-variable': 'type-variable'
  };

  return direct[id] || id;
}

module.exports = {
  treeDataProviders,
  registerTreeDataProvider,
  createTreeView,
  provideOutlines,
  getTreeChildren,
  treeElementToOutlineTree,
  treeItemToOutlineTree,
  treeItemLabel,
  treeItemIcon,
  iconFor
};
