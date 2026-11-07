'use strict';
// TeX Sync View: TeX 専用の PDF プレビューと SyncTeX 連動。
// 依存は pdf.js(media/pdfjs に同梱)のみ。ビルド工程なしの素の JS。
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const TEX_LANGS = new Set(['latex', 'tex']);
const isTexDoc = (doc) => !!doc && TEX_LANGS.has(doc.languageId);
const norm = (p) => path.resolve(p).normalize('NFC');

// GUI 起動の VS Code は PATH に TeX が入らないことがあるため補う
const TEX_PATH = ['/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
const execEnv = () => ({
  ...process.env,
  PATH: [...TEX_PATH, process.env.PATH || ''].join(path.delimiter),
});

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    cp.execFile(cmd, args, { env: execEnv(), maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ---------- SyncTeX ----------
const stats = { synctexCalls: 0, builds: 0, loads: 0 };
async function synctexView(file, line, col, pdf) {
  stats.synctexCalls++;
  const r = await run('synctex', ['view', '-i', `${line}:${col}:${file}`, '-o', pdf]);
  const recs = [];
  let cur = null;
  for (const l of r.stdout.split('\n')) {
    const m = /^(Page|x|y|h|v|W|H):(.*)$/.exec(l.trim());
    if (!m) continue;
    if (m[1] === 'Page') { cur = { page: Number(m[2]) }; recs.push(cur); continue; }
    if (cur) cur[m[1]] = Number(m[2]);
  }
  // h,v は箱の左下基準(pt, 紙面左上原点)。上端は v - H。
  return recs
    .filter((x) => x.page > 0 && isFinite(x.h) && isFinite(x.v))
    .map((x) => ({ page: x.page, x: x.h, y: x.v - x.H, w: x.W, h: x.H }));
}

async function synctexEdit(pdf, page, x, y) {
  stats.synctexCalls++;
  const r = await run('synctex', ['edit', '-o', `${page}:${x}:${y}:${pdf}`]);
  const input = /^Input:(.*)$/m.exec(r.stdout);
  const line = /^Line:(-?\d+)$/m.exec(r.stdout);
  if (!input || !line || Number(line[1]) < 1) return null;
  return { file: input[1].trim(), line: Number(line[1]) };
}

// ---------- ルート判定 ----------
function findRoot(doc) {
  const cfg = vscode.workspace.getConfiguration('texSync');
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const base = folder ? folder.uri.fsPath : path.dirname(doc.uri.fsPath);
  const conf = cfg.get('rootFile');
  if (conf) return path.resolve(base, conf);
  const head = doc.getText().slice(0, 5000);
  const m = /^%\s*!TEX\s+root\s*=\s*(.+)$/im.exec(head);
  if (m) return path.resolve(path.dirname(doc.uri.fsPath), m[1].trim());
  if (/\\documentclass/.test(doc.getText())) return doc.uri.fsPath;
  for (const dir of [path.dirname(doc.uri.fsPath), base]) {
    const c = path.join(dir, 'main.tex');
    if (fs.existsSync(c)) return c;
  }
  return doc.uri.fsPath;
}

// 出力先: texSync.outDir > latex-workshop.latex.outDir > out の順で採用(%DIR% は ルートと同じ場所)
function outDirOf(root) {
  const mine = vscode.workspace.getConfiguration('texSync').get('outDir');
  const lw = vscode.workspace.getConfiguration('latex-workshop').get('latex.outDir');
  let out = mine || lw || 'out';
  out = out.replace(/%DIR%/g, path.dirname(root)).replace(/%DOC%|%DOCFILE%/g, '');
  return path.resolve(path.dirname(root), out);
}

function pdfOf(root) {
  return path.join(outDirOf(root), path.basename(root, path.extname(root)) + '.pdf');
}

// latexmk の引数: texSync.latexmkArgs > LaTeX Workshop の先頭レシピ(latexmk のとき) > 既定
function latexmkArgsOf(root) {
  const dir = path.dirname(root);
  const name = path.basename(root, path.extname(root));
  const out = outDirOf(root);
  let args = vscode.workspace.getConfiguration('texSync').get('latexmkArgs');
  let source = 'texSync.latexmkArgs';
  if (!args || !args.length) {
    const lw = vscode.workspace.getConfiguration('latex-workshop');
    const recipes = lw.get('latex.recipes') || [];
    const tools = lw.get('latex.tools') || [];
    const first = recipes[0] && recipes[0].tools && recipes[0].tools[0];
    const tool = tools.find((t) => t.name === first);
    if (tool && tool.command === 'latexmk' && Array.isArray(tool.args)) {
      args = tool.args.map((a) => String(a)
        .replace(/%OUTDIR%/g, out).replace(/%DIR%/g, dir)
        .replace(/%DOCFILE%/g, name).replace(/%DOC%/g, path.join(dir, name)).replace(/%DOC_EXT%/g, root));
      source = 'latex-workshop recipe ' + first;
    } else {
      args = ['-interaction=nonstopmode', '-file-line-error', `-outdir=${out}`, root];
      source = 'default';
    }
  } else {
    args = [...args, `-outdir=${out}`, root];
  }
  // 標準入力が無いため、エラーで入力待ちにならないよう必ず付ける
  if (!args.some((a) => a.startsWith('-interaction'))) args.unshift('-interaction=nonstopmode');
  return { args, source };
}

// ---------- 本体 ----------
function activate(context) {
  const output = vscode.window.createOutputChannel('TeX Sync');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(output, status);

  /** @type {{panel: vscode.WebviewPanel, root: string, pdf: string, ready: boolean, lastMtime: number}|null} */
  let view = null;
  let ignoreEditorScrollUntil = 0;
  let noRevealUntil = 0; // この時刻までは選択マークで PDF を自動スクロールしない
  let lastPdfUserScroll = 0;
  let programmatic = null; // 拡張が動かしたエディタ位置。その位置のスクロールイベントは無視する
  let building = false;
  let rebuildQueued = false;
  const timers = {};
  const debounce = (key, ms, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
  context.subscriptions.push({ dispose: () => Object.values(timers).forEach(clearTimeout) });

  const post = (msg) => { if (view && view.ready) view.panel.webview.postMessage(msg); };
  const setStatus = (text) => { post({ type: 'status', text }); };

  // LaTeX Workshop が自動ビルドしている間は二重ビルドを避ける(PDF 更新は watcher で拾う)
  function shouldBuildOnSave() {
    const mode = vscode.workspace.getConfiguration('texSync').get('buildOnSave');
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    const lwInstalled = !!vscode.extensions.getExtension('James-Yu.latex-workshop');
    const lwAuto = vscode.workspace.getConfiguration('latex-workshop').get('latex.autoBuild.run');
    return !(lwInstalled && lwAuto !== 'never');
  }

  // ----- ビルド -----
  async function build(root) {
    stats.builds++;
    if (building) { rebuildQueued = true; return; }
    building = true;
    try {
      do {
        rebuildQueued = false;
        const { args, source } = latexmkArgsOf(root);
        setStatus('ビルド中…');
        output.appendLine(`[${source}]\n$ latexmk ${args.join(' ')}  (cwd=${path.dirname(root)})`);
        const r = await run('latexmk', args, { cwd: path.dirname(root) });
        output.appendLine(r.stdout + r.stderr);
        if (r.err) {
          setStatus('ビルド失敗(出力パネル "TeX Sync" を参照)');
          vscode.window.showWarningMessage('TeX Sync: ビルドに失敗しました。出力パネル "TeX Sync" を確認してください。');
        } else {
          setStatus('');
        }
        await reloadPdf(true);
      } while (rebuildQueued);
    } finally {
      building = false;
    }
  }

  // ----- PDF の読み込み -----
  async function reloadPdf(force) {
    if (!view) return;
    let st;
    try { st = fs.statSync(view.pdf); } catch { return; }
    if (!force && st.mtimeMs === view.lastMtime) return;
    view.lastMtime = st.mtimeMs;
    stats.loads++;
    const uri = view.panel.webview.asWebviewUri(vscode.Uri.file(view.pdf)).toString();
    post({ type: 'load', uri: `${uri}?t=${st.mtimeMs}` });
  }

  // ----- パネル -----
  async function openPreview(editor) {
    const doc = editor && editor.document;
    if (!isTexDoc(doc)) { vscode.window.showInformationMessage('TeX ファイルを開いた状態で実行してください。'); return; }
    const root = findRoot(doc);
    const pdf = pdfOf(root);
    if (view) {
      view.root = root; view.pdf = pdf; view.panel.reveal(vscode.ViewColumn.Beside, true);
      await reloadPdf(true);
      return;
    }
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, 'media'));
    const panel = vscode.window.createWebviewPanel('texSyncPreview', 'TeX PDF', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot, vscode.Uri.file(path.dirname(root)), vscode.Uri.file(path.dirname(pdf))],
    });
    view = { panel, root, pdf, ready: false, lastMtime: 0 };
    panel.webview.html = html(panel.webview, mediaRoot);
    panel.onDidDispose(() => { view = null; });
    panel.webview.onDidReceiveMessage(onWebviewMessage);
    if (!fs.existsSync(pdf)) build(root);
  }

  function html(webview, mediaRoot) {
    const u = (f) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, f)).toString();
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; worker-src blob:; connect-src ${webview.cspSource};">
<link rel="stylesheet" href="${u('viewer.css')}">
</head><body data-pdfjs="${u('pdfjs/pdf.min.mjs')}" data-worker="${u('pdfjs/pdf.worker.min.mjs')}" data-cmaps="${u('pdfjs/cmaps/')}" data-fonts="${u('pdfjs/standard_fonts/')}">
<div id="bar"><button id="zout">−</button><button id="zin">＋</button><button id="zfit">幅に合わせる</button><span id="pg"></span><span id="st"></span></div>
<div id="wrap"><div id="pages"></div></div>
<script type="module" src="${u('viewer.js')}" nonce="${nonce}"></script>
</body></html>`;
  }

  // ----- webview → 拡張 -----
  const inbox = []; // テスト用: webview から届いたメッセージの記録
  async function onWebviewMessage(m) {
    inbox.push(m);
    if (inbox.length > 200) inbox.shift();
    if (!view) return;
    if (m.type === 'ready') {
      view.ready = true;
      await reloadPdf(true);
      const ed = vscode.window.activeTextEditor;
      if (ed && isTexDoc(ed.document)) markSelection(ed);
    } else if (m.type === 'scroll') {
      onPdfScroll(m);
    } else if (m.type === 'click') {
      const hit = await synctexEdit(view.pdf, m.page, m.x, m.y);
      if (hit) await jumpTo(hit, true);
    }
  }

  const resolveInput = (file) => norm(path.isAbsolute(file) ? file : path.join(path.dirname(view.root), file));

  async function jumpTo(hit, openIfNeeded) {
    const target = resolveInput(hit.file);
    if (!fs.existsSync(target)) return;
    const pos = new vscode.Position(hit.line - 1, 0);
    const range = new vscode.Range(pos, pos);
    let ed = vscode.window.visibleTextEditors.find((e) => norm(e.document.uri.fsPath) === target);
    if (!ed && !openIfNeeded) return;
    if (!ed) {
      const doc = await vscode.workspace.openTextDocument(target);
      if (!isTexDoc(doc)) return;
      ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    } else if (openIfNeeded) {
      await vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: false });
    }
    // tex→PDF の逆流を止める窓。行→位置の対応は一対一ではないため、時間でも止める
    ignoreEditorScrollUntil = Date.now() + (openIfNeeded ? 1500 : 1200);
    programmatic = { file: target, line: hit.line - 1 };
    if (openIfNeeded) {
      // PDF クリックによるジャンプ: カーソルを移すが、その選択変更で PDF を動かし返さない
      noRevealUntil = Date.now() + 800;
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
      // スクロール連動: 利用者の選択範囲は変えない
      ed.revealRange(range, vscode.TextEditorRevealType.AtTop);
    }
  }

  // PDF のスクロール → tex のスクロール
  function onPdfScroll(m) {
    if (!vscode.workspace.getConfiguration('texSync').get('scrollSync')) return;
    lastPdfUserScroll = Date.now();
    debounce('pdfscroll', 60, async () => {
      if (!view) return;
      // 紙面の上端は余白で箱に当たらないため、少し下の位置を引く
      const hit = await synctexEdit(view.pdf, m.page, m.x, m.y + 24);
      if (!hit) return;
      const cur = vscode.window.visibleTextEditors.find((e) => norm(e.document.uri.fsPath) === resolveInput(hit.file));
      if (cur && cur.visibleRanges.length && Math.abs(cur.visibleRanges[0].start.line - (hit.line - 1)) < 2) return;
      await jumpTo(hit, false);
    });
  }

  // tex のスクロール → PDF のスクロール
  function onEditorScroll(ed) {
    const cfg = vscode.workspace.getConfiguration('texSync');
    if (!view || !cfg.get('scrollSync') || !isTexDoc(ed.document)) return;
    if (Date.now() < ignoreEditorScrollUntil || Date.now() - lastPdfUserScroll < 900) return;
    if (ed.visibleRanges.length && programmatic && programmatic.file === norm(ed.document.uri.fsPath)
        && Math.abs(ed.visibleRanges[0].start.line - programmatic.line) <= 2) return;
    debounce('edscroll', 60, async () => {
      if (!view || !ed.visibleRanges.length) return;
      programmatic = null; // 利用者が別位置へ動かした
      const top = ed.visibleRanges[0].start.line;
      const file = norm(ed.document.uri.fsPath);
      // 空行・コメント行は箱が無いので、近い行を順に試す
      for (const d of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
        const line = top + 1 + d;
        if (line > ed.document.lineCount) break;
        const text = ed.document.lineAt(line - 1).text;
        if (!text.trim() || /^\s*%/.test(text)) continue;
        const col = text.length - text.trimStart().length + 1;
        const rects = await synctexView(file, line, col, view.pdf);
        if (rects.length) {
          const r = rects[0];
          post({ type: 'scrollTo', page: r.page, y: r.y - d * 0, align: 'top' });
          return;
        }
      }
    });
  }

  // 選択範囲 → PDF のマーク
  function markSelection(ed) {
    const cfg = vscode.workspace.getConfiguration('texSync');
    if (!view || !cfg.get('markSelection') || !isTexDoc(ed.document)) return;
    debounce('mark', 120, async () => {
      if (!view) return;
      const doc = ed.document;
      const file = norm(doc.uri.fsPath);
      const sel = ed.selection;
      const targets = [];
      if (sel.isEmpty) {
        targets.push([sel.active.line + 1, sel.active.character + 1]);
      } else {
        const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
        for (let l = sel.start.line; l <= endLine; l++) {
          const t = doc.lineAt(l).text;
          if (!t.trim() || /^\s*%/.test(t)) continue;
          targets.push([l + 1, Math.max(t.length - t.trimStart().length + 1, l === sel.start.line ? sel.start.character + 1 : 1)]);
        }
        const max = Math.max(1, cfg.get('maxMarkLines'));
        if (targets.length > max) {
          const step = targets.length / max;
          const pick = [];
          for (let i = 0; i < max; i++) pick.push(targets[Math.floor(i * step)]);
          pick.push(targets[targets.length - 1]);
          targets.splice(0, targets.length, ...pick);
        }
      }
      const rects = [];
      const seen = new Set();
      const queue = targets.slice();
      const worker = async () => {
        while (queue.length) {
          const [l, c] = queue.shift();
          for (const r of await synctexView(file, l, c, view ? view.pdf : '')) {
            const k = [r.page, r.x.toFixed(1), r.y.toFixed(1), r.w.toFixed(1)].join(',');
            if (!seen.has(k)) { seen.add(k); rects.push(r); }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, targets.length) }, worker));
      post({ type: 'highlight', rects, reveal: Date.now() >= noRevealUntil });
    });
  }

  // ----- 登録 -----
  context.subscriptions.push(
    vscode.commands.registerCommand('texSync.openPreview', () => openPreview(vscode.window.activeTextEditor)),
    vscode.commands.registerCommand('texSync.build', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed && isTexDoc(ed.document)) build(findRoot(ed.document));
    }),
    vscode.commands.registerCommand('texSync.toggleScrollSync', async () => {
      const cfg = vscode.workspace.getConfiguration('texSync');
      const next = !cfg.get('scrollSync');
      await cfg.update('scrollSync', next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`TeX Sync: スクロール連動 ${next ? 'ON' : 'OFF'}`, 3000);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!isTexDoc(doc) || !view) return;
      if (shouldBuildOnSave()) build(view.root);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => { if (e.textEditor === vscode.window.activeTextEditor) markSelection(e.textEditor); }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => onEditorScroll(e.textEditor)),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      // tex 以外に移ったらマークを消す(他言語では何もしない)
      if (!view) return;
      if (ed && isTexDoc(ed.document)) markSelection(ed);
      else if (ed) post({ type: 'highlight', rects: [], reveal: false });
    })
  );

  // PDF が外部で更新されたとき(他のビルド手段を含む)にも読み直す
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.pdf');
  const onPdfChange = (uri) => {
    if (view && norm(uri.fsPath) === norm(view.pdf)) debounce('pdfwatch', 300, () => reloadPdf(false));
  };
  watcher.onDidChange(onPdfChange);
  watcher.onDidCreate(onPdfChange);
  context.subscriptions.push(watcher);

  // 自動テスト用の窓口(通常利用では使わない)
  return {
    _debug: {
      inbox, stats, onWebviewMessage, latexmkArgsOf, outDirOf, build,
      post: (m) => post(m),
      isReady: () => !!(view && view.ready),
    },
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
