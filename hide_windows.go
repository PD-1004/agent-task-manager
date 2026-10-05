//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hiddenCmd：Windows GUI 程序启动控制台子进程（tasklist/taskkill）时会弹出黑框，
// 这里隐藏子窗口，避免调用进程检测时闪出控制台窗口。
func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}
