# 项目资料目录

## 给使用者

- [软件介绍与怎么使用](../README.md)
- [常见问题](FAQ.md)
- [最新版下载](https://github.com/PD-1004/agent-task-manager/releases/latest)
- [反馈问题](https://github.com/PD-1004/agent-task-manager/issues)

## 给参与维护的人

- [参与约定](../CONTRIBUTING.md)
- [图标与打包资料](../build/README.md)

## 文件放置约定

```text
agent-task-manager/
├── README.md              软件介绍与基本操作
├── CONTRIBUTING.md        参与和维护约定
├── LICENSE                使用许可
├── .gitignore             不上传哪些本地文件
├── .github/               问题反馈与改动说明模板
├── docs/                  使用者能查阅的说明
│   ├── README.md           本目录索引
│   ├── FAQ.md              常见问题
│   └── img/                文档配图和界面截图
├── build/                 程序图标和打包资料
├── frontend/              软件界面文件
├── *.go                   功能代码及检查代码
├── go.mod、go.sum         软件依赖清单
└── wails.json             应用配置
```

补充说明放在 `docs/`，说明中的图片放在 `docs/img/`；程序图标放在 `build/`。下载用的程序放到 GitHub 发布页，本地生成的程序放在 `build/bin/`。

私人聊天、账号信息、数据库副本和备份留在本地。自动生成的文件不要混入项目说明目录。

当前功能文件保留在原位置，避免只为目录好看而影响软件。`frontend/dist/` 是正在使用的界面，需要保留；其他界面目录中的文件，如需整理，应另行核对使用情况。
