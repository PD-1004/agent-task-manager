package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

/* ---------- 数据结构 ---------- */

type WbBrokenItem struct {
	Path            string `json:"path"`
	Sessions        int    `json:"sessions"`
	SessionsCurrent int    `json:"sessionsCurrent"`
	DeviceLevel     bool   `json:"deviceLevel"`
	IsCurrent       bool   `json:"isCurrent"`
}

type WbBroken struct {
	Items []WbBrokenItem `json:"items"`
	Uid   string         `json:"uid"`
}

type WbSession struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Cwd         string `json:"cwd"`
	Msgs        int    `json:"msgs"`
	Files       int    `json:"files"`
	Stale       bool   `json:"stale"`
	Deleted     bool   `json:"deleted"`
	Earliest    string `json:"earliest"`
	EarliestNum int64  `json:"earliestNum"`
	Updated     string `json:"updated"`
	UpdatedNum  int64  `json:"updatedNum"`
}

type SpaceItem struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	CustomName    bool   `json:"customName"`
	Exists        bool   `json:"exists"`
	Tasks         int    `json:"tasks"`
	Files         int    `json:"files"`
	FirstUsed     string `json:"firstUsed"`
	FirstUsedNum  int64  `json:"firstUsedNum"`
	LastUsed      string `json:"lastUsed"`
	LastUsedNum   int64  `json:"lastUsedNum"`
}

type SpaceTask struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Cwd     string `json:"cwd"`
	Status  string `json:"status"`
	Deleted bool   `json:"deleted"`
	Created int64  `json:"created"`
	Last    int64  `json:"last"`
	Msgs    int    `json:"msgs"`
}

type SpaceTasksResult struct {
	Name      string     `json:"name"`
	SpacePath string     `json:"spacePath"`
	Tasks     []SpaceTask `json:"tasks"`
}

type WbFileItem struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Ext  string `json:"ext"`
	Size int64  `json:"size"`
}

type WbMigrateResult struct {
	Preview    bool `json:"preview"`
	Sessions   int  `json:"sessions"`
	Workspaces int  `json:"workspaces"`
	Files      int  `json:"files"`
	Dirs       int  `json:"dirs"`
	Heartbeats int  `json:"heartbeats"`
}

type WbRemoveResult struct {
	Removed   int `json:"removed"`
	Disk      int `json:"disk"`
	Spaces    int `json:"spaces"`
	Requested int `json:"requested"`
}

/* ---------- 路径 ---------- */

const maxTextBytes = 50 * 1024 * 1024

func wbHome() string {
	if v := os.Getenv("WB_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".workbuddy"
	}
	return filepath.Join(home, ".workbuddy")
}

func wbDb() string { return filepath.Join(wbHome(), "workbuddy.db") }

var multiSepRe = regexp.MustCompile(`\\+`)

// winNormalize：等价 path.win32.normalize（斜杠统一、折叠分隔符、处理 . 与 ..）
func winNormalize(p string) string {
	p = strings.ReplaceAll(p, "/", "\\")
	prefix := ""
	if strings.HasPrefix(p, "\\\\") {
		prefix = "\\\\"
		p = p[2:]
	}
	p = multiSepRe.ReplaceAllString(p, "\\")
	var out []string
	for _, s := range strings.Split(p, "\\") {
		if s == "" || s == "." {
			continue
		}
		if s == ".." {
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			continue
		}
		out = append(out, s)
	}
	res := prefix + strings.Join(out, "\\")
	if strings.HasSuffix(p, "\\") && !strings.HasSuffix(res, "\\") {
		res += "\\"
	}
	return res
}

func normExists(p string) bool {
	_, err := os.Stat(winNormalize(p))
	return err == nil
}

func isAlpha(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func driveLower(p string) string {
	if len(p) >= 2 && p[1] == ':' && isAlpha(p[0]) {
		return strings.ToLower(string(p[0])) + p[1:]
	}
	return p
}

func driveUpper(p string) string {
	if len(p) >= 2 && p[1] == ':' && isAlpha(p[0]) {
		return strings.ToUpper(string(p[0])) + p[1:]
	}
	return p
}

var sepClassRe = regexp.MustCompile(`[/\\:]`)
var dashRunRe = regexp.MustCompile(`-+`)

func normalizeWorkspacePathBase(d string) string {
	s := sepClassRe.ReplaceAllString(d, "-")
	s = strings.TrimLeft(s, "-")
	s = strings.TrimRight(s, "-")
	return dashRunRe.ReplaceAllString(s, "-")
}

func djb2Base36(s string) string {
	var h int32 = 5381
	for _, b := range []byte(s) {
		h = h*33 ^ int32(b)
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	n := uint32(h)
	out := ""
	for {
		out = string(digits[n%36]) + out
		n /= 36
		if n == 0 {
			break
		}
	}
	if out == "" {
		return "0"
	}
	return out
}

func compressWorkspacePathName(d string) string {
	base := normalizeWorkspacePathBase(d)
	if len(base) <= 255 {
		return base
	}
	out := ""
	size := 0
	for _, ch := range base {
		n := len(string(ch))
		if size+n > 180 {
			break
		}
		out += string(ch)
		size += n
	}
	return out + "-" + djb2Base36(base)
}

// slugOf：Windows 盘符落盘为小写，其余保持原样
func slugOf(cwd string) string {
	if len(cwd) >= 2 && cwd[1] == ':' && isAlpha(cwd[0]) {
		cwd = strings.ToLower(string(cwd[0])) + cwd[1:]
	}
	return compressWorkspacePathName(cwd)
}

func displayKey(cwd string) string {
	p := strings.ReplaceAll(cwd, "\\", "/")
	if len(p) >= 3 && p[1] == ':' && isAlpha(p[0]) && p[2] == '/' {
		p = strings.ToLower(p)
	}
	return strings.TrimRight(p, "/")
}

func baseNameOf(p string) string {
	parts := strings.FieldsFunc(p, func(r rune) bool { return r == '\\' || r == '/' })
	if len(parts) == 0 {
		return p
	}
	return parts[len(parts)-1]
}

/* ---------- 路径变体与带边界替换 ---------- */

func buildPairs(oldP, newP string) [][2]string {
	baseSet := []string{winNormalize(oldP), oldP,
		strings.ReplaceAll(oldP, "\\", "/"), strings.ReplaceAll(oldP, "/", "\\")}
	seen := map[string]bool{}
	variants := []string{}
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		variants = append(variants, s)
	}
	for _, o := range baseSet {
		add(o)
		add(driveLower(o))
		if len(o) >= 2 && o[1] == ':' && isAlpha(o[0]) {
			add(driveUpper(o))
		}
	}
	pairs := [][2]string{}
	for _, o := range variants {
		body := o
		if strings.Contains(o, ":") {
			parts := strings.SplitN(o, ":", 2)
			body = parts[1]
		}
		n := newP
		if strings.Contains(body, "/") {
			n = strings.ReplaceAll(newP, "\\", "/")
		}
		pairs = append(pairs, [2]string{o, n})
		if strings.Contains(o, "\\") {
			pairs = append(pairs, [2]string{
				strings.ReplaceAll(o, "\\", "\\\\"),
				strings.ReplaceAll(n, "\\", "\\\\"),
			})
		}
	}
	sort.SliceStable(pairs, func(i, j int) bool { return len(pairs[i][0]) > len(pairs[j][0]) })
	return pairs
}

// subPath：带边界替换（旧路径后必须是分隔符/引号/空白/结尾，避免误伤同名前缀）
func subPath(text string, pairs [][2]string) string {
	for _, pr := range pairs {
		if pr[0] == "" {
			continue
		}
		re, err := regexp.Compile(regexp.QuoteMeta(pr[0]) + `($|[\\/'"\s])`)
		if err != nil {
			continue
		}
		repl := strings.ReplaceAll(pr[1], "$", "$$")
		text = re.ReplaceAllString(text, repl+"$1")
	}
	return text
}

/* ---------- 进程 / 账号 ---------- */

func (a *App) WbHome() map[string]any {
	h := wbHome()
	_, err := os.Stat(h)
	return map[string]any{"home": h, "exists": err == nil}
}

func (a *App) WbRunning() bool {
	for _, name := range []string{"WorkBuddy.exe", "CodeBuddy.exe"} {
		out, err := hiddenCmd("tasklist", "/FI", "IMAGENAME eq "+name, "/FO", "CSV", "/NH").Output()
		if err == nil && strings.Contains(strings.ToLower(string(out)), strings.ToLower(name)) {
			return true
		}
	}
	return false
}

func (a *App) WbKill() OpResult {
	var last string
	ok := true
	for _, name := range []string{"WorkBuddy.exe", "CodeBuddy.exe"} {
		out, err := hiddenCmd("taskkill", "/F", "/IM", name, "/T").CombinedOutput()
		last += strings.TrimSpace(string(out)) + " "
		if err != nil {
			ok = false
		}
	}
	return OpResult{OK: ok, Output: strings.TrimSpace(last)}
}

func (a *App) WbUid() string { return currentUid() }

func currentUid() string {
	p := filepath.Join(wbHome(), "storage", "skeleton", "account-snapshot.json")
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	var j struct {
		Primary struct {
			Uid string `json:"uid"`
		} `json:"primary"`
	}
	if json.Unmarshal(b, &j) != nil {
		return ""
	}
	return j.Primary.Uid
}

/* ---------- 失效空间检测 ---------- */

var driveRe = regexp.MustCompile(`^[A-Za-z]:`)

func (a *App) WbScan() WbBroken {
	res := WbBroken{Items: []WbBrokenItem{}, Uid: currentUid()}
	dbPath := wbDb()
	if _, err := os.Stat(dbPath); err != nil {
		return res
	}
	db, err := openRO(dbPath)
	if err != nil {
		return res
	}
	defer db.Close()

	type bucket struct {
		path            string
		sessions        int
		sessionsCurrent int
		deviceLevel     bool
		uids            map[string]bool
	}
	buckets := map[string]*bucket{}

	if tableExists(db, "sessions") {
		rows, err := db.Query("SELECT cwd, user_id, COUNT(*) n FROM sessions GROUP BY cwd, user_id")
		if err == nil {
			for rows.Next() {
				var cwd sql.NullString
				var uid sql.NullString
				var n sql.NullInt64
				if rows.Scan(&cwd, &uid, &n) != nil {
					continue
				}
				if !cwd.Valid || cwd.String == "" || !driveRe.MatchString(cwd.String) || normExists(cwd.String) {
					continue
				}
				key := strings.ToLower(winNormalize(cwd.String))
				e := buckets[key]
				if e == nil {
					e = &bucket{path: winNormalize(cwd.String), uids: map[string]bool{}}
					buckets[key] = e
				}
				e.sessions += int(n.Int64)
				uidStr := ""
				if uid.Valid {
					uidStr = uid.String
				}
				if res.Uid != "" && uidStr == res.Uid {
					e.sessionsCurrent += int(n.Int64)
				}
				e.uids[uidStr] = true
			}
			rows.Close()
		}
	}
	if tableExists(db, "workspaces") {
		rows, err := db.Query("SELECT path FROM workspaces")
		if err == nil {
			for rows.Next() {
				var p sql.NullString
				if rows.Scan(&p) != nil {
					continue
				}
				if !p.Valid || p.String == "" || !driveRe.MatchString(p.String) || normExists(p.String) {
					continue
				}
				key := strings.ToLower(winNormalize(p.String))
				if buckets[key] == nil {
					buckets[key] = &bucket{path: winNormalize(p.String), deviceLevel: true, uids: map[string]bool{}}
				}
			}
			rows.Close()
		}
	}

	for _, e := range buckets {
		isCurrent := res.Uid == "" || len(e.uids) == 0 || e.uids[res.Uid]
		res.Items = append(res.Items, WbBrokenItem{
			Path: e.path, Sessions: e.sessions, SessionsCurrent: e.sessionsCurrent,
			DeviceLevel: e.deviceLevel, IsCurrent: isCurrent,
		})
	}
	sort.Slice(res.Items, func(i, j int) bool {
		a1 := res.Items[i].SessionsCurrent
		if a1 == 0 {
			a1 = res.Items[i].Sessions
		}
		b1 := res.Items[j].SessionsCurrent
		if b1 == 0 {
			b1 = res.Items[j].Sessions
		}
		return b1-a1 < 0
	})
	return res
}

/* ---------- 文本目标收集 ---------- */

func walkFiles(root string, out *[]string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		fp := filepath.Join(root, e.Name())
		if e.IsDir() {
			walkFiles(fp, out)
		} else {
			*out = append(*out, fp)
		}
	}
}

func collectTextTargets(pairs [][2]string, log func(string)) []string {
	roots := []string{"file-tree-manifests", "changes-index", filepath.Join("workspace", "sessions"), "projects"}
	targets := []string{}
	for _, rel := range roots {
		files := []string{}
		walkFiles(filepath.Join(wbHome(), rel), &files)
		for _, fp := range files {
			st, err := os.Stat(fp)
			if err != nil || st.Size() > maxTextBytes {
				continue
			}
			raw, err := os.ReadFile(fp)
			if err != nil {
				continue
			}
			head := raw
			if len(head) > 4096 {
				head = head[:4096]
			}
			if bytesContainsZero(head) {
				continue
			}
			if !utf8.Valid(raw) {
				continue
			}
			text := string(raw)
			if subPath(text, pairs) != text {
				targets = append(targets, fp)
			}
		}
		if log != nil {
			log(fmt.Sprintf("  扫描 %s：累计命中 %d 个文件", rel, len(targets)))
		}
	}
	return targets
}

func bytesContainsZero(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

func findOldProjectDirs(oldP string) []string {
	cands := []string{slugOf(oldP), slugOf(winNormalize(oldP)), slugOf(driveLower(oldP))}
	seen := map[string]bool{}
	found := []string{}
	for _, c := range cands {
		if seen[c] {
			continue
		}
		seen[c] = true
		p := filepath.Join(wbHome(), "projects", c)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			found = append(found, p)
		}
	}
	return found
}

/* ---------- 迁移 ---------- */

func (a *App) WbPreview(oldP, newP string) (WbMigrateResult, error) {
	return a.wbMigrate(oldP, newP, true)
}

func (a *App) WbMigrate(oldP, newP string) (WbMigrateResult, error) {
	return a.wbMigrate(oldP, newP, false)
}

func (a *App) wbMigrate(oldP, newP string, dryRun bool) (WbMigrateResult, error) {
	log := a.logf
	oldP = winNormalize(strings.TrimRight(oldP, "\\/"))
	newP = winNormalize(strings.TrimRight(newP, "\\/"))
	if !normExists(newP) {
		return WbMigrateResult{}, fmt.Errorf("新路径不存在：%s", newP)
	}
	if strings.EqualFold(oldP, newP) {
		return WbMigrateResult{}, fmt.Errorf("新旧路径相同")
	}
	dbPath := wbDb()
	if _, err := os.Stat(dbPath); err != nil {
		return WbMigrateResult{}, fmt.Errorf("未找到 %s", dbPath)
	}

	pairs := buildPairs(oldP, newP)
	log("─ migration ─")
	log("旧路径：%s", oldP)
	log("新路径：%s", newP)
	if dryRun {
		log("【仅预览模式，不改动任何数据】")
	}

	db, err := openRW(dbPath)
	if err != nil {
		return WbMigrateResult{}, err
	}
	defer db.Close()

	type sessHit struct{ id, cwd string }
	sessHits := []sessHit{}
	if tableExists(db, "sessions") {
		rows, err := db.Query("SELECT id, cwd FROM sessions")
		if err == nil {
			for rows.Next() {
				var id string
				var cwd sql.NullString
				if rows.Scan(&id, &cwd) != nil {
					continue
				}
				if cwd.Valid && cwd.String != "" && subPath(cwd.String, pairs) != cwd.String {
					sessHits = append(sessHits, sessHit{id, cwd.String})
				}
			}
			rows.Close()
		}
	}
	type wsHit struct {
		path string
		t    int64
	}
	wsHits := []wsHit{}
	if tableExists(db, "workspaces") {
		cols := tableColumns(db, "workspaces")
		hasLo := false
		for _, c := range cols {
			if c == "last_opened_at" {
				hasLo = true
			}
		}
		q := "SELECT path FROM workspaces"
		if hasLo {
			q = "SELECT path, CAST(last_opened_at AS INTEGER) FROM workspaces"
		}
		rows, err := db.Query(q)
		if err == nil {
			for rows.Next() {
				var p string
				var lo sql.NullInt64
				var err error
				if hasLo {
					err = rows.Scan(&p, &lo)
				} else {
					err = rows.Scan(&p)
				}
				if err != nil {
					continue
				}
				if p != "" && subPath(p, pairs) != p {
					wsHits = append(wsHits, wsHit{p, lo.Int64})
				}
			}
			rows.Close()
		}
	}
	log("数据库：sessions 表 %d 条、workspaces 表 %d 条待更新", len(sessHits), len(wsHits))
	for _, r := range sessHits {
		log("  会话 %s: %s", r.id[:minLen(8, len(r.id))], r.cwd)
	}

	oldDirs := findOldProjectDirs(oldP)
	for _, d := range oldDirs {
		log("会话历史目录：%s", d)
	}

	textTargets := collectTextTargets(pairs, func(s string) { log("%s", s) })
	log("含旧路径的索引/历史文件：%d 个", len(textTargets))
	for i, fp := range textTargets {
		if i >= 10 {
			log("  ... 等 %d 个", len(textTargets))
			break
		}
		rel, _ := filepath.Rel(wbHome(), fp)
		log("  %s", rel)
	}

	dnPath := filepath.Join(wbHome(), "workspace-display-names.json")
	dnOldKey := displayKey(oldP)
	var dn map[string]any
	var dnEntry map[string]any
	if b, err := os.ReadFile(dnPath); err == nil {
		if json.Unmarshal(b, &dn) != nil {
			dn = map[string]any{"version": 1, "workspaces": map[string]any{}}
		}
		if ws, ok := dn["workspaces"].(map[string]any); ok {
			if e, ok := ws[dnOldKey].(map[string]any); ok {
				dnEntry = e
				if n, ok := e["displayName"].(string); ok {
					log("空间显示名「%s」将迁移到新路径", n)
				}
			}
		}
	}

	heartbeats := []string{}
	hbDir := filepath.Join(wbHome(), "sessions")
	if entries, err := os.ReadDir(hbDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			fp := filepath.Join(hbDir, e.Name())
			b, err := os.ReadFile(fp)
			if err != nil {
				continue
			}
			var obj struct {
				Cwd string `json:"cwd"`
			}
			if json.Unmarshal(b, &obj) != nil {
				continue
			}
			if obj.Cwd != "" && subPath(obj.Cwd, pairs) != obj.Cwd {
				heartbeats = append(heartbeats, fp)
			}
		}
	}
	if len(heartbeats) > 0 {
		log("陈旧心跳文件：%d 个（将清理）", len(heartbeats))
	}

	if dryRun {
		log("预览结束。以上即实际迁移时会执行的全部改动。")
		return WbMigrateResult{Preview: true, Sessions: len(sessHits), Workspaces: len(wsHits),
			Files: len(textTargets), Dirs: len(oldDirs), Heartbeats: len(heartbeats)}, nil
	}

	log("步骤 1/5 更新数据库…")
	tx, err := db.Begin()
	if err == nil {
		for _, r := range sessHits {
			execAffected(tx, "UPDATE sessions SET cwd=? WHERE id=?", subPath(r.cwd, pairs), r.id)
		}
		var wsTs int64 = time.Now().UnixMilli()
		for _, r := range wsHits {
			if r.t > wsTs {
				wsTs = r.t
			}
		}
		for _, r := range wsHits {
			execAffected(tx, "DELETE FROM workspaces WHERE path=?", r.path)
		}
		if len(sessHits) > 0 || len(wsHits) > 0 {
			execAffected(tx, "INSERT OR REPLACE INTO workspaces(path, last_opened_at) VALUES(?, ?)", newP, wsTs)
		}
		tx.Commit()
	}

	log("步骤 2/5 替换索引与历史文件中的路径…")
	done := 0
	for _, fp := range textTargets {
		raw, err := os.ReadFile(fp)
		if err != nil {
			log("  跳过 %s（%v）", fp, err)
			continue
		}
		t := string(raw)
		t2 := subPath(t, pairs)
		if t2 != t {
			if err := os.WriteFile(fp, []byte(t2), 0644); err == nil {
				done++
			}
		}
	}
	log("  已替换 %d 个文件", done)

	log("步骤 3/5 迁移会话历史目录…")
	for _, d := range oldDirs {
		dst := filepath.Join(wbHome(), "projects", slugOf(newP))
		if filepath.Clean(d) == filepath.Clean(dst) {
			continue
		}
		if _, err := os.Stat(dst); err == nil {
			if entries, err := os.ReadDir(d); err == nil {
				for _, fn := range entries {
					srcF := filepath.Join(d, fn.Name())
					dstF := filepath.Join(dst, fn.Name())
					if _, err := os.Stat(dstF); err != nil {
						os.Rename(srcF, dstF)
					}
				}
			}
			os.Remove(d)
			log("  合并到已存在目录：%s", dst)
		} else {
			if err := os.Rename(d, dst); err == nil {
				log("  → %s", dst)
			}
		}
	}

	log("步骤 4/5 迁移空间显示名…")
	if dnEntry != nil && dn != nil {
		newKey := displayKey(newP)
		if ws, ok := dn["workspaces"].(map[string]any); ok {
			delete(ws, dnOldKey)
			oldName, _ := dnEntry["displayName"].(string)
			isAuto := oldName == baseNameOf(oldP)
			if isAuto {
				log("  显示名跟随新文件夹名（%s）", baseNameOf(newP))
			} else {
				dnEntry["id"] = newKey
				dnEntry["path"] = newP
				dnEntry["updatedAt"] = time.Now().UnixMilli()
				ws[newKey] = dnEntry
				log("  显示名保留：%s", oldName)
			}
		}
		if out, err := json.MarshalIndent(dn, "", "  "); err == nil {
			os.WriteFile(dnPath, out, 0644)
		}
	} else {
		log("  无自定义显示名，跳过（将自动显示为「新文件夹名」）")
	}

	log("步骤 5/5 清理陈旧心跳…")
	for _, fp := range heartbeats {
		os.Remove(fp)
	}
	log("  清理 %d 个", len(heartbeats))

	log("✅ 迁移完成！请重启 WorkBuddy 使空间列表生效。")
	return WbMigrateResult{Sessions: len(sessHits), Workspaces: len(wsHits),
		Files: len(textTargets), Dirs: len(oldDirs), Heartbeats: len(heartbeats)}, nil
}

func minLen(n, l int) int {
	if l < n {
		return l
	}
	return n
}

/* ---------- 会话级 ---------- */

func readDisplayNames() map[string]string {
	out := map[string]string{}
	p := filepath.Join(wbHome(), "workspace-display-names.json")
	b, err := os.ReadFile(p)
	if err != nil {
		return out
	}
	var j struct {
		Workspaces map[string]struct {
			DisplayName string `json:"displayName"`
			Path        string `json:"path"`
		} `json:"workspaces"`
	}
	if json.Unmarshal(b, &j) != nil {
		return out
	}
	for k, v := range j.Workspaces {
		if v.DisplayName == "" {
			continue
		}
		out[k] = v.DisplayName
		if v.Path != "" {
			out[displayKey(v.Path)] = v.DisplayName
		}
	}
	return out
}

func listSessionFiles(sid string) []WbFileItem {
	out := []WbFileItem{}
	f := filepath.Join(wbHome(), "changes-index", sid+".json")
	b, err := os.ReadFile(f)
	if err != nil {
		return out
	}
	var j struct {
		Changes []struct {
			Files []struct {
				FilePath string `json:"filePath"`
			} `json:"files"`
		} `json:"changes"`
	}
	if json.Unmarshal(b, &j) != nil {
		return out
	}
	seen := map[string]bool{}
	for _, c := range j.Changes {
		for _, fl := range c.Files {
			if fl.FilePath == "" {
				continue
			}
			key := strings.ToLower(fl.FilePath)
			if seen[key] {
				continue
			}
			st, err := os.Stat(fl.FilePath)
			if err != nil || !st.Mode().IsRegular() {
				continue
			}
			seen[key] = true
			out = append(out, WbFileItem{Path: fl.FilePath, Name: filepath.Base(fl.FilePath), Ext: filepath.Ext(fl.FilePath), Size: st.Size()})
		}
	}
	return out
}

func spaceFileCount(ids []string) int {
	seen := map[string]bool{}
	for _, sid := range ids {
		for _, f := range listSessionFiles(sid) {
			seen[strings.ToLower(f.Path)] = true
		}
	}
	return len(seen)
}

func countJsonlLines(cwd, sid string) int {
	jf := filepath.Join(wbHome(), "projects", slugOf(cwd), sid+".jsonl")
	b, err := os.ReadFile(jf)
	if err != nil || len(b) == 0 {
		return 0
	}
	n := 0
	for _, c := range b {
		if c == 0x0a {
			n++
		}
	}
	if b[len(b)-1] != 0x0a {
		n++
	}
	return n
}

// sessions 表行（按实际存在的列动态读取）
type wbSessionRow map[string]string

func querySessions(db *sql.DB) []wbSessionRow {
	if !tableExists(db, "sessions") {
		return nil
	}
	cols := tableColumns(db, "sessions")
	has := func(c string) bool {
		for _, x := range cols {
			if x == c {
				return true
			}
		}
		return false
	}
	sel := []string{"id"}
	opt := []string{"cwd", "title", "custom_title", "status", "deleted_at", "transport", "is_playground", "conversation_origin", "user_id"}
	names := []string{"id"}
	for _, c := range opt {
		if has(c) {
			sel = append(sel, c)
			names = append(names, c)
		}
	}
	createdExpr := "0"
	if has("created_at") {
		createdExpr = "CAST(created_at AS INTEGER)"
	}
	lastExpr := "0"
	if has("last_activity_at") && has("updated_at") {
		lastExpr = "CAST(COALESCE(last_activity_at, updated_at) AS INTEGER)"
	} else if has("updated_at") {
		lastExpr = "CAST(updated_at AS INTEGER)"
	} else if has("last_activity_at") {
		lastExpr = "CAST(last_activity_at AS INTEGER)"
	}
	q := "SELECT " + strings.Join(sel, ", ") + ", " + createdExpr + ", " + lastExpr + " FROM sessions"
	rows, err := db.Query(q)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []wbSessionRow{}
	colsOut := append(append([]string{}, names...), "_ca", "_la")
	for rows.Next() {
		vals := make([]any, len(colsOut))
		ptrs := make([]any, len(colsOut))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		row := wbSessionRow{}
		for i, name := range colsOut {
			switch v := vals[i].(type) {
			case nil:
				row[name] = ""
			case []byte:
				row[name] = string(v)
			case string:
				row[name] = v
			case int64:
				row[name] = fmt.Sprintf("%d", v)
			case float64:
				row[name] = fmt.Sprintf("%d", int64(v))
			default:
				row[name] = fmt.Sprintf("%v", v)
			}
		}
		out = append(out, row)
	}
	return out
}

// isSpaceSession：与 WorkBuddy app.asar 的 classify() 一致
func isSpaceSession(r wbSessionRow) bool {
	if r["deleted_at"] != "" {
		return false
	}
	cwd := r["cwd"]
	if cwd == "" || !driveRe.MatchString(cwd) {
		return false
	}
	if r["transport"] == "cloud" {
		return false
	}
	if r["is_playground"] == "1" {
		return false
	}
	if r["conversation_origin"] != "" {
		return false
	}
	if _, ok := r["is_playground"]; ok && r["is_playground"] == "" {
		base := baseNameOf(cwd)
		if regexp.MustCompile(`^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$`).MatchString(base) {
			return false
		}
	}
	return true
}

func (a *App) WbSessions() []WbSession {
	out := []WbSession{}
	dbPath := wbDb()
	if _, err := os.Stat(dbPath); err != nil {
		return out
	}
	db, err := openRO(dbPath)
	if err != nil {
		return out
	}
	defer db.Close()
	uidNow := currentUid()
	for _, r := range querySessions(db) {
		if uidNow != "" && r["user_id"] != uidNow {
			continue
		}
		if isSpaceSession(r) {
			continue
		}
		title := r["custom_title"]
		if title == "" {
			title = r["title"]
		}
		if title == "" {
			title = "(未命名)"
		}
		cwd := r["cwd"]
		ca := parseInt64(r["_ca"])
		ua := parseInt64(r["_la"])
		out = append(out, WbSession{
			ID: r["id"], Title: title, Cwd: cwd,
			Msgs: countJsonlLines(cwd, r["id"]), Files: len(listSessionFiles(r["id"])),
			Stale: cwd != "" && driveRe.MatchString(cwd) && !normExists(cwd),
			Deleted: r["deleted_at"] != "",
			Earliest: fmtDate(ca), EarliestNum: ca, Updated: fmtDate(ua), UpdatedNum: ua,
		})
	}
	return out
}

func parseInt64(s string) int64 {
	var v int64
	fmt.Sscanf(s, "%d", &v)
	return v
}

func (a *App) WbTaskRemove(sid string) (WbRemoveResult, error) {
	if !regexp.MustCompile(`^[\w.-]+$`).MatchString(sid) {
		return WbRemoveResult{}, fmt.Errorf("非法会话 ID")
	}
	return a.removeSession(sid), nil
}

func (a *App) removeSession(sid string) WbRemoveResult {
	res := WbRemoveResult{}
	dbPath := wbDb()
	cwd := ""
	if db, err := openRW(dbPath); err == nil {
		db.QueryRow("SELECT cwd FROM sessions WHERE id=?", sid).Scan(&cwd)
		tx, err := db.Begin()
		if err == nil {
			for _, t := range allTables(db) {
				if t == "sessions" {
					continue
				}
				cols := tableColumns(db, t)
				for _, col := range []string{"session_id", "parent_session_id", "child_session_id"} {
					for _, c := range cols {
						if c == col {
							execAffected(tx, "DELETE FROM "+t+" WHERE "+col+"=?", sid)
						}
					}
				}
			}
			execAffected(tx, "DELETE FROM sessions WHERE id=?", sid)
			tx.Commit()
		}
		db.Close()
	}
	if cwd != "" {
		jf := filepath.Join(wbHome(), "projects", slugOf(cwd), sid+".jsonl")
		if _, err := os.Stat(jf); err == nil {
			os.Remove(jf)
			res.Disk++
		}
	}
	for _, rel := range []string{"file-tree-manifests", "changes-index"} {
		f := filepath.Join(wbHome(), rel, sid+".json")
		if _, err := os.Stat(f); err == nil {
			os.Remove(f)
			res.Disk++
		}
	}
	wsDir := filepath.Join(wbHome(), "workspace", "sessions", sid)
	if _, err := os.Stat(wsDir); err == nil {
		os.RemoveAll(wsDir)
		res.Disk++
	}
	a.logf("🧹 WorkBuddy 会话已清除（含 %d 个关联文件）", res.Disk)
	return res
}

/* ---------- 空间级 ---------- */

func (a *App) WbSpaces() []SpaceItem {
	out := []SpaceItem{}
	dbPath := wbDb()
	if _, err := os.Stat(dbPath); err != nil {
		return out
	}
	db, err := openRO(dbPath)
	if err != nil {
		return out
	}
	defer db.Close()

	names := readDisplayNames()
	nkey := func(p string) string {
		return strings.ToLower(winNormalize(strings.TrimRight(p, "\\/")))
	}
	wsOpened := map[string]int64{}
	if tableExists(db, "workspaces") {
		cols := tableColumns(db, "workspaces")
		hasLo := false
		for _, c := range cols {
			if c == "last_opened_at" {
				hasLo = true
			}
		}
		q := "SELECT path FROM workspaces"
		if hasLo {
			q = "SELECT path, CAST(last_opened_at AS INTEGER) FROM workspaces"
		}
		rows, err := db.Query(q)
		if err == nil {
			for rows.Next() {
				var p string
				var lo sql.NullInt64
				var err error
				if hasLo {
					err = rows.Scan(&p, &lo)
				} else {
					err = rows.Scan(&p)
				}
				if err == nil && p != "" {
					wsOpened[nkey(p)] = lo.Int64
				}
			}
			rows.Close()
		}
	}

	type bucket struct {
		path     string
		sessions []sessMini
		first    int64
		last     int64
	}
	buckets := map[string]*bucket{}
	uidNow := currentUid()
	for _, r := range querySessions(db) {
		if !isSpaceSession(r) {
			continue
		}
		if uidNow != "" && r["user_id"] != uidNow {
			continue
		}
		k := nkey(r["cwd"])
		e := buckets[k]
		if e == nil {
			e = &bucket{path: winNormalize(strings.TrimRight(r["cwd"], "\\/")), first: 0}
			buckets[k] = e
		}
		ca := parseInt64(r["_ca"])
		la := parseInt64(r["_la"])
		e.sessions = append(e.sessions, sessMini{r["id"], ca, la})
		if e.first == 0 || ca < e.first {
			e.first = ca
		}
		if la > e.last {
			e.last = la
		}
	}

	day := func(ms int64) string {
		if ms <= 0 {
			return "—"
		}
		return fmtDate(ms)
	}
	for k, e := range buckets {
		base := baseNameOf(e.path)
		dn, custom := names[displayKey(e.path)]
		name := base
		if custom {
			name = dn
		}
		lo := wsOpened[k]
		lastUsed := lo
		if e.last > lastUsed {
			lastUsed = e.last
		}
		out = append(out, SpaceItem{
			Path: e.path, Name: name, CustomName: custom, Exists: normExists(e.path),
			Tasks: len(e.sessions), Files: spaceFileCount(idsOf(e.sessions)),
			FirstUsed: day(e.first), FirstUsedNum: e.first,
			LastUsed: day(lastUsed), LastUsedNum: lastUsed,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Exists != out[j].Exists {
			return out[i].Exists
		}
		return out[j].LastUsedNum-out[i].LastUsedNum < 0
	})
	return out
}

type sessMini struct {
	id      string
	created int64
	last    int64
}

func idsOf(s []sessMini) []string {
	out := make([]string, 0, len(s))
	for _, x := range s {
		out = append(out, x.id)
	}
	return out
}

func (a *App) WbSpaceRemove(spacePath string) (WbRemoveResult, error) {
	p := winNormalize(strings.TrimRight(spacePath, "\\/"))
	if p == "" {
		return WbRemoveResult{}, fmt.Errorf("路径为空")
	}
	res := WbRemoveResult{}
	for _, id := range a.spaceSessionIds(p, false) {
		r := a.removeSession(id)
		res.Removed++
		res.Disk += r.Disk
	}
	a.cleanSpaceMeta(p)
	a.logf("🧹 已移除空间「%s」：%d 个会话（含 %d 个关联文件），空间将从侧栏消失", p, res.Removed, res.Disk)
	return res, nil
}

func (a *App) WbSpaceRemoveBatch(spacePaths []string) (WbRemoveResult, error) {
	seen := map[string]bool{}
	list := []string{}
	for _, p := range spacePaths {
		n := winNormalize(strings.TrimRight(p, "\\/"))
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		list = append(list, n)
	}
	if len(list) == 0 {
		return WbRemoveResult{}, fmt.Errorf("未选择任何空间")
	}
	res := WbRemoveResult{Requested: len(list)}
	for _, p := range list {
		r, err := a.WbSpaceRemove(p)
		if err != nil {
			continue
		}
		res.Removed += r.Removed
		res.Disk += r.Disk
		res.Spaces++
	}
	a.logf("🧹 已批量移除 %d 个空间（共 %d 个会话），空间将从侧栏消失", res.Spaces, res.Removed)
	return res, nil
}

func (a *App) cleanSpaceMeta(p string) {
	if db, err := openRW(wbDb()); err == nil {
		execAffected(db, "DELETE FROM workspaces WHERE path=?", p)
		db.Close()
	}
	dnPath := filepath.Join(wbHome(), "workspace-display-names.json")
	b, err := os.ReadFile(dnPath)
	if err != nil {
		return
	}
	var dn map[string]any
	if json.Unmarshal(b, &dn) != nil {
		return
	}
	if ws, ok := dn["workspaces"].(map[string]any); ok {
		k := displayKey(p)
		if _, ok := ws[k]; ok {
			delete(ws, k)
			if out, err := json.MarshalIndent(dn, "", "  "); err == nil {
				os.WriteFile(dnPath, out, 0644)
			}
		}
	}
}

// spaceSessionIds：该空间（含子目录）下的全部会话 id
func (a *App) spaceSessionIds(spacePath string, skipDeleted bool) []string {
	ids := []string{}
	db, err := openRO(wbDb())
	if err != nil {
		return ids
	}
	defer db.Close()
	n := strings.ToLower(winNormalize(strings.TrimRight(spacePath, "\\/")))
	for _, r := range querySessions(db) {
		cwd := r["cwd"]
		if cwd == "" {
			continue
		}
		if skipDeleted && r["deleted_at"] != "" {
			continue
		}
		sk := strings.ToLower(winNormalize(strings.TrimRight(cwd, "\\/")))
		if sk == n || strings.HasPrefix(sk, n+"\\") {
			ids = append(ids, r["id"])
		}
	}
	return ids
}

func (a *App) WbSpaceTasks(spacePath string) SpaceTasksResult {
	p := winNormalize(strings.TrimRight(spacePath, "\\/"))
	names := readDisplayNames()
	name, custom := names[displayKey(p)]
	if !custom {
		name = baseNameOf(p)
	}
	res := SpaceTasksResult{Name: name, SpacePath: p, Tasks: []SpaceTask{}}
	if _, err := os.Stat(wbDb()); err != nil {
		return res
	}
	db, err := openRO(wbDb())
	if err != nil {
		return res
	}
	defer db.Close()
	uidNow := currentUid()
	sp := strings.ToLower(winNormalize(strings.TrimRight(p, "\\/")))
	for _, r := range querySessions(db) {
		cwd := r["cwd"]
		if cwd == "" {
			continue
		}
		if uidNow != "" && r["user_id"] != uidNow {
			continue
		}
		sk := strings.ToLower(winNormalize(strings.TrimRight(cwd, "\\/")))
		if sk != sp && !strings.HasPrefix(sk, sp+"\\") {
			continue
		}
		title := r["custom_title"]
		if title == "" {
			title = r["title"]
		}
		if title == "" {
			title = "(未命名)"
		}
		res.Tasks = append(res.Tasks, SpaceTask{
			ID: r["id"], Title: title, Cwd: cwd, Status: r["status"],
			Deleted: r["deleted_at"] != "", Created: parseInt64(r["_ca"]),
			Last: parseInt64(r["_la"]), Msgs: countJsonlLines(cwd, r["id"]),
		})
	}
	sort.Slice(res.Tasks, func(i, j int) bool { return res.Tasks[j].Last-res.Tasks[i].Last < 0 })
	return res
}

func (a *App) WbSpaceFiles(spacePath string) []WbFileItem {
	out := []WbFileItem{}
	for _, id := range a.spaceSessionIds(spacePath, true) {
		out = append(out, listSessionFiles(id)...)
	}
	return out
}

func (a *App) WbSessionFiles(sid string) []WbFileItem { return listSessionFiles(sid) }
