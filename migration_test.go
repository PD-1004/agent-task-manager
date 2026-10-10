package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Substitute only the OS process-list command. All file and SQLite operations are real.
func TestMain(m *testing.M) {
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	if strings.EqualFold(filepath.Base(exe), "tasklist.exe") {
		if os.Getenv("ATM_TEST_ZCODE_RUNNING") == "1" {
			fmt.Println(`"ZCode.exe","99999","Console","1","100 K"`)
		} else {
			fmt.Println("INFO: No tasks are running which match the specified criteria.")
		}
		os.Exit(0)
	}
	dir, err := os.MkdirTemp("", "atm-process-test-")
	if err != nil {
		panic(err)
	}
	in, err := os.Open(exe)
	if err != nil {
		panic(err)
	}
	out, err := os.Create(filepath.Join(dir, "tasklist.exe"))
	if err != nil {
		panic(err)
	}
	if _, err = io.Copy(out, in); err != nil {
		panic(err)
	}
	in.Close()
	out.Close()
	os.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

type migrationFixture struct{ base, old, new string }

func setupMigration(t *testing.T, withDB bool) migrationFixture {
	t.Helper()
	root := t.TempDir()
	f := migrationFixture{filepath.Join(root, "zcode"), filepath.Join(root, "old-project"), filepath.Join(root, "moved-project")}
	t.Setenv("ZCODE_HOME", f.base)
	t.Setenv("ATM_TEST_ZCODE_RUNNING", "0")
	for _, dir := range []string{f.new, filepath.Join(f.base, "v2"), filepath.Join(f.base, "cli", "db")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	settings := map[string]any{"recentProjects": []string{f.old, f.new}, "lastWorkspaceSession": []map[string]string{{"workspacePath": f.old, "workspacePurpose": "project"}}}
	b, _ := json.Marshal(settings)
	if err := os.WriteFile(filepath.Join(f.base, "v2", "setting.json"), b, 0644); err != nil {
		t.Fatal(err)
	}
	if !withDB {
		return f
	}
	for _, entry := range []struct{ path, schema string }{
		{"v2/tasks-index.sqlite", `CREATE TABLE tasks (task_id TEXT, workspace_path TEXT, workspace_key TEXT, meta_json TEXT, created_at INTEGER, PRIMARY KEY(workspace_key,task_id));
		 CREATE TABLE task_group_view_node_orders (node_key TEXT PRIMARY KEY);`},
		{"cli/db/db.sqlite", `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, path TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
		 CREATE TABLE message (id TEXT PRIMARY KEY,session_id TEXT,data TEXT,time_created INTEGER,sequence INTEGER);`},
	} {
		db, err := sql.Open("sqlite", filepath.Join(f.base, entry.path))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(entry.schema); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(entry.path, "v2") {
			meta, _ := json.Marshal(map[string]string{"workspacePath": f.old})
			_, err = db.Exec("INSERT INTO tasks VALUES ('task-1',?,?,?,1)", f.old, f.old, string(meta))
			if err == nil {
				_, err = db.Exec("INSERT INTO task_group_view_node_orders VALUES (?)", f.old)
			}
		} else {
			_, err = db.Exec("INSERT INTO session VALUES ('task-1','original-project-id',?,?, 'history',1,2)", f.old, f.old)
			if err == nil {
				_, err = db.Exec(`INSERT INTO message VALUES ('msg-1','task-1','{"role":"user","text":"keep me"}',1,1), ('msg-2','task-1','{"role":"assistant","text":"keep me too"}',2,2)`)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
	return f
}

func queryMigration(t *testing.T, relative, query string, args ...any) string {
	t.Helper()
	db, err := openRO(filepath.Join(os.Getenv("ZCODE_HOME"), relative))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err = db.QueryRow(query, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestMigrateCompletesAfterManualFolderMove(t *testing.T) {
	f := setupMigration(t, true)
	if _, err := os.Stat(f.old); !os.IsNotExist(err) {
		t.Fatal("old directory must be absent")
	}
	res, err := (&App{}).MigratePaths(f.old, f.new)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tasks != 1 || res.Sessions != 1 {
		t.Fatalf("missing bindings: %+v", res)
	}
	if got := queryMigration(t, "v2/tasks-index.sqlite", "SELECT workspace_path FROM tasks WHERE task_id='task-1'"); got != f.new {
		t.Fatalf("task path=%q", got)
	}
	if got := queryMigration(t, "v2/tasks-index.sqlite", "SELECT node_key FROM task_group_view_node_orders"); got != f.new {
		t.Fatalf("project ordering still points to old path: %q", got)
	}
	if got := queryMigration(t, "cli/db/db.sqlite", "SELECT directory FROM session WHERE id='task-1'"); got != f.new {
		t.Fatalf("session path=%q", got)
	}
	if got := queryMigration(t, "cli/db/db.sqlite", "SELECT COUNT(*) FROM message"); got != "2" {
		t.Fatalf("messages lost: %s", got)
	}
	if got := queryMigration(t, "cli/db/db.sqlite", "SELECT project_id FROM session WHERE id='task-1'"); got != "original-project-id" {
		t.Fatal("session identity changed")
	}
	scan, err := (&App{}).ScanPaths()
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Paths) != 1 || scan.Paths[0].Path != f.new || scan.Paths[0].Refs.Tasks != 1 || scan.Paths[0].Refs.Messages != 2 {
		t.Fatalf("project not merged: %+v", scan)
	}
	if _, err = (&App{}).MigratePaths(f.old, f.new); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
}

func TestMigrateRejectsRunningZcodeBeforeWriting(t *testing.T) {
	f := setupMigration(t, false)
	t.Setenv("ATM_TEST_ZCODE_RUNNING", "1")
	before, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	_, err := (&App{}).MigratePaths(f.old, f.new)
	if err == nil || !strings.Contains(err.Error(), "运行") {
		t.Fatalf("expected running-process rejection, got %v", err)
	}
	after, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	if string(before) != string(after) {
		t.Fatal("settings changed while ZCode running")
	}
}

func TestMigrateReportsDatabaseFailureWithoutChangingSettings(t *testing.T) {
	f := setupMigration(t, true)
	db, err := openRW(filepath.Join(f.base, "v2", "tasks-index.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TRIGGER reject_migrate BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'fixture-write-failure'); END`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	_, err = (&App{}).MigratePaths(f.old, f.new)
	if err == nil {
		t.Fatal("database failure was reported as success")
	}
	after, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	if string(before) != string(after) {
		t.Fatal("settings changed although database migration failed")
	}
	if got := queryMigration(t, "cli/db/db.sqlite", "SELECT directory FROM session WHERE id='task-1'"); got != f.old {
		t.Fatal("session changed although task migration failed")
	}
}

func TestMigrateRejectsMissingDestination(t *testing.T) {
	f := setupMigration(t, false)
	_, err := (&App{}).MigratePaths(f.old, filepath.Join(f.new, "missing"))
	if err == nil {
		t.Fatal("missing destination accepted")
	}
}

func TestMigrateRejectsFileDestination(t *testing.T) {
	f := setupMigration(t, false)
	file := filepath.Join(f.new, "not-a-folder.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := (&App{}).MigratePaths(f.old, file); err == nil {
		t.Fatal("file accepted as project directory")
	}
}

func TestMigrateRollsBackTasksWhenSessionUpdateFails(t *testing.T) {
	f := setupMigration(t, true)
	db, err := openRW(filepath.Join(f.base, "cli", "db", "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TRIGGER reject_session_migrate BEFORE UPDATE ON session BEGIN SELECT RAISE(ABORT,'fixture-session-failure'); END`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	if _, err := (&App{}).MigratePaths(f.old, f.new); err == nil {
		t.Fatal("session failure reported as success")
	}
	if got := queryMigration(t, "v2/tasks-index.sqlite", "SELECT workspace_path FROM tasks WHERE task_id='task-1'"); got != f.old {
		t.Fatal("task binding committed although session migration failed")
	}
	after, _ := os.ReadFile(filepath.Join(f.base, "v2", "setting.json"))
	if string(before) != string(after) {
		t.Fatal("settings changed although session migration failed")
	}
}

func TestMigrateRealSnapshotPreservesHistory(t *testing.T) {
	source := os.Getenv("ATM_MIGRATION_SNAPSHOT")
	if source == "" {
		t.Skip("set ATM_MIGRATION_SNAPSHOT to a consistent data copy")
	}
	base := t.TempDir()
	t.Setenv("ZCODE_HOME", base)
	t.Setenv("ATM_TEST_ZCODE_RUNNING", "0")
	for _, relative := range []string{"v2/setting.json", "v2/tasks-index.sqlite", "cli/db/db.sqlite"} {
		dst := filepath.Join(base, relative)
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			t.Fatal(err)
		}
		in, err := os.Open(filepath.Join(source, relative))
		if err != nil {
			t.Fatal(err)
		}
		out, err := os.Create(dst)
		if err != nil {
			t.Fatal(err)
		}
		_, err = io.Copy(out, in)
		in.Close()
		out.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	old, new := os.Getenv("ATM_SNAPSHOT_OLD_PATH"), os.Getenv("ATM_SNAPSHOT_NEW_PATH")
	if old == "" || new == "" {
		t.Fatal("set ATM_SNAPSHOT_OLD_PATH and ATM_SNAPSHOT_NEW_PATH for snapshot verification")
	}
	taskID := queryMigration(t, "cli/db/db.sqlite", "SELECT id FROM session WHERE directory=? OR path=? LIMIT 1", old, old)
	beforeTasks, err := (&App{}).ListProjectTasks(old)
	if err != nil || len(beforeTasks.Tasks) != 1 {
		t.Fatal("snapshot must contain one task at the old path")
	}
	totals := []struct{ db, query, want string }{
		{"v2/tasks-index.sqlite", "SELECT COUNT(*) FROM tasks", ""},
		{"cli/db/db.sqlite", "SELECT COUNT(*) FROM session", ""},
		{"cli/db/db.sqlite", "SELECT COUNT(*) FROM message", ""},
	}
	for i := range totals {
		totals[i].want = queryMigration(t, totals[i].db, totals[i].query)
	}
	messageCount := queryMigration(t, "cli/db/db.sqlite", "SELECT COUNT(*) FROM message WHERE session_id=?", taskID)
	historyDigest := func() string {
		db, err := openRO(filepath.Join(base, "cli", "db", "db.sqlite"))
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		rows, err := db.Query("SELECT id,data FROM message WHERE session_id=? ORDER BY id", taskID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		h := sha256.New()
		for rows.Next() {
			var id, data string
			if err := rows.Scan(&id, &data); err != nil {
				t.Fatal(err)
			}
			fmt.Fprintf(h, "%d:%s%d:%s", len(id), id, len(data), data)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return fmt.Sprintf("%x", h.Sum(nil))
	}
	before := historyDigest()
	res, err := (&App{}).MigratePaths(old, new)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tasks != 1 || res.Meta != 1 || res.Sessions != 1 || res.NodeOrders != 1 {
		t.Fatalf("unexpected real bindings: %+v", res)
	}
	if historyDigest() != before {
		t.Fatal("history content changed")
	}
	for _, expectation := range totals {
		if got := queryMigration(t, expectation.db, expectation.query); got != expectation.want {
			t.Fatalf("row count changed: %s", expectation.query)
		}
	}
	tasks, err := (&App{}).ListProjectTasks(new)
	if err != nil || len(tasks.Tasks) != 1 || tasks.Tasks[0].Msgs != beforeTasks.Tasks[0].Msgs {
		t.Fatalf("history not visible at new path: %d tasks, err=%v", len(tasks.Tasks), err)
	}
	oldTasks, err := (&App{}).ListProjectTasks(old)
	if err != nil || len(oldTasks.Tasks) != 0 {
		t.Fatal("old path still has task bindings")
	}
	files, err := (&App{}).ListProjectFiles(new)
	if err != nil {
		t.Fatal(err)
	}
	if got := queryMigration(t, "cli/db/db.sqlite", "SELECT COUNT(*) FROM message WHERE session_id=?", taskID); got != messageCount {
		t.Fatal("original message count changed")
	}
	t.Logf("Real snapshot: 1 task, %d grouped / %s original messages preserved; file trace results=%d", tasks.Tasks[0].Msgs, messageCount, len(files))
}
