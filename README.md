# Agent任务管理器

项目搬家 · 历史不丢。把项目文件夹从 A 挪到 B 后，ZCode / WorkBuddy 常出现：左侧项目打不开、老任务调不了技能、新路径下任务历史"消失"。本工具基于对 ZCode 存储结构（设置 / 任务索引 / 会话库三层绑定）的完整逆向，**一键把三处存储里的旧路径绑定全部改到新路径**，并附带任务历史与空间的管理能力。

## 快速开始

前往 [Releases](https://github.com/PD-1004/agent-task-manager/releases/latest) 下载最新便携版：

| 文件 | 说明 |
|---|---|
| `AgentTaskManager-Portable-x.x.x.exe` | Windows 10/11 x64 · 单文件 · 免安装，下载后双击即用 |

## 功能

| 功能 | 说明 |
|---|---|
| 📋 任务管理 | 按名称实时搜索（空格分隔多关键词）、全选 / 多选批量删除；双击任务查看改动过的文件清单，一键复制完整路径 |
| 🗂️ 空间管理 | 列出 WorkBuddy 当前账号打开过的所有空间，识别失效空间；支持整体迁移、批量移除、自定义显示名识别，账号切换自动刷新 |
| 🔍 诊断扫描 | 列出 ZCode 记录的所有项目路径，标记失效项，可直接填入迁移或移除项目 |
| 🚪 双产品入口 | 启动时选择管理 ZCode 还是 WorkBuddy，两个入口能力一致 |

> ⚠️ 批量删除均为彻底删除（含聊天记录），不可恢复；执行前请完全退出对应客户端。

## 界面预览

### 启动选择产品

![启动选择产品](docs/img/01-select.png)

### ZCode 任务管理

![ZCode任务管理](docs/img/02-zcode-tasks.png)

### WorkBuddy 空间管理

![WorkBuddy空间管理](docs/img/03-wb-spaces.png)

## 使用说明

支持 **ZCode** 与 **WorkBuddy** 双产品入口，启动时选择即可，两个入口能力一致。完整功能说明（含迁移规则、显示名机制、统计口径）见 [使用说明.md](./使用说明.md)。

## 从源码构建

```bash
npm install
npx electron-builder install-app-deps   # 为 Electron 重编译 better-sqlite3
npm run dist                            # 输出便携版 exe 到 release/
```

## 许可

[MIT](https://opensource.org/licenses/MIT)
