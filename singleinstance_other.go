//go:build !windows

package main

// 非 Windows 平台暂不启用单实例限制
func acquireSingleInstance() bool { return true }

func activateExisting(string) {}
