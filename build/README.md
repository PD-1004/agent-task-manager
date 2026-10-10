# 程序图标与打包资料

这个目录存放程序图标，以及生成 Windows 应用时需要的资料。

| 位置 | 用途 |
| --- | --- |
| `appicon.png` | 原始应用图标 |
| `tray.ico` | 右下角系统托盘图标 |
| `windows/icon.ico` | Windows 程序文件和窗口使用的图标 |
| `windows/info.json` | Windows 文件属性中的名称与版本资料 |
| `windows/wails.exe.manifest` | Windows 运行所需的配置 |
| `windows/installer/` | 安装程序所需的资料 |
| `darwin/` | 保留的 macOS 配置，当前下载版面向 Windows |
| `bin/` | 本地生成的程序，不提交到仓库 |

更换应用图标时，应同步托盘和 Windows 图标，以及 `frontend/dist/assets/logo.png` 中的界面标识。保留透明背景，并检查小尺寸图标是否清晰。

本目录中的图标与配置需要保留。下载用的程序放到 GitHub 发布页。
