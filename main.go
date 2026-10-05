package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

const appTitle = "Agent 任务管理器"

func main() {
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
		// 关闭窗口时隐藏到系统托盘，而不是退出
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			runtime.WindowHide(ctx)
			return true
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
