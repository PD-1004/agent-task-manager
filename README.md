<p align="center">
  <img src="build/appicon.png" width="96" alt="Agent 任务管理器图标" />
</p>

# Agent 任务管理器

帮 ZCode 和 WorkBuddy 用户整理任务，修复项目搬家后的文件夹位置。

[![最新版本](https://img.shields.io/github/v/release/PD-1004/agent-task-manager?label=最新版本)](https://github.com/PD-1004/agent-task-manager/releases/latest)
[![适用系统](https://img.shields.io/badge/系统-Windows%2010%20%2F%2011-blue)](#下载与打开)
[![MIT 许可](https://img.shields.io/badge/许可-MIT-green)](LICENSE)

**[下载最新版](https://github.com/PD-1004/agent-task-manager/releases/latest)** · [怎么使用](#怎么使用) · [常见问题](docs/FAQ.md) · [反馈问题](https://github.com/PD-1004/agent-task-manager/issues)

## 它能帮你做什么

把项目文件夹换了位置或名字，原来的任务和聊天却还指向旧文件夹？这个工具可以帮你更新软件记住的位置。

| 你遇到的情况 | 可以怎么处理 |
| --- | --- |
| 文件夹搬家后，项目打不开 | 找到旧项目，点击「迁移」，填入新位置 |
| 新位置的项目里看不到原任务 | 检查任务是否仍在旧位置，再迁移过去 |
| 任务太多，找起来费劲 | 按关键词搜索，查看或清理任务 |
| 想知道某个任务涉及哪些文件 | 双击任务名称，查看可找到的文件记录 |
| WorkBuddy 的空间搬走了 | 在「空间」页查看状态、任务和新旧位置 |

适用于 **Windows 10 / 11，64 位系统**。它是独立的辅助工具，不是 ZCode 或 WorkBuddy 官方客户端。

当前已有可下载版本，项目正在维护。版本更新和已知问题可查看[发布记录](https://github.com/PD-1004/agent-task-manager/releases)与[反馈区](https://github.com/PD-1004/agent-task-manager/issues)。

## 下载与打开

1. 打开 **[最新版下载页](https://github.com/PD-1004/agent-task-manager/releases/latest)**。
2. 找到页面下方的 **Assets**，下载名字为 `AgentTaskManager-版本号.exe` 的文件。
3. 双击下载的文件，选择 **ZCode** 或 **WorkBuddy**。

日常使用下载 `.exe` 即可。页面上的 `Source code` 是项目文件，无需下载。

## 怎么使用

### 1. 项目搬家后，找回原任务

以 ZCode 为例：

1. 保存工作，**从右下角托盘完全退出 ZCode**。
2. 备份 ZCode 本地数据。管理器不会自动替你创建备份，备份位置见[常见问题](docs/FAQ.md#怎么备份)。
3. 把项目文件夹移动到新位置；如果已经搬好了，就直接进行下一步。
4. 打开管理器，选择 **ZCode → 项目**，找到仍指向旧位置的那一项。
5. 点击 **迁移**，填入已经存在的新文件夹位置，点击 **开始迁移**。
6. 完成后重新打开 ZCode，检查原任务和聊天记录。

例如，文件夹从 `D:\我的项目` 搬到 `E:\我的项目`，就把旧位置迁移到新位置。

这里的「迁移」是更新软件记住的位置。请先把本地文件夹搬好。

### 2. 查找和整理任务

- 打开 **任务** 页，在搜索框输入关键词；多个关键词用空格分开。
- 双击任务名称，查看能找到的文件记录。
- 勾选需要清理的任务，再点击清除。全选只针对当前搜索结果。
- ZCode 的「任务」页主要显示没有打开具体项目时产生的任务。具体项目中的任务，到 **项目** 页双击项目名称查看。

**清除任务会删除相关聊天记录，不能直接撤销。** 不确定的任务，先保留。

### 3. 管理 WorkBuddy 空间

1. 选择 **WorkBuddy → 空间**，查看它记住的文件夹位置。
2. 双击空间名称，查看其中的任务；双击文件数，查看文件清单。
3. 文件夹搬家后，先保存工作、备份数据并完全退出 WorkBuddy，再点击 **迁移**，填写新位置。
4. 迁移完成后重新打开 WorkBuddy 检查结果。

WorkBuddy 的任务列表会跟随当前账号切换，无需重新启动管理器。

## 界面预览

以下截图用于说明界面，个别图标或文字可能与最新版略有不同。

### 选择要管理的软件

![选择 ZCode 或 WorkBuddy](docs/img/01-select.png)

### 查看 ZCode 任务

![ZCode 任务列表](docs/img/02-zcode-tasks.png)

### 管理 WorkBuddy 空间

![WorkBuddy 空间列表](docs/img/03-wb-spaces.png)

## 操作前记住这几件事

- **迁移、清理前先备份，并完全退出对应客户端。** 关闭窗口可能只是缩到托盘。
- **看不到任务，不代表任务已被删除。** 先检查旧位置，别急着点击「移除」。
- **文件列表为空，不代表本地文件丢了。** 搬家前的聊天可能仍写着旧位置，请到新文件夹检查。
- 迁移失败时，先保留错误提示和备份，再[反馈问题](https://github.com/PD-1004/agent-task-manager/issues)。

## 项目资料放在哪里

| 位置 | 放什么 |
| --- | --- |
| [README.md](README.md) | 软件介绍、下载入口和基本操作 |
| [docs/](docs/README.md) | 常见问题、目录说明和界面截图 |
| [build/](build/README.md) | 程序图标和打包所需资料 |
| `frontend/` | 软件界面文件 |
| 根目录的 `.go` 文件 | 软件功能代码 |
| [.github/](.github/) | 反馈问题和提交改动时使用的模板 |

## 反馈与参与

维护者：[PD-1004](https://github.com/PD-1004)。

遇到问题，请到 [Issues](https://github.com/PD-1004/agent-task-manager/issues) 留下软件版本、操作步骤和错误截图。提交前请遮住姓名、私人路径、聊天内容和账号信息。

想帮忙改进介绍、翻译或代码，可以先看[参与约定](CONTRIBUTING.md)。

## 许可

本项目使用 [MIT 许可](LICENSE)，允许在遵守许可的前提下使用、修改和分享。
