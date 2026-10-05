package main

import (
	"database/sql"
	"testing"
	"time"
)

func TestTiming(t *testing.T) {
	db, err := openRO(zcodeFiles()["sessionDb"])
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	count := func(q string, args ...any) int64 {
		t0 := time.Now()
		var c int64
		db.QueryRow(q, args...).Scan(&c)
		t.Logf("%.1fs  %s -> %d", time.Since(t0).Seconds(), q, c)
		return c
	}

	count("SELECT COUNT(*) FROM session")
	pat := subPattern(defaultWs())
	count("SELECT COUNT(*) FROM session WHERE directory=? OR directory LIKE ? ESCAPE '\\'", defaultWs(), pat)
	count("SELECT COUNT(*) FROM message")

	t0 := time.Now()
	var n int64
	var sum sql.NullInt64
	db.QueryRow("SELECT COUNT(*), SUM(LENGTH(data)) FROM message WHERE data LIKE '%workspace%default%'").Scan(&n, &sum)
	t.Logf("%.1fs  含默认工作区文本的 message 行: %d 行, 总长度 %.1f MB",
		time.Since(t0).Seconds(), n, float64(sum.Int64)/1048576)
}
