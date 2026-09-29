// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package app

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/golang/mock/gomock"
	"github.com/mustafaturan/monoflake"
	"gorm.io/gorm"

	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/agentrq/agentrq/backend/internal/repository/base"
	mock_repository "github.com/agentrq/agentrq/backend/internal/service/mocks/repository"
)

type sqliteConn struct{ db *gorm.DB }

func (c sqliteConn) Conn(context.Context) *gorm.DB { return c.db }
func (c sqliteConn) Close(context.Context)         {}

type countingIDs struct{ n atomic.Int64 }

func (c *countingIDs) NextID() int64        { return 5000 + c.n.Add(1) }
func (c *countingIDs) NextIDString() string { return monoflake.ID(c.NextID()).String() }

const (
	memUser   = int64(482467435371298817)
	memParent = int64(10)
	memFork   = int64(20)
)

func TestMCPWorkspaceResolvesAForkToItsParent(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := mock_repository.NewMockRepository(ctrl)
	owner := monoflake.ID(memUser).String()

	repo.EXPECT().SystemGetWorkspace(gomock.Any(), memFork).Return(model.Workspace{ID: memFork, UserID: memUser, ForkOfID: memParent}, nil)
	w, gotOwner, content := mcpWorkspace(context.Background(), repo, memFork, "someone")
	if w.ID != memFork || gotOwner != owner || content != memParent {
		t.Errorf("a fork: %d, %s, %d; want %d, %s, %d", w.ID, gotOwner, content, memFork, owner, memParent)
	}

	repo.EXPECT().SystemGetWorkspace(gomock.Any(), memParent).Return(model.Workspace{ID: memParent, UserID: memUser}, nil)
	if _, _, content := mcpWorkspace(context.Background(), repo, memParent, "someone"); content != memParent {
		t.Errorf("a workspace: %d, want its own", content)
	}

	repo.EXPECT().SystemGetWorkspace(gomock.Any(), memFork).Return(model.Workspace{}, errRepo)
	if _, gotOwner, content := mcpWorkspace(context.Background(), repo, memFork, "someone"); gotOwner != "someone" || content != memFork {
		t.Errorf("unreadable: %s, %d; want the caller and itself", gotOwner, content)
	}
}

// A fork's agent reads its parent's memory.md, and what it saves is the
// parent's: a fork writes its learnings into the parent's memory.
func TestAForksMemoryIsItsParents(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Workspace{}, &model.Memory{}); err != nil {
		t.Fatal(err)
	}
	for _, w := range []model.Workspace{
		{ID: memParent, UserID: memUser, Name: "api"},
		{ID: memFork, UserID: memUser, Name: "api fork", ForkOfID: memParent},
	} {
		if err := db.Create(&w).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := base.New(sqliteConn{db: db})
	ids := &countingIDs{}
	ctx := context.Background()
	memoryOf := func(ws int64) workspaceMemory {
		_, owner, content := mcpWorkspace(ctx, repo, ws, "")
		return workspaceMemory{repo: repo, ids: ids, workspaceID: content, userID: owner}
	}
	parent, fork := memoryOf(memParent), memoryOf(memFork)

	if err := parent.save(ctx, "MEMORY.md", "# Index"); err != nil {
		t.Fatal(err)
	}
	if got, found, err := fork.load(ctx, "MEMORY.md"); err != nil || !found || got != "# Index" {
		t.Fatalf("the fork's loadMemory: %q, %v, %v; want the parent's", got, found, err)
	}

	if err := fork.save(ctx, "deploys.md", "how we ship"); err != nil {
		t.Fatal(err)
	}
	if got, found, _ := parent.load(ctx, "deploys.md"); !found || got != "how we ship" {
		t.Fatalf("the parent reads what the fork saved: %q, %v", got, found)
	}

	if deleted, err := fork.delete(ctx, "deploys.md"); err != nil || !deleted {
		t.Fatalf("the fork's deleteMemory: %v, %v", deleted, err)
	}
	if _, found, _ := parent.load(ctx, "deploys.md"); found {
		t.Fatal("deleted from the fork, the parent still has it")
	}
	if deleted, err := fork.delete(ctx, "deploys.md"); err != nil || deleted {
		t.Fatalf("deleting it again: %v, %v; want nothing to delete", deleted, err)
	}
	if _, found, err := fork.load(ctx, "never.md"); err != nil || found {
		t.Fatalf("a memory never written: %v, %v", found, err)
	}
}

func TestWorkspaceMemoryReportsStorageFailures(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := mock_repository.NewMockRepository(ctrl)
	m := workspaceMemory{repo: repo, ids: &countingIDs{}, workspaceID: memParent, userID: monoflake.ID(memUser).String()}
	ctx := context.Background()

	repo.EXPECT().GetMemory(gomock.Any(), memUser, memParent, "MEMORY.md").Return(model.Memory{}, errRepo)
	if _, _, err := m.load(ctx, "MEMORY.md"); err != errRepo {
		t.Errorf("load: %v", err)
	}
	repo.EXPECT().DeleteMemory(gomock.Any(), memUser, memParent, "MEMORY.md").Return(errRepo)
	if _, err := m.delete(ctx, "MEMORY.md"); err != errRepo {
		t.Errorf("delete: %v", err)
	}
}
