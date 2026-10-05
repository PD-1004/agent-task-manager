package main

import (
	"encoding/json"
	"testing"
)

func TestScanPaths(t *testing.T) {
	app := &App{}
	res, err := app.ScanPaths()
	if err != nil {
		t.Fatalf("ScanPaths 出错: %v", err)
	}
	b, _ := json.MarshalIndent(res, "", "  ")
	if len(res.Paths) == 0 {
		t.Logf("未扫描到项目路径（本机可能没有 .zcode 数据）")
	}
	t.Logf("paths=%d stale=%d excluded=%d\n%s", len(res.Paths), res.StaleCount, res.Excluded, string(b))
}
