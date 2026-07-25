'use strict';

const { EventEmitter } = require('../types/event-emitter');
const { Uri } = require('../types/uri');
const fs = require('fs');
const path = require('path');
const os = require('os');

const builtinExtensions = new Map([
  ['vscode.git', () => require('./builtin-git').extension]
]);

const _onDidChange = new EventEmitter();

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function originalExtensionManifest(pkgPath, wrapperManifest) {
  const nestedPath = path.join(pkgPath || '', 'extension', 'package.json');
  const nestedManifest = readJsonIfExists(nestedPath);
  if (nestedManifest) {
    return {
      packageJSON: nestedManifest,
      extensionPath: path.dirname(nestedPath)
    };
  }

  return {
    packageJSON: wrapperManifest,
    extensionPath: pkgPath
  };
}

function extensionExports(extensionId) {
  const registry = global.__pulsarVscodeExtensionExports;
  if (!registry) return undefined;
  return typeof registry.get === 'function' ? registry.get(extensionId) : registry[extensionId];
}

function extensionIsActive(extensionId) {
  const activeIds = global.__pulsarVscodeExtensionActiveIds;
  if (activeIds && typeof activeIds.has === 'function') return activeIds.has(extensionId);
  const registry = global.__pulsarVscodeExtensionExports;
  return !!(registry && typeof registry.has === 'function' && registry.has(extensionId));
}

function extensionActivationPromise(extensionId) {
  const promises = global.__pulsarVscodeExtensionActivationPromises;
  if (!promises) return undefined;
  return typeof promises.get === 'function' ? promises.get(extensionId) : promises[extensionId];
}

function wrapPackage(pkg) {
  const meta = pkg.metadata || {};
  const pkgPath = pkg.path || '';
  const original = originalExtensionManifest(pkgPath, meta);
  const packageJSON = original.packageJSON || meta;
  const extensionPath = original.extensionPath || pkgPath;
  const id = (packageJSON.publisher && packageJSON.name ? `${packageJSON.publisher}.${packageJSON.name}` : null) ||
    (meta._vscodeExtension && meta._vscodeExtension.id) ||
    pkg.name;
  return {
    id,
    extensionUri: Uri.file(extensionPath),
    extensionPath,
    get isActive() { return extensionIsActive(id); },
    packageJSON,
    get exports() { return extensionExports(id); },
    async activate() {
      let activation = extensionActivationPromise(id);
      if (activation) {
        await activation;
        return extensionExports(id);
      }
      if (!this.isActive && atom.packages && typeof atom.packages.activatePackage === 'function') {
        pkg = await atom.packages.activatePackage(pkg.name);
        activation = extensionActivationPromise(id);
        if (activation) await activation;
      }
      return extensionExports(id);
    }
  };
}

function allPackages() {
  const packages = [];
  try { packages.push(...atom.packages.getActivePackages()); } catch (e) {}
  try {
    for (const pkg of atom.packages.getLoadedPackages()) {
      if (!packages.includes(pkg)) packages.push(pkg);
    }
  } catch (e) {}
  return packages;
}

function packageMatchesExtensionId(pkg, extensionId) {
  const meta = pkg.metadata || {};
  return pkg.name === extensionId ||
    (meta._vscodeExtension && meta._vscodeExtension.id === extensionId);
}

function packageFromPath(pkgPath) {
  const metadata = readJsonIfExists(path.join(pkgPath || '', 'package.json'));
  if (!metadata) return null;
  return {
    name: metadata.name,
    path: pkgPath,
    metadata,
    mainModule: null,
    isActive() { return false; }
  };
}

function packagePathMatchesExtensionId(pkgPath, extensionId) {
  const pkg = packageFromPath(pkgPath);
  if (!pkg) return null;
  if (packageMatchesExtensionId(pkg, extensionId)) return pkg;

  const original = originalExtensionManifest(pkgPath, pkg.metadata);
  const manifest = original.packageJSON || {};
  const originalId = manifest.publisher && manifest.name ? `${manifest.publisher}.${manifest.name}` : null;
  return originalId === extensionId ? pkg : null;
}

function availablePackagePaths() {
  const paths = new Set();
  try {
    for (const pkgPath of atom.packages.getAvailablePackagePaths()) paths.add(pkgPath);
  } catch (e) {}

  try {
    const packagesDir = path.join(atom.getConfigDirPath ? atom.getConfigDirPath() : path.join(os.homedir(), '.pulsar'), 'packages');
    for (const name of fs.readdirSync(packagesDir)) paths.add(path.join(packagesDir, name));
  } catch (e) {}

  return Array.from(paths);
}

function getExtension(extensionId) {
  const builtin = builtinExtensions.get(extensionId);
  if (builtin) return builtin();

  let pkg;
  try { pkg = atom.packages.getActivePackage(extensionId); } catch (e) {}
  if (!pkg) {
    try { pkg = atom.packages.getLoadedPackage(extensionId); } catch (e) {}
  }
  if (!pkg) pkg = allPackages().find(candidate => packageMatchesExtensionId(candidate, extensionId));
  if (!pkg) {
    for (const pkgPath of availablePackagePaths()) {
      pkg = packagePathMatchesExtensionId(pkgPath, extensionId);
      if (pkg) break;
    }
  }
  return pkg ? wrapPackage(pkg) : undefined;
}

module.exports = {
  get all() {
    return Array.from(builtinExtensions.values()).map(load => load()).concat(allPackages().map(wrapPackage));
  },
  getExtension,
  onDidChange: _onDidChange.event
};
