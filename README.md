# Agent任务管理器

> ZCode / WorkBuddy 项目路径一键诊断与迁移、任务历史管理 —— Windows 桌面工具（Electron）

<p align="center">
  <img src="assets/logo.png" width="140" alt="Agent任务管理器">
</p>

## 这是什么

把项目文件夹从 A 挪到 B 之后，ZCode / WorkBuddy 常常出现：左侧项目打不开、老任务调不了技能、新路径下任务历史"消失"。本工具基于对 ZCode 存储结构（设置 / 任务索引 / 会话库三层绑定）的完整逆向，**一键把三处存储里的旧路径绑定全部改到新路径**，并附带任务历史的管理能力。

## 功能特性

- **📋 任务管理**：按名称实时搜索、全选 / 多选批量删除、查看任务改动过的文件清单并一键复制路径
- **🗂️ 空间管理**（WorkBuddy）：列出当前账号打开过的空间，支持整体迁移、批量移除、自定义显示名识别，账号切换自动刷新
- **🔍 诊断扫描**：列出 ZCode 记录的所有项目路径，标记失效项，可直接填入迁移或移除

支持 **ZCode** 与 **WorkBuddy** 双产品入口，启动时选择即可，两个入口能力一致。

> ⚠️ 批量删除均为彻底删除（含聊天记录），不可恢复；执行前请先完全退出对应客户端。

## 下载使用

前往 [Releases](https://github.com/PD-1004/agent-task-manager/releases) 下载 `Agent任务管理器-便携版-x.x.x.exe`：

- 便携版为单文件，**免安装**，双击即用
- 详细功能说明见 [使用说明.md](./使用说明.md)

## 从源码构建

```bash
npm install
npx electron-builder install-app-deps   # 为 Electron 重编译 better-sqlite3
npm run dist                            # 输出便携版 exe 到 release/
```
## License

[MIT](https://opensource.org/licenses/MIT)
