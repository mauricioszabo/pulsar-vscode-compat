'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }
}

function makeTempGitRepository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-vscode-compat-git-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'one\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'two\n');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
  return dir;
}

test('extensions.getExtension exposes a built-in vscode.git extension API', () => {
  const root = makeTempGitRepository();
  global.atom = {
    project: { getPaths: () => [root] },
    packages: {
      getActivePackage: () => null,
      getLoadedPackage: () => null,
      getActivePackages: () => [],
      getLoadedPackages: () => []
    }
  };

  delete require.cache[require.resolve('../lib/namespaces/extensions')];
  delete require.cache[require.resolve('../lib/namespaces/builtin-git')];
  const extensions = require('../lib/namespaces/extensions');
  const gitExtension = extensions.getExtension('vscode.git');

  assert(gitExtension, 'expected vscode.git extension object');
  assert.strictEqual(gitExtension.id, 'vscode.git');
  assert.strictEqual(gitExtension.exports.enabled, true);
  assert.strictEqual(typeof gitExtension.exports.onDidChangeEnablement, 'function');

  const api = gitExtension.exports.getAPI(1);
  assert.strictEqual(api.state, 'initialized');
  assert.strictEqual(api.repositories.length, 1);
  assert.strictEqual(api.repositories[0].rootUri.fsPath, root);
  assert.strictEqual(api.getRepository(api.repositories[0].rootUri), api.repositories[0]);
});

test('built-in vscode.git repository status populates HEAD and change arrays', async () => {
  const root = makeTempGitRepository();
  global.atom = { project: { getPaths: () => [root] } };

  delete require.cache[require.resolve('../lib/namespaces/builtin-git')];
  const { api, Status } = require('../lib/namespaces/builtin-git');
  const repo = api.repositories[0];
  await repo.status();

  assert(repo.state.HEAD && repo.state.HEAD.commit, 'expected HEAD commit');
  assert(repo.state.workingTreeChanges.some(change => change.uri.fsPath.endsWith('tracked.txt')));
  assert(repo.state.workingTreeChanges.some(change => change.uri.fsPath.endsWith('untracked.txt') && change.status === Status.UNTRACKED));
  const log = await repo.log({ maxEntries: 1 });
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].message, 'initial');
});

run();
