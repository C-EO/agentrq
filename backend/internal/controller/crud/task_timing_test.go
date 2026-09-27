// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package crud

import (
	"context"
	"fmt"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/golang/mock/gomock"
)

func TestGetTask_StateTransitions(t *testing.T) {
	e := newTestController(t)

	start := time.Now().Add(-time.Hour)
	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1, Status: "completed"}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return([]model.TaskStateTransition{
		{TaskID: 10, FromState: model.TaskStateNone, ToState: model.TaskStateOngoing, CreatedAt: start},
		{TaskID: 10, FromState: model.TaskStateOngoing, ToState: model.TaskStateCompleted, CreatedAt: start.Add(20 * time.Minute)},
	}, nil)

	resp, err := e.controller.GetTask(context.Background(), entity.GetTaskRequest{WorkspaceID: 1, TaskID: 10, UserID: testUserIDStr})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.StateTransitions) != 2 ||
		resp.StateTransitions[0].FromState != "" || resp.StateTransitions[0].ToState != "ongoing" ||
		resp.StateTransitions[1].FromState != "ongoing" || resp.StateTransitions[1].ToState != "completed" {
		t.Fatalf("transitions = %+v", resp.StateTransitions)
	}
	if resp.Timing.WorkedSeconds != 20*60 || resp.Timing.StartToCloseSeconds == nil || *resp.Timing.StartToCloseSeconds != 20*60 {
		t.Fatalf("timing = %+v", resp.Timing)
	}
}

func TestGetTask_StateTransitionsError(t *testing.T) {
	e := newTestController(t)

	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return(nil, fmt.Errorf("boom"))

	if _, err := e.controller.GetTask(context.Background(), entity.GetTaskRequest{WorkspaceID: 1, TaskID: 10, UserID: testUserIDStr}); err == nil {
		t.Fatal("expected the history lookup's error")
	}
}
