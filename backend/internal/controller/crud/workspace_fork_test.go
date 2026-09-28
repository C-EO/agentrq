// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package crud

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/agentrq/agentrq/backend/internal/repository/base"
	"github.com/golang/mock/gomock"
	"github.com/mustafaturan/monoflake"
	"gorm.io/datatypes"
)

const (
	fkParent = int64(10)
	fkFork   = int64(20)
)

type denyWorkspaceLimiter struct{ stubLimiter }

func (*denyWorkspaceLimiter) AllowWorkspace(int64) bool { return false }

func parentWorkspace() model.Workspace {
	return model.Workspace{
		ID: fkParent, UserID: testUserID, Name: "api", Description: "the API", Icon: "icon",
		WorkingDirectory:      "/src/api",
		NotificationSettings:  datatypes.JSON(`{"TaskCreated":true}`),
		AutoAllowedTools:      datatypes.JSON(`["Bash"]`),
		AllowAllCommands:      true,
		ClearContextDefault:   true,
		SelfLearningLoopNote:  "learn",
		InputSendDelaySeconds: 5,
	}
}

func forkWorkspace() model.Workspace {
	f := parentWorkspace()
	f.ID, f.Name, f.WorkingDirectory, f.ForkOfID = fkFork, "api fork", "", fkParent
	return f
}

func wantForkErr(t *testing.T, err error, kind error, msg string) {
	t.Helper()
	if !errors.Is(err, kind) {
		t.Fatalf("err = %v, want %v", err, kind)
	}
	if err.Error() != msg {
		t.Errorf("message = %q, want %q", err.Error(), msg)
	}
}

func TestForkWorkspace_CopiesTheParent(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	parent := parentWorkspace()
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parent, nil)
	env.idgen.EXPECT().NextID().Return(fkFork)
	var created model.Workspace
	env.repo.EXPECT().CreateWorkspace(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m model.Workspace) (model.Workspace, error) {
			created = m
			return m, nil
		})

	rs, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: fkParent})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != fkFork || created.ForkOfID != fkParent || created.Name != "api fork" || created.UserID != testUserID {
		t.Errorf("created = %+v", created)
	}
	if created.Icon != "icon" || created.Description != "the API" {
		t.Errorf("icon/description not copied: %+v", created)
	}
	if created.WorkingDirectory != "" {
		t.Errorf("working directory = %q: the daemon makes the fork's folder", created.WorkingDirectory)
	}
	if !reflect.DeepEqual(created.ForkSettings(), parent.ForkSettings()) {
		t.Errorf("settings = %v, want the parent's %v", created.ForkSettings(), parent.ForkSettings())
	}
	if created.CreatedAt.IsZero() || created.CreatedAt.Equal(parent.CreatedAt) {
		t.Error("the fork kept the parent's creation time")
	}
	if rs.Workspace.ForkOfID != fkParent || rs.Workspace.ForkOf == nil || rs.Workspace.ForkOf.Name != "api" {
		t.Errorf("response = %+v", rs.Workspace)
	}
	// A fork is a workspace too, so both are counted.
	if got := env.actions(); !reflect.DeepEqual(got, []entity.Action{entity.ActionWorkspaceCreate, entity.ActionWorkspaceForkCreate}) {
		t.Errorf("actions = %v", got)
	}
	for _, e := range *env.events {
		if e.WorkspaceID != fkFork || e.UserID != testUserID {
			t.Errorf("event = %+v", e)
		}
	}
}

func TestForkWorkspace_TakesTheGivenName(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
	env.idgen.EXPECT().NextID().Return(fkFork)
	env.repo.EXPECT().CreateWorkspace(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m model.Workspace) (model.Workspace, error) { return m, nil })

	rs, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: fkParent, Name: "billing"})
	if err != nil || rs.Workspace.Name != "billing" {
		t.Fatalf("name = %q, err = %v", rs.Workspace.Name, err)
	}
}

func TestForkName_FitsTheColumn(t *testing.T) {
	if got := forkName("api"); got != "api fork" {
		t.Errorf("forkName = %q", got)
	}
	long := strings.Repeat("é", 200)
	got := forkName(long)
	if n := len([]rune(got)); n != maxWorkspaceNameRunes || !strings.HasSuffix(got, " fork") {
		t.Errorf("forkName of 200 runes = %d runes, %q", n, got[len(got)-10:])
	}
}

func TestForkWorkspace_Refusals(t *testing.T) {
	archived := parentWorkspace()
	now := time.Now()
	archived.ArchivedAt = &now
	supervisor := parentWorkspace()
	supervisor.Name = "supervisor"

	for _, tc := range []struct {
		name   string
		parent model.Workspace
		msg    string
	}{
		{"a fork", forkWorkspace(), "a fork cannot be forked"},
		{"the supervisor", supervisor, "the supervisor workspace cannot be forked"},
		{"archived", archived, "an archived workspace cannot be forked"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newMachineTelemetryEnv(t)
			env.repo.EXPECT().GetWorkspace(gomock.Any(), gomock.Any(), testUserID).Return(tc.parent, nil)
			_, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: tc.parent.ID})
			wantForkErr(t, err, entity.ErrForkOfFork, tc.msg)
			if len(*env.events) != 0 {
				t.Errorf("a refused fork was counted: %v", env.actions())
			}
		})
	}
}

func TestForkWorkspace_Errors(t *testing.T) {
	t.Run("rate limited", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.controller.(*controller).limiter = &denyWorkspaceLimiter{}
		_, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: fkParent})
		if err == nil || err.Error() != "rate limit exceeded" {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("parent not found", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.controller.(*controller).limiter = &stubLimiter{}
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(model.Workspace{}, base.ErrNotFound)
		_, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: fkParent})
		if !errors.Is(err, base.ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("create fails", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
		env.idgen.EXPECT().NextID().Return(fkFork)
		env.repo.EXPECT().CreateWorkspace(gomock.Any(), gomock.Any()).Return(model.Workspace{}, errors.New("db"))
		if _, err := env.controller.ForkWorkspace(context.Background(), entity.ForkWorkspaceRequest{UserID: testUserIDStr, WorkspaceID: fkParent}); err == nil {
			t.Fatal("expected an error")
		}
		if len(*env.events) != 0 {
			t.Error("a failed fork was counted")
		}
	})
}

func TestMergeFork_MovesTheTasksBack(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
	env.repo.EXPECT().MergeForkIntoParent(gomock.Any(), fkFork, fkParent).Return([]int64{1, 2, 3}, nil)
	env.repo.EXPECT().GetTask(gomock.Any(), fkParent, int64(1), testUserID).Return(model.Task{ID: 1, WorkspaceID: fkParent}, nil)
	// A task that cannot be read back misses its live update, not the merge.
	env.repo.EXPECT().GetTask(gomock.Any(), fkParent, int64(2), testUserID).Return(model.Task{}, errors.New("gone"))
	env.repo.EXPECT().GetTask(gomock.Any(), fkParent, int64(3), testUserID).Return(model.Task{ID: 3, WorkspaceID: fkParent}, nil)

	rs, err := env.controller.MergeFork(context.Background(), entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkFork})
	if err != nil {
		t.Fatal(err)
	}
	if rs.MovedTasks != 3 || len(rs.Tasks) != 2 || rs.Tasks[0].ID != 1 || rs.Tasks[1].ID != 3 {
		t.Errorf("response = %+v", rs)
	}
	if rs.ParentID != monoflake.ID(fkParent).String() {
		t.Errorf("parentId = %q", rs.ParentID)
	}
	e := env.only(t)
	if e.Action != entity.ActionWorkspaceForkMerge || e.WorkspaceID != fkParent || e.ResourceID != fkFork {
		t.Errorf("event = %+v: a merge is counted against the parent, which survives it", e)
	}
}

func TestMergeFork_Refusals(t *testing.T) {
	t.Run("not a fork", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
		_, err := env.controller.MergeFork(context.Background(), entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkParent})
		wantForkErr(t, err, entity.ErrNotAFork, "only a fork can be merged")
	})
	t.Run("unfinished", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
		env.repo.EXPECT().MergeForkIntoParent(gomock.Any(), fkFork, fkParent).
			Return(nil, entity.NewForkError(entity.ErrForkUnfinished, "2 tasks in this fork are not finished"))
		_, err := env.controller.MergeFork(context.Background(), entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkFork})
		wantForkErr(t, err, entity.ErrForkUnfinished, "2 tasks in this fork are not finished")
		if len(*env.events) != 0 {
			t.Error("a refused merge was counted")
		}
	})
	t.Run("not found", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(model.Workspace{}, base.ErrNotFound)
		_, err := env.controller.MergeFork(context.Background(), entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkFork})
		if !errors.Is(err, base.ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestDeleteAndArchive_RefuseForksAndTheirParents(t *testing.T) {
	type op func(env *machineTelemetryEnv, id int64) error
	del := func(env *machineTelemetryEnv, id int64) error {
		return env.controller.DeleteWorkspace(context.Background(), entity.DeleteWorkspaceRequest{ID: id, UserID: testUserIDStr})
	}
	archive := func(env *machineTelemetryEnv, id int64) error {
		return env.controller.ArchiveWorkspace(context.Background(), entity.ArchiveWorkspaceRequest{ID: id, UserID: testUserIDStr})
	}
	for name, do := range map[string]op{"delete": del, "archive": archive} {
		t.Run(name+" a fork", func(t *testing.T) {
			env := newMachineTelemetryEnv(t)
			env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
			wantForkErr(t, do(env, fkFork), entity.ErrForkNoDelete, "merge this fork instead")
		})
		for n, msg := range map[int64]string{
			1: "this workspace has 1 fork; merge it first",
			3: "this workspace has 3 forks; merge them first",
		} {
			t.Run(name+" a parent", func(t *testing.T) {
				env := newMachineTelemetryEnv(t)
				env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
				env.repo.EXPECT().CountForks(gomock.Any(), fkParent, testUserID).Return(n, nil)
				wantForkErr(t, do(env, fkParent), entity.ErrHasForks, msg)
			})
		}
		t.Run(name+" count fails", func(t *testing.T) {
			env := newMachineTelemetryEnv(t)
			env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
			env.repo.EXPECT().CountForks(gomock.Any(), fkParent, testUserID).Return(int64(0), errors.New("db"))
			if err := do(env, fkParent); err == nil || err.Error() != "db" {
				t.Fatalf("err = %v", err)
			}
		})
	}
	t.Run("delete not found", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(model.Workspace{}, base.ErrNotFound)
		if err := del(env, fkParent); !errors.Is(err, base.ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	})
}

// updateRequest is what the settings form sends for w, unchanged.
func updateRequest(w model.Workspace) entity.UpdateWorkspaceRequest {
	e := fromModelWorkspaceToEntity(w)
	e.Icon = "" // an icon is sent only when it changes
	return entity.UpdateWorkspaceRequest{UserID: testUserIDStr, Workspace: e}
}

func TestUpdateWorkspace_ForkKeepsItsInheritedSettings(t *testing.T) {
	change := map[string]func(*entity.Workspace){
		"notification_settings":    func(w *entity.Workspace) { w.NotificationSettings = &entity.NotificationSettings{TaskCreated: false} },
		"auto_allowed_tools":       func(w *entity.Workspace) { w.AutoAllowedTools = []string{"Bash", "Edit"} },
		"allow_all_commands":       func(w *entity.Workspace) { w.AllowAllCommands = false },
		"clear_context_default":    func(w *entity.Workspace) { w.ClearContextDefault = false },
		"self_learning_loop_note":  func(w *entity.Workspace) { w.SelfLearningLoopNote = "other" },
		"input_send_delay_seconds": func(w *entity.Workspace) { w.InputSendDelaySeconds = 10 },
	}
	// Every inherited setting is refused here, and nothing else is inherited.
	for col := range forkWorkspace().ForkSettings() {
		if change[col] == nil {
			t.Errorf("no refusal case for %s", col)
		}
	}
	for col, mutate := range change {
		t.Run(col, func(t *testing.T) {
			env := newMachineTelemetryEnv(t)
			env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
			env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
			rq := updateRequest(forkWorkspace())
			mutate(&rq.Workspace)
			_, err := env.controller.UpdateWorkspace(context.Background(), rq)
			wantForkErr(t, err, entity.ErrForkInherited, "this setting is inherited from api; change it there")
		})
	}
	t.Run("parent unreadable", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(model.Workspace{}, errors.New("db"))
		rq := updateRequest(forkWorkspace())
		rq.Workspace.AllowAllCommands = false
		_, err := env.controller.UpdateWorkspace(context.Background(), rq)
		wantForkErr(t, err, entity.ErrForkInherited, "this setting is inherited from its parent; change it there")
	})
}

func TestUpdateWorkspace_ForkEditsItsOwnFields(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
	env.repo.EXPECT().UpdateWorkspace(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m model.Workspace) (model.Workspace, error) { return m, nil })
	rq := updateRequest(forkWorkspace())
	rq.Workspace.Name = "renamed"
	rq.Workspace.Description = "mine"
	rq.Workspace.WorkingDirectory = "/home/me/.agentrq/forks/x"
	rs, err := env.controller.UpdateWorkspace(context.Background(), rq)
	if err != nil {
		t.Fatal(err)
	}
	if rs.Workspace.Name != "renamed" || rs.Workspace.WorkingDirectory != "/home/me/.agentrq/forks/x" || rs.ForkIDs != nil {
		t.Errorf("response = %+v", rs)
	}
}

func TestUpdateWorkspace_ParentNamesItsForks(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
	env.repo.EXPECT().UpdateWorkspace(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m model.Workspace) (model.Workspace, error) { return m, nil })
	env.repo.EXPECT().ListForks(gomock.Any(), fkParent, testUserID).Return([]model.Workspace{{ID: 21}, {ID: 22}}, nil)
	rq := updateRequest(parentWorkspace())
	rq.Workspace.AllowAllCommands = false
	rs, err := env.controller.UpdateWorkspace(context.Background(), rq)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(rs.ForkIDs, []int64{21, 22}) {
		t.Errorf("forkIds = %v", rs.ForkIDs)
	}
}

func TestUpdateWorkspaceAutoAllowedTools_ForkWritesItsParent(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
	env.repo.EXPECT().UpdateWorkspace(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m model.Workspace) (model.Workspace, error) {
			if m.ID != fkParent || string(m.AutoAllowedTools) != `["Bash","Edit"]` {
				t.Errorf("saved %d with %s", m.ID, m.AutoAllowedTools)
			}
			return m, nil
		})
	err := env.controller.UpdateWorkspaceAutoAllowedTools(context.Background(), entity.UpdateWorkspaceAutoAllowedToolsRequest{
		WorkspaceID: fkFork, UserID: testUserIDStr, Tools: []string{"Bash", "Edit"},
	})
	if err != nil {
		t.Fatal(err)
	}

	env = newMachineTelemetryEnv(t)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
	env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(model.Workspace{}, base.ErrNotFound)
	err = env.controller.UpdateWorkspaceAutoAllowedTools(context.Background(), entity.UpdateWorkspaceAutoAllowedToolsRequest{
		WorkspaceID: fkFork, UserID: testUserIDStr, Tools: []string{"Bash"},
	})
	if !errors.Is(err, base.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestListWorkspaces_FillsInForks(t *testing.T) {
	env := newMachineTelemetryEnv(t)
	orphan := model.Workspace{ID: 30, UserID: testUserID, Name: "orphan", ForkOfID: 99}
	env.repo.EXPECT().ListWorkspaces(gomock.Any(), testUserID, false).
		Return([]model.Workspace{forkWorkspace(), parentWorkspace(), orphan, {ID: 40, Name: "plain"}}, nil)
	env.repo.EXPECT().CountUnfinishedTasks(gomock.Any(), []int64{fkFork, 30}).Return(map[int64]int64{fkFork: 2}, nil)

	rs, err := env.controller.ListWorkspaces(context.Background(), entity.ListWorkspacesRequest{UserID: testUserIDStr})
	if err != nil {
		t.Fatal(err)
	}
	fork, parent, orph, plain := rs.Workspaces[0], rs.Workspaces[1], rs.Workspaces[2], rs.Workspaces[3]
	if fork.ForkOfID != fkParent || fork.ForkOf == nil || fork.ForkOf.Name != "api" || fork.UnfinishedTasks != 2 {
		t.Errorf("fork = %+v", fork)
	}
	if parent.ForkCount != 1 || parent.ForkOf != nil {
		t.Errorf("parent = %+v", parent)
	}
	if orph.ForkOfID != 99 || orph.ForkOf != nil || orph.UnfinishedTasks != 0 {
		t.Errorf("fork of a parent not listed = %+v", orph)
	}
	if plain.ForkCount != 0 || plain.ForkOfID != 0 {
		t.Errorf("plain = %+v", plain)
	}

	env = newMachineTelemetryEnv(t)
	env.repo.EXPECT().ListWorkspaces(gomock.Any(), testUserID, false).Return([]model.Workspace{forkWorkspace()}, nil)
	env.repo.EXPECT().CountUnfinishedTasks(gomock.Any(), gomock.Any()).Return(nil, errors.New("db"))
	if _, err := env.controller.ListWorkspaces(context.Background(), entity.ListWorkspacesRequest{UserID: testUserIDStr}); err == nil {
		t.Fatal("expected the count's error")
	}
}

func TestSameForkSettings_ComparesMeaning(t *testing.T) {
	a := parentWorkspace()
	b := parentWorkspace()
	b.NotificationSettings = datatypes.JSON(`{ "TaskCreated": true }`)
	if !sameForkSettings(a, b) {
		t.Error("the same JSON with other spacing counted as a change")
	}
	b.NotificationSettings = datatypes.JSON(`{"TaskCreated":true,"TaskStatusUpdated":false,"Channels":[],"c":"","d":0,"x":null}`)
	if !sameForkSettings(a, b) {
		t.Error("a key set to its zero value counted as a change")
	}
	a.AutoAllowedTools, b.AutoAllowedTools = nil, datatypes.JSON(`[]`)
	a.NotificationSettings, b.NotificationSettings = datatypes.JSON(`{}`), datatypes.JSON(`null`)
	if !sameForkSettings(a, b) {
		t.Error("empty, [] , {} and null counted as different")
	}
	b.NotificationSettings = datatypes.JSON(`not json`)
	if !sameForkSettings(a, b) {
		t.Error("unreadable JSON is no setting at all")
	}
	b.AutoAllowedTools = datatypes.JSON(`["Bash"]`)
	if sameForkSettings(a, b) {
		t.Error("a new tool went unnoticed")
	}
}

// The check a merge makes before stopping the fork's agent.
func TestCheckForkMerge(t *testing.T) {
	req := entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkFork}
	t.Run("ready", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
		env.repo.EXPECT().CountUnfinishedTasks(gomock.Any(), []int64{fkFork}).Return(map[int64]int64{}, nil)
		if err := env.controller.CheckForkMerge(context.Background(), req); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("unfinished", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
		env.repo.EXPECT().CountUnfinishedTasks(gomock.Any(), []int64{fkFork}).Return(map[int64]int64{fkFork: 1}, nil)
		wantForkErr(t, env.controller.CheckForkMerge(context.Background(), req), entity.ErrForkUnfinished, "1 task in this fork is not finished")
	})
	t.Run("not a fork", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkParent, testUserID).Return(parentWorkspace(), nil)
		err := env.controller.CheckForkMerge(context.Background(), entity.MergeForkRequest{UserID: testUserIDStr, WorkspaceID: fkParent})
		wantForkErr(t, err, entity.ErrNotAFork, "only a fork can be merged")
	})
	t.Run("count fails", func(t *testing.T) {
		env := newMachineTelemetryEnv(t)
		env.repo.EXPECT().GetWorkspace(gomock.Any(), fkFork, testUserID).Return(forkWorkspace(), nil)
		env.repo.EXPECT().CountUnfinishedTasks(gomock.Any(), []int64{fkFork}).Return(nil, errors.New("db down"))
		if err := env.controller.CheckForkMerge(context.Background(), req); err == nil {
			t.Fatal("want the error")
		}
	})
}
