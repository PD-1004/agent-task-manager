'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');

// 本应用为纯 DOM 界面（无视频/3D/WebGL），禁用 GPU 加速：
// 部分机器首次启动时 GPU 进程初始化 / 着色器编译极慢，甚至渲染进程直接崩溃
// （启动日志可见 RENDER-GONE exitCode=0x80000003），是"初次启动白屏"的主因。
app.disableHardwareAcceleration();

/* 更新提醒：改成你自己的 GitHub 仓库（owner/repo），如 changexbc/workbuddy-switch */
const UPDATE_REPO = 'PD-1004/agent-task-manager';
function gtVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execP = promisify(exec);
const core = require('./core');
const wb = require('./wb-core');

// 启动诊断日志（用于排查窗口不显示问题）
const SLOG = path.join(process.env.ZCODE_HOME || path.join(process.env.USERPROFILE || 'C:\\', '.zcode'), 'tmp', 'agent-startup.log');
function slog(t) {
  try { fs.appendFileSync(SLOG, new Date().toISOString().slice(11, 23) + ' ' + t + '\n'); } catch {}
}
process.on('uncaughtException', (e) => slog('UNCAUGHT: ' + e.message + '\n' + String(e.stack).slice(0, 400)));
process.on('unhandledRejection', (e) => slog('UNHANDLED_REJECTION: ' + String(e && e.message ? e.message + '\n' + String(e.stack).slice(0, 400) : e)));
slog('main.js loaded, argv=' + JSON.stringify(process.argv.slice(1)));

let win = null;
function sendLog(channel, line) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, line);
}
const zlog = (line) => sendLog('pd:log', line);
const wlog = (line) => sendLog('pd:wlog', line);

// 数据修改类操作的前置校验：宿主应用必须已退出
async function requireClosed(kind) {
  const r = kind === 'wb' ? { running: await wb.wbRunning() } : await core.isZcodeRunning();
  const name = kind === 'wb' ? 'WorkBuddy' : 'ZCode';
  if (r.running) throw new Error(`检测到 ${name} 正在运行！请先完全退出（托盘右键 → 退出），否则修改会被程序写回覆盖。`);
}

const TITLE = 'Agent 任务管理器 - 开发者公众号：掌心向暖RPA自动化';

function registerIpc() {
  slog('registerIpc: start');
  /* ---------- 环境 ---------- */
  ipcMain.handle('env:status', () => core.envStatus());
  ipcMain.handle('env:zcodeRunning', () => core.isZcodeRunning());
  ipcMain.handle('env:killZcode', async () => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['强制结束', '取消'], defaultId: 1, cancelId: 1,
      message: '强制结束 ZCode 进程？', detail: '正在运行中的会话可能丢失未保存的内容。确认继续？',
    });
    if (r.response !== 0) return { ok: false };
    return core.killZcode();
  });
  ipcMain.handle('wb:home', () => ({ home: wb.HOME, exists: fs.existsSync(wb.HOME) }));
  ipcMain.handle('wb:running', () => wb.wbRunning());
  ipcMain.handle('wb:kill', async () => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['强制结束', '取消'], defaultId: 1, cancelId: 1,
      message: '强制结束 WorkBuddy 进程？', detail: '正在运行中的会话可能丢失未保存的内容。确认继续？',
    });
    if (r.response !== 0) return { ok: false };
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('taskkill', ['/F', '/IM', 'WorkBuddy.exe', '/T'], { windowsHide: true }, (e1, o1) => {
        execFile('taskkill', ['/F', '/IM', 'CodeBuddy.exe', '/T'], { windowsHide: true }, (e2, o2) => {
          resolve({ ok: !e1 || !e2, output: String(o1 || '') + String(o2 || (e1 && e1.message) || (e2 && e2.message) || '') });
        });
      });
    });
  });
  ipcMain.handle('clip:write', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  ipcMain.handle('pick:directory', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('open:external', (_e, url) => {
    shell.openExternal(String(url || ''));
    return true;
  });
  ipcMain.handle('app:latest', async () => {
    if (!UPDATE_REPO || UPDATE_REPO.includes('YOUR_GITHUB_USER')) return null;
    try {
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { 'User-Agent': 'zcode-path-doctor', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const d = await res.json();
      const tag = String(d.tag_name || '').replace(/^v/, '');
      const cur = app.getVersion();
      return { update: !!tag && gtVer(tag, cur), latest: tag, current: cur, url: d.html_url || '', notes: d.body || '' };
    } catch { return null; }
  });

  slog('registerIpc: env done');

  /* ---------- ZCode 项目 ---------- */
  ipcMain.handle('scan', () => core.scanPaths());
  ipcMain.handle('migrate', async (_e, { oldPath, newPath }) => {
    await requireClosed('zcode');
    return core.migrate(oldPath, newPath, {}, zlog);
  });
  ipcMain.handle('project:remove', async (_e, { projectPath }) => {
    await requireClosed('zcode');
    return core.removeProject(projectPath, zlog);
  });

  /* ---------- ZCode 任务（默认会话区） ---------- */
  ipcMain.handle('zc:tasks', () => core.listDefaultTasks());
  ipcMain.handle('zc:task:remove', async (_e, { taskId }) => {
    await requireClosed('zcode');
    return core.removeTask(taskId, zlog);
  });

  /* ---------- WorkBuddy 空间（逻辑源自 wb-space-migrator） ---------- */
  ipcMain.handle('wb:scan', () => wb.findBroken());
  ipcMain.handle('wb:spaces', () => wb.listSpaces());
  ipcMain.handle('wb:uid', () => wb.currentUid());
  ipcMain.handle('wb:space:tasks', (_e, { spacePath }) => wb.listSpaceTasks(spacePath));
  ipcMain.handle('wb:space:files', (_e, { spacePath }) => wb.listSpaceFiles(spacePath));
  ipcMain.handle('wb:space:remove', async (_e, { spacePath }) => {
    await requireClosed('wb');
    return wb.removeSpace(spacePath, wlog);
  });
  ipcMain.handle('wb:space:removeBatch', async (_e, { spacePaths }) => {
    await requireClosed('wb');
    return wb.removeSpaces(spacePaths, wlog);
  });
  ipcMain.handle('wb:tasks', () => wb.listSessions());
  ipcMain.handle('wb:task:remove', async (_e, { sessionId }) => {
    await requireClosed('wb');
    return wb.removeSession(sessionId, wlog);
  });
  ipcMain.handle('wb:task:files', (_e, { sessionId }) => wb.listSessionFiles(sessionId));
  ipcMain.handle('wb:preview', async (_e, { oldPath, newPath }) => {
    return wb.migrate(oldPath, newPath, { dryRun: true, log: wlog });
  });
  ipcMain.handle('wb:migrate', async (_e, { oldPath, newPath }) => {
    await requireClosed('wb');
    return wb.migrate(oldPath, newPath, { log: wlog });
  });
  slog('registerIpc: all handlers registered');
}

function createWindow() {
  // 图标：打包版 exe 图标已内嵌，跳过 asar 内图标（原生窗口无法从 asar 读取，会导致创建失败）
  const iconFile = path.join(__dirname, 'app.ico');
  const canUseIcon = fs.existsSync(iconFile) && !__dirname.includes('app.asar');
  try {
    win = new BrowserWindow({
      width: 1180, height: 820, minWidth: 980, minHeight: 680,
      title: TITLE,
      autoHideMenuBar: true,
      backgroundColor: '#eef2f8',
      show: false, // 内容就绪后再显示，避免冷启动时页面加载数秒、用户盯着空白窗口
      icon: canUseIcon ? iconFile : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  } catch (e) {
    slog('BrowserWindow 创建失败: ' + e.message);
    throw e;
  }
  slog('BrowserWindow created, icon=' + (canUseIcon ? 'app.ico' : 'exe-embedded'));
  const showWin = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); slog('show() called'); }
  };
  win.once('ready-to-show', () => { slog('ready-to-show fired'); showWin(); });
  // 兜底：个别环境 ready-to-show 可能不触发，4 秒后无论如何显示窗口（backgroundColor 与主题一致）
  setTimeout(showWin, 4000);
  win.webContents.on('did-fail-load', (_e, code, desc) => slog('did-fail-load: ' + code + ' ' + desc));
  win.webContents.on('render-process-gone', (_e, details) => slog('RENDER-GONE: ' + details.reason + ' exitCode=' + details.exitCode));
  win.webContents.on('preload-error', (_e, p, err) => slog('preload-error: ' + String(err).slice(0, 150)));
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) slog('renderer error: ' + String(message).slice(0, 200)); });
  win.loadFile('index.html').then(() => slog('loadFile resolved')).catch((e) => slog('loadFile rejected: ' + e.message));
}

/* ---------- 自测模式（无窗口，供打包后验证） ---------- */
if (process.argv.includes('--selftest')) {
  app.whenReady().then(async () => {
    const out = { ok: false, zcode: null, wb: null };
    try {
      out.zcode = core.scanPaths();
      const wbRes = wb.findBroken();
      out.wb = { broken: wbRes.items.length, current: wbRes.items.filter((i) => i.isCurrent).length };
      out.ok = true;
    } catch (e) { out.error = e.message; }
    const outPath = path.join(process.env.PORTABLE_EXECUTABLE_DIR || __dirname, 'selftest-result.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log('selftest ->', outPath, 'ok =', out.ok);
    app.exit(out.ok ? 0 : 1);
  });
} else {
  app.whenReady().then(() => {
    slog('whenReady -> registerIpc + createWindow');
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => app.quit());
