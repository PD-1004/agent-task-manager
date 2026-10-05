package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	_ "modernc.org/sqlite"
)

// 托盘需要真正的 ICO（含 16/32/48/256 多尺寸），PNG 会显示空白
//go:embed build/tray.ico
var trayIcon []byte

/* ---------- 数据结构（字段名与前端 renderer.js 一致） ---------- */

type Refs struct {
	Setting     int `json:"setting"`
	Tasks       int `json:"tasks"`
	Sessions    int `json:"sessions"`
	Messages    int `json:"messages"`
	LastSession int `json:"lastSession"`
}

type PathEntry struct {
	Path         string `json:"path"`
	Exists       bool   `json:"exists"`
	FirstSeen    int64  `json:"firstSeen"`
	FirstSeenStr string `json:"firstSeenStr"`
	Refs         Refs   `json:"refs"`
}

type ScanResult struct {
	ScannedAt  string      `json:"scannedAt"`
	Paths      []PathEntry `json:"paths"`
	StaleCount int         `json:"staleCount"`
	Excluded   int         `json:"excluded"`
}

/* ---------- App ---------- */

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go systray.Run(a.onTrayReady, func() {})
}


/* ---------- 系统托盘 ---------- */

func (a *App) onTrayReady() {
	systray.SetIcon(trayIcon)
	systray.SetTitle("Agent 任务管理器")
	systray.SetTooltip("Agent 任务管理器")

	mShow := systray.AddMenuItem("显示窗口", "显示主窗口")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "退出程序")

	go func() {
		for {
			select {
			case <-mShow.ClickedCh:
				if a.ctx != nil {
					runtime.WindowUnminimise(a.ctx)
					runtime.WindowShow(a.ctx)
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				if a.ctx != nil {
					runtime.Quit(a.ctx)
				}
				return
			}
		}
	}()
}

/* ---------- 路径工具 ---------- */

func zcodeDir() string {
	if v := os.Getenv("ZCODE_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".zcode"
	}
	return filepath.Join(home, ".zcode")
}

// normKey：去掉尾部斜杠并转小写，作为路径唯一键
func normKey(p string) string {
	return strings.ToLower(strings.TrimRight(p, "\\/"))
}

func fmtDate(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).Format("2006/1/2")
}

/* ---------- SQLite ---------- */

func openRO(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro&cache=shared")
	if err != nil {
		return nil, err
	}
	if err = db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func tableExists(db *sql.DB, name string) bool {
	var n string
	err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&n)
	return err == nil
}

// roleExpr：不同版本的 message 表结构不同，优先用 json_extract，否则退化为 LIKE 判断
func roleExpr(db *sql.DB) string {
	var r sql.NullString
	if err := db.QueryRow("SELECT json_extract('{\"role\":\"user\"}','$.role')").Scan(&r); err == nil && r.Valid && r.String == "user" {
		return "json_extract(m.data, '$.role')"
	}
	return "(CASE WHEN m.data LIKE '%\"role\":\"user\"%' THEN 'user'" +
		" WHEN m.data LIKE '%\"role\":\"assistant\"%' THEN 'assistant' ELSE NULL END)"
}

func scanInt(rows *sql.Rows, dest *int) bool {
	var v sql.NullInt64
	if err := rows.Scan(&v); err != nil {
		return false
	}
	if v.Valid {
		*dest = int(v.Int64)
	}
	return true
}

/* ---------- 诊断扫描 ---------- */

func (a *App) ScanPaths() (ScanResult, error) {
	base := zcodeDir()
	settingFile := filepath.Join(base, "v2", "setting.json")
	tasksDbFile := filepath.Join(base, "v2", "tasks-index.sqlite")
	sessionDbFile := filepath.Join(base, "cli", "db", "db.sqlite")
	internalWs := normKey(filepath.Join(base, "workspace"))

	excluded := 0

	entries := map[string]*PathEntry{}
	get := func(raw string) *PathEntry {
		if raw == "" {
			return nil
		}
		return entries[normKey(raw)]
	}
	touch2 := func(raw string) *PathEntry {
		if raw == "" || len(raw) < 2 {
			return nil
		}
		if k := normKey(raw); k == internalWs || strings.HasPrefix(k, internalWs+"\\") {
			excluded++
			return nil
		}
		k := normKey(raw)
		if e, ok := entries[k]; ok {
			return e
		}
		e := &PathEntry{Path: raw}
		entries[k] = e
		return e
	}
	seen := func(e *PathEntry, ms int64) {
		if e != nil && ms > 0 && (e.FirstSeen == 0 || ms < e.FirstSeen) {
			e.FirstSeen = ms
		}
	}

	// 1) setting.json
	if b, err := os.ReadFile(settingFile); err == nil {
		var s struct {
			RecentProjects        []string `json:"recentProjects"`
			LastWorkspaceSession  []struct {
				WorkspacePath    string `json:"workspacePath"`
				WorkspacePurpose string `json:"workspacePurpose"`
			} `json:"lastWorkspaceSession"`
		}
		if err := json.Unmarshal(b, &s); err == nil {
			for _, p := range s.RecentProjects {
				if e := touch2(p); e != nil {
					e.Refs.Setting++
				}
			}
			for _, w := range s.LastWorkspaceSession {
				if e := touch2(w.WorkspacePath); e != nil && w.WorkspacePurpose == "project" {
					e.Refs.LastSession++
				}
			}
		}
	}

	// 2) tasks-index.sqlite
	if db, err := openRO(tasksDbFile); err == nil {
		if tableExists(db, "tasks") {
			rows, err := db.Query(`SELECT workspace_path p, COUNT(*) n, MIN(CAST(created_at AS INTEGER)) m FROM tasks GROUP BY workspace_path`)
			if err == nil {
				for rows.Next() {
					var p string
					var n, m sql.NullInt64
					if err := rows.Scan(&p, &n, &m); err != nil {
						continue
					}
					if e := touch2(p); e != nil {
						e.Refs.Tasks += int(n.Int64)
						if m.Valid {
							seen(e, m.Int64)
						}
					}
				}
				rows.Close()
			}
		}
		db.Close()
	}

	// 3) 会话库 db.sqlite
	if db, err := openRO(sessionDbFile); err == nil {
		if tableExists(db, "session") {
			rows, err := db.Query(`SELECT directory p, COUNT(*) n, MIN(CAST(time_created AS INTEGER)) m FROM session GROUP BY directory`)
			if err == nil {
				for rows.Next() {
					var p string
					var n, m sql.NullInt64
					if err := rows.Scan(&p, &n, &m); err != nil {
						continue
					}
					if e := touch2(p); e != nil {
						e.Refs.Sessions += int(n.Int64)
						if m.Valid {
							seen(e, m.Int64)
						}
					}
				}
				rows.Close()
			}

			// 消息数：同一轮 AI 回答拆出的多条 assistant 记录合并计 1
			if tableExists(db, "message") {
				role := roleExpr(db)
				q := `WITH r AS (
					SELECT s.directory k, ` + role + ` role,
					       LAG(` + role + `) OVER (
					         PARTITION BY s.id ORDER BY CAST(m.time_created AS INTEGER), CAST(m.sequence AS INTEGER)
					       ) prev
					FROM session s JOIN message m ON m.session_id = s.id
				      )
				      SELECT k k, SUM(CASE WHEN role <> 'assistant' THEN 1
				                           WHEN prev IS NULL OR prev <> 'assistant' THEN 1
				                           ELSE 0 END) n
				      FROM r GROUP BY k`
				rows, err := db.Query(q)
				if err == nil {
					for rows.Next() {
						var k sql.NullString
						var n sql.NullInt64
						if err := rows.Scan(&k, &n); err != nil {
							continue
						}
						if e := get(k.String); e != nil {
							e.Refs.Messages += int(n.Int64)
						}
					}
					rows.Close()
				}
			}
		}
		db.Close()
	}

	list := make([]PathEntry, 0, len(entries))
	stale := 0
	for _, e := range entries {
		if _, err := os.Stat(e.Path); err == nil {
			e.Exists = true
		} else {
			stale++
		}
		e.FirstSeenStr = fmtDate(e.FirstSeen)
		list = append(list, *e)
	}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Exists != b.Exists {
			return a.Exists
		}
		return (a.Refs.Tasks + a.Refs.Sessions) > (b.Refs.Tasks + b.Refs.Sessions)
	})

	return ScanResult{
		ScannedAt:  time.Now().Format("2006/1/2 15:04:05"),
		Paths:      list,
		StaleCount: stale,
		Excluded:   excluded,
	}, nil
}
