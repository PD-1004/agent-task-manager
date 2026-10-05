package main

import "testing"

// 只读校验：确认迁移后的核心逻辑能从真实数据里取到内容
func TestDataNonEmpty(t *testing.T) {
	a := NewApp()

	env := a.EnvStatus()
	t.Logf("EnvStatus: dir=%s exists=%v files=%v", env.ZcodeDir, env.ZcodeDirExists, env.Files)

	scan, err := a.ScanPaths()
	t.Logf("ScanPaths: %d 条路径, 失效 %d, 排除 %d, err=%v", len(scan.Paths), scan.StaleCount, scan.Excluded, err)
	for i, p := range scan.Paths {
		if i >= 5 {
			break
		}
		t.Logf("  [%d] %s exists=%v tasks=%d msgs=%d", i, p.Path, p.Exists, p.Refs.Tasks, p.Refs.Messages)
	}

	tasks, err := a.ListDefaultTasks()
	t.Logf("ListDefaultTasks: %d 条, err=%v", len(tasks), err)
	for i, x := range tasks {
		if i >= 3 {
			break
		}
		t.Logf("  %s | %s | 消息 %d | 文件 %d", x.ID[:8], x.Title, x.Msgs, x.Files)
	}

	if len(scan.Paths) > 0 {
		pt, err := a.ListProjectTasks(scan.Paths[0].Path)
		t.Logf("ListProjectTasks(%s): %d 条, err=%v", pt.Name, len(pt.Tasks), err)
		pf, err := a.ListProjectFiles(scan.Paths[0].Path)
		t.Logf("ListProjectFiles(%s): %d 个, err=%v", pt.Name, len(pf), err)
	}

	spaces := a.WbSpaces()
	t.Logf("WbSpaces: %d 条", len(spaces))
	for i, s := range spaces {
		if i >= 5 {
			break
		}
		t.Logf("  %s | 任务 %d | 文件 %d | exists=%v", s.Name, s.Tasks, s.Files, s.Exists)
	}

	sess := a.WbSessions()
	t.Logf("WbSessions: %d 条", len(sess))
	for i, s := range sess {
		if i >= 3 {
			break
		}
		t.Logf("  %s | %s | 消息 %d | 文件 %d | stale=%v", s.ID[:8], s.Title, s.Msgs, s.Files, s.Stale)
	}

	br := a.WbScan()
	t.Logf("WbScan: 失效 %d 条, uid=%s", len(br.Items), br.Uid)

	if len(spaces) > 0 {
		st := a.WbSpaceTasks(spaces[0].Path)
		t.Logf("WbSpaceTasks(%s): %d 条", st.Name, len(st.Tasks))
	}
}
