'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('../types/event-emitter');
const { Disposable } = require('../types/disposable');
const { Uri } = require('../types/uri');

const Status = Object.freeze({
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
  TYPE_CHANGED: 11,
  ADDED_BY_US: 12,
  ADDED_BY_THEM: 13,
  DELETED_BY_US: 14,
  DELETED_BY_THEM: 15,
  BOTH_ADDED: 16,
  BOTH_DELETED: 17,
  BOTH_MODIFIED: 18
});

const RefType = Object.freeze({ Head: 0, RemoteHead: 1, Tag: 2 });

const _onDidChangeEnablement = new EventEmitter();
const _onDidChangeState = new EventEmitter();
const _onDidPublish = new EventEmitter();
const _onDidOpenRepository = new EventEmitter();
const _onDidCloseRepository = new EventEmitter();

let cachedRepositories = null;

function runGit(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrBuffer = Buffer.concat(stderr);
      const output = options.encoding === 'buffer' ? stdoutBuffer : stdoutBuffer.toString(options.encoding || 'utf8');
      if (code) {
        const error = new Error(stderrBuffer.toString('utf8') || `git ${args.join(' ')} exited with code ${code}`);
        error.stdout = output;
        error.stderr = stderrBuffer.toString('utf8');
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve(output);
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function runGitLines(cwd, args) {
  const out = await runGit(cwd, args);
  return out.replace(/\r?\n$/, '').split(/\r?\n/).filter(Boolean);
}

function isGitRepositoryRoot(rootPath) {
  try {
    const stat = fs.statSync(path.join(rootPath, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch (e) {
    return false;
  }
}

function findRepositoryRoot(startPath) {
  let current = path.resolve(startPath || '.');
  try {
    const stat = fs.statSync(current);
    if (stat.isFile()) current = path.dirname(current);
  } catch (e) {}

  while (current && current !== path.dirname(current)) {
    if (isGitRepositoryRoot(current)) return current;
    current = path.dirname(current);
  }
  return isGitRepositoryRoot(current) ? current : null;
}

function projectPaths() {
  try {
    if (global.atom && atom.project && typeof atom.project.getPaths === 'function') {
      return atom.project.getPaths();
    }
  } catch (e) {}
  return [];
}

function uniqueRepositoryRoots() {
  const roots = new Set();
  for (const projectPath of projectPaths()) {
    const root = findRepositoryRoot(projectPath);
    if (root) roots.add(root);
  }
  return Array.from(roots);
}

function changeUri(rootPath, filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
  return Uri.file(absolute);
}

function changeStatus(indexCode, worktreeCode) {
  if (indexCode === 'U' && worktreeCode === 'U') return Status.BOTH_MODIFIED;
  if (indexCode === 'A' && worktreeCode === 'A') return Status.BOTH_ADDED;
  if (indexCode === 'D' && worktreeCode === 'D') return Status.BOTH_DELETED;
  if (indexCode === 'D' && worktreeCode === 'U') return Status.DELETED_BY_US;
  if (indexCode === 'U' && worktreeCode === 'D') return Status.DELETED_BY_THEM;
  if (indexCode === 'A' && worktreeCode === 'U') return Status.ADDED_BY_US;
  if (indexCode === 'U' && worktreeCode === 'A') return Status.ADDED_BY_THEM;

  const code = indexCode && indexCode !== ' ' && indexCode !== '?' ? indexCode : worktreeCode;
  switch (code) {
    case 'A': return indexCode && indexCode !== ' ' && indexCode !== '?' ? Status.INDEX_ADDED : Status.UNTRACKED;
    case 'D': return indexCode && indexCode !== ' ' ? Status.INDEX_DELETED : Status.DELETED;
    case 'R': return Status.INDEX_RENAMED;
    case 'C': return Status.INDEX_COPIED;
    case 'T': return Status.TYPE_CHANGED;
    case '!': return Status.IGNORED;
    case '?': return Status.UNTRACKED;
    case 'M':
    default:
      return indexCode && indexCode !== ' ' && indexCode !== '?' ? Status.INDEX_MODIFIED : Status.MODIFIED;
  }
}

function makeChange(rootPath, status, filePath, originalPath) {
  const uri = changeUri(rootPath, filePath);
  const originalUri = originalPath ? changeUri(rootPath, originalPath) : uri;
  return { uri, originalUri, renameUri: originalPath ? uri : undefined, status };
}

function parsePorcelainStatus(rootPath, output) {
  const indexChanges = [];
  const workingTreeChanges = [];
  const mergeChanges = [];
  const entries = output.split('\0').filter(Boolean);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const indexCode = entry[0];
    const worktreeCode = entry[1];
    let filePath = entry.slice(3);
    let originalPath;

    if (indexCode === 'R' || indexCode === 'C') {
      originalPath = entries[++i];
    }

    const status = changeStatus(indexCode, worktreeCode);
    const change = makeChange(rootPath, status, filePath, originalPath);

    if (indexCode === 'U' || worktreeCode === 'U' || (indexCode === 'A' && worktreeCode === 'A') || (indexCode === 'D' && worktreeCode === 'D')) {
      mergeChanges.push(change);
      continue;
    }
    if (indexCode === '?' && worktreeCode === '?') {
      workingTreeChanges.push(makeChange(rootPath, Status.UNTRACKED, filePath));
      continue;
    }
    if (indexCode && indexCode !== ' ') indexChanges.push(change);
    if (worktreeCode && worktreeCode !== ' ') workingTreeChanges.push(makeChange(rootPath, changeStatus(' ', worktreeCode), filePath, originalPath));
  }

  return { indexChanges, workingTreeChanges, mergeChanges };
}

async function currentBranch(rootPath) {
  let name;
  try { name = (await runGit(rootPath, ['symbolic-ref', '--short', 'HEAD'])).trim(); } catch (e) {}
  let commit;
  try { commit = (await runGit(rootPath, ['rev-parse', 'HEAD'])).trim(); } catch (e) {}
  if (!name && !commit) return undefined;

  const branch = { type: RefType.Head, name, commit };
  if (name) {
    try {
      const upstream = (await runGit(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
      const slash = upstream.indexOf('/');
      if (slash > 0) branch.upstream = { remote: upstream.slice(0, slash), name: upstream.slice(slash + 1) };
      const counts = (await runGit(rootPath, ['rev-list', '--left-right', '--count', `${name}...@{u}`])).trim().split(/\s+/);
      branch.ahead = Number(counts[0]) || 0;
      branch.behind = Number(counts[1]) || 0;
    } catch (e) {}
  }
  return branch;
}

async function remotes(rootPath) {
  const lines = await runGitLines(rootPath, ['remote', '-v']).catch(() => []);
  const byName = new Map();
  for (const line of lines) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match) continue;
    const remote = byName.get(match[1]) || { name: match[1], isReadOnly: false };
    if (match[3] === 'fetch') remote.fetchUrl = match[2];
    if (match[3] === 'push') remote.pushUrl = match[2];
    byName.set(remote.name, remote);
  }
  return Array.from(byName.values());
}

function parseCommitLine(line) {
  const parts = line.split('\x1f');
  return {
    hash: parts[0] || '',
    parents: parts[1] ? parts[1].split(' ').filter(Boolean) : [],
    authorName: parts[2] || undefined,
    authorEmail: parts[3] || undefined,
    authorDate: parts[4] ? new Date(Number(parts[4]) * 1000) : undefined,
    commitDate: parts[5] ? new Date(Number(parts[5]) * 1000) : undefined,
    message: parts[6] || ''
  };
}

async function refs(rootPath, query = {}) {
  const args = ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)', 'refs/heads', 'refs/remotes', 'refs/tags'];
  if (query.count) args.splice(1, 0, '--count', String(query.count));
  const lines = await runGitLines(rootPath, args).catch(() => []);
  return lines.map(line => {
    const [refname, commit, upstream] = line.split('\0');
    if (refname.startsWith('refs/heads/')) {
      const name = refname.slice('refs/heads/'.length);
      const branch = { type: RefType.Head, name, commit };
      if (upstream) {
        const slash = upstream.indexOf('/');
        if (slash > 0) branch.upstream = { remote: upstream.slice(0, slash), name: upstream.slice(slash + 1) };
      }
      return branch;
    }
    if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length);
      const slash = name.indexOf('/');
      return { type: RefType.RemoteHead, name, remote: slash > 0 ? name.slice(0, slash) : undefined, commit };
    }
    return { type: RefType.Tag, name: refname.slice('refs/tags/'.length), commit };
  });
}

class GitRepository {
  constructor(rootPath) {
    this._rootPath = rootPath;
    this.rootUri = Uri.file(rootPath);
    this.inputBox = { value: '' };
    this._onDidChangeState = new EventEmitter();
    this._onDidChangeUI = new EventEmitter();
    this.ui = { selected: true, onDidChange: this._onDidChangeUI.event };
    this.state = {
      HEAD: undefined,
      refs: [],
      remotes: [],
      submodules: [],
      rebaseCommit: undefined,
      mergeChanges: [],
      indexChanges: [],
      workingTreeChanges: [],
      onDidChange: this._onDidChangeState.event
    };
  }

  async status() {
    const output = await runGit(this._rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => '');
    const parsed = parsePorcelainStatus(this._rootPath, output);
    this.state.HEAD = await currentBranch(this._rootPath);
    this.state.refs = await refs(this._rootPath).catch(() => []);
    this.state.remotes = await remotes(this._rootPath).catch(() => []);
    this.state.submodules = [];
    this.state.rebaseCommit = undefined;
    this.state.indexChanges = parsed.indexChanges;
    this.state.workingTreeChanges = parsed.workingTreeChanges;
    this.state.mergeChanges = parsed.mergeChanges;
    this._onDidChangeState.fire(undefined);
  }

  getConfigs() { return runGitLines(this._rootPath, ['config', '--list']).then(lines => lines.map(line => { const i = line.indexOf('='); return { key: line.slice(0, i), value: line.slice(i + 1) }; })); }
  getConfig(key) { return runGit(this._rootPath, ['config', '--get', key]).then(out => out.trim(), () => undefined); }
  setConfig(key, value) { return runGit(this._rootPath, ['config', key, value]).then(() => value); }
  getGlobalConfig(key) { return runGit(this._rootPath, ['config', '--global', '--get', key]).then(out => out.trim(), () => undefined); }

  getObjectDetails(treeish, filePath) { return runGit(this._rootPath, ['ls-tree', '-l', treeish, '--', filePath]).then(out => { const parts = out.trim().split(/\s+/); return { mode: parts[0], object: parts[2], size: Number(parts[3]) || 0 }; }); }
  detectObjectType(object) { return runGit(this._rootPath, ['cat-file', '-t', object]).then(out => ({ mimetype: out.trim() || 'text/plain' })); }
  buffer(ref, filePath) { return runGit(this._rootPath, ['show', `${ref}:${filePath}`], { encoding: 'buffer' }); }
  show(ref, filePath) { return runGit(this._rootPath, ['show', `${ref}:${filePath}`]); }
  getCommit(ref) { return runGit(this._rootPath, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s', ref]).then(out => parseCommitLine(out.trim())); }

  add(paths) { return runGit(this._rootPath, ['add', '--', ...paths]).then(() => undefined); }
  clean(paths) { return runGit(this._rootPath, ['clean', '-fd', '--', ...paths]).then(() => undefined); }
  apply(patchText, reverse) { return runGit(this._rootPath, ['apply', reverse ? '--reverse' : ''].filter(Boolean), { input: patchText }).then(() => undefined); }
  diff(cached) { return runGit(this._rootPath, ['diff'].concat(cached ? ['--cached'] : [])); }
  diffWithHEAD(filePath) { return filePath ? runGit(this._rootPath, ['diff', 'HEAD', '--', filePath]) : this.status().then(() => this.state.workingTreeChanges); }
  diffWith(ref, filePath) { return filePath ? runGit(this._rootPath, ['diff', ref, '--', filePath]) : runGit(this._rootPath, ['diff', '--name-status', ref]).then(() => []); }
  diffIndexWithHEAD(filePath) { return filePath ? runGit(this._rootPath, ['diff', '--cached', 'HEAD', '--', filePath]) : this.status().then(() => this.state.indexChanges); }
  diffIndexWith(ref, filePath) { return filePath ? runGit(this._rootPath, ['diff', '--cached', ref, '--', filePath]) : Promise.resolve([]); }
  diffBlobs(object1, object2) { return runGit(this._rootPath, ['diff', object1, object2]); }
  diffBetween(ref1, ref2, filePath) { return filePath ? runGit(this._rootPath, ['diff', ref1, ref2, '--', filePath]) : Promise.resolve([]); }
  hashObject(data) { return runGit(this._rootPath, ['hash-object', '--stdin'], { input: data }).then(out => out.trim()); }

  createBranch(name, checkout, ref) { return runGit(this._rootPath, ['branch', name].concat(ref ? [ref] : [])).then(() => checkout ? this.checkout(name) : undefined); }
  deleteBranch(name, force) { return runGit(this._rootPath, ['branch', force ? '-D' : '-d', name]).then(() => undefined); }
  getBranch(name) { return refs(this._rootPath).then(all => all.find(ref => ref.type === RefType.Head && ref.name === name)); }
  getBranches(query = {}) { return refs(this._rootPath, query).then(all => all.filter(ref => query.remote ? ref.type === RefType.RemoteHead : ref.type === RefType.Head)); }
  setBranchUpstream(name, upstream) { return runGit(this._rootPath, ['branch', '--set-upstream-to', upstream, name]).then(() => undefined); }
  getRefs(query = {}) { return refs(this._rootPath, query); }
  getMergeBase(ref1, ref2) { return runGit(this._rootPath, ['merge-base', ref1, ref2]).then(out => out.trim()); }
  tag(name, upstream) { return runGit(this._rootPath, ['tag', name, upstream]).then(() => undefined); }
  deleteTag(name) { return runGit(this._rootPath, ['tag', '-d', name]).then(() => undefined); }
  checkout(treeish) { return runGit(this._rootPath, ['checkout', treeish]).then(() => undefined); }
  addRemote(name, url) { return runGit(this._rootPath, ['remote', 'add', name, url]).then(() => undefined); }
  removeRemote(name) { return runGit(this._rootPath, ['remote', 'remove', name]).then(() => undefined); }
  renameRemote(name, newName) { return runGit(this._rootPath, ['remote', 'rename', name, newName]).then(() => undefined); }
  fetch(optionsOrRemote, ref, depth) { const args = ['fetch']; if (typeof optionsOrRemote === 'string') args.push(optionsOrRemote); else if (optionsOrRemote && optionsOrRemote.all) args.push('--all'); if (ref) args.push(ref); if (depth) args.push('--depth', String(depth)); return runGit(this._rootPath, args).then(() => undefined); }
  pull(unshallow) { return runGit(this._rootPath, ['pull'].concat(unshallow ? ['--unshallow'] : [])).then(() => undefined); }
  push(remoteName, branchName, setUpstream, force) { const args = ['push']; if (setUpstream) args.push('--set-upstream'); if (force !== undefined) args.push(force === 1 ? '--force-with-lease' : '--force'); if (remoteName) args.push(remoteName); if (branchName) args.push(branchName); return runGit(this._rootPath, args).then(() => undefined); }
  blame(filePath) { return runGit(this._rootPath, ['blame', '--', filePath]); }
  log(options = {}) { const args = ['log', `-n${options.maxEntries || 32}`, '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s']; if (options.path) args.push('--', options.path); return runGitLines(this._rootPath, args).then(lines => lines.map(parseCommitLine)); }
  commit(message, opts = {}) { const args = ['commit', '-m', message]; if (opts.all) args.push('-a'); if (opts.amend) args.push('--amend'); if (opts.signoff) args.push('--signoff'); if (opts.empty) args.push('--allow-empty'); if (opts.noVerify) args.push('--no-verify'); return runGit(this._rootPath, args).then(() => undefined); }
}

function repositories() {
  const roots = uniqueRepositoryRoots();
  const previous = cachedRepositories || [];
  cachedRepositories = roots.map(root => previous.find(repo => repo._rootPath === root) || new GitRepository(root));
  return cachedRepositories;
}

function getRepository(uri) {
  const filePath = uri && uri.fsPath ? uri.fsPath : String(uri || '');
  const root = findRepositoryRoot(filePath);
  if (!root) return null;
  return repositories().find(repo => repo._rootPath === root) || new GitRepository(root);
}

async function init(root) {
  const rootPath = root && root.fsPath ? root.fsPath : String(root || '');
  await runGit(rootPath, ['init']);
  cachedRepositories = null;
  const repo = getRepository(Uri.file(rootPath));
  if (repo) _onDidOpenRepository.fire(repo);
  return repo;
}

async function openRepository(root) {
  return getRepository(root);
}

const api = {
  state: 'initialized',
  onDidChangeState: _onDidChangeState.event,
  onDidPublish: _onDidPublish.event,
  git: { path: 'git' },
  get repositories() { return repositories(); },
  onDidOpenRepository: _onDidOpenRepository.event,
  onDidCloseRepository: _onDidCloseRepository.event,
  toGitUri(uri, ref) { return uri.with({ scheme: 'git', query: JSON.stringify({ path: uri.fsPath, ref }) }); },
  getRepository,
  init,
  openRepository,
  registerRemoteSourcePublisher() { return new Disposable(() => {}); },
  registerRemoteSourceProvider() { return new Disposable(() => {}); },
  registerCredentialsProvider() { return new Disposable(() => {}); },
  registerPushErrorHandler() { return new Disposable(() => {}); }
};

const extension = {
  id: 'vscode.git',
  extensionUri: Uri.file(__dirname),
  extensionPath: __dirname,
  isActive: true,
  packageJSON: { name: 'git', publisher: 'vscode', version: '1.0.0' },
  extensionKind: undefined,
  exports: {
    enabled: true,
    onDidChangeEnablement: _onDidChangeEnablement.event,
    getAPI(version) {
      if (version !== 1) throw new Error(`Unsupported vscode.git API version: ${version}`);
      return api;
    }
  },
  activate() { return Promise.resolve(this.exports); }
};

module.exports = { extension, api, GitRepository, Status, RefType, _private: { findRepositoryRoot, parsePorcelainStatus } };
