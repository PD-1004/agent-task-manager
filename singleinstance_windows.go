//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const singleInstanceMutex = `Local\AgentTaskManager.SingleInstance`

// acquireSingleInstance 尝试创建命名互斥体；已存在说明程序正在运行，返回 false。
// 互斥体句柄随进程退出自动释放，无需显式清理。
func acquireSingleInstance() bool {
	name, err := windows.UTF16PtrFromString(singleInstanceMutex)
	if err != nil {
		return true // 名字异常时不拦截，避免无法启动
	}
	if _, err = windows.CreateMutex(nil, false, name); err != nil {
		return false // ERROR_ALREADY_EXISTS：已有实例在运行
	}
	return true
}

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procFindWindowW         = user32.NewProc("FindWindowW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
)

const swRestore = 9

// activateExisting 把已在运行的实例窗口还原并置前。
func activateExisting(title string) {
	t, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(t)))
	if hwnd == 0 {
		return
	}
	procShowWindow.Call(hwnd, swRestore)
	procSetForegroundWindow.Call(hwnd)
}
