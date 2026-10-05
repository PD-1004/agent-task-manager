package main

import (
	"context"
	"embed"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

const appTitle = "Agent 任务管理器"

func main() {
	// 单实例：已有实例在运行时，把它拉到前台然后退出本次启动
	if !acquireSingleInstance() {
		activateExisting(appTitle)
		return
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:     appTitle,
		Width:     1180,
		Height:    820,
		MinWidth:  980,
		MinHeight: 680,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// 与界面主题底色一致，避免冷启动时闪白
		BackgroundColour: &options.RGBA{R: 0xee, G: 0xf2, B: 0xf8, A: 1},
		OnStartup:        app.startup,
		// 点关闭窗口 → 隐藏到托盘；托盘「退出」→ 放行真正退出
		OnBeforeClose: app.beforeClose,
		OnShutdown: func(ctx context.Context) {
			systray.Quit() // 进程退出前清掉托盘图标
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
