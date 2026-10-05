# Agent任务管理器（源码）

当前版本的源码目录。项目介绍、功能说明与使用文档见仓库根目录的 [README.md](https://github.com/PD-1004/agent-task-manager#readme)。

## 构建

需要 Go 1.20+ 与 Wails CLI v2：

```bash
wails build -platform windows/amd64   # 输出到 build/bin/
```

## 目录说明

| 文件 | 职责 |
|---|---|
| `main.go` | 程序入口、窗口与绑定注册 |
| `app.go` | 系统托盘、环境状态、ZCode 路径扫描 |
| `core.go` | ZCode：任务清单、项目任务与文件、路径迁移、移除 |
| `wbcore.go` | WorkBuddy：会话、空间、路径迁移、移除 |
| `hide_windows.go` / `hide_other.go` | 调用 `tasklist` / `taskkill` 时隐藏子进程窗口 |
| `frontend/dist/` | 前端静态资源，由 Wails 直接 embed，改动后需重新构建 |

## 注意

修改 ZCode 或 WorkBuddy 的数据前，请先完全退出对应客户端，否则改动可能被客户端写回覆盖。
