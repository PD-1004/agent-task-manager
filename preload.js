'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  envStatus: () => ipcRenderer.invoke('env:status'),
  zcodeRunning: () => ipcRenderer.invoke('env:zcodeRunning'),
  killZcode: () => ipcRenderer.invoke('env:killZcode'),
  copyText: (text) => ipcRenderer.invoke('clip:write', text),
  pickDirectory: () => ipcRenderer.invoke('pick:directory'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  checkUpdate: () => ipcRenderer.invoke('app:latest'),

  // ZCode 项目
  scan: () => ipcRenderer.invoke('scan'),
  migrate: (oldPath, newPath) => ipcRenderer.invoke('migrate', { oldPath, newPath }),
  removeProject: (projectPath) => ipcRenderer.invoke('project:remove', { projectPath }),
  zcProjectTasks: (projectPath) => ipcRenderer.invoke('zc:project:tasks', { projectPath }),
  zcProjectFiles: (projectPath) => ipcRenderer.invoke('zc:project:files', { projectPath }),
  onLog: (cb) => ipcRenderer.on('pd:log', (_e, line) => cb(line)),

  // ZCode 任务（默认会话区）
  zcTasks: () => ipcRenderer.invoke('zc:tasks'),
  zcTaskRemove: (taskId) => ipcRenderer.invoke('zc:task:remove', { taskId }),

  // WorkBuddy 空间 / 任务（逻辑源自 wb-space-migrator）
  wbRunning: () => ipcRenderer.invoke('wb:running'),
  wbHome: () => ipcRenderer.invoke('wb:home'),
  wbKill: () => ipcRenderer.invoke('wb:kill'),
  wbScan: () => ipcRenderer.invoke('wb:scan'),
  wbSpaces: () => ipcRenderer.invoke('wb:spaces'),
  wbUid: () => ipcRenderer.invoke('wb:uid'),
  wbSpaceTasks: (spacePath) => ipcRenderer.invoke('wb:space:tasks', { spacePath }),
  wbSpaceFiles: (spacePath) => ipcRenderer.invoke('wb:space:files', { spacePath }),
  wbSpaceRemove: (spacePath) => ipcRenderer.invoke('wb:space:remove', { spacePath }),
  wbSpaceRemoveBatch: (spacePaths) => ipcRenderer.invoke('wb:space:removeBatch', { spacePaths }),
  wbTasks: () => ipcRenderer.invoke('wb:tasks'),
  wbTaskRemove: (sessionId) => ipcRenderer.invoke('wb:task:remove', { sessionId }),
  wbTaskFiles: (sessionId) => ipcRenderer.invoke('wb:task:files', { sessionId }),
  wbPreview: (oldPath, newPath) => ipcRenderer.invoke('wb:preview', { oldPath, newPath }),
  wbMigrate: (oldPath, newPath) => ipcRenderer.invoke('wb:migrate', { oldPath, newPath }),
  onWbLog: (cb) => ipcRenderer.on('pd:wlog', (_e, line) => cb(line)),
});
