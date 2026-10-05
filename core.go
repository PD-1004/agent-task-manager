package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const bt = "`"

/* ---------- 数据结构 ---------- */

type EnvFile struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

type EnvStatus struct {
	ZcodeDir       string             `json:"zcodeDir"`
	ZcodeDirExists bool               `json:"zcodeDirExists"`
	Files          map[string]EnvFile `json:"files"`
}

type ProcStatus struct {
	Running bool     `json:"running"`
	Count   int      `json:"count"`
	Pids    []string `json:"pids"`
	Error   string   `json:"error,omitempty"`
}

type OpResult struct {
	OK     bool   `json:"ok"`
	Output string `json:"output"`
}

type MigrateResult struct {
	Setting    int `json:"setting"`
	Tasks      int `json:"tasks"`
	Meta       int `json:"meta"`
	NodeOrders int `json:"nodeOrders"`
	Sessions   int `json:"sessions"`
}

type RemoveProjectResult struct {
	Setting      int `json:"setting"`
	Tasks        int `json:"tasks"`
	NodeOrders   int `json:"nodeOrders"`
	Sessions     int `json:"sessions"`
	Messages     int `json:"messages"`
	ProjSettings int `json:"projSettings"`
	DiskFiles    int `json:"diskFiles"`
}

type FileItem struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

type TaskItem struct {
	ID       string     `json:"id"`
	Title    string     `json:"title"`
	Msgs     int        `json:"msgs"`
	Files    int        `json:"files"`
	FileList []FileItem `json:"fileList"`
	Tc       int64      `json:"tc"`
	Last     int64      `json:"last"`
	Status   string     `json:"status"`
}

type ProjectTasksResult struct {
	Name        string     `json:"name"`
	ProjectPath string     `json:"projectPath"`
	Tasks       []TaskItem `json:"tasks"`
}

type RemoveTaskResult struct {
	Msgs int `json:"msgs"`
	Disk int `json:"disk"`
}

/* ---------- 路径 ---------- */

func zcodeFiles() map[string]string {
	base := zcodeDir()
	return map[string]string{
		"setting":   filepath.Join(base, "v2", "setting.json"),
		"tasksDb":   filepath.Join(base, "v2", "tasks-index.sqlite"),
		"sessionDb": filepath.Join(base, "cli", "db", "db.sqlite"),
	}
}

func defaultWs() string  { return filepath.Join(zcodeDir(), "workspace", "default") }
func internalWs() string { return filepath.Join(zcodeDir(), "workspace") }

func isInternalWs(p string) bool {
	k := normKey(p)
	base := normKey(internalWs())
	return k == base || strings.HasPrefix(k, base+"\\")
}

func jsonEscape(p string) string { return strings.ReplaceAll(p, "\\", "\\\\") }

func likeEscape(p string) string {
	p = strings.ReplaceAll(p, "\\", "\\\\")
	p = strings.ReplaceAll(p, "%", "\\%")
	p = strings.ReplaceAll(p, "_", "\\_")
	return p
}

// 路径本身 + 路径\下级
func subPattern(p string) string { return likeEscape(p) + "\\%" }

/* ---------- 日志（推送到前端） ---------- */

func (a *App) logf(format string, args ...interface{}) {
	line := fmt.Sprintf(format, args...)
	println(line) // 同时落 stderr，便于从启动器捕获诊断
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "pd:log", line)
	}
}

/* ---------- SQLite 辅助 ---------- */

func openRW(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?cache=shared")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err = db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func tableColumns(db *sql.DB, t string) []string {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", t))
	if err != nil {
		return nil
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			continue
		}
		cols = append(cols, name)
	}
	return cols
}

func allTables(db *sql.DB) []string {
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table'")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if rows.Scan(&n) == nil {
			out = append(out, n)
		}
	}
	return out
}

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func execAffected(e execer, q string, args ...interface{}) int {
	r, err := e.Exec(q, args...)
	if err != nil {
		return 0
	}
	n, _ := r.RowsAffected()
	return int(n)
}

func chunkStrings(arr []string, n int) [][]string {
	var out [][]string
	for i := 0; i < len(arr); i += n {
		end := i + n
		if end > len(arr) {
			end = len(arr)
		}
		out = append(out, arr[i:end])
	}
	return out
}

// 消息条数：按 keyExpr 分组。AI 一次回答内的连续多条 assistant 合并计 1
func countMessagesBy(db *sql.DB, keyExpr, whereSQL string, params ...interface{}) map[string]int {
	role := roleExpr(db)
	base := " FROM session s JOIN message m ON m.session_id = s.id " + whereSQL
	out := map[string]int{}
	q := `WITH r AS (
		SELECT ` + keyExpr + ` k, ` + role + ` role,
		       LAG(` + role + `) OVER (PARTITION BY s.id ORDER BY CAST(m.time_created AS INTEGER), CAST(m.sequence AS INTEGER)) prev
		` + base + `
	) SELECT k, SUM(CASE WHEN role <> 'assistant' THEN 1
	                     WHEN prev IS NULL OR prev <> 'assistant' THEN 1 ELSE 0 END) n
	FROM r GROUP BY k`
	rows, err := db.Query(q, params...)
	if err != nil {
		rows2, err2 := db.Query(`SELECT `+keyExpr+` k, COUNT(*) n `+base+` GROUP BY k`, params...)
		if err2 != nil {
			return out
		}
		defer rows2.Close()
		for rows2.Next() {
			var k sql.NullString
			var n sql.NullInt64
			if rows2.Scan(&k, &n) == nil && k.Valid {
				out[k.String] = int(n.Int64)
			}
		}
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k sql.NullString
		var n sql.NullInt64
		if rows.Scan(&k, &n) == nil && k.Valid {
			out[k.String] = int(n.Int64)
		}
	}
	return out
}

/* ---------- 环境检测 ---------- */

func (a *App) EnvStatus() EnvStatus {
	base := zcodeDir()
	_, err := os.Stat(base)
	files := map[string]EnvFile{}
	for k, f := range zcodeFiles() {
		_, e := os.Stat(f)
		files[k] = EnvFile{Path: f, Exists: e == nil}
	}
	return EnvStatus{ZcodeDir: base, ZcodeDirExists: err == nil, Files: files}
}

func (a *App) IsZcodeRunning() ProcStatus {
	out, err := hiddenCmd("tasklist", "/FI", "IMAGENAME eq ZCode.exe", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return ProcStatus{Running: false, Error: err.Error(), Pids: []string{}}
	}
	pids := []string{}
	re := regexp.MustCompile(`^"([^"]*)"\s*,\s*"([^"]*)"`)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if m := re.FindStringSubmatch(line); m != nil && strings.EqualFold(m[1], "ZCode.exe") {
			pids = append(pids, m[2])
		}
	}
	return ProcStatus{Running: len(pids) > 0, Count: len(pids), Pids: pids}
}

func (a *App) KillZcode() OpResult {
	out, err := hiddenCmd("taskkill", "/F", "/IM", "ZCode.exe", "/T").CombinedOutput()
	return OpResult{OK: err == nil, Output: strings.TrimSpace(string(out))}
}

/* ---------- 一键迁移 ---------- */

func (a *App) MigratePaths(oldP, newP string) (MigrateResult, error) {
	oldP = strings.TrimRight(oldP, "\\/")
	newP = strings.TrimRight(newP, "\\/")
	if oldP == "" || newP == "" {
		return MigrateResult{}, fmt.Errorf("旧路径和新路径都不能为空")
	}
	if normKey(oldP) == normKey(newP) {
		return MigrateResult{}, fmt.Errorf("新旧路径相同，无需迁移")
	}
	if isInternalWs(oldP) {
		return MigrateResult{}, fmt.Errorf("旧路径属于 ZCode 内部会话区（默认工作区），不是项目，不支持迁移")
	}
	if isInternalWs(newP) {
		return MigrateResult{}, fmt.Errorf("新路径位于 ZCode 内部会话区（.zcode\\workspace），项目不应放在这里")
	}
	if _, err := os.Stat(newP); err != nil {
		return MigrateResult{}, fmt.Errorf("新路径在磁盘上不存在：%s\n请先把项目文件夹移动/重命名到位，再执行迁移", newP)
	}

	res := MigrateResult{}
	files := zcodeFiles()
	oldEsc, newEsc := jsonEscape(oldP), jsonEscape(newP)

	// 1) setting.json
	if b, err := os.ReadFile(files["setting"]); err == nil {
		var s map[string]any
		if json.Unmarshal(b, &s) == nil {
			n := 0
			if rp, ok := s["recentProjects"].([]any); ok {
				hasNew := false
				for _, it := range rp {
					if str, ok := it.(string); ok && str == newP {
						hasNew = true
					}
				}
				list := []any{}
				for _, it := range rp {
					str, isStr := it.(string)
					if isStr && normKey(str) == normKey(oldP) {
						n++
						if !hasNew {
							list = append(list, newP)
						}
						continue
					}
					list = append(list, it)
				}
				s["recentProjects"] = list
			}
			if lws, ok := s["lastWorkspaceSession"].([]any); ok {
				for _, it := range lws {
					if m, ok := it.(map[string]any); ok {
						if wp, ok := m["workspacePath"].(string); ok && normKey(wp) == normKey(oldP) {
							m["workspacePath"] = newP
							n++
						}
					}
				}
			}
			if n > 0 {
				out, _ := json.MarshalIndent(s, "", "  ")
				if err := os.WriteFile(files["setting"], append(out, '\n'), 0644); err == nil {
					res.Setting = n
					a.logf("✏️ setting.json：更新 %d 处", n)
				}
			}
		}
	} else {
		a.logf("⚠️ setting.json 跳过：%v", err)
	}

	// 2) tasks-index.sqlite
	if _, err := os.Stat(files["tasksDb"]); err == nil {
		db, err := openRW(files["tasksDb"])
		if err == nil {
			func() {
				defer db.Close()
				if !tableExists(db, "tasks") {
					a.logf("⚠️ 任务索引跳过：tasks 表不存在（ZCode 版本可能已变化）")
					return
				}
				tx, err := db.Begin()
				if err != nil {
					return
				}
				res.Tasks = execAffected(tx, "UPDATE tasks SET workspace_path=?, workspace_key=? WHERE workspace_path=? OR workspace_key=?", newP, newP, oldP, oldP)
				res.Meta = execAffected(tx, `UPDATE tasks SET meta_json = REPLACE(REPLACE(meta_json, ?, ?), ?, ?)
					WHERE meta_json LIKE ? ESCAPE '\' OR meta_json LIKE ? ESCAPE '\'`,
					oldEsc, newEsc, oldP, newP, "%"+likeEscape(oldEsc)+"%", "%"+likeEscape(oldP)+"%")
				if tableExists(db, "task_group_view_node_orders") {
					res.NodeOrders = execAffected(tx, `UPDATE task_group_view_node_orders SET node_key = REPLACE(REPLACE(node_key, ?, ?), ?, ?)
						WHERE node_key LIKE ? ESCAPE '\'`, oldEsc, newEsc, oldP, newP, "%"+likeEscape(oldEsc)+"%")
				}
				tx.Commit()
				a.logf("✏️ 任务索引：%d 条任务、%d 条元数据、%d 条排序记录", res.Tasks, res.Meta, res.NodeOrders)
			}()
		}
	}

	// 3) session db
	if _, err := os.Stat(files["sessionDb"]); err == nil {
		db, err := openRW(files["sessionDb"])
		if err == nil {
			func() {
				defer db.Close()
				if !tableExists(db, "session") {
					a.logf("⚠️ 会话库跳过：session 表不存在（ZCode 版本可能已变化）")
					return
				}
				res.Sessions = execAffected(db, "UPDATE session SET directory=?, path=? WHERE directory=? OR path=?", newP, newP, oldP, oldP)
				a.logf("✏️ 会话库：%d 个会话的工作目录已改绑", res.Sessions)
			}()
		}
	}

	total := res.Setting + res.Tasks + res.Meta + res.NodeOrders + res.Sessions
	a.logf("🎉 迁移完成。共 %d 处绑定更新。", total)
	return res, nil
}

/* ---------- 移除项目 ---------- */

func (a *App) RemoveProject(projectPath string) (RemoveProjectResult, error) {
	// ZCode 运行时会锁库并在退出时回写内存数据，此时移除必然无效，直接拒绝
	if st := a.IsZcodeRunning(); st.Running {
		return RemoveProjectResult{}, fmt.Errorf("ZCode 正在运行（PID %s），请先完全退出 ZCode（含托盘）再移除", strings.Join(st.Pids, ","))
	}
	p := strings.TrimRight(projectPath, "\\/")
	if p == "" {
		return RemoveProjectResult{}, fmt.Errorf("路径为空")
	}
	if isInternalWs(p) {
		return RemoveProjectResult{}, fmt.Errorf("该路径属于 ZCode 内部会话区（默认工作区），不属于项目，不支持通过本工具移除")
	}

	res := RemoveProjectResult{}
	sessionIds := []string{}
	files := zcodeFiles()

	// 1) setting.json
	if b, err := os.ReadFile(files["setting"]); err == nil {
		var s map[string]any
		if json.Unmarshal(b, &s) == nil {
			n := 0
			if rp, ok := s["recentProjects"].([]any); ok {
				list := []any{}
				for _, it := range rp {
					if str, isStr := it.(string); isStr && normKey(str) == normKey(p) {
						n++
						continue
					}
					list = append(list, it)
				}
				s["recentProjects"] = list
			}
			if lws, ok := s["lastWorkspaceSession"].([]any); ok {
				list := []any{}
				for _, it := range lws {
					if m, ok := it.(map[string]any); ok {
						if wp, ok := m["workspacePath"].(string); ok && normKey(wp) == normKey(p) {
							n++
							continue
						}
					}
					list = append(list, it)
				}
				s["lastWorkspaceSession"] = list
			}
			if n > 0 {
				out, _ := json.MarshalIndent(s, "", "  ")
				if err := os.WriteFile(files["setting"], append(out, '\n'), 0644); err == nil {
					res.Setting = n
					a.logf("✏️ setting.json：移除 %d 处记录", n)
				}
			}
		}
	} else {
		a.logf("⚠️ setting.json 跳过：%v", err)
	}

	// 2) tasks-index.sqlite
	taskIds := []string{}
	if _, err := os.Stat(files["tasksDb"]); err == nil {
		db, err := openRW(files["tasksDb"])
		if err == nil {
			func() {
				defer db.Close()
				pat := subPattern(p)
				// 表结构必须在开启事务前取好：事务进行中用 db 另开连接查询，
				// 会被该事务持有的写锁阻塞，而事务又在等查询结果，形成自死锁
				tables := allTables(db)
				colsMap := map[string][]string{}
				for _, t := range tables {
					colsMap[t] = tableColumns(db, t)
				}
				hasTasks := tableExists(db, "tasks")
				tx, err := db.Begin()
				if err != nil {
					return
				}
				if hasTasks {
					rows, err := tx.Query(`SELECT task_id FROM tasks WHERE workspace_path=? OR workspace_path LIKE ? ESCAPE '\'
						OR workspace_key=? OR workspace_key LIKE ? ESCAPE '\'`, p, pat, p, pat)
					if err == nil {
						for rows.Next() {
							var id sql.NullString
							if rows.Scan(&id) == nil && id.Valid {
								taskIds = append(taskIds, id.String)
							}
						}
						rows.Close()
					}
				}
				for _, t := range tables {
					cols := colsMap[t]
					has := func(c string) bool {
						for _, x := range cols {
							if x == c {
								return true
							}
						}
						return false
					}
					switch {
					case has("workspace_path") || has("workspace_key"):
						conds, args := []string{}, []any{}
						for _, c := range []string{"workspace_path", "workspace_key"} {
							if !has(c) {
								continue
							}
							conds = append(conds, "("+c+"=? OR "+c+" LIKE ? ESCAPE '\\')")
							args = append(args, p, pat)
						}
						n := execAffected(tx, "DELETE FROM "+t+" WHERE "+strings.Join(conds, " OR "), args...)
						if t == "tasks" {
							res.Tasks = n
						}
					case t == "task_group_view_node_orders" && has("node_key"):
						res.NodeOrders = execAffected(tx, `DELETE FROM task_group_view_node_orders
							WHERE node_key LIKE ? ESCAPE '\' OR node_key LIKE ? ESCAPE '\'`,
							"%"+likeEscape(jsonEscape(p))+"%", "%"+likeEscape(p)+"%")
					case t == "task_group_members" && has("task_id") && len(taskIds) > 0:
						for _, part := range chunkStrings(taskIds, 400) {
							ph := strings.TrimSuffix(strings.Repeat("?,", len(part)), ",")
							args := make([]any, len(part))
							for i, s := range part {
								args[i] = s
							}
							execAffected(tx, "DELETE FROM task_group_members WHERE task_id IN ("+ph+")", args...)
						}
					}
				}
				if err := tx.Commit(); err != nil {
					a.logf("❌ 任务索引提交失败（库被锁或磁盘只读？）：%v", err)
				}
				a.logf("✏️ 任务索引：移除 %d 条任务、%d 条排序记录", res.Tasks, res.NodeOrders)
			}()
		}
	}

	// 3) session db + 磁盘关联文件
	if _, err := os.Stat(files["sessionDb"]); err == nil {
		db, err := openRW(files["sessionDb"])
		if err == nil {
			func() {
				defer db.Close()
				pat := subPattern(p)
				var hasMessage, hasLocalSetting bool
				rows, err := db.Query(`SELECT id, project_id FROM session
					WHERE directory=? OR directory LIKE ? ESCAPE '\' OR path=? OR path LIKE ? ESCAPE '\'`, p, pat, p, pat)
				if err != nil {
					return
				}
				ids := []string{}
				projSet := map[string]bool{}
				for rows.Next() {
					var id string
					var pid sql.NullString
					if rows.Scan(&id, &pid) != nil {
						continue
					}
					ids = append(ids, id)
					if pid.Valid && pid.String != "" {
						projSet[pid.String] = true
					}
				}
				rows.Close()
				res.Sessions = len(ids)
				sessionIds = ids
				if len(ids) == 0 {
					return
				}
				// 同理：表结构在开启事务前取好，避免事务内用 db 查询时与写锁互相等待
				tables := allTables(db)
				colsMap := map[string][]string{}
				for _, t := range tables {
					colsMap[t] = tableColumns(db, t)
				}
				hasMessage = tableExists(db, "message")
				hasLocalSetting = tableExists(db, "local_setting")
				tx, err := db.Begin()
				if err != nil {
					return
				}
				if hasMessage {
					for _, part := range chunkStrings(ids, 400) {
						ph := strings.TrimSuffix(strings.Repeat("?,", len(part)), ",")
						args := make([]any, len(part))
						for i, s := range part {
							args[i] = s
						}
						var c sql.NullInt64
						if tx.QueryRow("SELECT COUNT(*) FROM message WHERE session_id IN ("+ph+")", args...).Scan(&c) == nil {
							res.Messages += int(c.Int64)
						}
					}
				}
				for _, t := range tables {
					if t == "session" {
						continue
					}
					cols := colsMap[t]
					for _, col := range []string{"session_id", "parent_session_id", "child_session_id"} {
						found := false
						for _, c := range cols {
							if c == col {
								found = true
							}
						}
						if !found {
							continue
						}
						for _, part := range chunkStrings(ids, 400) {
							ph := strings.TrimSuffix(strings.Repeat("?,", len(part)), ",")
							args := make([]any, len(part))
							for i, s := range part {
								args[i] = s
							}
							execAffected(tx, "DELETE FROM "+t+" WHERE "+col+" IN ("+ph+")", args...)
						}
					}
				}
				ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
				args := make([]any, len(ids))
				for i, s := range ids {
					args[i] = s
				}
				execAffected(tx, "DELETE FROM session WHERE id IN ("+ph+")", args...)
				if hasLocalSetting {
					for pid := range projSet {
						res.ProjSettings += execAffected(tx, "DELETE FROM local_setting WHERE scope='project' AND scope_id=?", pid)
					}
				}
				tx.Commit()
				a.logf("✏️ 会话库：移除 %d 个会话（%d 条消息）、%d 条项目设置", res.Sessions, res.Messages, res.ProjSettings)
			}()
		}

		for _, id := range sessionIds {
			for _, d := range []string{"agents", "artifacts"} {
				dir := filepath.Join(zcodeDir(), "cli", d, id)
				if _, err := os.Stat(dir); err == nil {
					os.RemoveAll(dir)
					res.DiskFiles++
				}
			}
			ro := filepath.Join(zcodeDir(), "cli", "rollout", "model-io-"+id+".jsonl")
			if _, err := os.Stat(ro); err == nil {
				os.Remove(ro)
				res.DiskFiles++
			}
		}
		if res.DiskFiles > 0 {
			a.logf("🧹 已清理 %d 个会话关联目录/文件", res.DiskFiles)
		}
	}

	a.logf("🎉 移除完成。注意：磁盘上的项目文件夹（如存在）未被删除。")
	return res, nil
}

/* ---------- 任务级：清单与清除 ---------- */

var wsFileRe = regexp.MustCompile(`[A-Za-z]:(?:\\\\|\\|/)+[^"'` + bt + `\s<>|*?]*?[\\/]+\.zcode[\\/]+workspace[\\/]+default[\\/]+(?:[^"'` + bt + `\s<>|*?)\]}])+`)
var multiSlashRe = regexp.MustCompile(`\\+`)
var tailPunctRe = regexp.MustCompile(`[\\.,;:：）)】\]}]+$`)

var taskDataTables = []string{"message", "part", "session_entry"}
var textCols = []string{"data", "content", "text", "payload"}

func normalizeWsPath(p string) string {
	p = strings.ReplaceAll(p, "/", "\\")
	p = multiSlashRe.ReplaceAllString(p, "\\")
	p = tailPunctRe.ReplaceAllString(p, "")
	return p
}

func projectFileRegex(p string) *regexp.Regexp {
	segs := []string{}
	for _, s := range regexp.MustCompile(`[\\/]+`).Split(p, -1) {
		if s != "" {
			segs = append(segs, regexp.QuoteMeta(s))
		}
	}
	sep := `(?:\\{1,2}|/)+`
	body := strings.Join(segs, sep) + sep + `[^"'` + bt + `\s<>|*?)\]}，。；：、！？]+`
	return regexp.MustCompile(body)
}

// 只统计磁盘上仍然存在的文件
func collectFiles(texts []string, re *regexp.Regexp, baseKey string, mustBeSub bool) []FileItem {
	seen := map[string]bool{}
	out := []FileItem{}
	for _, data := range texts {
		if data == "" {
			continue
		}
		for _, m := range re.FindAllString(data, -1) {
			fp := normalizeWsPath(m)
			k := normKey(fp)
			if !strings.HasPrefix(k, baseKey) || k == normKey(strings.TrimRight(baseKey, "\\")) {
				continue
			}
			if mustBeSub && len(k) <= len(baseKey) {
				continue
			}
			if seen[k] {
				continue
			}
			st, err := os.Stat(fp)
			if err != nil || st.IsDir() {
				continue
			}
			seen[k] = true
			out = append(out, FileItem{Name: filepath.Base(fp), Path: fp, Size: st.Size(), Mtime: st.ModTime().UnixMilli()})
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.Compare(out[i].Path, out[j].Path) < 0 })
	return out
}

// 收集任务（会话）文本，按 session_id 分组（每个会话只处理自己的文本）
func collectSessionTexts(db *sql.DB, ids []string, likePatterns []string) map[string][]string {
	out := map[string][]string{}
	for _, t := range taskDataTables {
		if !tableExists(db, t) {
			continue
		}
		cols := tableColumns(db, t)
		hasSession := false
		for _, c := range cols {
			if c == "session_id" {
				hasSession = true
			}
		}
		if !hasSession {
			continue
		}
		col := ""
		for _, c := range textCols {
			for _, x := range cols {
				if x == c {
					col = c
					break
				}
			}
			if col != "" {
				break
			}
		}
		if col == "" {
			continue
		}
		if len(ids) == 0 {
			for _, lp := range likePatterns {
				rows, err := db.Query(fmt.Sprintf("SELECT session_id, %s FROM %s WHERE %s LIKE ?", col, t, col), lp)
				if err != nil {
					continue
				}
				for rows.Next() {
					var sid string
					var s sql.NullString
					if rows.Scan(&sid, &s) == nil && s.Valid {
						out[sid] = append(out[sid], s.String)
					}
				}
				rows.Close()
			}
			continue
		}
		for _, part := range chunkStrings(ids, 300) {
			ph := strings.TrimSuffix(strings.Repeat("?,", len(part)), ",")
			conds, args := []string{}, []any{}
			for _, s := range part {
				args = append(args, s)
			}
			for _, lp := range likePatterns {
				conds = append(conds, col+" LIKE ?")
				args = append(args, lp)
			}
			where := "session_id IN (" + ph + ")"
			if len(conds) > 0 {
				where += " AND (" + strings.Join(conds, " OR ") + ")"
			}
			rows, err := db.Query(fmt.Sprintf("SELECT session_id, %s FROM %s WHERE %s", col, t, where), args...)
			if err != nil {
				continue
			}
			for rows.Next() {
				var sid string
				var s sql.NullString
				if rows.Scan(&sid, &s) == nil && s.Valid {
					out[sid] = append(out[sid], s.String)
				}
			}
			rows.Close()
		}
	}
	return out
}

func (a *App) ListDefaultTasks() ([]TaskItem, error) {
	db, err := openRO(zcodeFiles()["sessionDb"])
	if err != nil {
		return []TaskItem{}, nil
	}
	defer db.Close()
	if !tableExists(db, "session") {
		return []TaskItem{}, nil
	}
	dw := defaultWs()
	where := "WHERE (s.directory = ? OR s.directory LIKE ? ESCAPE '\\')"
	params := []any{dw, subPattern(dw)}
	msgMap := countMessagesBy(db, "s.id", where, params...)
	rows, err := db.Query(`SELECT s.id, s.title, CAST(s.time_created AS INTEGER) tc FROM session s `+where+` ORDER BY s.time_created DESC`, params...)
	if err != nil {
		return []TaskItem{}, nil
	}
	type rowT struct {
		id, title string
		tc        int64
	}
	var list []rowT
	for rows.Next() {
		var id string
		var title sql.NullString
		var tc sql.NullInt64
		if rows.Scan(&id, &title, &tc) != nil {
			continue
		}
		list = append(list, rowT{id, title.String, tc.Int64})
	}
	rows.Close()

	// 先按会话 id 收敛（避免对整张 message 表做 LIKE 全表扫描）
	ids := make([]string, 0, len(list))
	for _, r := range list {
		ids = append(ids, r.id)
	}
	bySess := collectSessionTexts(db, ids, []string{"%workspace%default%"})
	base := normKey(dw) + "\\"
	out := make([]TaskItem, 0, len(list))
	for _, r := range list {
		fl := collectFiles(bySess[r.id], wsFileRe, base, true)
		t := r.title
		if t == "" {
			t = "(未命名)"
		}
		out = append(out, TaskItem{ID: r.id, Title: t, Msgs: msgMap[r.id], Files: len(fl), FileList: fl, Tc: r.tc, Last: r.tc})
	}
	return out, nil
}

func (a *App) RemoveTask(taskID string) (RemoveTaskResult, error) {
	// ZCode 运行时会锁库并在退出时回写内存数据，此时移除必然无效，直接拒绝
	if st := a.IsZcodeRunning(); st.Running {
		return RemoveTaskResult{}, fmt.Errorf("ZCode 正在运行（PID %s），请先完全退出 ZCode（含托盘）再移除", strings.Join(st.Pids, ","))
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(taskID) {
		return RemoveTaskResult{}, fmt.Errorf("非法任务 ID")
	}
	res := RemoveTaskResult{}
	files := zcodeFiles()

	if db, err := openRW(files["tasksDb"]); err == nil {
		if tableExists(db, "tasks") {
			execAffected(db, "DELETE FROM tasks WHERE task_id=?", taskID)
		}
		if tableExists(db, "task_group_view_node_orders") {
			execAffected(db, "DELETE FROM task_group_view_node_orders WHERE node_key LIKE ? ESCAPE '\\'", "%"+likeEscape(jsonEscape(taskID))+"%")
		}
		db.Close()
	}

	if db, err := openRW(files["sessionDb"]); err == nil {
		var c sql.NullInt64
		db.QueryRow("SELECT COUNT(*) FROM message WHERE session_id=?", taskID).Scan(&c)
		res.Msgs = int(c.Int64)
		// 表结构信息先在事务外收集：openRW 为单连接，事务开启后再用 db 查询会挂死
		type delTarget struct{ table, col string }
		targets := []delTarget{}
		for _, t := range allTables(db) {
			if t == "session" {
				continue
			}
			cols := tableColumns(db, t)
			for _, col := range []string{"session_id", "parent_session_id", "child_session_id"} {
				for _, c2 := range cols {
					if c2 == col {
						targets = append(targets, delTarget{t, col})
					}
				}
			}
		}
		tx, err := db.Begin()
		if err == nil {
			for _, d := range targets {
				execAffected(tx, "DELETE FROM "+d.table+" WHERE "+d.col+"=?", taskID)
			}
			execAffected(tx, "DELETE FROM session WHERE id=?", taskID)
			tx.Commit()
		}
		db.Close()
	}

	for _, d := range []string{"agents", "artifacts"} {
		dir := filepath.Join(zcodeDir(), "cli", d, taskID)
		if _, err := os.Stat(dir); err == nil {
			os.RemoveAll(dir)
			res.Disk++
		}
	}
	ro := filepath.Join(zcodeDir(), "cli", "rollout", "model-io-"+taskID+".jsonl")
	if _, err := os.Stat(ro); err == nil {
		os.Remove(ro)
		res.Disk++
	}

	a.logf("🧹 任务 %s… 已清除（%d 条消息、%d 个关联目录/文件）", taskID, res.Msgs, res.Disk)
	return res, nil
}

/* ---------- 项目级：任务清单 / 文件统计 ---------- */

func sessionLastExpr(db *sql.DB) string {
	cols := tableColumns(db, "session")
	for _, c := range []string{"time_updated", "updated_at", "last_activity_at", "modified_at"} {
		for _, x := range cols {
			if x == c {
				return "CAST(s." + c + " AS INTEGER)"
			}
		}
	}
	return "CAST(s.time_created AS INTEGER)"
}

func (a *App) ListProjectTasks(projectPath string) (ProjectTasksResult, error) {
	p := strings.TrimRight(projectPath, "\\/")
	name := filepath.Base(p)
	if name == "" {
		name = p
	}
	if p == "" {
		return ProjectTasksResult{}, fmt.Errorf("路径为空")
	}
	db, err := openRO(zcodeFiles()["sessionDb"])
	if err != nil {
		return ProjectTasksResult{Name: name, ProjectPath: p, Tasks: []TaskItem{}}, nil
	}
	defer db.Close()
	if !tableExists(db, "session") {
		return ProjectTasksResult{Name: name, ProjectPath: p, Tasks: []TaskItem{}}, nil
	}
	lastExpr := sessionLastExpr(db)
	cols := tableColumns(db, "session")
	hasStatus := false
	for _, c := range cols {
		if c == "status" {
			hasStatus = true
		}
	}
	pat := subPattern(p)
	where := "WHERE (s.directory=? OR s.directory LIKE ? ESCAPE '\\' OR s.path=? OR s.path LIKE ? ESCAPE '\\')"
	params := []any{p, pat, p, pat}
	msgMap := countMessagesBy(db, "s.id", where, params...)

	sel := "SELECT s.id, s.title, CAST(s.time_created AS INTEGER) tc, " + lastExpr + " lu"
	if hasStatus {
		sel += ", s.status"
	}
	rows, err := db.Query(sel+" FROM session s "+where+" ORDER BY lu DESC", params...)
	if err != nil {
		return ProjectTasksResult{Name: name, ProjectPath: p, Tasks: []TaskItem{}}, nil
	}
	tasks := []TaskItem{}
	for rows.Next() {
		var id string
		var title, status sql.NullString
		var tc, lu sql.NullInt64
		var err error
		if hasStatus {
			err = rows.Scan(&id, &title, &tc, &lu, &status)
		} else {
			err = rows.Scan(&id, &title, &tc, &lu)
		}
		if err != nil {
			continue
		}
		t := title.String
		if t == "" {
			t = "(未命名)"
		}
		last := lu.Int64
		if last == 0 {
			last = tc.Int64
		}
		item := TaskItem{ID: id, Title: t, Msgs: msgMap[id], Last: last, Tc: tc.Int64}
		if hasStatus {
			item.Status = status.String
		}
		tasks = append(tasks, item)
	}
	rows.Close()
	return ProjectTasksResult{Name: name, ProjectPath: p, Tasks: tasks}, nil
}

func (a *App) ListProjectFiles(projectPath string) ([]FileItem, error) {
	p := strings.TrimRight(projectPath, "\\/")
	if p == "" {
		return []FileItem{}, nil
	}
	db, err := openRO(zcodeFiles()["sessionDb"])
	if err != nil {
		return []FileItem{}, nil
	}
	defer db.Close()
	if !tableExists(db, "session") {
		return []FileItem{}, nil
	}
	pat := subPattern(p)
	rows, err := db.Query(`SELECT id FROM session WHERE directory=? OR directory LIKE ? ESCAPE '\' OR path=? OR path LIKE ? ESCAPE '\'`, p, pat, p, pat)
	if err != nil {
		return []FileItem{}, nil
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return []FileItem{}, nil
	}
	bySess := collectSessionTexts(db, ids, []string{"%" + likeEscape(jsonEscape(p)) + "%", "%" + likeEscape(p) + "%"})
	texts := []string{}
	for _, v := range bySess {
		texts = append(texts, v...)
	}
	return collectFiles(texts, projectFileRegex(p), normKey(p)+"\\", true), nil
}

/* ---------- 其他 ---------- */

func (a *App) CopyText(text string) error {
	return runtime.ClipboardSetText(a.ctx, text)
}

func (a *App) OpenExternal(url string) {
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, url)
	}
}

/* ---------- 更新检查 ---------- */

const appVersion = "1.4.0"

type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	HasUpdate bool   `json:"hasUpdate"`
	URL       string `json:"url"`
	Error     string `json:"error,omitempty"`
}

func (a *App) CheckUpdate() UpdateInfo {
	info := UpdateInfo{Current: appVersion}
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", "https://api.github.com/repos/PD-1004/agent-task-manager/releases/latest", nil)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	req.Header.Set("User-Agent", "agent-task-manager")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	defer resp.Body.Close()
	var rel struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if json.NewDecoder(resp.Body).Decode(&rel) != nil {
		info.Error = "解析失败"
		return info
	}
	info.Latest = rel.TagName
	info.URL = rel.HTMLURL
	info.HasUpdate = versionGreater(rel.TagName, appVersion)
	return info
}

// 语义化版本比较：去 v 前缀后按段比较数字
func versionGreater(a, b string) bool {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			fmt.Sscanf(pa[i], "%d", &x)
		}
		if i < len(pb) {
			fmt.Sscanf(pb[i], "%d", &y)
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func (a *App) PickDirectory() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("窗口未就绪")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择文件夹"})
}

func (a *App) NowStamp() string { return time.Now().Format("2006/1/2 15:04:05") }
