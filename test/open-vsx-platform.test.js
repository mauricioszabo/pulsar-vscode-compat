'use strict';

const assert = require('assert');
const { selectOpenVsxDownload } = require('../lib/ui/install-vsx');

const info = {
  targetPlatform: 'alpine-arm64',
  files: { download: 'wrong-alpine-arm64.vsix' },
  downloads: {
    'linux-arm64': 'linux-arm64.vsix',
    'linux-x64': 'linux-x64.vsix',
    'darwin-arm64': 'darwin-arm64.vsix',
    'win32-x64': 'win32-x64.vsix'
  }
};

assert.strictEqual(selectOpenVsxDownload(info, 'linux', 'x64'), 'linux-x64.vsix');
assert.strictEqual(selectOpenVsxDownload(info, 'linux', 'arm64'), 'linux-arm64.vsix');
assert.strictEqual(selectOpenVsxDownload(info, 'darwin', 'arm64'), 'darwin-arm64.vsix');
assert.strictEqual(selectOpenVsxDownload(info, 'win32', 'x64'), 'win32-x64.vsix');
assert.strictEqual(
  selectOpenVsxDownload({ files: { download: 'universal.vsix' } }, 'linux', 'x64'),
  'universal.vsix'
);
assert.throws(
  () => selectOpenVsxDownload({ downloads: { 'linux-arm64': 'arm.vsix' } }, 'linux', 'x64'),
  /linux-x64/
);

console.log('Open VSX downloads select the host target platform');
