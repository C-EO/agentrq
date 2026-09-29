// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package base

import (
	"context"
	"reflect"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/agentrq/agentrq/backend/internal/data/model"
)

func TestSessionMachinesForWorkspace(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Session{}); err != nil {
		t.Fatal(err)
	}
	for _, s := range []model.Session{
		{ID: 1, WorkspaceID: 7, UserID: memUserID, MachineID: 4, Status: "killed"},
		{ID: 2, WorkspaceID: 7, UserID: memUserID, MachineID: 4, Status: "running"},
		{ID: 3, WorkspaceID: 7, UserID: memUserID, MachineID: 3, Status: "exited"},
		{ID: 4, WorkspaceID: 8, UserID: memUserID, MachineID: 9, Status: "running"},
		{ID: 5, WorkspaceID: 7, UserID: memOtherUserID, MachineID: 6, Status: "running"},
	} {
		if err := db.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(&mockDB{db: db})

	got, err := repo.SessionMachinesForWorkspace(context.Background(), 7, memUserID)
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{3, 4}; !reflect.DeepEqual(got, want) {
		t.Errorf("machines = %v, want %v (each once, this workspace and user only)", got, want)
	}
	if got, _ := repo.SessionMachinesForWorkspace(context.Background(), 99, memUserID); len(got) != 0 {
		t.Errorf("a workspace that never ran = %v", got)
	}
}
