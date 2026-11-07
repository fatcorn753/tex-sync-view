'use strict';
// 実 VS Code を隔離プロファイルで起動してテストを走らせる(ユーザーの VS Code には触れない)。
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const app = process.env.CODE_APP || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const root = path.resolve(__dirname, '..');
const sample = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texsync-'));
if (process.env.SANDBOX) { // サンドボックスを複製し、導入済みの自作拡張を外して開発版と置き換える
  fs.cpSync(path.join(process.env.SANDBOX, 'data'), path.join(tmp, 'data'), { recursive: true });
  fs.cpSync(path.join(process.env.SANDBOX, 'ext'), path.join(tmp, 'ext'), { recursive: true });
  cp.spawnSync('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', ['--user-data-dir', path.join(tmp, 'data'), '--extensions-dir', path.join(tmp, 'ext'), '--uninstall-extension', 'fatcorn753.tex-sync-view'], { stdio: 'ignore' });
}
if (process.env.USER_SETTINGS) {
  fs.mkdirSync(path.join(tmp, 'data', 'User'), { recursive: true });
  fs.copyFileSync(process.env.USER_SETTINGS, path.join(tmp, 'data', 'User', 'settings.json'));
}
const args = [
  '--user-data-dir=' + path.join(tmp, 'data'),
  '--extensions-dir=' + path.join(tmp, 'ext'),
  '--extensionDevelopmentPath=' + root,
  '--extensionTestsPath=' + path.join(__dirname, process.env.TESTFILE || 'index.js'),
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : []),
  sample,
];
const c = cp.spawn(app, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
c.on('exit', (code) => process.exit(code));
