// PDF.js による PDF 表示。tex 側との連動は拡張本体とのメッセージで行う。
const vscode = acquireVsCodeApi();
const body = document.body;
const wrap = document.getElementById('wrap');
const pagesEl = document.getElementById('pages');
const pgEl = document.getElementById('pg');
const stEl = document.getElementById('st');

let pdfjs = null;
let doc = null;
let pages = []; // {div, canvas, w, h, token, rendering}
let scale = 1.4;
let highlights = [];
const dlog = [];
let expectedTop = null; // 拡張側の指示で動かした位置。この位置のスクロールは利用者操作ではない

async function initPdfjs() {
  pdfjs = await import(body.dataset.pdfjs);
  // 別オリジンの worker は直接読めないため、本文を取って Blob 化する
  const code = await (await fetch(body.dataset.worker)).text();
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) renderPage(pages[Number(e.target.dataset.i)]);
}, { root: wrap, rootMargin: '800px 0px' });

function layout() {
  for (const p of pages) {
    p.div.style.width = p.w * scale + 'px';
    p.div.style.height = p.h * scale + 'px';
    p.token++;
    p.rendered = false;
  }
  drawHighlights();
  for (const p of pages) if (isNear(p)) renderPage(p);
}

function isNear(p) {
  const r = p.div.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  return r.bottom > w.top - 800 && r.top < w.bottom + 800;
}

async function renderPage(p) {
  if (!p || p.rendered || p.rendering) return;
  p.rendering = true;
  const token = p.token;
  try {
    const page = await doc.getPage(p.n);
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (token === p.token) {
      p.canvas?.remove();
      p.div.prepend(canvas);
      p.canvas = canvas;
      p.rendered = true;
    }
  } catch (e) { if (!/cancel/i.test(String(e && e.name + e.message))) vscode.postMessage({ type: 'renderError', msg: String(e && (e.stack || e.message || e)) }); }
  p.rendering = false;
  if (token !== p.token && isNear(p)) renderPage(p);
}

async function load(uri) {
  if (!pdfjs) await initPdfjs();
  const keep = currentTop();
  let buf;
  try {
    const res = await fetch(uri);
    buf = await res.arrayBuffer();
  } catch (e) { stEl.textContent = 'PDF を読み込めません'; return; }
  const next = await pdfjs.getDocument({ data: buf, cMapUrl: body.dataset.cmaps, cMapPacked: true, standardFontDataUrl: body.dataset.fonts, useWorkerFetch: false }).promise;
  const dims = [];
  for (let i = 1; i <= next.numPages; i++) {
    const v = (await next.getPage(i)).getViewport({ scale: 1 });
    dims.push([v.width, v.height]);
  }
  doc?.destroy();
  doc = next;
  io.disconnect();
  pagesEl.textContent = '';
  pages = dims.map(([w, h], i) => {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.i = i;
    pagesEl.appendChild(div);
    io.observe(div);
    return { div, n: i + 1, w, h, token: 0, rendered: false, rendering: false, canvas: null };
  });
  layout();
  if (keep) scrollToPoint(keep.page, keep.y, 'top', true);
  stEl.textContent = '';
  updatePage();
}

// ---------- 座標 ----------
function currentTop() {
  if (!pages.length) return null;
  const wTop = wrap.getBoundingClientRect().top;
  for (const p of pages) {
    const r = p.div.getBoundingClientRect();
    if (r.bottom > wTop + 1) return { page: p.n, y: Math.max(0, (wTop - r.top) / scale), x: p.w / 2 };
  }
  const p = pages[pages.length - 1];
  return { page: p.n, y: p.h, x: p.w / 2 };
}

function scrollToPoint(page, y, align, quiet) {
  const p = pages[page - 1];
  if (!p) return;
  const top = p.div.offsetTop + y * scale;
  wrap.scrollTop = align === 'center' ? top - wrap.clientHeight / 2 : top - 8;
  expectedTop = wrap.scrollTop; // 端でのクランプ後の実際の位置
}

function drawHighlights() {
  document.querySelectorAll('.hl').forEach((e) => e.remove());
  for (const r of highlights) {
    const p = pages[r.page - 1];
    if (!p) continue;
    const d = document.createElement('div');
    d.className = 'hl';
    d.style.left = r.x * scale + 'px';
    d.style.top = r.y * scale + 'px';
    d.style.width = Math.max(r.w, 2) * scale + 'px';
    d.style.height = Math.max(r.h, 2) * scale + 'px';
    p.div.appendChild(d);
  }
}

function revealHighlights() {
  if (!highlights.length) return;
  const first = highlights[0];
  const p = pages[first.page - 1];
  if (!p) return;
  const top = p.div.offsetTop + first.y * scale;
  const bottom = top + first.h * scale;
  const vTop = wrap.scrollTop;
  const vBottom = vTop + wrap.clientHeight;
  if (top < vTop + 20 || bottom > vBottom - 20) scrollToPoint(first.page, first.y, 'center');
}

function updatePage() {
  const t = currentTop();
  pgEl.textContent = t && doc ? `${t.page} / ${doc.numPages}` : '';
}

// ---------- イベント ----------
let scrollTimer = 0;
wrap.addEventListener('scroll', () => {
  dlog.push(Math.round(Date.now() % 100000) + ':ev st=' + Math.round(wrap.scrollTop) + ' exp=' + (expectedTop === null ? 'null' : Math.round(expectedTop))); if (dlog.length > 12) dlog.shift();
  updatePage();
  if (expectedTop !== null) {
    if (Math.abs(wrap.scrollTop - expectedTop) < 2) return; // 自分で動かした分
    expectedTop = null; // 別の位置へ動いた = 利用者の操作
  }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const t = currentTop();
    if (t) vscode.postMessage({ type: 'scroll', page: t.page, x: t.x, y: t.y });
  }, 40);
});

pagesEl.addEventListener('click', (ev) => {
  if (!(ev.metaKey || ev.ctrlKey)) return;
  const div = ev.target.closest('.page');
  if (!div) return;
  const r = div.getBoundingClientRect();
  vscode.postMessage({ type: 'click', page: Number(div.dataset.i) + 1, x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale });
});
pagesEl.addEventListener('dblclick', (ev) => {
  const div = ev.target.closest('.page');
  if (!div) return;
  const r = div.getBoundingClientRect();
  vscode.postMessage({ type: 'click', page: Number(div.dataset.i) + 1, x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale });
});

function zoom(f) {
  const keep = currentTop();
  scale = Math.min(5, Math.max(0.3, f));
  layout();
  if (keep) scrollToPoint(keep.page, keep.y, 'top', true);
}
document.getElementById('zin').onclick = () => zoom(scale * 1.15);
document.getElementById('zout').onclick = () => zoom(scale / 1.15);
document.getElementById('zfit').onclick = () => { if (pages.length) zoom((wrap.clientWidth - 24) / Math.max(...pages.map((p) => p.w))); };
wrap.addEventListener('wheel', (ev) => { if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); zoom(scale * (ev.deltaY < 0 ? 1.06 : 1 / 1.06)); } }, { passive: false });

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'load') load(m.uri);
  else if (m.type === 'status') stEl.textContent = m.text;
  else if (m.type === 'scrollTo') scrollToPoint(m.page, m.y, m.align);
  else if (m.type === 'probe') vscode.postMessage({ type: 'probeResult', pages: pages.length, hl: document.querySelectorAll('.hl').length, scrollTop: wrap.scrollTop, top: currentTop(), rendered: pages.filter((p) => p.rendered).length, dlog: dlog.slice(-8) });
  else if (m.type === 'snapshot') {
    const p = pages[m.page - 1];
    const c = document.createElement('canvas');
    c.width = p.canvas.width; c.height = p.canvas.height;
    const g = c.getContext('2d');
    g.drawImage(p.canvas, 0, 0);
    const k = c.width / p.w;
    g.fillStyle = 'rgba(255,200,0,0.35)'; g.strokeStyle = 'rgba(255,120,0,0.95)'; g.lineWidth = 2;
    for (const r of highlights.filter((h) => h.page === m.page)) { g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k); g.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k); }
    vscode.postMessage({ type: 'snapshotResult', data: c.toDataURL('image/png') });
  }
  else if (m.type === 'zoomFit') document.getElementById('zfit').click();
  else if (m.type === 'testScroll') { wrap.scrollTop = pages[m.page - 1].div.offsetTop + m.y * scale; }
  else if (m.type === 'highlight') { highlights = m.rects; drawHighlights(); if (m.reveal) revealHighlights(); }
});

vscode.postMessage({ type: 'ready' });
window.addEventListener('error', (e) => vscode.postMessage({ type: 'renderError', msg: 'window: ' + e.message }));
window.addEventListener('unhandledrejection', (e) => vscode.postMessage({ type: 'renderError', msg: 'rejection: ' + String(e.reason && (e.reason.stack || e.reason)) }));
