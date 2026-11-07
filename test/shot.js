'use strict';
// README 用スクリーンショットの撮影用。デモ文書を開き、段階的に選択を変えて待つ。
const vscode = require('vscode');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async function run() {
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const api = await vscode.extensions.getExtension('fatcorn753.tex-sync-view').activate();
  const dbg = api._debug;
  const doc = await vscode.workspace.openTextDocument(path.join(ws, 'main.tex'));
  const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('texSync.openPreview');
  while (!dbg.isReady()) await sleep(200);
  await sleep(3000);
  dbg.post({ type: 'zoomFit' });
  // 段階 1: 本文 3 行を選択
  const find = (s) => doc.getText().split('\n').findIndex((l) => l.includes(s));
  const a = find('左のエディタ');
  ed.selection = new vscode.Selection(a, 0, a + 1, 200);
  ed.revealRange(new vscode.Range(a - 3, 0, a - 3, 0), vscode.TextEditorRevealType.AtTop);
  await sleep(30000);
  // 段階 2: 複数行の数式
  const b = find('begin{align}');
  ed.selection = new vscode.Selection(b, 0, b + 3, 0);
  ed.revealRange(new vscode.Range(b - 8, 0, b - 8, 0), vscode.TextEditorRevealType.AtTop);
  await sleep(40000);
};
