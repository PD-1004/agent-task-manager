//go:build !windows

package main

import "os/exec"

// 非 Windows 平台无需隐藏控制台窗口
func hiddenCmd(name string, args ...string) *exec.Cmd {
	return exec.Command(name, args...)
}
