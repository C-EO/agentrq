// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package base

import (
	"context"
	"testing"
	"time"

	"github.com/agentrq/agentrq/backend/internal/data/model"
)

func TestCreateTaskWithMessages_WritesBoth(t *testing.T) {
	db := deleteTaskDB(t)
	repo := New(&mockDB{db: db})
	now := time.Now()

	task := model.Task{ID: dtTaskID, CreatedAt: now, UpdatedAt: now, WorkspaceID: dtWorkspaceID, UserID: dtUserID, Status: "ongoing", Title: "Fork: x"}
	msgs := []model.Message{
		{ID: 1, CreatedAt: now, TaskID: dtTaskID, UserID: dtUserID, Sender: "human", Text: "a"},
		{ID: 2, CreatedAt: now, TaskID: dtTaskID, UserID: dtUserID, Sender: "agent", Text: "b"},
	}
	if _, err := repo.CreateTaskWithMessages(context.Background(), task, msgs); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := repo.ListMessages(context.Background(), dtTaskID)
	if err != nil || len(got) != 2 {
		t.Fatalf("messages = %d, %v; want 2", len(got), err)
	}
}

func TestCreateTaskWithMessages_NoMessages(t *testing.T) {
	db := deleteTaskDB(t)
	repo := New(&mockDB{db: db})
	now := time.Now()

	task := model.Task{ID: dtTaskID, CreatedAt: now, UpdatedAt: now, WorkspaceID: dtWorkspaceID, UserID: dtUserID, Status: "ongoing", Title: "Fork: x"}
	if _, err := repo.CreateTaskWithMessages(context.Background(), task, nil); err != nil {
		t.Fatalf("create: %v", err)
	}
}

// A message that cannot be written takes the task down with it: a fork is
// either the whole conversation or nothing.
func TestCreateTaskWithMessages_AllOrNothing(t *testing.T) {
	db := deleteTaskDB(t)
	repo := New(&mockDB{db: db})
	now := time.Now()

	task := model.Task{ID: dtTaskID, CreatedAt: now, UpdatedAt: now, WorkspaceID: dtWorkspaceID, UserID: dtUserID, Status: "ongoing", Title: "Fork: x"}
	dup := []model.Message{
		{ID: 1, CreatedAt: now, TaskID: dtTaskID, UserID: dtUserID, Sender: "human", Text: "a"},
		{ID: 1, CreatedAt: now, TaskID: dtTaskID, UserID: dtUserID, Sender: "human", Text: "same id"},
	}
	if _, err := repo.CreateTaskWithMessages(context.Background(), task, dup); err == nil {
		t.Fatal("expected the duplicate message ID to fail the write")
	}
	var n int64
	db.Model(&model.Task{}).Where("id = ?", dtTaskID).Count(&n)
	if n != 0 {
		t.Fatalf("task row survived a failed fork (%d rows)", n)
	}

	// And a task that cannot be written stops before any message.
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateTaskWithMessages(context.Background(), task, dup[:1]); err == nil {
		t.Fatal("expected the duplicate task ID to fail the write")
	}
	db.Model(&model.Message{}).Count(&n)
	if n != 0 {
		t.Fatalf("messages written for a task that failed (%d rows)", n)
	}
}
