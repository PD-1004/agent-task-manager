/* Wails 适配层
   renderer.js 通过 window.api 调用后端，这里把同名接口映射到 Wails 绑定的 Go 方法，
   renderer.js 无需改动即可继续复用。 */
(function () {
  function app() { return window.go.main.App; }

  // 事件订阅：Go 侧通过 EventsEmit('pd:log', line) 推送日志
  function onLog(cb) {
    try {
      if (window.runtime && window.runtime.EventsOn) {
        return window.runtime.EventsOn('pd:log', cb);
      }
    } catch (e) { /* 运行时不可用则忽略 */ }
    return function () {};
  }

  window.api = {
    /* ---------- ZCode ---------- */
    envStatus: function () { return app().EnvStatus(); },
    zcodeRunning: function () { return app().IsZcodeRunning(); },
    killZcode: function () { return app().KillZcode(); },

    scan: function () { return app().ScanPaths(); },
    migrate: function (oldPath, newPath) { return app().MigratePaths(oldPath, newPath); },
    removeProject: function (projectPath) { return app().RemoveProject(projectPath); },

    zcTasks: function () { return app().ListDefaultTasks(); },
    zcTaskRemove: function (taskId) { return app().RemoveTask(taskId); },
    zcProjectTasks: function (projectPath) { return app().ListProjectTasks(projectPath); },
    zcProjectFiles: function (projectPath) { return app().ListProjectFiles(projectPath); },

    /* ---------- WorkBuddy ---------- */
    wbHome: function () { return app().WbHome(); },
    wbUid: function () { return app().WbUid(); },
    wbRunning: function () { return app().WbRunning(); },
    wbKill: function () { return app().WbKill(); },

    wbSpaces: function () { return app().WbSpaces(); },
    wbSpaceTasks: function (spacePath) { return app().WbSpaceTasks(spacePath); },
    wbSpaceFiles: function (spacePath) { return app().WbSpaceFiles(spacePath); },
    wbSpaceRemove: function (spacePath) { return app().WbSpaceRemove(spacePath); },
    wbSpaceRemoveBatch: function (spacePaths) { return app().WbSpaceRemoveBatch(spacePaths); },
    wbMigrate: function (oldPath, newPath) { return app().WbMigrate(oldPath, newPath); },

    wbTasks: function () { return app().WbSessions(); },
    wbTaskRemove: function (sessionId) { return app().WbTaskRemove(sessionId); },
    wbTaskFiles: function (sessionId) { return app().WbSessionFiles(sessionId); },

    /* ---------- 通用 ---------- */
    pickDirectory: function () { return app().PickDirectory(); },
    copyText: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return Promise.resolve();
    },
    openExternal: function (url) {
      try { return app().OpenExternal(url).then(function () {}); } catch (e) {}
      window.open(url, '_blank');
      return Promise.resolve();
    },
    checkUpdate: function () { return app().CheckUpdate(); },
    onLog: onLog,
  };
})();
