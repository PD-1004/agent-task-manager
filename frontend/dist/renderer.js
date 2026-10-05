'use strict';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- toast ---------- */
function toast(msg, type = 'error') {
  const box = document.createElement('div');
  box.className = 'toast ' + type;
  box.textContent = msg;
  $('#toasts').appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => { box.classList.remove('show'); setTimeout(() => box.remove(), 300); }, 4500);
}

/* ---------- 通用确认弹窗（替代原生 confirm，返回 Promise<boolean>） ---------- */
function confirmDialog({ title = '确认操作', message = '', danger = false, icon, confirmText = '确定', cancelText = '取消' } = {}) {
  return new Promise((resolve) => {
    const m = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    const ic = $('#confirmIcon');
    ic.innerHTML = `<svg class="ic"><use href="#${danger ? 'i-alert' : (icon || 'i-info')}"/></svg>`;
    m.classList.toggle('danger', danger);
    const ok = $('#confirmOk'), cancel = $('#confirmCancel');
    ok.textContent = confirmText;
    cancel.textContent = cancelText;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    let done = false;
    const close = (v) => {
      if (done) return; done = true;
      m.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      m.removeEventListener('click', onBack);
      window.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBack = (e) => { if (e.target === m) close(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    m.addEventListener('click', onBack);
    window.addEventListener('keydown', onKey, true);
    m.classList.remove('hidden');
    ok.focus();
  });
}
function fmtBytes(b) {
  if (!b) return '0';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(ms) {
  try { return ms ? new Date(ms).toLocaleDateString('zh-CN') : '—'; } catch { return '—'; }
}
const pill = (ok, okText = '有效', badText = '失效') => ok
  ? `<span class="pill ok"><svg class="ic"><use href="#i-check"/></svg>${okText}</span>`
  : `<span class="pill bad"><svg class="ic"><use href="#i-alert"/></svg>${badText}</span>`;
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 侧边栏切换（进入即扫描，并复位子页签） ---------- */
const FIRST_TAB = { zcode: 'zc-tasks', wb: 'wb-tasks' };
$$('.snav').forEach((b) => b.addEventListener('click', () => {
  $$('.snav').forEach((x) => x.classList.toggle('active', x === b));
  $$('.sect').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + b.dataset.sec));
  const first = FIRST_TAB[b.dataset.sec];
  if (first) {
    const t = $$('.subtabs .tab').find((x) => x.dataset.tab === first);
    if (t) t.click();
  }
  if (b.dataset.sec === 'zcode') { refreshEnv(); doScan(); refreshZcTasks(); }
  if (b.dataset.sec === 'wb') { refreshWbEnv(); wbSpaces(); wbTasks(); }
}));

/* 侧边栏「使用帮助」：在系统默认浏览器中打开外部链接（阻止应用内导航） */
$('#sideHelp').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal(e.currentTarget.href).catch(() => {});
});

/* 启动后检查 GitHub 最新版本；有新版本则弹窗提示（前往下载） */
(function checkUpdateOnStart() {
  if (!window.api.checkUpdate) return;
  window.api.checkUpdate().then((r) => {
    if (!r || !r.update) return;
    confirmDialog({
      title: '发现新版本 v' + r.latest,
      message: (r.notes ? r.notes.trim().slice(0, 400) + '\n\n' : '') + '当前版本 v' + r.current + '\n点击「前往下载」在浏览器打开发布页。',
      icon: 'i-info', confirmText: '前往下载', cancelText: '稍后',
    }).then((go) => { if (go && r.url) window.api.openExternal(r.url); });
  }).catch(() => {});
})();



/* 子页签（两个平台通用） */
$$('.subtabs .tab').forEach((t) => t.addEventListener('click', () => {
  const group = t.closest('.subtabs');
  $$('.subtabs .tab').forEach((x) => { if (x.closest('.subtabs') === group) x.classList.toggle('active', x === t); });
  $$('.panel').forEach((p) => { if (p.id) p.classList.toggle('active', p.id === t.dataset.tab); });
}));

/* ---------- ZCode 环境状态 ---------- */
async function refreshEnv() {
  const env = await window.api.envStatus();
  $('#envZcodeDir').textContent = '数据目录 ' + env.zcodeDir;
  $('#envZcodeDir').className = 'chip ' + (env.zcodeDirExists ? 'ok' : 'bad');
  const r = await window.api.zcodeRunning();
  $('#envRunning').textContent = r.running ? 'ZCode 运行中' : 'ZCode 未运行';
  $('#envRunning').className = 'chip ' + (r.running ? 'bad' : 'ok');
  $('#btnKill').classList.toggle('hidden', !r.running);
}
// 统一的运行态读取：兼容布尔值 / {running} 两种返回形态
async function zcodeIsRunning() {
  const r = await window.api.zcodeRunning();
  return typeof r === 'boolean' ? r : !!(r && r.running);
}
// 轮询等待进程真正退出（taskkill 后进程消失有延迟，也可能被重新拉起）
async function waitUntilZcodeClosed(timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!(await zcodeIsRunning())) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return !(await zcodeIsRunning());
}
/* ZCode 运行中的统一拦截：明确说明原因并支持一键结束进程后继续。
   此前只是一闪而过的 toast，用户往往以为「点了没反应」 */
async function ensureZcodeClosed(action) {
  const running = await zcodeIsRunning();
  await refreshEnv(); // 顺带把胶囊状态刷新到最新，避免 UI 与实际不一致
  if (!running) return true;
  const go = await confirmDialog({
    title: `无法${action}：ZCode 正在运行`,
    message: `ZCode 正在运行，它会锁定数据并在退出时把内存中的改动回写，此时${action}不会生效。\n\n`
      + '你可以手动完全退出 ZCode（含托盘）后重试，或直接结束它的进程。\n\n'
      + '· 结束进程不会删除磁盘上的项目文件\n'
      + '· ZCode 中未保存的会话内容可能丢失',
    danger: true,
    confirmText: '结束 ZCode 进程',
    cancelText: '取消',
  });
  if (!go) return false;
  await window.api.killZcode();
  const closed = await waitUntilZcodeClosed();
  await refreshEnv();
  if (!closed) { toast('ZCode 进程仍未退出，请手动关闭（含托盘）后重试', 'error'); return false; }
  return true;
}
$('#btnKill').addEventListener('click', async () => {
  const r = await window.api.killZcode();
  if (r && r.ok === false) return; // 用户在原生确认框选择了「取消」
  await waitUntilZcodeClosed();
  await refreshEnv();
});

/* ---------- ZCode 任务 ---------- */
let zcTasks = null, zcSortKey = 'tc', zcSortDir = -1, zcFilesMap = new Map(), zcFilesCurrentId = '';
let zcFilesCurrent = [];
const zcSel = new Set(); // 多选：任务 id 集合
let zcQuery = '';        // 搜索关键词（小写；空格分隔多个词，需全部命中）

/* 任务搜索 + 多选（ZCode / WorkBuddy 共用） */
function matchQuery(title, q) {
  if (!q) return true;
  const t = String(title || '').toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}
function syncSelUi(ids, sel, infoEl, btnEl, allEl) {
  const n = sel.size;
  infoEl.textContent = n ? `已选 ${n} 项` : '';
  btnEl.disabled = n === 0;
  allEl.checked = ids.length > 0 && ids.every((id) => sel.has(id));
  allEl.indeterminate = !allEl.checked && ids.some((id) => sel.has(id));
}
function emptyRow(tb, colspan, text) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.className = 'muted';
  td.textContent = text;
  tr.appendChild(td);
  tb.appendChild(tr);
}

function zcSorted() {
  if (!zcTasks) return [];
  const arr = zcTasks.filter((t) => matchQuery(t.title, zcQuery));
  const dir = zcSortDir;
  arr.sort((a, b) => {
    if (zcSortKey === 'title') return a.title.localeCompare(b.title, 'zh-CN') * dir;
    const va = a[zcSortKey] || 0, vb = b[zcSortKey] || 0;
    return (va - vb) * dir;
  });
  return arr;
}
const zcVisibleIds = () => zcSorted().map((t) => t.id);
function renderZcTasks() {
  const arr = zcSorted();
  const tb = $('#zcTaskTable tbody'); tb.innerHTML = '';
  zcFilesMap = new Map(arr.map((t) => [t.id, t.fileList || []]));
  const total = (zcTasks || []).length;
  $('#zcTaskCount').textContent = total ? `显示 ${arr.length} / ${total}` : '';
  if (!arr.length) {
    emptyRow(tb, 6, zcQuery ? `没有匹配「${zcQuery}」的任务` : '默认会话区暂无任务');
  }
  for (const t of arr) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="ckcol"><input type="checkbox" data-sel="${t.id}"${zcSel.has(t.id) ? ' checked' : ''}></td>
      <td class="title-cell" data-files="${t.id}" title="双击查看该任务产生的文件清单"></td>
      <td class="num">${t.msgs}</td><td class="num">${t.files}</td><td>${fmtDate(t.tc)}</td>
      <td><button class="btn mini danger" data-del="${t.id}" data-msgs="${t.msgs}"><svg class="ic"><use href="#i-trash"/></svg>清除</button></td>`;
    tr.querySelector('.title-cell').textContent = t.title; // 标题以文本写入，避免 HTML 注入/结构破坏
    tr.querySelector('[data-del]').dataset.title = t.title;
    tr.classList.toggle('sel', zcSel.has(t.id));
    tb.appendChild(tr);
  }
  $$('#zcTaskTable [data-del]').forEach((b) => b.addEventListener('click', () => removeTaskFlow(b)));
  syncSelUi(zcVisibleIds(), zcSel, $('#zcSelInfo'), $('#zcBatchDel'), $('#zcSelAll'));
}
/* 双击任务标题 -> 弹出该任务在默认会话区产生的文件清单 */
$('#zcTaskTable tbody').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('[data-files]');
  if (cell) showTaskFiles(cell.dataset.files);
});
function openZcFilesModal(title, list) {
  $('#zcFilesTitle').textContent = `文件清单 · ${title}`;
  $('#zcFilesMeta').textContent = list.length
    ? `共 ${list.length} 个文件 —— 口径：本任务在 *\\.zcode\\workspace\\default\\ 目录下产生并仍存在的文件`
    : '本任务未在默认会话区（*\\.zcode\\workspace\\default\\）产生文件';
  const box = $('#zcFilesList');
  box.innerHTML = '';
  zcFilesCurrent = list;
  if (!list.length) {
    box.innerHTML = '<div class="fitem muted">（无）</div>';
  } else {
    list.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'fitem';
      const nm = document.createElement('div');
      nm.className = 'fname';
      nm.textContent = f.name;
      const nmSize = document.createElement('span');
      nmSize.className = 'fsize';
      nmSize.textContent = fmtBytes(f.size);
      nm.appendChild(nmSize);
      const cp = document.createElement('button');
      cp.className = 'btn mini ghost fcopy';
      cp.dataset.idx = String(i);
      cp.title = '复制该文件路径';
      cp.innerHTML = '<svg class="ic"><use href="#i-copy"/></svg>复制';
      nm.appendChild(cp);
      const ph = document.createElement('div');
      ph.className = 'fpath mono';
      ph.textContent = f.path;
      item.appendChild(nm);
      item.appendChild(ph);
      box.appendChild(item);
    });
  }
  box.dataset.count = String(list.length);
  $('#zcFilesModal').classList.remove('hidden');
}
function showTaskFiles(taskId) {
  const t = (zcTasks || []).find((x) => x.id === taskId);
  zcFilesCurrentId = taskId;
  openZcFilesModal(t ? t.title : taskId, zcFilesMap.get(taskId) || []);
}
$('#zcFilesClose').addEventListener('click', () => $('#zcFilesModal').classList.add('hidden'));
$('#zcFilesModal').addEventListener('click', (e) => { if (e.target === $('#zcFilesModal')) $('#zcFilesModal').classList.add('hidden'); });
$('#zcFilesCopy').addEventListener('click', async () => {
  if (!zcFilesCurrent.length) { toast('没有可复制的路径'); return; }
  await window.api.copyText(zcFilesCurrent.map((f) => f.path).join('\n'));
  toast(`已复制 ${zcFilesCurrent.length} 个文件路径`, 'success');
});
/* 单条路径复制 */
$('#zcFilesList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-idx]');
  if (!b) return;
  const f = zcFilesCurrent[+b.dataset.idx];
  if (!f) return;
  await window.api.copyText(f.path);
  toast(`已复制路径：${f.name}`, 'success');
});

/* 搜索输入框：防抖重渲染 + 保证焦点不丢（图片/testing 环境下偶发点不中） */
function bindSearchInput(sel, apply) {
  const el = $(sel);
  if (!el) return;
  let timer = null;
  el.addEventListener('mousedown', () => { requestAnimationFrame(() => el.focus()); });
  el.addEventListener('input', () => {
    const v = String(el.value || '').trim().toLowerCase();
    clearTimeout(timer);
    timer = setTimeout(() => apply(v), 160); // 防抖：避免每个字符都重排整张表
  });
}

/* ZCode 任务：搜索 / 全选 / 批量清除 */
bindSearchInput('#zcTaskSearch', (v) => {
  zcQuery = v;
  renderZcTasks();
});
$('#zcTaskTable tbody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-sel]');
  if (!cb) return;
  if (cb.checked) zcSel.add(cb.dataset.sel); else zcSel.delete(cb.dataset.sel);
  if (cb.closest('tr')) cb.closest('tr').classList.toggle('sel', cb.checked);
  syncSelUi(zcVisibleIds(), zcSel, $('#zcSelInfo'), $('#zcBatchDel'), $('#zcSelAll'));
});
$('#zcSelAll').addEventListener('change', (e) => {
  const ids = zcVisibleIds();
  if (e.target.checked) ids.forEach((id) => zcSel.add(id));
  else ids.forEach((id) => zcSel.delete(id));
  renderZcTasks();
});
$('#zcBatchDel').addEventListener('click', removeZcBatch);
$$('#zcTaskTable th.sortable').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if (zcSortKey === key) zcSortDir = -zcSortDir;
  else { zcSortKey = key; zcSortDir = -1; }
  $$('#zcTaskTable th').forEach((x) => x.removeAttribute('data-dir'));
  th.setAttribute('data-dir', zcSortDir > 0 ? 'asc' : 'desc');
  renderZcTasks();
}));

async function refreshZcTasks() {
  try {
    zcTasks = await window.api.zcTasks();
    // 已删除的任务要从选择集里剔除，避免批量按钮计数虚高
    for (const id of [...zcSel]) if (!zcTasks.some((t) => t.id === id)) zcSel.delete(id);
    renderZcTasks();
    const msgs = zcTasks.reduce((s, t) => s + t.msgs, 0);
    const files = zcTasks.reduce((s, t) => s + t.files, 0);
    $('#zcTaskStats').innerHTML = `
      <div class="stat"><div class="n">${zcTasks.length}</div><div class="l">任务</div></div>
      <div class="stat"><div class="n">${msgs}</div><div class="l">消息</div></div>
      <div class="stat"><div class="n">${files}</div><div class="l">文件数</div></div>`;
  } catch (e) { toast(e.message || String(e)); }
}

async function removeTaskFlow(btn) {
  const id = btn.dataset.del, title = btn.dataset.title, msgs = +btn.dataset.msgs;
  if (!(await ensureZcodeClosed('清除任务'))) return;
  if (!(await confirmDialog({ title: '彻底清除任务', message: `确定彻底清除任务「${title}」？\n\n将删除：${msgs} 条聊天消息及全部关联数据（不可恢复）\n· 此操作不创建备份\n· 需要 ZCode 已完全退出`, danger: true, confirmText: '彻底清除' }))) return;
  try {
    const r = await window.api.zcTaskRemove(id);
    zcSel.delete(id);
    toast(`任务已清除（${r.msgs} 条消息）`, 'success');
    await refreshZcTasks();
  } catch (e) { toast(e.message || String(e)); }
}

/* 批量清除所选任务 */
async function removeZcBatch() {
  const ids = [...zcSel];
  if (!ids.length) return;
  if (!(await ensureZcodeClosed('清除任务'))) return;
  const items = ids.map((id) => (zcTasks || []).find((t) => t.id === id)).filter(Boolean);
  if (!items.length) return;
  const msgs = items.reduce((s, t) => s + (t.msgs || 0), 0);
  const files = items.reduce((s, t) => s + (t.files || 0), 0);
  const preview = items.slice(0, 12).map((t) => `· ${t.title}`).join('\n') + (items.length > 12 ? `\n…（共 ${items.length} 个）` : '');
  const msg = `确定彻底清除选中的 ${items.length} 个任务？\n\n${preview}\n\n`
    + `将删除：${msgs} 条聊天消息、${files} 个任务文件引用及全部关联数据（不可恢复）\n`
    + `· 此操作不创建备份\n· 需要 ZCode 已完全退出`;
  if (!(await confirmDialog({ title: '批量清除任务', message: msg, danger: true, confirmText: '彻底清除' }))) return;
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await window.api.zcTaskRemove(id); ok++; } catch { fail++; }
  }
  zcSel.clear();
  await refreshZcTasks();
  toast(fail ? `已清除 ${ok} 个任务，${fail} 个失败（可能是 ZCode 被重新打开）` : `已清除 ${ok} 个任务`, fail ? 'error' : 'success');
}

/* ---------- ZCode 项目（扫描 + 多选/批量移除 + 行内迁移弹窗 + 双击任务弹窗） ---------- */
let lastScan = null, sortKey = null, sortDir = 1;
const zcProjSel = new Set();        // 多选：项目路径集合
const zcProjFileNums = new Map();   // 项目路径 -> 文件数（异步填充，供显示与排序）
const zcProjFileLoading = new Set();

function projName(p) { return String(p).split(/[\\/]/).pop() || p; }

function sortedPaths() {
  if (!lastScan) return [];
  const arr = [...lastScan.paths];
  if (!sortKey) return arr;
  const dir = sortDir;
  arr.sort((a, b) => {
    if (sortKey === 'exists') return ((a.exists ? 1 : 0) - (b.exists ? 1 : 0)) * dir;
    if (sortKey === 'firstSeen') return ((a.firstSeen || Infinity) - (b.firstSeen || Infinity)) * dir;
    if (sortKey === 'name') {
      const va = projName(a.path).toLowerCase(), vb = projName(b.path).toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    }
    if (sortKey === 'files') return ((zcProjFileNums.get(a.path) || 0) - (zcProjFileNums.get(b.path) || 0)) * dir;
    return ((a.refs[sortKey] || 0) - (b.refs[sortKey] || 0)) * dir;
  });
  return arr;
}
const zcProjVisiblePaths = () => sortedPaths().map((p) => p.path);

/* 「文件数」列懒加载：每个项目一次会话文本扫描（含子目录、引用且仍存在的文件去重），填充后更新单元格 */
async function fillProjectFileCount(fpath, cell) {
  if (!zcProjFileNums.has(fpath) && !zcProjFileLoading.has(fpath)) {
    zcProjFileLoading.add(fpath);
    try {
      const files = await window.api.zcProjectFiles(fpath);
      zcProjFileNums.set(fpath, files.length);
    } catch { zcProjFileNums.set(fpath, -1); }
    zcProjFileLoading.delete(fpath);
  }
  const n = zcProjFileNums.get(fpath);
  cell.textContent = n == null ? '…' : (n < 0 ? '—' : String(n));
}

function renderRows() {
  const tb = $('#scanTable tbody'); tb.innerHTML = '';
  const rows = sortedPaths();
  for (const p of rows) {
    const tr = document.createElement('tr');
    const acts = [];
    acts.push(`<button class="btn mini" data-mig="${escapeHtml(p.path)}"><svg class="ic"><use href="#i-swap"/></svg>迁移</button>`);
    if (p.refs.tasks || p.refs.sessions || p.refs.setting) acts.push(`<button class="btn mini danger" data-remove="${escapeHtml(p.path)}" data-sessions="${p.refs.sessions}" data-tasks="${p.refs.tasks}"><svg class="ic"><use href="#i-trash"/></svg>移除</button>`);
    tr.innerHTML = `<td class="ckcol"><input type="checkbox" data-psel="${escapeHtml(p.path)}"${zcProjSel.has(p.path) ? ' checked' : ''}></td>
      <td class="zc-proj-name" data-path="${escapeHtml(p.path)}" title="双击查看该项目下的全部任务&#10;${escapeHtml(p.path)}">${escapeHtml(projName(p.path))}</td>
      <td>${pill(p.exists)}</td>
      <td>${p.firstSeenStr || '—'}</td>
      <td class="num">${p.refs.tasks}</td>
      <td class="num zc-proj-files" data-fpath="${escapeHtml(p.path)}">…</td>
      <td class="ops">${acts.join(' ')}</td>`;
    tr.classList.toggle('sel', zcProjSel.has(p.path));
    tb.appendChild(tr);
  }
  $$('#scanTable td.zc-proj-files').forEach((td) => fillProjectFileCount(td.dataset.fpath, td));
  $('#zcProjCount').textContent = rows.length ? `共 ${rows.length} 个项目` : '';
  syncSelUi(zcProjVisiblePaths(), zcProjSel, $('#zcProjSelInfo'), $('#zcProjBatchDel'), $('#zcProjSelAll'));
}

async function doScan() {
  try {
    lastScan = await window.api.scan();
    // 已消失的项目要从选择集里剔除，避免批量按钮计数虚高
    for (const p of [...zcProjSel]) if (!lastScan.paths.some((x) => x.path === p)) zcProjSel.delete(p);
    renderRows();
    $('#scanTable').classList.remove('hidden');
    $('#scanEmpty').classList.add('hidden');
    const ex = lastScan.excluded ? `，已排除 ${lastScan.excluded} 个内部路径` : '';
    $('#scanStats').innerHTML = `
      <div class="stat"><div class="n">${lastScan.paths.length}</div><div class="l">项目路径</div></div>
      <div class="stat"><div class="n ${lastScan.staleCount ? 'bad' : 'ok'}">${lastScan.staleCount}</div><div class="l">失效待处理</div></div>
      <div class="stat"><div class="n">${lastScan.excluded}</div><div class="l" title="ZCode 内部会话区（默认工作区及其子目录），不属于项目管理范围">已排除内部路径</div></div>
      <div class="stat time"><div class="l">扫描于 ${lastScan.scannedAt}</div></div>`;
  } catch (e) { toast(e.message || String(e)); }
}
$$('#scanTable th.sortable').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if (sortKey === key) sortDir = -sortDir;
  else { sortKey = key; sortDir = (key === 'exists' || key === 'firstSeen' || key === 'name') ? 1 : -1; }
  $$('#scanTable th').forEach((x) => x.removeAttribute('data-dir'));
  th.setAttribute('data-dir', sortDir > 0 ? 'asc' : 'desc');
  renderRows();
}));

/* 项目表：单选 / 全选 / 批量移除 / 行内按钮 / 双击弹任务（事件委托，兼容重渲染） */
$('#scanTable tbody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-psel]');
  if (!cb) return;
  if (cb.checked) zcProjSel.add(cb.dataset.psel); else zcProjSel.delete(cb.dataset.psel);
  if (cb.closest('tr')) cb.closest('tr').classList.toggle('sel', cb.checked);
  syncSelUi(zcProjVisiblePaths(), zcProjSel, $('#zcProjSelInfo'), $('#zcProjBatchDel'), $('#zcProjSelAll'));
});
$('#zcProjSelAll').addEventListener('change', (e) => {
  const paths = zcProjVisiblePaths();
  if (e.target.checked) paths.forEach((p) => zcProjSel.add(p));
  else paths.forEach((p) => zcProjSel.delete(p));
  renderRows();
});
$('#zcProjBatchDel').addEventListener('click', removeZcProjectBatch);
$('#scanTable tbody').addEventListener('click', (e) => {
  const mig = e.target.closest('[data-mig]');
  if (mig) { openMigModal(mig.dataset.mig); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) { removeProjectFlow(rm); return; }
});
$('#scanTable tbody').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.zc-proj-name');
  if (cell) openZcProjectTasks(cell.dataset.path);
});

/* 批量移除选中项目（复用单项目移除逻辑：设置记录 + 任务登记 + 会话及聊天记录） */
async function removeZcProjectBatch() {
  const paths = [...zcProjSel];
  if (!paths.length) return;
  if (!(await ensureZcodeClosed('移除项目'))) return;
  const items = paths.map((p) => (lastScan && lastScan.paths || []).find((x) => x.path === p)).filter(Boolean);
  if (!items.length) return;
  const tasks = items.reduce((s, p) => s + (p.refs.tasks || 0), 0);
  const sessions = items.reduce((s, p) => s + (p.refs.sessions || 0), 0);
  const preview = items.slice(0, 12).map((p) => `· ${projName(p.path)}（${p.refs.tasks} 个任务）`).join('\n') + (items.length > 12 ? `\n…（共 ${items.length} 个）` : '');
  const msg = `确定批量移除选中的 ${items.length} 个项目？\n\n${preview}\n\n`
    + `将移除：程序设置记录、${tasks} 条任务登记、${sessions} 个会话（含全部聊天记录）\n`
    + `· 磁盘上的项目文件夹不会被删除\n· 此操作不创建备份\n· 需要 ZCode 已完全退出`;
  if (!(await confirmDialog({ title: '批量移除项目', message: msg, danger: true, confirmText: '移除项目' }))) return;
  let ok = 0, fail = 0;
  for (const p of paths) {
    try { await window.api.removeProject(p); ok++; } catch { fail++; }
  }
  zcProjSel.clear();
  await doScan();
  toast(fail ? `已移除 ${ok} 个项目，${fail} 个失败（可能是 ZCode 被重新打开）` : `已移除 ${ok} 个项目`, fail ? 'error' : 'success');
}

/* 项目迁移弹窗 */
function openMigModal(oldPath) {
  $('#migModalOld').textContent = oldPath;
  $('#migModalNew').value = '';
  $('#migModal').classList.remove('hidden');
  $('#migModalNew').focus();
}
$('#migModalBrowse').addEventListener('click', async () => {
  const p = await window.api.pickDirectory();
  if (p) $('#migModalNew').value = p;
});
$('#migModalCancel').addEventListener('click', () => $('#migModal').classList.add('hidden'));
$('#migModalStart').addEventListener('click', async () => {
  const oldPath = $('#migModalOld').textContent.trim();
  const newPath = $('#migModalNew').value.trim();
  if (!newPath) { toast('请先填写新路径'); return; }
  if (!(await confirmDialog({ title: '确认迁移项目', message: `二次确认：把项目从\n  ${oldPath}\n迁移到\n  ${newPath}\n\n迁移后需重启 ZCode 生效。继续？`, icon: 'i-swap', confirmText: '开始迁移' }))) return;
  const btn = $('#migModalStart'); btn.disabled = true;
  try {
    await window.api.migrate(oldPath, newPath);
    toast('迁移完成，重启 ZCode 后生效', 'success');
    $('#migModal').classList.add('hidden');
    await doScan();
  } catch (e) { toast(e.message || String(e)); }
  btn.disabled = false;
});

/* ---------- ZCode：移除项目（二次确认） ---------- */
async function removeProjectFlow(btn) {
  if (!(await ensureZcodeClosed('移除项目'))) return;
  const p = btn.dataset.remove, sessions = +btn.dataset.sessions, tasks = +btn.dataset.tasks;
  const msg = `确定从 ZCode 中移除项目「${p}」？\n\n`
    + `将移除：程序设置记录、${tasks} 条任务登记、${sessions} 个会话（含全部聊天记录）\n`
    + `· 磁盘上的项目文件夹不会被删除\n`
    + `· 此操作不创建备份，请确认不再需要\n`
    + `· 需要 ZCode 已完全退出`;
  if (!(await confirmDialog({ title: '移除项目', message: msg, danger: true, confirmText: '移除项目' }))) return;
  try {
    const r = await window.api.removeProject(p);
    zcProjSel.delete(p);
    toast(`项目已移除（${r.sessions} 个会话、${r.messages} 条消息）`, 'success');
    await doScan();
  } catch (e) { toast(e.message || String(e)); }
}

/* ---------- ZCode：项目任务弹窗（双击项目名称；支持移除单个任务） ---------- */
let zcProjTasksCurrentPath = '';
async function openZcProjectTasks(projectPath) {
  zcProjTasksCurrentPath = projectPath || '';
  $('#zcProjTasksModal').classList.remove('hidden');
  $('#zcProjTasksTitle').textContent = '项目任务加载中…';
  $('#zcProjTasksMeta').textContent = '';
  $('#zcProjTasksList').innerHTML = '<p class="muted">正在读取…</p>';
  try {
    const r = await window.api.zcProjectTasks(projectPath);
    const total = r.tasks.length;
    const totalMsgs = r.tasks.reduce((a, t) => a + (t.msgs || 0), 0);
    $('#zcProjTasksTitle').textContent = `项目「${r.name}」下的全部任务`;
    $('#zcProjTasksMeta').textContent = `共 ${total} 个任务 · ${totalMsgs} 条消息 · 路径 ${r.projectPath}`;
    if (!total) { $('#zcProjTasksList').innerHTML = '<p class="muted">该项目下没有会话记录</p>'; return; }
    let html = '<table class="filetbl"><thead><tr><th>任务名称</th><th class="num">消息数</th><th>最近使用</th><th>状态</th><th></th></tr></thead><tbody>';
    for (const t of r.tasks) {
      const st = t.status ? escapeHtml(t.status) : '<span class="muted">—</span>';
      html += `<tr><td>${escapeHtml(t.title)}</td><td class="num">${t.msgs}</td><td>${fmtDate(t.last)}</td><td>${st}</td>`
        + `<td><button class="btn mini danger" data-zdel="${escapeHtml(t.id)}" data-ztitle="${escapeHtml(t.title)}"><svg class="ic"><use href="#i-trash"/></svg>移除</button></td></tr>`;
    }
    html += '</tbody></table>';
    $('#zcProjTasksList').innerHTML = html;
  } catch (e) { $('#zcProjTasksList').innerHTML = `<p class="bad">读取失败：${escapeHtml(e.message || e)}</p>`; }
}
$('#zcProjTasksClose').addEventListener('click', () => $('#zcProjTasksModal').classList.add('hidden'));
$('#zcProjTasksModal').addEventListener('click', (e) => { if (e.target === $('#zcProjTasksModal')) $('#zcProjTasksModal').classList.add('hidden'); });
$('#zcProjTasksList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-zdel]');
  if (b) removeZcProjectTaskFlow(b.dataset.zdel, b.dataset.ztitle);
});
async function removeZcProjectTaskFlow(id, title) {
  if (!(await ensureZcodeClosed('清除任务'))) return;
  if (!(await confirmDialog({
    title: '彻底清除任务',
    message: `确定彻底清除任务「${title}」？\n\n将删除：该任务的全部聊天记录及关联数据（不可恢复）\n· 此操作不创建备份\n· 需要 ZCode 已完全退出`,
    danger: true, confirmText: '彻底清除',
  }))) return;
  try {
    const r = await window.api.zcTaskRemove(id);
    zcSel.delete(id);
    toast(`任务已清除（${r.msgs} 条消息）`, 'success');
    if (zcProjTasksCurrentPath) await openZcProjectTasks(zcProjTasksCurrentPath); // 刷新弹窗
    doScan();
    refreshZcTasks();
  } catch (e) { toast(e.message || String(e)); }
}

/* ---------- WorkBuddy 环境 ---------- */
async function refreshWbEnv() {
  const home = await window.api.wbHome();
  const chipHome = $('#wbHomeChip');
  chipHome.textContent = '数据目录 ' + home.home;
  chipHome.className = 'chip ' + (home.exists ? 'ok' : 'bad');
  const running = await window.api.wbRunning();
  const chipRun = $('#wbEnvChip');
  chipRun.textContent = running ? 'WorkBuddy 运行中' : 'WorkBuddy 未运行';
  chipRun.className = 'chip ' + (running ? 'bad' : 'ok');
  $('#btnWbKill').classList.toggle('hidden', !running);
}
$('#btnWbKill').addEventListener('click', async () => {
  await window.api.wbKill();
  setTimeout(refreshWbEnv, 800);
});

/* ---------- WorkBuddy 任务（会话清单 + 清除） ---------- */
let wbTasksData = null, wbSortKey = 'earliest', wbSortDir = -1, wbTitleClickTimer = null, wbAccountUid = null;
async function checkWbAccount() {
  let uid = null;
  try { uid = await window.api.wbUid(); } catch { return; }
  if (uid === wbAccountUid) return;
  const changed = wbAccountUid !== null;
  wbAccountUid = uid;
  wbSpaces();
  wbTasks();
  if (changed) toast('已切换到新账号，已刷新 WorkBuddy 会话与空间', 'success');
}
const wbSel = new Set(); // 多选：会话 id 集合
let wbQuery = '';        // 搜索关键词（小写）

const wbVisibleIds = () => wbTaskSorted().map((t) => t.id);
function wbTaskSorted() {
  if (!wbTasksData) return [];
  const arr = wbTasksData.filter((t) => matchQuery(t.title, wbQuery));
  const dir = wbSortDir;
  arr.sort((a, b) => {
    if (wbSortKey === 'title') return (a.title || '').localeCompare(b.title || '', 'zh-CN') * dir;
    if (wbSortKey === 'msgs') return ((a.msgs || 0) - (b.msgs || 0)) * dir;
    if (wbSortKey === 'files') return ((a.files || 0) - (b.files || 0)) * dir;
    if (wbSortKey === 'earliest') return ((a.earliestNum || 0) - (b.earliestNum || 0)) * dir;
    return 0;
  });
  return arr;
}
function renderWbTasks() {
  const arr = wbTaskSorted();
  const tb = $('#wbTaskTable tbody'); tb.innerHTML = '';
  const total = (wbTasksData || []).length;
  $('#wbTaskCount').textContent = total ? `显示 ${arr.length} / ${total}` : '';
  if (!arr.length) emptyRow(tb, 7, wbQuery ? `没有匹配「${wbQuery}」的任务` : '暂无会话记录');
  for (const t of arr) {
    const tr = document.createElement('tr');
    const status = t.deleted ? '<span class="muted">已删除</span>' : t.stale ? pill(false, '空间失效') : '<span class="pill ok">正常</span>';
    tr.innerHTML = `<td class="ckcol"><input type="checkbox" data-sel="${t.id}"${wbSel.has(t.id) ? ' checked' : ''}></td>
      <td class="wb-title" data-sid="${t.id}" title="单击复制所属空间路径 · 双击查看改动过的文件">${t.title || '(未命名)'}</td>
      <td class="num">${t.msgs}</td><td class="num">${t.files}</td><td>${t.earliest}</td><td>${status}</td>
      <td><button class="btn mini danger" data-del="${t.id}"><svg class="ic"><use href="#i-trash"/></svg>清除</button></td>`;
    tr.querySelector('.wb-title').textContent = t.title || '(未命名)';
    tr.querySelector('[data-del]').dataset.title = t.title || '(未命名)';
    tr.classList.toggle('sel', wbSel.has(t.id));
    tb.appendChild(tr);
  }
  $$('#wbTaskTable [data-del]').forEach((b) => b.addEventListener('click', () => removeWbTaskFlow(b)));
  syncSelUi(wbVisibleIds(), wbSel, $('#wbSelInfo'), $('#wbBatchDel'), $('#wbSelAll'));
}
/* WB 任务：单击任务标题 → 复制所属空间路径；双击任务标题 → 弹窗显示改动过的文件 */
$('#wbTaskTable tbody').addEventListener('click', (e) => {
  const cell = e.target.closest('.wb-title');
  if (!cell) return;
  const t = (wbTasksData || []).find((x) => x.id === cell.dataset.sid);
  const cwd = t && t.cwd;
  if (!cwd) return;
  clearTimeout(wbTitleClickTimer);
  wbTitleClickTimer = setTimeout(() => {
    window.api.copyText(cwd).then(() => toast('已复制所属空间路径', 'success')).catch(() => toast('复制失败'));
  }, 220);
});
$('#wbTaskTable tbody').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.wb-title');
  if (!cell) return;
  clearTimeout(wbTitleClickTimer);
  openWbTaskFiles(cell.dataset.sid);
});
async function openWbTaskFiles(sid) {
  const box = $('#wbTaskFilesModal'); box.classList.remove('hidden');
  $('#wbTaskFilesTitle').textContent = '会话文件加载中…';
  $('#wbTaskFilesMeta').textContent = '';
  $('#wbTaskFilesList').innerHTML = '<p class="muted">正在读取…</p>';
  try {
    const t = (wbTasksData || []).find((x) => x.id === sid);
    const title = t ? (t.title || '(未命名)') : sid;
    const files = await window.api.wbTaskFiles(sid);
    const n = files.length;
    $('#wbTaskFilesTitle').textContent = `会话「${title}」改动过的文件`;
    $('#wbTaskFilesMeta').textContent = `共 ${n} 个文件 · 口径：本会话改动过且仍存在的文件`;
    if (!n) { $('#wbTaskFilesList').innerHTML = '<p class="muted">该会话没有改动过的文件记录</p>'; return; }
    let html = '<table class="filetbl"><thead><tr><th>文件名</th><th class="pathcol">路径</th><th class="num">大小</th><th></th></tr></thead><tbody>';
    for (const f of files) {
      html += `<tr><td>${escapeHtml(f.name)}</td>`
        + `<td class="pathcell" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>`
        + `<td class="num">${fmtBytes(f.size)}</td>`
        + `<td><button class="btn mini" data-copy="${escapeHtml(f.path)}">复制</button></td></tr>`;
    }
    html += '</tbody></table>';
    $('#wbTaskFilesList').innerHTML = html;
    bindCopyButtons(box);
  } catch (e) { $('#wbTaskFilesList').innerHTML = `<p class="bad">读取失败：${escapeHtml(e.message || e)}</p>`; }
}
$('#wbTaskFilesClose').addEventListener('click', () => $('#wbTaskFilesModal').classList.add('hidden'));
/* WorkBuddy 任务：搜索 / 全选 / 批量清除 */
bindSearchInput('#wbTaskSearch', (v) => {
  wbQuery = v;
  renderWbTasks();
});
$('#wbTaskTable tbody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-sel]');
  if (!cb) return;
  if (cb.checked) wbSel.add(cb.dataset.sel); else wbSel.delete(cb.dataset.sel);
  if (cb.closest('tr')) cb.closest('tr').classList.toggle('sel', cb.checked);
  syncSelUi(wbVisibleIds(), wbSel, $('#wbSelInfo'), $('#wbBatchDel'), $('#wbSelAll'));
});
$('#wbSelAll').addEventListener('change', (e) => {
  const ids = wbVisibleIds();
  if (e.target.checked) ids.forEach((id) => wbSel.add(id));
  else ids.forEach((id) => wbSel.delete(id));
  renderWbTasks();
});
$('#wbBatchDel').addEventListener('click', removeWbBatch);
$$('#wbTaskTable th.sortable').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if (wbSortKey === key) wbSortDir = -wbSortDir;
  else { wbSortKey = key; wbSortDir = -1; }
  $$('#wbTaskTable th').forEach((x) => x.removeAttribute('data-dir'));
  th.setAttribute('data-dir', wbSortDir > 0 ? 'asc' : 'desc');
  renderWbTasks();
}));

async function wbTasks() {
  try {
    wbTasksData = await window.api.wbTasks();
    // 已清除的会话要从选择集里剔除
    for (const id of [...wbSel]) if (!wbTasksData.some((t) => t.id === id)) wbSel.delete(id);
    renderWbTasks();
    const stale = wbTasksData.filter((t) => t.stale && !t.deleted).length;
    $('#wbTaskStats').innerHTML = `
      <div class="stat"><div class="n">${wbTasksData.length}</div><div class="l">会话</div></div>
      <div class="stat"><div class="n ${stale ? 'bad' : 'ok'}">${stale}</div><div class="l">所属空间失效</div></div>
      <div class="stat"><div class="n">${wbTasksData.filter((t) => t.deleted).length}</div><div class="l">已标记删除</div></div>`;
  } catch (e) { toast(e.message || String(e)); }
}

async function removeWbTaskFlow(btn) {
  const id = btn.dataset.del, title = btn.dataset.title;
  const running = await window.api.wbRunning();
  if (running) { toast('检测到 WorkBuddy 正在运行！请先完全退出 WorkBuddy 再清除会话。'); return; }
  if (!(await confirmDialog({ title: '彻底清除会话', message: `确定彻底清除 WorkBuddy 会话「${title}」？\n\n将删除：会话记录、聊天历史文件、索引与备份文件（不可恢复）\n· 此操作不创建备份\n· 需要 WorkBuddy 已完全退出`, danger: true, confirmText: '彻底清除' }))) return;
  try {
    const r = await window.api.wbTaskRemove(id);
    wbSel.delete(id);
    toast(`会话已清除（${r.disk} 个关联文件）`, 'success');
    await wbTasks();
  } catch (e) { toast(e.message || String(e)); }
}

/* WorkBuddy：批量清除所选会话 */
async function removeWbBatch() {
  const ids = [...wbSel];
  if (!ids.length) return;
  if (await window.api.wbRunning()) { toast('检测到 WorkBuddy 正在运行！请先完全退出 WorkBuddy 再清除会话。'); refreshWbEnv(); return; }
  const items = ids.map((id) => (wbTasksData || []).find((t) => t.id === id)).filter(Boolean);
  if (!items.length) return;
  const preview = items.slice(0, 12).map((t) => `· ${t.title || '(未命名)'}`).join('\n') + (items.length > 12 ? `\n…（共 ${items.length} 个）` : '');
  const msg = `确定彻底清除选中的 ${items.length} 个 WorkBuddy 会话？\n\n${preview}\n\n`
    + `将删除：会话记录、聊天历史文件、索引与备份文件（不可恢复）\n`
    + `· 此操作不创建备份\n· 需要 WorkBuddy 已完全退出`;
  if (!(await confirmDialog({ title: '批量清除会话', message: msg, danger: true, confirmText: '彻底清除' }))) return;
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await window.api.wbTaskRemove(id); ok++; } catch { fail++; }
  }
  wbSel.clear();
  await wbTasks();
  toast(fail ? `已清除 ${ok} 个会话，${fail} 个失败` : `已清除 ${ok} 个会话`, fail ? 'error' : 'success');
}

/* ---------- WorkBuddy 空间（全量清单 + 迁移弹窗 + 移除 + 双击看任务） ---------- */
let wbSpacesData = null;
const wbSpaceSel = new Set();          // 多选：空间路径（规范化）集合
let wbSpaceSortKey = 'lastUsedNum', wbSpaceSortDir = -1;

function wbSpaceSorted() {
  if (!wbSpacesData) return [];
  const arr = wbSpacesData.slice();
  const dir = wbSpaceSortDir;
  arr.sort((a, b) => {
    if (wbSpaceSortKey === 'name') return (a.name || '').localeCompare(b.name || '', 'zh-CN') * dir;
    if (wbSpaceSortKey === 'exists') return ((a.exists ? 1 : 0) - (b.exists ? 1 : 0)) * dir;
    const va = a[wbSpaceSortKey] || 0, vb = b[wbSpaceSortKey] || 0;
    return (va - vb) * dir;
  });
  return arr;
}
const wbSpaceVisiblePaths = () => wbSpaceSorted().map((s) => s.path);

function renderWbSpaces() {
  const tb = $('#wbTable tbody');
  tb.innerHTML = '';
  const rows = wbSpaceSorted();
  if (!rows.length) {
    $('#wbTable').classList.add('hidden');
    $('#wbEmpty').classList.remove('hidden');
  } else {
    $('#wbTable').classList.remove('hidden');
    $('#wbEmpty').classList.add('hidden');
    for (const s of rows) {
      const tr = document.createElement('tr');
      const acts = [];
      acts.push(`<button class="btn mini" data-mig="${s.path}"><svg class="ic"><use href="#i-swap"/></svg>迁移</button>`);
      acts.push(`<button class="btn mini danger" data-remove="${s.path}" data-tasks="${s.tasks}"><svg class="ic"><use href="#i-trash"/></svg>移除</button>`);
      tr.innerHTML = `<td class="ckcol"><input type="checkbox" data-sel="${s.path}"${wbSpaceSel.has(s.path) ? ' checked' : ''}></td>
        <td class="wb-space-name" data-path="${s.path}" title="双击查看该空间下的全部任务\n${s.path}">${escapeHtml(s.name || s.path)}${s.customName ? ' <span class="badge-custom">自定义</span>' : ''}</td>
        <td>${pill(s.exists)}</td><td class="num">${s.firstUsed}</td><td class="num">${s.tasks}</td><td class="num wb-space-files" data-path="${s.path}" title="双击查看该空间下的文件清单">${s.files}</td>
        <td class="ops">${acts.join(' ')}</td>`;
      tr.classList.toggle('sel', wbSpaceSel.has(s.path));
      tb.appendChild(tr);
    }
  }
  const stale = (wbSpacesData || []).filter((s) => !s.exists).length;
  $('#wbStats').innerHTML = `
    <div class="stat"><div class="n">${wbSpacesData.length}</div><div class="l">空间</div></div>
    <div class="stat"><div class="n ${stale ? 'bad' : 'ok'}">${stale}</div><div class="l">失效待处理</div></div>
    <div class="stat"><div class="n">${wbSpacesData.reduce((a, s) => a + s.tasks, 0)}</div><div class="l">任务</div></div>
    <div class="stat"><div class="n">${wbSpacesData.reduce((a, s) => a + s.files, 0)}</div><div class="l">文件</div></div>
    <div class="stat time"><div class="l">扫描于 ${new Date().toLocaleString()}</div></div>`;
  $('#wbSpaceCount').textContent = wbSpacesData.length ? `共 ${wbSpacesData.length} 个空间` : '';
  syncSelUi(wbSpaceVisiblePaths(), wbSpaceSel, $('#wbSpaceSelInfo'), $('#wbSpaceBatchDel'), $('#wbSpaceSelAll'));
}

async function wbSpaces() {
  try {
    wbSpacesData = await window.api.wbSpaces();
    renderWbSpaces();
  } catch (e) { toast(e.message || String(e)); }
}
$('#btnWbRescan').addEventListener('click', wbSpaces);

/* WB 空间：单选 / 全选 / 批量移除 */
$('#wbTable tbody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-sel]');
  if (!cb) return;
  if (cb.checked) wbSpaceSel.add(cb.dataset.sel); else wbSpaceSel.delete(cb.dataset.sel);
  if (cb.closest('tr')) cb.closest('tr').classList.toggle('sel', cb.checked);
  syncSelUi(wbSpaceVisiblePaths(), wbSpaceSel, $('#wbSpaceSelInfo'), $('#wbSpaceBatchDel'), $('#wbSpaceSelAll'));
});
$('#wbSpaceSelAll').addEventListener('change', (e) => {
  const paths = wbSpaceVisiblePaths();
  if (e.target.checked) paths.forEach((p) => wbSpaceSel.add(p));
  else paths.forEach((p) => wbSpaceSel.delete(p));
  renderWbSpaces();
});
$('#wbSpaceBatchDel').addEventListener('click', removeWbSpaceBatch);

/* WB 空间：双击空间名称 → 弹窗显示该空间下的全部任务；双击文件数 → 弹窗显示文件清单 */
$('#wbTable tbody').addEventListener('dblclick', (e) => {
  const nameCell = e.target.closest('.wb-space-name');
  if (nameCell) { openWbSpaceTasks(nameCell.dataset.path); return; }
  const fileCell = e.target.closest('.wb-space-files');
  if (fileCell) { openWbSpaceFiles(fileCell.dataset.path); return; }
});
/* WB 空间：操作列按钮（迁移 / 移除），事件委托以兼容重渲染 */
$('#wbTable tbody').addEventListener('click', (e) => {
  const mig = e.target.closest('[data-mig]');
  if (mig) { openWbMigModal(mig.dataset.mig); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) { removeWbSpaceFlow(rm); return; }
});
let wbSpaceTasksCurrentPath = '';
async function openWbSpaceTasks(spacePath) {
  wbSpaceTasksCurrentPath = spacePath || '';
  const box = $('#wbSpaceTasksModal'); box.classList.remove('hidden');
  $('#wbSpaceTasksTitle').textContent = '空间任务加载中…';
  $('#wbSpaceTasksMeta').textContent = '';
  $('#wbSpaceTasksList').innerHTML = '<p class="muted">正在读取…</p>';
  try {
    const r = await window.api.wbSpaceTasks(spacePath);
    const total = r.tasks.length;
    const totalMsgs = r.tasks.reduce((a, t) => a + (t.msgs || 0), 0);
    $('#wbSpaceTasksTitle').textContent = `空间「${r.name}」下的全部任务`;
    $('#wbSpaceTasksMeta').textContent = `共 ${total} 个任务 · ${totalMsgs} 条消息 · 路径 ${r.spacePath}`;
    if (!total) { $('#wbSpaceTasksList').innerHTML = '<p class="muted">该空间下没有会话记录</p>'; return; }
    let html = '<table class="filetbl"><thead><tr><th>任务名称</th><th class="num">消息数</th><th>最近使用</th><th>状态</th><th></th></tr></thead><tbody>';
    for (const t of r.tasks) {
      const st = t.deleted ? '<span class="muted">已删除</span>' : (t.status ? escapeHtml(t.status) : '正常');
      html += `<tr><td>${escapeHtml(t.title)}</td><td class="num">${t.msgs}</td><td>${fmtDate(t.last)}</td><td>${st}</td>`
        + `<td><button class="btn mini danger" data-wdel="${escapeHtml(t.id)}" data-wtitle="${escapeHtml(t.title)}"><svg class="ic"><use href="#i-trash"/></svg>移除</button></td></tr>`;
    }
    html += '</tbody></table>';
    $('#wbSpaceTasksList').innerHTML = html;
  } catch (e) { $('#wbSpaceTasksList').innerHTML = `<p class="bad">读取失败：${escapeHtml(e.message || e)}</p>`; }
}
$('#wbSpaceTasksClose').addEventListener('click', () => $('#wbSpaceTasksModal').classList.add('hidden'));
$('#wbSpaceTasksModal').addEventListener('click', (e) => { if (e.target === $('#wbSpaceTasksModal')) $('#wbSpaceTasksModal').classList.add('hidden'); });
$('#wbSpaceTasksList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-wdel]');
  if (b) removeWbSpaceTaskFlow(b.dataset.wdel, b.dataset.wtitle);
});
/* 空间任务弹窗内移除单个任务：删除会话及聊天历史文件，随后刷新弹窗与相关清单 */
async function removeWbSpaceTaskFlow(id, title) {
  if (await window.api.wbRunning()) {
    toast('检测到 WorkBuddy 正在运行！请先完全退出 WorkBuddy 再清除会话。');
    refreshWbEnv();
    return;
  }
  if (!(await confirmDialog({
    title: '彻底清除任务',
    message: `确定彻底清除任务「${title}」？\n\n将删除：会话记录、聊天历史文件、索引与备份文件（不可恢复）\n· 此操作不创建备份\n· 需要 WorkBuddy 已完全退出`,
    danger: true, confirmText: '彻底清除',
  }))) return;
  try {
    const r = await window.api.wbTaskRemove(id);
    wbSel.delete(id);
    toast(`任务已清除（${r.disk} 个关联文件）`, 'success');
    if (wbSpaceTasksCurrentPath) await openWbSpaceTasks(wbSpaceTasksCurrentPath); // 刷新弹窗
    wbSpaces();
    wbTasks();
  } catch (e) { toast(e.message || String(e)); }
}

/* 弹窗内「复制」按钮：事件委托，每个弹窗只绑定一次 */
function bindCopyButtons(box) {
  if (box.__copyBound) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-copy]');
    if (!b) return;
    window.api.copyText(b.dataset.copy).then(() => toast('路径已复制', 'success')).catch(() => toast('复制失败'));
  });
  box.__copyBound = true;
}

/* WB 空间：双击「文件数」 → 弹窗显示该空间下全部会话改动过的文件（可复制路径） */
async function openWbSpaceFiles(spacePath) {
  const box = $('#wbSpaceFilesModal'); box.classList.remove('hidden');
  $('#wbSpaceFilesTitle').textContent = '空间文件加载中…';
  $('#wbSpaceFilesMeta').textContent = '';
  $('#wbSpaceFilesList').innerHTML = '<p class="muted">正在读取…</p>';
  try {
    const files = await window.api.wbSpaceFiles(spacePath);
    const n = files.length;
    $('#wbSpaceFilesTitle').textContent = `空间「${spacePath.split(/[\\/]/).pop()}」下的文件`;
    $('#wbSpaceFilesMeta').textContent = `共 ${n} 个文件 · 口径：该空间下各会话改动过且仍存在的文件`;
    if (!n) { $('#wbSpaceFilesList').innerHTML = '<p class="muted">该空间下没有改动过的文件记录</p>'; return; }
    let html = '<table class="filetbl"><thead><tr><th>文件名</th><th class="pathcol">路径</th><th class="num">大小</th><th></th></tr></thead><tbody>';
    for (const f of files) {
      html += `<tr><td>${escapeHtml(f.name)}</td>`
        + `<td class="pathcell" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>`
        + `<td class="num">${fmtBytes(f.size)}</td>`
        + `<td><button class="btn mini" data-copy="${escapeHtml(f.path)}">复制</button></td></tr>`;
    }
    html += '</tbody></table>';
    $('#wbSpaceFilesList').innerHTML = html;
    bindCopyButtons(box);
  } catch (e) { $('#wbSpaceFilesList').innerHTML = `<p class="bad">读取失败：${escapeHtml(e.message || e)}</p>`; }
}
$('#wbSpaceFilesClose').addEventListener('click', () => $('#wbSpaceFilesModal').classList.add('hidden'));

/* WB 空间排序 */
$$('#wbTable th.sortable').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if (wbSpaceSortKey === key) wbSpaceSortDir = -wbSpaceSortDir;
  else { wbSpaceSortKey = key; wbSpaceSortDir = key === 'name' || key === 'exists' ? 1 : -1; }
  $$('#wbTable th').forEach((x) => x.removeAttribute('data-dir'));
  th.setAttribute('data-dir', wbSpaceSortDir > 0 ? 'asc' : 'desc');
  renderWbSpaces();
}));

/* WB 空间迁移弹窗 */
function openWbMigModal(oldPath) {
  $('#wbMigModalOld').textContent = oldPath;
  $('#wbMigModalNew').value = '';
  $('#wbMigModal').classList.remove('hidden');
  $('#wbMigModalNew').focus();
}
$('#wbMigModalBrowse').addEventListener('click', async () => {
  const p = await window.api.pickDirectory();
  if (p) $('#wbMigModalNew').value = p;
});
$('#wbMigModalCancel').addEventListener('click', () => $('#wbMigModal').classList.add('hidden'));
$('#wbMigModalStart').addEventListener('click', async () => {
  const oldPath = $('#wbMigModalOld').textContent.trim();
  const newPath = $('#wbMigModalNew').value.trim();
  if (!newPath) { toast('请先填写新路径'); return; }
  if (!(await confirmDialog({ title: '确认迁移空间', message: `二次确认：把空间从\n  ${oldPath}\n迁移到\n  ${newPath}\n\n将更新数据库、会话历史目录、索引文件、显示名、心跳。\n完成后需重启 WorkBuddy 生效。继续？`, icon: 'i-swap', confirmText: '开始迁移' }))) return;
  const btn = $('#wbMigModalStart'); btn.disabled = true;
  try {
    await window.api.wbMigrate(oldPath, newPath);
    toast('迁移完成，重启 WorkBuddy 后生效', 'success');
    $('#wbMigModal').classList.add('hidden');
    await wbSpaces();
  } catch (e) { toast(e.message || String(e)); }
  btn.disabled = false;
});

/* ---------- WorkBuddy 空间：移除（单个 / 批量） ---------- */
/* 空间是 sessions 的投影：移除 = 删除该空间下全部会话（任务），空间即从侧栏消失；
   磁盘上的文件夹不会被删除。 */
async function removeWbSpaceFlow(btn) {
  const p = btn.dataset.remove, tasks = +btn.dataset.tasks;
  const msg = `确定移除空间「${p}」？\n\n`
    + `将删除该空间下的全部任务（${tasks} 个会话及聊天记录），空间随即从侧栏消失。\n`
    + `· 磁盘上的文件夹不会被删除\n· 此操作不可恢复，需要 WorkBuddy 已完全退出`;
  if (!(await confirmDialog({ title: '移除空间', message: msg, danger: true, confirmText: '移除空间' }))) return;
  try {
    const r = await window.api.wbSpaceRemove(p);
    toast(`已移除空间：${r.removed} 个会话（空间将从侧栏消失）`, 'success');
    await wbSpaces();
  } catch (e) { toast(e.message || String(e)); }
}

/* 批量移除选中空间：逐个删除其下会话（任务） */
async function removeWbSpaceBatch() {
  const paths = [...wbSpaceSel];
  if (!paths.length) return;
  if (await window.api.wbRunning()) { toast('检测到 WorkBuddy 正在运行！请先完全退出 WorkBuddy 再移除空间。'); refreshWbEnv(); return; }
  const items = paths.map((p) => (wbSpacesData || []).find((s) => s.path === p)).filter(Boolean);
  if (!items.length) return;
  const preview = items.slice(0, 12).map((s) => `· ${s.name || s.path}（${s.tasks} 个任务）`).join('\n') + (items.length > 12 ? `\n…（共 ${items.length} 个）` : '');
  const msg = `确定批量移除选中的 ${items.length} 个空间？\n\n${preview}\n\n`
    + `将删除这些空间下的全部任务（会话及聊天记录），空间随即从侧栏消失。\n`
    + `· 磁盘上的文件夹不会被删除\n· 此操作不可恢复，需要 WorkBuddy 已完全退出`;
  if (!(await confirmDialog({ title: '批量移除空间', message: msg, danger: true, confirmText: '移除空间' }))) return;
  try {
    const r = await window.api.wbSpaceRemoveBatch(paths);
    toast(`已批量移除 ${r.spaces} 个空间（共 ${r.removed} 个会话）`, 'success');
    wbSpaceSel.clear();
    await wbSpaces();
  } catch (e) { toast(e.message || String(e)); }
}

/* ---------- 启动：产品选择弹窗（必选其一才能进入） ---------- */
let pickChoice = '';
function pickCards() { return $$('#pickModal .pm-card'); }
function pickReset() {
  pickChoice = '';
  pickCards().forEach((c) => c.classList.remove('sel'));
  $('#pickGo').disabled = true;
  $('#pickHint').textContent = '请先选择一个产品';
  $('#pickModal').classList.remove('hidden');
}
pickCards().forEach((c) => {
  c.addEventListener('click', () => {
    pickChoice = c.dataset.pick;
    pickCards().forEach((x) => x.classList.toggle('sel', x === c));
    $('#pickGo').disabled = false;
    $('#pickHint').textContent = `已选择 ${c.querySelector('strong').textContent}，点「确定」进入`;
  });
  c.addEventListener('dblclick', () => { if (pickChoice === c.dataset.pick) $('#pickGo').click(); });
});
$('#pickGo').addEventListener('click', () => {
  if (!pickChoice) return;
  $('#pickModal').classList.add('hidden');
  const nav = $$('.snav').find((b) => b.dataset.sec === pickChoice);
  if (nav) nav.click();
});

/* ---------- 初始化 ---------- */
(async () => {
  pickReset();
  refreshEnv();
  refreshWbEnv();
  setInterval(refreshEnv, 5000);
  setInterval(refreshWbEnv, 5000);
  setInterval(checkWbAccount, 5000);
  doScan();
  refreshZcTasks();
  try { wbAccountUid = await window.api.wbUid(); } catch {}
  wbSpaces();
  wbTasks();
})();
