'use strict';
/**
 * ZCode 路径修复器 - 核心逻辑（不依赖 Electron，可独立测试）
 *
 * 知识来源：2026-09 实战逆向 ZCode 存储结构，路径绑定分布在：
 *  1. v2/setting.json                -> recentProjects / lastWorkspaceSession
 *  2. v2/tasks-index.sqlite          -> tasks(workspace_path, workspace_key, meta_json)
 *                                       task_group_view_node_orders(node_key, JSON 转义路径)
 *  3. cli/db/db.sqlite               -> session(directory, path) 及全部会话数据表
 * 注意：修改必须在 ZCode 完全退出后进行（退出时程序会把内存状态写回磁盘）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ZCODE_DIR = process.env.ZCODE_HOME || path.join(os.homedir(), '.zcode');
const FILES = {
  setting: path.join(ZCODE_DIR, 'v2', 'setting.json'),
  tasksDb: path.join(ZCODE_DIR, 'v2', 'tasks-index.sqlite'),
  sessionDb: path.join(ZCODE_DIR, 'cli', 'db', 'db.sqlite'),
};
const DEFAULT_WS = path.join(ZCODE_DIR, 'workspace', 'default');
const INTERNAL_WS = path.join(ZCODE_DIR, 'workspace'); // ZCode 内部工作区（默认会话区），非项目型，不纳入工具范围

/* ---------- 工具函数 ---------- */

function normKey(p) {
  return String(p || '').replace(/[\\/]+$/, '').toLowerCase();
}
// 是否为 ZCode 内部工作区路径（默认会话区及其子目录）
function isInternalWs(p) {
  const k = normKey(p), base = normKey(INTERNAL_WS);
  return k === base || k.startsWith(base + '\\');
}
function jsonEscape(p) {
  return p.replace(/\\/g, '\\\\');
}
function likeEscape(p) {
  return p.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
function logDefault() {}
function lazySqlite() {
  try {
    return require('better-sqlite3');
  } catch (e) {
    throw new Error('sqlite 模块加载失败: ' + e.message);
  }
}
function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function fmtDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('zh-CN'); } catch { return ''; }
}
// 子路径匹配模式：路径本身 + 路径\下级
function selfAndSubPatterns(p) {
  return [p, likeEscape(p) + '\\%'];
}

/* ---------- 环境检测 ---------- */

function envStatus() {
  return {
    zcodeDir: ZCODE_DIR,
    zcodeDirExists: fs.existsSync(ZCODE_DIR),
    files: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, { path: f, exists: fs.existsSync(f) }])),
  };
}

function isZcodeRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq ZCode.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ running: false, error: err.message });
      // CSV 第一列是映像名称。tasklist 在「没有匹配进程」时会输出一行 INFO 提示，
      // 必须按列精确比对，否则一旦出现同名/提示文案就会被误判为仍在运行。
      const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const pids = [];
      for (const line of lines) {
        const m = /^"([^"]*)"\s*,\s*"([^"]*)"/.exec(line);
        if (m && /^ZCode\.exe$/i.test(m[1])) pids.push(m[2]);
      }
      resolve({ running: pids.length > 0, count: pids.length, pids });
    });
  });
}

function killZcode() {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/IM', 'ZCode.exe', '/T'], { windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, output: String(stdout || (err && err.message) || '').trim() });
    });
  });
}

function isZcodeRunningSyncSafe() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ZCode.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' });
    return /ZCode\.exe/i.test(out || '');
  } catch { return false; }
}

/* ---------- 消息条数口径 ----------
 * 按「视觉上的对话泡泡」计数：
 *   · 用户每发一句 = 1 条
 *   · AI 的一次回答 = 1 条 —— 同一轮里因工具调用续跑产生的连续多条 assistant 行合并计 1
 * 例：提问 1 句 + AI 先读技能文件再作答（2 行 assistant）= 2 条，而不是 3 条。
 */
function roleExpr(db) {
  try {
    db.prepare("SELECT json_extract('{\"role\":\"user\"}','$.role') r").get();
    return "json_extract(m.data, '$.role')";
  } catch {
    return "(CASE WHEN m.data LIKE '%\"role\":\"user\"%' THEN 'user'"
      + " WHEN m.data LIKE '%\"role\":\"assistant\"%' THEN 'assistant' ELSE NULL END)";
  }
}
/* 按 keyExpr 分组统计消息数；窗口函数不可用 / message 表结构变化时回退为直接行数 */
function countMessagesBy(db, keyExpr, whereSql = '', params = []) {
  const role = roleExpr(db);
  const base = ' FROM session s JOIN message m ON m.session_id = s.id ' + whereSql;
  try {
    return db.prepare(`
      WITH r AS (
        SELECT ${keyExpr} k, ${role} role,
               LAG(${role}) OVER (
                 PARTITION BY s.id ORDER BY CAST(m.time_created AS INTEGER), CAST(m.sequence AS INTEGER)
               ) prev
        ${base}
      )
      SELECT k k, SUM(CASE WHEN role <> 'assistant' THEN 1
                           WHEN prev IS NULL OR prev <> 'assistant' THEN 1
                           ELSE 0 END) n
      FROM r GROUP BY k`).all(...params);
  } catch {
    return db.prepare(`SELECT ${keyExpr} k, COUNT(*) n ${base} GROUP BY k`).all(...params);
  }
}

/* ---------- 扫描诊断 ---------- */

function scanPaths() {
  const sqlite = lazySqlite();
  const map = new Map();
  let excluded = 0;
  const touch = (raw) => {
    if (!raw || typeof raw !== 'string' || raw.length < 2) return;
    if (isInternalWs(raw)) { excluded++; return; } // 内部会话区不属于项目型范围
    const k = normKey(raw);
    if (!map.has(k)) map.set(k, { path: raw, refs: { setting: 0, tasks: 0, sessions: 0, messages: 0, lastSession: 0 }, firstSeen: 0 });
    return map.get(k);
  };
  // 已登记的取出来（不再走 touch，避免重复计入「已排除内部路径」）
  const get = (raw) => (raw && typeof raw === 'string' ? map.get(normKey(raw)) : undefined);
  const seen = (e, ms) => { if (e && ms && (!e.firstSeen || ms < e.firstSeen)) e.firstSeen = ms; };

  // 1) setting.json
  try {
    const s = JSON.parse(fs.readFileSync(FILES.setting, 'utf-8'));
    for (const p of s.recentProjects || []) { const e = touch(p); if (e) e.refs.setting++; }
    for (const e of s.lastWorkspaceSession || []) {
      const t = touch(e && e.workspacePath);
      if (t && e && e.workspacePurpose === 'project') t.refs.lastSession++;
    }
  } catch { /* setting 不存在或损坏，跳过 */ }

  // 2) tasks-index.sqlite
  let tasksDb = null;
  if (fs.existsSync(FILES.tasksDb)) {
    tasksDb = new sqlite(FILES.tasksDb, { readonly: true, fileMustExist: true });
    if (tableExists(tasksDb, 'tasks')) {
      for (const r of tasksDb.prepare(
        'SELECT workspace_path p, COUNT(*) n, MIN(CAST(created_at AS INTEGER)) m FROM tasks GROUP BY workspace_path').all()) {
        const e = touch(r.p); if (e) { e.refs.tasks += r.n; seen(e, r.m); }
      }
    }
  }

  // 3) session db
  let sessionDb = null;
  if (fs.existsSync(FILES.sessionDb)) {
    sessionDb = new sqlite(FILES.sessionDb, { readonly: true, fileMustExist: true });
    if (tableExists(sessionDb, 'session')) {
      for (const r of sessionDb.prepare(
        'SELECT directory p, COUNT(*) n, MIN(CAST(time_created AS INTEGER)) m FROM session GROUP BY directory').all()) {
        const e = touch(r.p); if (e) { e.refs.sessions += r.n; seen(e, r.m); }
      }
      // 消息条数：按会话归属目录汇总（AI 一次回答内的多条 assistant 行合并计 1）
      if (tableExists(sessionDb, 'message')) {
        for (const r of countMessagesBy(sessionDb, 's.directory')) {
          const e = get(r.k); if (e) e.refs.messages += r.n;
        }
      }
    }
  }

  const list = [...map.values()].map((e) => ({
    ...e, exists: fs.existsSync(e.path), firstSeenStr: fmtDate(e.firstSeen),
  }));
  list.sort((a, b) => (a.exists === b.exists ? b.refs.tasks + b.refs.sessions - (a.refs.tasks + a.refs.sessions) : (a.exists ? 1 : -1)));
  if (tasksDb) tasksDb.close();
  if (sessionDb) sessionDb.close();
  return { scannedAt: new Date().toLocaleString(), paths: list, staleCount: list.filter((x) => !x.exists).length, excluded };
}

/* ---------- 一键迁移 ---------- */

function migrate(oldP, newP, opts = {}, log = logDefault) {
  oldP = String(oldP || '').replace(/[\\/]+$/, '');
  newP = String(newP || '').replace(/[\\/]+$/, '');
  if (!oldP || !newP) throw new Error('旧路径和新路径都不能为空');
  if (normKey(oldP) === normKey(newP)) throw new Error('新旧路径相同，无需迁移');
  if (isInternalWs(oldP)) throw new Error('旧路径属于 ZCode 内部会话区（默认工作区），不是项目，不支持迁移。');
  if (isInternalWs(newP)) throw new Error('新路径位于 ZCode 内部会话区（.zcode\\workspace），项目不应放在这里。');
  if (!fs.existsSync(newP)) throw new Error(`新路径在磁盘上不存在：${newP}\n请先把项目文件夹移动/重命名到位，再执行迁移。`);
  // 进程检测由 IPC 层 requireClosed 统一把关，此处不再二次检测（避免双检竞态误报）

  const result = { setting: 0, tasks: 0, meta: 0, nodeOrders: 0, sessions: 0 };
  const oldEsc = jsonEscape(oldP), newEsc = jsonEscape(newP);
  const sqlite = lazySqlite();

  // --- 1) setting.json ---
  try {
    const s = JSON.parse(fs.readFileSync(FILES.setting, 'utf-8'));
    let n = 0;
    (s.recentProjects || []).forEach((p, i, arr) => {
      if (normKey(p) === normKey(oldP)) { if (arr.includes(newP)) { arr[i] = null; } else { arr[i] = newP; } n++; }
    });
    s.recentProjects = (s.recentProjects || []).filter(Boolean);
    for (const e of s.lastWorkspaceSession || []) {
      if (e && normKey(e.workspacePath) === normKey(oldP)) { e.workspacePath = newP; n++; }
    }
    if (n) {
      fs.writeFileSync(FILES.setting, JSON.stringify(s, null, 2) + '\n', 'utf-8');
      result.setting = n;
      log(`✏️ setting.json：更新 ${n} 处`);
    }
  } catch (e) { log(`⚠️ setting.json 跳过：${e.message}`); }

  // --- 2) tasks-index.sqlite ---
  if (fs.existsSync(FILES.tasksDb)) {
    const db = new sqlite(FILES.tasksDb);
    try {
      if (!tableExists(db, 'tasks')) throw new Error('tasks 表不存在（ZCode 版本可能已变化）');
      db.transaction(() => {
        const r1 = db.prepare('UPDATE tasks SET workspace_path=?, workspace_key=? WHERE workspace_path=? OR workspace_key=?')
          .run(newP, newP, oldP, oldP);
        result.tasks = r1.changes;
        const r2 = db.prepare(`UPDATE tasks SET meta_json = REPLACE(REPLACE(meta_json, ?, ?), ?, ?)
          WHERE meta_json LIKE ? ESCAPE '\\' OR meta_json LIKE ? ESCAPE '\\'`)
          .run(oldEsc, newEsc, oldP, newP, `%${likeEscape(oldEsc)}%`, `%${likeEscape(oldP)}%`);
        result.meta = r2.changes;
        if (tableExists(db, 'task_group_view_node_orders')) {
          const r3 = db.prepare(`UPDATE task_group_view_node_orders SET node_key = REPLACE(REPLACE(node_key, ?, ?), ?, ?)
            WHERE node_key LIKE ? ESCAPE '\\'`)
            .run(oldEsc, newEsc, oldP, newP, `%${likeEscape(oldEsc)}%`);
          result.nodeOrders = r3.changes;
        }
      })();
      log(`✏️ 任务索引：${result.tasks} 条任务、${result.meta} 条元数据、${result.nodeOrders} 条排序记录`);
    } finally { db.close(); }
  }

  // --- 3) session db ---
  if (fs.existsSync(FILES.sessionDb)) {
    const db = new sqlite(FILES.sessionDb);
    try {
      if (!tableExists(db, 'session')) throw new Error('session 表不存在（ZCode 版本可能已变化）');
      const r = db.prepare('UPDATE session SET directory=?, path=? WHERE directory=? OR path=?')
        .run(newP, newP, oldP, oldP);
      result.sessions = r.changes;
      log(`✏️ 会话库：${result.sessions} 个会话的工作目录已改绑`);
    } finally { db.close(); }
  }

  log(`🎉 迁移完成。共 ${result.setting + result.tasks + result.meta + result.nodeOrders + result.sessions} 处绑定更新。`);
  return result;
}

/* ---------- 移除项目（含聊天记录的完整清除） ---------- */

function removeProject(projectPath, log = logDefault) {
  const p = String(projectPath || '').replace(/[\\/]+$/, '');
  if (!p) throw new Error('路径为空');
  if (isInternalWs(p)) throw new Error('该路径属于 ZCode 内部会话区（默认工作区），不属于项目，不支持通过本工具移除。');
  // 进程检测由 IPC 层统一把关

  const res = { setting: 0, tasks: 0, nodeOrders: 0, sessions: 0, messages: 0, projSettings: 0, diskFiles: 0 };
  const sqlite = lazySqlite();

  // --- 1) setting.json ---
  try {
    const s = JSON.parse(fs.readFileSync(FILES.setting, 'utf-8'));
    const before = JSON.stringify(s.recentProjects || []);
    s.recentProjects = (s.recentProjects || []).filter((x) => normKey(x) !== normKey(p));
    res.setting = JSON.parse(before).length - s.recentProjects.length;
    const lwsBefore = (s.lastWorkspaceSession || []).length;
    s.lastWorkspaceSession = (s.lastWorkspaceSession || []).filter((e) => !(e && normKey(e.workspacePath) === normKey(p)));
    res.setting += lwsBefore - s.lastWorkspaceSession.length;
    if (res.setting) {
      fs.writeFileSync(FILES.setting, JSON.stringify(s, null, 2) + '\n', 'utf-8');
      log(`✏️ setting.json：移除 ${res.setting} 处记录`);
    }
  } catch (e) { log(`⚠️ setting.json 跳过：${e.message}`); }

  // --- 2) tasks-index.sqlite：收集任务 id 后按列名泛化清理 ---
  const taskIds = [];
  if (fs.existsSync(FILES.tasksDb)) {
    const db = new sqlite(FILES.tasksDb);
    try {
      const pats = selfAndSubPatterns(p);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      db.transaction(() => {
        // 先收集 task_id（供 task_group_members 等关联表清理）
        if (tableExists(db, 'tasks')) {
          for (const r of db.prepare(`SELECT task_id FROM tasks WHERE workspace_path=? OR workspace_path LIKE ? ESCAPE '\\'
              OR workspace_key=? OR workspace_key LIKE ? ESCAPE '\\'`).all(p, pats[1], p, pats[1])) taskIds.push(r.task_id);
        }
        for (const t of tables) {
          const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
          if (cols.includes('workspace_path') || cols.includes('workspace_key')) {
            const conds = [], args = [];
            for (const c of ['workspace_path', 'workspace_key']) {
              if (!cols.includes(c)) continue;
              conds.push(`(${c}=? OR ${c} LIKE ? ESCAPE '\\')`);
              args.push(p, pats[1]);
            }
            const r = db.prepare(`DELETE FROM ${t} WHERE ${conds.join(' OR ')}`).run(...args);
            if (t === 'tasks') res.tasks = r.changes;
          } else if (t === 'task_group_view_node_orders' && cols.includes('node_key')) {
            const r = db.prepare(`DELETE FROM task_group_view_node_orders
              WHERE node_key LIKE ? ESCAPE '\\' OR node_key LIKE ? ESCAPE '\\'`)
              .run(`%${likeEscape(jsonEscape(p))}%`, `%${likeEscape(p)}%`);
            res.nodeOrders = r.changes;
          } else if (t === 'task_group_members' && cols.includes('task_id') && taskIds.length) {
            for (const part of chunk(taskIds, 400)) {
              db.prepare(`DELETE FROM task_group_members WHERE task_id IN (${part.map(() => '?').join(',')})`).run(...part);
            }
          }
        }
      })();
      log(`✏️ 任务索引：移除 ${res.tasks} 条任务、${res.nodeOrders} 条排序记录`);
    } finally { db.close(); }
  }

  // --- 3) session db：删除会话及全部关联数据 ---
  if (fs.existsSync(FILES.sessionDb)) {
    const db = new sqlite(FILES.sessionDb);
    try {
      const pats = selfAndSubPatterns(p);
      const sess = db.prepare(`SELECT id, project_id FROM session
        WHERE directory=? OR directory LIKE ? ESCAPE '\\' OR path=? OR path LIKE ? ESCAPE '\\'`).all(p, pats[1], p, pats[1]);
      const ids = sess.map((r) => r.id);
      const projIds = [...new Set(sess.map((r) => r.project_id).filter(Boolean))];
      res.sessions = ids.length;
      if (!ids.length) { db.close(); }
      else {
        db.transaction(() => {
          // 统计将删除的消息数
          if (tableExists(db, 'message')) {
            res.messages = 0;
            for (const part of chunk(ids, 400)) {
              res.messages += db.prepare(`SELECT COUNT(*) c FROM message WHERE session_id IN (${part.map(() => '?').join(',')})`).get(...part).c;
            }
          }
          // 按列名泛化删除所有带 session_id / parent_session_id / child_session_id 的表
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
          for (const t of tables) {
            if (t === 'session') continue;
            const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
            for (const col of ['session_id', 'parent_session_id', 'child_session_id']) {
              if (!cols.includes(col)) continue;
              for (const part of chunk(ids, 400)) {
                db.prepare(`DELETE FROM ${t} WHERE ${col} IN (${part.map(() => '?').join(',')})`).run(...part);
              }
            }
          }
          db.prepare(`DELETE FROM session WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
          // 项目级设置（权限规则等）
          for (const pid of projIds) {
            if (tableExists(db, 'local_setting')) {
              res.projSettings += db.prepare("DELETE FROM local_setting WHERE scope='project' AND scope_id=?").run(pid).changes;
            }
          }
        })();
        log(`✏️ 会话库：移除 ${res.sessions} 个会话（${res.messages} 条消息）、${res.projSettings} 条项目设置`);
        db.close();

        // --- 4) 磁盘上的会话关联文件 ---
        for (const id of ids) {
          for (const d of ['agents', 'artifacts']) {
            const dir = path.join(ZCODE_DIR, 'cli', d, id);
            if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); res.diskFiles++; }
          }
          const ro = path.join(ZCODE_DIR, 'cli', 'rollout', `model-io-${id}.jsonl`);
          if (fs.existsSync(ro)) { fs.rmSync(ro, { force: true }); res.diskFiles++; }
        }
        if (res.diskFiles) log(`🧹 已清理 ${res.diskFiles} 个会话关联目录/文件`);
      }
    } catch (e) { try { db.close(); } catch {} throw e; }
  }

  log(`🎉 移除完成。注意：磁盘上的项目文件夹（如存在）未被删除。`);
  return res;
}

/* ---------- 任务级：清单与清除（默认会话区） ---------- */

// 「任务文件」口径：该任务产生、并存储在 *\.zcode\workspace\default\ 下的现存文件。
// 数据来源为任务自身的会话记录（message / part / session_entry 的文本内容），
// 数据库里同一路径有原始形态与 JSON 转义形态两种写法，正则同时兼容（分隔符 = 1~2 个反斜杠 或 斜杠）。
const WS_FILE_RE = /[A-Za-z]:(?:\\\\|\\|\/)+[^"'`\s<>|*?]*?[\\/]+\.zcode[\\/]+workspace[\\/]+default[\\/]+(?:[^"'`\s<>|*?)\]}])+/g;
const TASK_DATA_TABLES = ['message', 'part', 'session_entry'];
// 路径归一化：\\ -> \（JSON 转义）、/ -> \（分隔符统一）、折叠多余分隔符、去掉句末标点
function normalizeWsPath(p) {
  return String(p)
    .replace(/\//g, '\\')                 // 分隔符统一为反斜杠
    .replace(/\\+/g, '\\')                // \\ -> \（JSON 转义），并折叠多余分隔符
    .replace(/[\\.,;:：）)】\]}]+$/, '');  // 去掉结尾的分隔符与句末标点（避免同一文件被算两次）
}
// 从任务的若干段会话文本里提取符合条件的文件（去重，按路径排序）
function collectTaskFiles(texts) {
  const base = normKey(DEFAULT_WS) + '\\';
  const seen = new Set();
  const out = [];
  for (const data of texts || []) {
    if (!data || typeof data !== 'string') continue;
    let m;
    WS_FILE_RE.lastIndex = 0;
    while ((m = WS_FILE_RE.exec(data)) !== null) {
      const p = normalizeWsPath(m[0]);
      const k = p.toLowerCase();
      if (!k.startsWith(base) || k.length <= base.length) continue; // 不在默认会话区内（含该目录本身）
      if (seen.has(k)) continue;
      seen.add(k);
      let st = null;
      try { st = fs.statSync(p); } catch { continue; } // 只统计磁盘上仍然存在的文件
      if (!st.isFile()) continue; // 目录不计入文件数
      out.push({ name: path.basename(p), path: p, size: st.size, mtime: st.mtimeMs });
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function listDefaultTasks() {
  const sqlite = lazySqlite();
  const db = new sqlite(FILES.sessionDb, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, 'session')) return [];
    const where = "WHERE s.directory = ? OR s.directory LIKE ? ESCAPE '\\'";
    const params = [DEFAULT_WS, likeEscape(DEFAULT_WS) + '\\%'];
    const msgMap = new Map(countMessagesBy(db, 's.id', where, params).map((r) => [r.k, r.n]));
    const rows = db.prepare(`
      SELECT s.id, s.title, CAST(s.time_created AS INTEGER) tc
      FROM session s
      ${where}
      ORDER BY s.time_created DESC
    `).all(...params);

    // 按任务聚合原始文本，再做一次性的路径提取
    const bySess = new Map();
    for (const t of TASK_DATA_TABLES) {
      if (!tableExists(db, t)) continue;
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
      if (!cols.includes('session_id')) continue;
      const col = ['data', 'content', 'text', 'payload'].find((c) => cols.includes(c));
      if (!col) continue;
      const hits = db.prepare(`SELECT session_id, ${col} AS data FROM ${t} WHERE ${col} LIKE ?`).all('%workspace%default%');
      for (const h of hits) {
        if (!bySess.has(h.session_id)) bySess.set(h.session_id, []);
        bySess.get(h.session_id).push(h.data);
      }
    }
    return rows.map((r) => {
      const fileList = collectTaskFiles(bySess.get(r.id) || []);
      return { id: r.id, title: r.title || '(未命名)', msgs: msgMap.get(r.id) || 0, files: fileList.length, fileList, tc: r.tc };
    });
  } finally { db.close(); }
}
function removeTask(taskId, log = logDefault) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(taskId || ''))) throw new Error('非法任务 ID');
  // 进程检测由 IPC 层统一把关
  const sqlite = lazySqlite();
  let msgs = 0;

  const tdb = new sqlite(FILES.tasksDb);
  try {
    if (tableExists(tdb, 'tasks')) tdb.prepare('DELETE FROM tasks WHERE task_id=?').run(taskId);
    if (tableExists(tdb, 'task_group_view_node_orders')) {
      tdb.prepare("DELETE FROM task_group_view_node_orders WHERE node_key LIKE ? ESCAPE '\\'").run(`%${likeEscape(jsonEscape(taskId))}%`);
    }
  } finally { tdb.close(); }

  const db = new sqlite(FILES.sessionDb);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const tx = db.transaction(() => {
      try { msgs = db.prepare('SELECT COUNT(*) c FROM message WHERE session_id=?').get(taskId).c; } catch {}
      for (const t of tables) {
        if (t === 'session') continue;
        const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
        for (const col of ['session_id', 'parent_session_id', 'child_session_id']) {
          if (cols.includes(col)) db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(taskId);
        }
      }
      db.prepare('DELETE FROM session WHERE id=?').run(taskId);
    });
    tx();
  } finally { db.close(); }

  let disk = 0;
  for (const d of ['agents', 'artifacts']) {
    const dir = path.join(ZCODE_DIR, 'cli', d, taskId);
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); disk++; }
  }
  const ro = path.join(ZCODE_DIR, 'cli', 'rollout', `model-io-${taskId}.jsonl`);
  if (fs.existsSync(ro)) { fs.rmSync(ro, { force: true }); disk++; }

  log(`🧹 任务 ${taskId.slice(0, 16)}… 已清除（${msgs} 条消息、${disk} 个关联目录/文件）`);
  return { msgs, disk };
}

module.exports = {
  ZCODE_DIR, FILES, DEFAULT_WS, INTERNAL_WS,
  envStatus, isZcodeRunning, killZcode,
  scanPaths, migrate, removeProject, listDefaultTasks, removeTask,
};
