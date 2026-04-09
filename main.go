package main

import (
	"embed"
	goRuntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	width := 1120
	height := 760
	minWidth := 980
	minHeight := 640
	if goRuntime.GOOS == "windows" {
		width = 1240
		height = 820
		minWidth = 1024
		minHeight = 680
	}

	err := wails.Run(&options.App{
		Title:     "Kitty",
		Width:     width,
		Height:    height,
		Frameless: false,
		MinWidth:  minWidth,
		MinHeight: minHeight,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 11, G: 11, B: 15, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  false,
			Theme:                windows.Dark,
			ResizeDebounceMS:     16,
		},
		Mac: &mac.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			TitleBar:             mac.TitleBarHiddenInset(),
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
