'use strict';
/**
 * WorkBuddy 空间迁移逻辑
 * 数据结构（依据 WorkBuddy app.asar 校准）：
 *   ~/.workbuddy/workbuddy.db                 sessions.cwd / workspaces(path) 表
 *   ~/.workbuddy/projects/<slug>/             slug = compressWorkspacePathName(cwd)
 *   ~/.workbuddy/file-tree-manifests/*.json   文件树索引（含绝对路径，JSON 转义）
 *   ~/.workbuddy/changes-index/*.json         变更索引（同上）
 *   ~/.workbuddy/workspace/sessions/<sid>/    会话文件修改备份
 *   ~/.workbuddy/workspace-display-names.json 空间显示名
 *   ~/.workbuddy/sessions/<pid>.json          运行时心跳（陈旧的清理）
 * 迁移共 5 步，不含备份（清除操作不可恢复）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOME = process.env.WB_HOME || path.join(os.homedir(), '.workbuddy');
const MAX_TEXT_BYTES = 50 * 1024 * 1024; // 超过此大小的文件跳过文本替换

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/* ---------- WorkBuddy 内部算法（与 app.asar 校准一致） ---------- */

function _to_int32(x) {
  x &= 0xFFFFFFFF;
  return x >= 0x80000000 ? x - 0x100000000 : x;
}
function _djb2_base36(s) {
  let h = 5381;
  for (const b of Buffer.from(s, 'utf-8')) {
    h = _to_int32(_to_int32(h * 33) ^ b);
  }
  const u = h >>> 0;
  let out = '';
  let n = u;
  do { out = '0123456789abcdefghijklmnopqrstuvwxyz'[n % 36] + out; n = Math.floor(n / 36); } while (n);
  return out || '0';
}
function normalize_workspace_path_base(d) {
  return String(d)
    .replace(/[/\\:]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-+/g, '-');
}
function compress_workspace_path_name(d) {
  const base = normalize_workspace_path_base(d);
  if (Buffer.byteLength(base, 'utf-8') <= 255) return base;
  let out = '', size = 0;
  for (const ch of base) {
    const n = Buffer.byteLength(ch, 'utf-8');
    if (size + n > 180) break;
    out += ch; size += n;
  }
  return out + '-' + _djb2_base36(base);
}
function slug_of(cwd) {
  // 实测 Windows 盘符落盘为小写，其余保持原样
  if (/^[A-Za-z]:/.test(cwd)) cwd = cwd[0].toLowerCase() + cwd.slice(1);
  return compress_workspace_path_name(cwd);
}
function display_key(cwd) {
  let p = String(cwd).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = p.toLowerCase();
  return p.replace(/\/+$/, '');
}
function _drive_lower(p) {
  return /^[A-Za-z]:/.test(p) ? p[0].toLowerCase() + p.slice(1) : p;
}

/* ---------- 路径变体与带边界替换 ---------- */

function build_pairs(oldP, newP) {
  // 变体：normpath/原始/正斜杠/反斜杠 × 盘符大小写；另含 JSON 转义形式；长前缀优先
  const base = new Set([
    path.win32.normalize(oldP), oldP,
    oldP.replace(/\\/g, '/'), oldP.replace(/\//g, '\\'),
  ]);
  const variants = new Set();
  for (const o of base) {
    variants.add(o);
    variants.add(_drive_lower(o));
    if (/^[A-Za-z]:/.test(o)) variants.add(o[0].toUpperCase() + o.slice(1));
  }
  const pairs = [];
  for (const o of variants) {
    const body = o.includes(':') ? o.split(':').slice(1).join(':') : o;
    const n = body.includes('/') ? newP.replace(/\\/g, '/') : newP;
    pairs.push([o, n]);
    if (o.includes('\\')) {
      pairs.push([o.replace(/\\/g, '\\\\'), n.replace(/\\/g, '\\\\')]);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

const ESC_RE = /[.*+?^${}()|[\]\\]/g;
function sub_path(text, pairs) {
  for (const [oldV, newV] of pairs) {
    // 带边界：旧路径后必须是分隔符/引号/空白/结尾，避免误伤同名前缀目录
    const pat = new RegExp(oldV.replace(ESC_RE, '\\$&') + '(?=$|[\\\\/\'"\\s])', 'g');
    text = text.replace(pat, () => newV);
  }
  return text;
}

function normExists(p) {
  try { return fs.existsSync(path.win32.normalize(p)); } catch { return false; }
}

/* ---------- 进程检测 ---------- */

function wbRunning() {
  return new Promise((resolve) => {
    const names = ['WorkBuddy.exe', 'CodeBuddy.exe'];
    let found = false, done = 0;
    for (const name of names) {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (!err && new RegExp(name.replace('.', '\\.'), 'i').test(String(stdout || ''))) found = true;
        if (++done === names.length) resolve(found);
      });
    }
  });
}
/* ---------- 检测：失效空间 ---------- */

function currentUid() {
  const p = path.join(HOME, 'storage', 'skeleton', 'account-snapshot.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')).primary?.uid || null;
  } catch { return null; }
}

function findBroken() {
  const db = path.join(HOME, 'workbuddy.db');
  if (!fs.existsSync(db)) return { items: [], uid: null };
  const sqlite = require('better-sqlite3');
  const uidNow = currentUid();
  const broken = new Map();
  const con = new sqlite(db, { readonly: true, fileMustExist: true });
  try {
    if (con.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()) {
      for (const r of con.prepare('SELECT cwd, user_id, COUNT(*) n FROM sessions GROUP BY cwd, user_id').all()) {
        const cwd = r.cwd;
        if (cwd && /^[A-Za-z]:/.test(cwd) && !normExists(cwd)) {
          const key = path.win32.normalize(cwd).toLowerCase();
          const e = broken.get(key) || {
            path: path.win32.normalize(cwd), sessions: 0, sessionsCurrent: 0,
            deviceLevel: false, uids: new Set(),
          };
          e.sessions += r.n;
          e.deviceLevel = false;
          if (uidNow && r.user_id === uidNow) e.sessionsCurrent += r.n;
          e.uids.add(r.user_id);
          broken.set(key, e);
        }
      }
    }
    if (con.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get()) {
      for (const r of con.prepare('SELECT path FROM workspaces').all()) {
        const p = r.path;
        if (p && /^[A-Za-z]:/.test(p) && !normExists(p)) {
          const key = path.win32.normalize(p).toLowerCase();
          if (!broken.has(key)) broken.set(key, {
            path: path.win32.normalize(p), sessions: 0, sessionsCurrent: 0,
            deviceLevel: true, uids: new Set(),
          });
        }
      }
    }
  } finally { con.close(); }
  const items = [...broken.values()].map((e) => ({
    ...e,
    isCurrent: uidNow === null || e.uids.size === 0 || e.uids.has(uidNow),
  }));
  items.sort((a, b) => -((a.sessionsCurrent || a.sessions) - (b.sessionsCurrent || b.sessions)));
  return { items, uid: uidNow };
}

/* ---------- 文本目标收集（跳过二进制与 >50MB） ---------- */

function walkFiles(root, out) {
  if (!fs.existsSync(root)) return;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    const fp = path.join(root, d.name);
    if (d.isDirectory()) walkFiles(fp, out);
    else if (d.isFile()) out.push(fp);
  }
}

function collectTextTargets(pairs, log = () => {}) {
  const roots = ['file-tree-manifests', 'changes-index', path.join('workspace', 'sessions'), 'projects'];
  const targets = [];
  for (const rel of roots) {
    const files = [];
    walkFiles(path.join(HOME, rel), files);
    for (const fp of files) {
      try {
        if (fs.statSync(fp).size > MAX_TEXT_BYTES) continue;
        const raw = fs.readFileSync(fp);
        if (raw.slice(0, 4096).includes(0)) continue; // 二进制跳过
        let text;
        try { text = utf8Strict.decode(raw); } catch { continue; } // 非 UTF-8 跳过
        if (sub_path(text, pairs) !== text) targets.push(fp);
      } catch { /* OSError 等价：跳过 */ }
    }
    log(`  扫描 ${rel}：累计命中 ${targets.length} 个文件`);
  }
  return targets;
}

function findOldProjectDirs(oldP) {
  const cands = [...new Set([slug_of(oldP), slug_of(path.win32.normalize(oldP)), slug_of(_drive_lower(oldP))])];
  const found = [];
  for (const c of cands) {
    const p = path.join(HOME, 'projects', c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) found.push(p);
  }
  return found;
}

/* ---------- 迁移（dry_run=仅预览；无备份步骤） ---------- */

function migrate(oldP, newP, { dryRun = false, log = () => {} } = {}) {
  oldP = path.win32.normalize(String(oldP || '').replace(/[\\/]+$/, ''));
  newP = path.win32.normalize(String(newP || '').replace(/[\\/]+$/, ''));
  if (!normExists(newP)) throw new Error(`新路径不存在：${newP}`);
  if (oldP.toLowerCase() === newP.toLowerCase()) throw new Error('新旧路径相同');
  const db = path.join(HOME, 'workbuddy.db');
  if (!fs.existsSync(db)) throw new Error(`未找到 ${db}`);
    // 进程检测由 IPC 层统一把关

  const pairs = build_pairs(oldP, newP);
  log('─'.repeat(52));
  log(`旧路径：${oldP}`);
  log(`新路径：${newP}`);
  if (dryRun) log('【仅预览模式，不改动任何数据】');

  const sqlite = require('better-sqlite3');
  const con = new sqlite(db, { timeout: 15000 });
  try {
    // 1. 数据库变更计划
    const sessHits = con.prepare('SELECT id, cwd FROM sessions').all()
      .filter((r) => r.cwd && sub_path(r.cwd, pairs) !== r.cwd);
    const wsHits = con.prepare('SELECT path, last_opened_at t FROM workspaces').all()
      .filter((r) => r.path && sub_path(r.path, pairs) !== r.path);
    log(`数据库：sessions 表 ${sessHits.length} 条、workspaces 表 ${wsHits.length} 条待更新`
      + `（同路径所有账号的会话记录会一并修正，文件夹位置只有一个）`);
    for (const r of sessHits) log(`  会话 ${r.id.slice(0, 8)}: ${r.cwd}`);

    // 2. projects 目录
    const oldDirs = findOldProjectDirs(oldP);
    for (const d of oldDirs) log(`会话历史目录：${d}`);

    // 3. 文本索引
    const textTargets = collectTextTargets(pairs, log);
    log(`含旧路径的索引/历史文件：${textTargets.length} 个`);
    for (const fp of textTargets.slice(0, 10)) log(`  ${path.relative(HOME, fp)}`);
    if (textTargets.length > 10) log(`  ... 等 ${textTargets.length} 个`);

    // 4. 显示名 & 心跳
    const dnPath = path.join(HOME, 'workspace-display-names.json');
    let dn = null, dnEntry = null;
    const dnOldKey = display_key(oldP);
    if (fs.existsSync(dnPath)) {
      try {
        dn = JSON.parse(fs.readFileSync(dnPath, 'utf-8'));
        dnEntry = dn?.workspaces?.[dnOldKey] || null;
      } catch { dn = { version: 1, workspaces: {} }; }
      if (dnEntry) log(`空间显示名「${dnEntry.displayName}」将迁移到新路径`);
    }
    const heartbeats = [];
    const hbDir = path.join(HOME, 'sessions');
    if (fs.existsSync(hbDir)) {
      for (const fn of fs.readdirSync(hbDir)) {
        if (!fn.endsWith('.json')) continue;
        const fp = path.join(hbDir, fn);
        try {
          const obj = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          if (obj.cwd && sub_path(obj.cwd, pairs) !== obj.cwd) heartbeats.push(fp);
        } catch { continue; }
      }
    }
    if (heartbeats.length) log(`陈旧心跳文件：${heartbeats.length} 个（将清理）`);

    if (dryRun) {
      log('预览结束。以上即实际迁移时会执行的全部改动。');
      return { preview: true, sessions: sessHits.length, workspaces: wsHits.length, files: textTargets.length, dirs: oldDirs.length, heartbeats: heartbeats.length };
    }

    // ---- 实际执行（5 步，无备份） ----
    log('步骤 1/5 更新数据库…');
    const tx = con.transaction(() => {
      for (const r of sessHits) {
        con.prepare('UPDATE sessions SET cwd=? WHERE id=?').run(sub_path(r.cwd, pairs), r.id);
      }
      const wsTs = wsHits.length ? Math.max(...wsHits.map((r) => r.t || 0)) : Date.now();
      for (const r of wsHits) con.prepare('DELETE FROM workspaces WHERE path=?').run(r.path);
      if (sessHits.length || wsHits.length) {
        con.prepare('INSERT OR REPLACE INTO workspaces(path, last_opened_at) VALUES(?, ?)').run(newP, wsTs);
      }
    });
    tx();

    log('步骤 2/5 替换索引与历史文件中的路径…');
    let done = 0;
    for (const fp of textTargets) {
      try {
        const raw = fs.readFileSync(fp);
        const t = utf8Strict.decode(raw);
        const t2 = sub_path(t, pairs);
        if (t2 !== t) {
          fs.writeFileSync(fp, t2, 'utf-8');
          done++;
        }
      } catch (e) { log(`  跳过 ${fp}（${e.message}）`); }
    }
    log(`  已替换 ${done} 个文件`);

    log('步骤 3/5 迁移会话历史目录…');
    for (const d of oldDirs) {
      const dst = path.join(HOME, 'projects', slug_of(newP));
      if (path.resolve(d) === path.resolve(dst)) continue;
      if (fs.existsSync(dst)) {
        for (const fn of fs.readdirSync(d)) {
          const srcF = path.join(d, fn), dstF = path.join(dst, fn);
          if (!fs.existsSync(dstF)) fs.renameSync(srcF, dstF);
        }
        try { fs.rmdirSync(d); } catch {}
        log(`  合并到已存在目录：${dst}`);
      } else {
        fs.renameSync(d, dst);
        log(`  → ${dst}`);
      }
    }

    log('步骤 4/5 迁移空间显示名…');
    if (dnEntry && dn) {
      const newKey = display_key(newP);
      const oldBase = baseNameOf(oldP);
      // 显示名若只是自动取自旧文件夹名（非用户自定义），不写死，让其自动跟随新文件夹名；
      // 只有用户真正自定义过的名字才保留。
      const isAuto = dnEntry.displayName === oldBase;
      dn.workspaces[dnOldKey] && delete dn.workspaces[dnOldKey];
      if (isAuto) {
        log(`  显示名跟随新文件夹名（${baseNameOf(newP)}）`);
      } else {
        dnEntry.id = newKey;
        dnEntry.path = newP;
        dnEntry.updatedAt = Date.now();
        dn.workspaces[newKey] = dnEntry;
        log(`  显示名保留：${dnEntry.displayName}`);
      }
      fs.writeFileSync(dnPath, JSON.stringify(dn, null, 2), 'utf-8');
    } else {
      log('  无自定义显示名，跳过（将自动显示为「新文件夹名」）');
    }

    log('步骤 5/5 清理陈旧心跳…');
    for (const fp of heartbeats) { try { fs.rmSync(fp, { force: true }); } catch {} }
    log(`  清理 ${heartbeats.length} 个`);

    log('─'.repeat(52));
    log('✅ 迁移完成！请重启 WorkBuddy 使空间列表生效。');
    return { preview: false, sessions: sessHits.length, workspaces: wsHits.length, files: textTargets.length, dirs: oldDirs.length, heartbeats: heartbeats.length };
  } finally { con.close(); }
}

/* ---------- 会话级：清单与清除（WorkBuddy 侧） ---------- */

function listSessions() {
  const dbPath = path.join(HOME, 'workbuddy.db');
  if (!fs.existsSync(dbPath)) return [];
  const sqlite = require('better-sqlite3');
  const db = new sqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!fs.existsSync(dbPath) || !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()) return [];
    const uidNow = currentUid();
    // 只保留【当前账号】下的【本地任务】：按 user_id 归账号，isSpaceSession 排除「空间」桶
    return db.prepare(`
      SELECT id, COALESCE(NULLIF(custom_title,''), title) title, cwd, status, deleted_at,
             transport, is_playground, conversation_origin, user_id,
             CAST(created_at AS INTEGER) ca, CAST(updated_at AS INTEGER) ua
      FROM sessions
    `).all()
      .filter((r) => (!uidNow || r.user_id === uidNow) && !isSpaceSession(r))
      .map((r) => ({
        id: r.id,
        title: r.title || '(未命名)',
        cwd: r.cwd || '',
        msgs: countJsonlLines(r.cwd, r.id),
        files: listSessionFiles(r.id).length,
        stale: !!(r.cwd && /^[A-Za-z]:/.test(r.cwd) && !normExists(r.cwd)),
        deleted: !!r.deleted_at,
        earliest: (() => { try { return new Date(r.ca).toLocaleDateString('zh-CN'); } catch { return ''; } })(),
        earliestNum: r.ca || 0,
        updated: (() => { try { return new Date(r.ua).toLocaleDateString('zh-CN'); } catch { return ''; } })(),
        updatedNum: r.ua || 0,
      }));
  } finally { db.close(); }
}

function removeSession(sid, log = logDefault) {
  if (!/^[\w.-]+$/.test(String(sid || ''))) throw new Error('非法会话 ID');
  // 进程检测由 IPC 层统一把关
  const dbPath = path.join(HOME, 'workbuddy.db');
  const sqlite = require('better-sqlite3');
  const db = new sqlite(dbPath);
  let row = null;
  try {
    row = db.prepare('SELECT cwd FROM sessions WHERE id=?').get(sid) || null;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    db.transaction(() => {
      for (const t of tables) {
        if (t === 'sessions') continue;
        const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
        for (const col of ['session_id', 'parent_session_id', 'child_session_id']) {
          if (cols.includes(col)) db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(sid);
        }
      }
      db.prepare('DELETE FROM sessions WHERE id=?').run(sid);
    })();
  } finally { db.close(); }

  // 会话内容与索引文件（按 WorkBuddy 数据结构）
  let disk = 0;
  const cwd = row ? row.cwd : '';
  if (cwd) {
    const jf = path.join(HOME, 'projects', slug_of(cwd), `${sid}.jsonl`);
    if (fs.existsSync(jf)) { fs.rmSync(jf, { force: true }); disk++; }
  }
  for (const rel of ['file-tree-manifests', 'changes-index']) {
    const f = path.join(HOME, rel, `${sid}.json`);
    if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); disk++; }
  }
  const wsDir = path.join(HOME, 'workspace', 'sessions', sid);
  if (fs.existsSync(wsDir)) { fs.rmSync(wsDir, { recursive: true, force: true }); disk++; }
  log(`🧹 WorkBuddy 会话已清除（含 ${disk} 个关联文件）`);
  return { disk };
}

/* ---------- 空间级：全量清单 + 移除 ---------- */

/* 用户手动起的空间显示名：workspace-display-names.json（key 为正斜杠小写路径） */
function readDisplayNames() {
  const p = path.join(HOME, 'workspace-display-names.json');
  const map = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    for (const [k, v] of Object.entries((j && j.workspaces) || {})) {
      if (!v || !v.displayName) continue;
      map.set(String(k), v.displayName);
      if (v.path) map.set(display_key(v.path), v.displayName);
    }
  } catch { /* 没有该文件或损坏：全部走路径末段兜底 */ }
  return map;
}

/* 该空间下会话改动过的文件数：取 changes-index/<会话ID>.json 记录的文件路径去重，
   且只在磁盘上仍存在、且是普通文件时计数（与 ZCode 侧「文件数」口径一致） */
function spaceFileCount(sessionIds) {
  const seen = new Set();
  for (const sid of sessionIds) {
    const f = path.join(HOME, 'changes-index', `${sid}.json`);
    if (!fs.existsSync(f)) continue;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { continue; }
    for (const c of (j && j.changes) || []) {
      for (const fl of (c && c.files) || []) {
        const fp = fl && fl.filePath;
        if (!fp) continue;
        const key = String(fp).toLowerCase();
        if (seen.has(key)) continue;
        try { if (fs.statSync(fp).isFile()) seen.add(key); } catch { /* 已不存在，不计 */ }
      }
    }
  }
  return seen.size;
}

/* 单会话改动过的文件清单：读取 changes-index/<会话ID>.json，去重返回 { path, name, ext, size } */
function listSessionFiles(sid) {
  const f = path.join(HOME, 'changes-index', `${sid}.json`);
  const out = [];
  if (!fs.existsSync(f)) return out;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return out; }
  const seen = new Set();
  for (const c of (j && j.changes) || []) {
    for (const fl of (c && c.files) || []) {
      const fp = fl && fl.filePath;
      if (!fp) continue;
      const key = String(fp).toLowerCase();
      if (seen.has(key)) continue;
      let st = null;
      try { st = fs.statSync(fp); } catch { continue; }
      if (!st.isFile()) continue;
      seen.add(key);
      out.push({ path: fp, name: path.win32.basename(fp), ext: path.extname(fp), size: st.size });
    }
  }
  return out;
}

/* 空间下全部会话改动过的文件清单（双击「文件数」时弹出） */
function listSpaceFiles(spacePath) {
  const p = path.win32.normalize(String(spacePath || '').replace(/[\\/]+$/, ''));
  if (!p) return [];
  const dbPath = path.join(HOME, 'workbuddy.db');
  const sqlite = require('better-sqlite3');
  const n = path.win32.normalize(p).toLowerCase();
  const db = new sqlite(dbPath);
  let ids;
  try {
    ids = db.prepare('SELECT id, cwd, deleted_at FROM sessions').all()
      .filter((r) => !r.deleted_at && (() => { const sk = path.win32.normalize(r.cwd || '').replace(/[\\/]+$/, '').toLowerCase(); return sk === n || sk.startsWith(n + '\\'); })())
      .map((r) => r.id);
  } finally { db.close(); }
  const files = [];
  for (const id of ids) for (const f of listSessionFiles(id)) files.push(f);
  return files;
}

/* 空间清单：忠实还原 WorkBuddy 侧栏「空间」分组 —— 它是 sessions 表的一次投影（视图），
   不是独立存储实体（详见 WorkBuddy侧栏空间分组逻辑.md）。判定与 app.asar 的 classify() 一致：
   未删 + 本地 + autoGenerated !== true（is_playground=0，或 is_playground 为 NULL 且目录名非时间戳）
   + 非云端来源 + 有 cwd → 归「空间」；按时间戳命名且 is_playground 为 NULL 的自动目录归「本地任务」。
   workspaces 表只是「最近打开的目录」清单，仅用于补充 last_opened_at，不作分桶依据。 */
function isSpaceSession(r) {
  if (r.deleted_at) return false;
  const cwd = r.cwd || '';
  if (!cwd || !/^[A-Za-z]:/.test(cwd)) return false;
  if (r.transport === 'cloud') return false;
  if (r.is_playground === 1) return false;                 // autoGenerated → 本地任务
  if (r.conversation_origin) return false;                 // genie / 云助理 / 云自动化 不在本地空间
  if (r.is_playground === null) {
    const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    if (/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(base)) return false; // 自动时间戳目录 → 本地任务
  }
  return true; // workdir / project 等本地空间子桶
}

function listSpaces() {
  const dbPath = path.join(HOME, 'workbuddy.db');
  if (!fs.existsSync(dbPath)) return [];
  const sqlite = require('better-sqlite3');
  const names = readDisplayNames();
  const con = new sqlite(dbPath, { readonly: true, fileMustExist: true });
  const nkey = (p) => path.win32.normalize(String(p).replace(/[\\/]+$/, '')).toLowerCase();
  const buckets = new Map();   // nkey -> { path, sessions:[{id,created,last}] }
  const wsOpened = new Map();  // nkey(path) -> last_opened_at（仅用于补充排序/显示）
  try {
    for (const r of con.prepare('SELECT path, CAST(last_opened_at AS INTEGER) lo FROM workspaces').all()) {
      if (r.path) wsOpened.set(nkey(r.path), r.lo || 0);
    }
    const uidNow = currentUid();
    for (const r of con.prepare(`SELECT id, cwd, deleted_at, is_playground, project_id, conversation_origin, transport, user_id,
          CAST(created_at AS INTEGER) ca, CAST(COALESCE(last_activity_at, updated_at) AS INTEGER) la
        FROM sessions`).all()) {
      if (!isSpaceSession(r) || (uidNow && r.user_id !== uidNow)) continue;
      const k = nkey(r.cwd);
      const e = buckets.get(k) || { path: path.win32.normalize(String(r.cwd).replace(/[\\/]+$/, '')), sessions: [] };
      e.sessions.push({ id: r.id, created: r.ca || 0, last: r.la || 0 });
      buckets.set(k, e);
    }
  } finally { con.close(); }

  const day = (ms) => { try { return ms && ms !== Infinity ? new Date(ms).toLocaleDateString('zh-CN') : '—'; } catch { return '—'; } };
  const list = [...buckets.entries()].map(([k, e]) => {
    const live = e.sessions;
    const first = live.length ? Math.min(...live.map((s) => s.created || Infinity)) : 0;
    const last = live.length ? Math.max(...live.map((s) => s.last || 0)) : 0;
    const base = e.path.split(/[\\/]/).pop() || e.path;
    const dn = names.get(display_key(e.path));
    const lo = wsOpened.get(k) || 0;
    return {
      path: e.path,
      name: dn || base,
      customName: !!dn,
      exists: normExists(e.path),
      tasks: live.length,
      files: spaceFileCount(live.map((s) => s.id)),
      firstUsed: day(first),
      firstUsedNum: first || 0,
      lastUsed: day(Math.max(lo, last)),
      lastUsedNum: Math.max(lo, last),
    };
  });
  list.sort((a, b) => (a.exists === b.exists ? b.lastUsedNum - a.lastUsedNum : (a.exists ? 1 : -1)));
  return list;
}

/* 清理空间相关元数据：workspaces 表登记 + 显示名（使迁移/移除后不残留旧记录） */
function cleanSpaceMeta(p, log = () => {}) {
  const dbPath = path.join(HOME, 'workbuddy.db');
  const sqlite = require('better-sqlite3');
  const db = new sqlite(dbPath);
  try { db.prepare('DELETE FROM workspaces WHERE path=?').run(p); } finally { db.close(); }
  const dnPath = path.join(HOME, 'workspace-display-names.json');
  if (fs.existsSync(dnPath)) {
    try {
      const dn = JSON.parse(fs.readFileSync(dnPath, 'utf-8'));
      const k = display_key(p);
      if (dn.workspaces && dn.workspaces[k]) {
        delete dn.workspaces[k];
        fs.writeFileSync(dnPath, JSON.stringify(dn, null, 2), 'utf-8');
      }
    } catch { /* 损坏则忽略 */ }
  }
}

/* 移除空间：空间是 sessions 的投影，删 workspaces 行无法让它消失，
   必须删除该 cwd（含子目录）下的全部会话（任务），空间才会从侧栏消失。 */
function removeSpace(spacePath, log = () => {}) {
  const p = path.win32.normalize(String(spacePath || '').replace(/[\\/]+$/, ''));
  if (!p) throw new Error('路径为空');
  // 进程检测由 IPC 层统一把关
  const dbPath = path.join(HOME, 'workbuddy.db');
  const sqlite = require('better-sqlite3');
  const n = path.win32.normalize(p).toLowerCase();
  const db = new sqlite(dbPath);
  let ids;
  try {
    ids = db.prepare('SELECT id, cwd FROM sessions').all()
      .filter((r) => { const sk = path.win32.normalize(r.cwd || '').replace(/[\\/]+$/, '').toLowerCase(); return sk === n || sk.startsWith(n + '\\'); })
      .map((r) => r.id);
  } finally { db.close(); }
  let removed = 0, disk = 0;
  for (const id of ids) { const r = removeSession(id, log); removed++; disk += (r && r.disk) || 0; }
  cleanSpaceMeta(p, log);
  log(`🧹 已移除空间「${p}」：${removed} 个会话（含 ${disk} 个关联文件），空间将从侧栏消失`);
  return { removed, disk };
}

/* ---------- 空间下所有任务（双击空间名称时弹出） ---------- */

/* 单会话的消息条数 = projects/<slug>/<会话ID>.jsonl 的行数（与文档口径一致：消息数即记录条数） */
function countJsonlLines(cwd, sid) {
  const jf = path.join(HOME, 'projects', slug_of(cwd), `${sid}.jsonl`);
  try {
    const buf = fs.readFileSync(jf);
    if (!buf.length) return 0;
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
    if (buf[buf.length - 1] !== 0x0a) n++; // 末尾无换行也算一行
    return n;
  } catch { return 0; }
}

/* 给定空间路径，列出其下全部（含子目录）会话：标题、消息数、最近使用、状态。
   返回 { name, spacePath, tasks: [...] }，tasks 按最近使用倒序。 */
function listSpaceTasks(spacePath) {
  const p = path.win32.normalize(String(spacePath || '').replace(/[\\/]+$/, ''));
  const dbPath = path.join(HOME, 'workbuddy.db');
  if (!fs.existsSync(dbPath)) return { name: baseNameOf(p), spacePath: p, tasks: [] };
  const sqlite = require('better-sqlite3');
  const names = readDisplayNames();
  const con = new sqlite(dbPath, { readonly: true, fileMustExist: true });
  const nkey = (x) => path.win32.normalize(String(x).replace(/[\\/]+$/, '')).toLowerCase();
  const sp = nkey(p);
  const tasks = [];
  try {
    if (con.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()) {
      const uidNow = currentUid();
      for (const r of con.prepare(`SELECT id, COALESCE(NULLIF(custom_title,''), title) title, cwd, status, deleted_at, user_id,
            CAST(created_at AS INTEGER) ca, CAST(COALESCE(last_activity_at, updated_at) AS INTEGER) la
          FROM sessions`).all()) {
        if (!r.cwd || (uidNow && r.user_id !== uidNow)) continue;
        const sk = nkey(r.cwd);
        if (sk !== sp && !sk.startsWith(sp + '\\')) continue; // 含子目录
        tasks.push({
          id: r.id,
          title: r.title || '(未命名)',
          cwd: r.cwd,
          status: r.status || '',
          deleted: !!r.deleted_at,
          created: r.ca || 0,
          last: r.la || 0,
          msgs: countJsonlLines(r.cwd, r.id),
        });
      }
    }
  } finally { con.close(); }
  tasks.sort((a, b) => (b.last || 0) - (a.last || 0));
  return { name: names.get(display_key(p)) || baseNameOf(p), spacePath: p, tasks };
}
function baseNameOf(p) { return String(p).split(/[\\/]/).pop() || p; }

/* 批量移除空间：逐个删除该 cwd 下的全部会话（任务），空间即从侧栏消失 */
function removeSpaces(spacePaths, log = () => {}) {
  const list = [...new Set((spacePaths || [])
    .map((p) => path.win32.normalize(String(p || '').replace(/[\\/]+$/, '')))
    .filter(Boolean))];
  if (!list.length) throw new Error('未选择任何空间');
  let removed = 0, spaces = 0;
  for (const p of list) { const r = removeSpace(p, log); removed += (r && r.removed) || 0; spaces++; }
  log(`🧹 已批量移除 ${spaces} 个空间（共 ${removed} 个会话），空间将从侧栏消失`);
  return { removed, spaces, requested: list.length };
}

module.exports = {
  HOME, build_pairs, sub_path, slug_of, display_key,
  wbRunning, currentUid, findBroken, migrate,
  listSessions, removeSession, listSpaces, removeSpace, removeSpaces, readDisplayNames,
  listSpaceTasks, listSpaceFiles, listSessionFiles,
};
