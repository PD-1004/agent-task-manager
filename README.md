# Agent 任务管理器

管理本机 AI 编程工具（ZCode、WorkBuddy / CodeBuddy）的任务、项目与会话数据：查看清单、诊断失效路径、迁移数据目录、批量清理。Windows 桌面应用，单个 exe 直接运行。

## 功能

### ZCode

- **任务清单**：查看默认会话区与项目区的任务，含消息数、文件数、最早使用时间
- **项目清单**：诊断扫描项目路径是否仍然有效，失效项目可迁移或移除
- 支持路径迁移与批量移除

### WorkBuddy / CodeBuddy

- **任务清单**：当前账号的本地任务，已标记删除的任务会高亮显示
- **空间清单**：空间与会话统计，支持迁移、移除、批量移除
- 进程状态检测与强制结束

> 操作前请先退出对应的 AI 编程工具，避免数据文件被占用导致写入失败。

## 构建

需要 Go 1.20+ 与 Wails CLI v2：

```bash
wails build -platform windows/amd64   # 产物输出到 build/bin/
```

## 目录说明

| 文件 | 职责 |
|---|---|
| `main.go` | 程序入口、窗口与绑定注册 |
| `app.go` | 系统托盘、环境状态、ZCode 路径扫描 |
| `core.go` | ZCode：任务清单、项目任务与文件、路径迁移、移除 |
| `wbcore.go` | WorkBuddy：会话、空间、路径迁移、移除 |
| `hide_windows.go` / `hide_other.go` | 隐藏子进程控制台窗口（按平台 build tag 拆分） |
| `frontend/dist/` | 前端源码（HTML / JS / CSS），是源码而非构建产物 |

## 许可证

[MIT](LICENSE)
