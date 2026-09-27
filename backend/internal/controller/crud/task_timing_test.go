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

func TestTaskTiming(t *testing.T) {
	t0 := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	at := func(minutes int) time.Time { return t0.Add(time.Duration(minutes) * time.Minute) }
	tr := func(from, to string, minutes int) entity.TaskStateTransition {
		return entity.TaskStateTransition{FromState: from, ToState: to, CreatedAt: at(minutes)}
	}
	now := at(100)

	for _, tc := range []struct {
		name                          string
		transitions                   []entity.TaskStateTransition
		started, closed               *time.Time
		startToClose                  *int64
		blockedSeconds, workedSeconds int64
		needsInputSeconds             int64
	}{
		{name: "no history"},
		{
			name:        "not started yet",
			transitions: []entity.TaskStateTransition{tr("", "notstarted", 0)},
		},
		{
			name: "worked, blocked, worked, completed",
			transitions: []entity.TaskStateTransition{
				tr("", "notstarted", 0),
				tr("notstarted", "ongoing", 5),
				tr("ongoing", "blocked", 15),
				tr("blocked", "ongoing", 45),
				tr("ongoing", "completed", 50),
			},
			started: ptr(at(5)), closed: ptr(at(50)), startToClose: ptr(int64(45 * 60)),
			blockedSeconds: 30 * 60, workedSeconds: 15 * 60,
		},
		{
			name: "still blocked counts up to now",
			transitions: []entity.TaskStateTransition{
				tr("", "ongoing", 0),
				tr("ongoing", "blocked", 40),
			},
			started:        ptr(at(0)),
			blockedSeconds: 60 * 60, workedSeconds: 40 * 60,
		},
		{
			name: "reopened is not closed",
			transitions: []entity.TaskStateTransition{
				tr("", "ongoing", 0),
				tr("ongoing", "rejected", 10),
				tr("rejected", "ongoing", 90),
			},
			started:       ptr(at(0)),
			workedSeconds: 10*60 + 10*60,
		},
		{
			name: "needing input is its own total",
			transitions: []entity.TaskStateTransition{
				tr("", "ongoing", 0),
				tr("ongoing", "needsinput", 10),
				tr("needsinput", "ongoing", 25),
				tr("ongoing", "completed", 30),
			},
			started: ptr(at(0)), closed: ptr(at(30)), startToClose: ptr(int64(30 * 60)),
			workedSeconds: 15 * 60, needsInputSeconds: 15 * 60,
		},
		{
			name: "rejected without being started",
			transitions: []entity.TaskStateTransition{
				tr("", "notstarted", 0),
				tr("notstarted", "rejected", 10),
			},
			closed: ptr(at(10)),
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := taskTiming(tc.transitions, now)
			if !sameTime(got.StartedAt, tc.started) || !sameTime(got.ClosedAt, tc.closed) {
				t.Errorf("started, closed = %v, %v; want %v, %v", got.StartedAt, got.ClosedAt, tc.started, tc.closed)
			}
			if (got.StartToCloseSeconds == nil) != (tc.startToClose == nil) ||
				(got.StartToCloseSeconds != nil && *got.StartToCloseSeconds != *tc.startToClose) {
				t.Errorf("startToClose = %v, want %v", got.StartToCloseSeconds, tc.startToClose)
			}
			if got.NeedsInputSeconds != tc.needsInputSeconds {
				t.Errorf("needs input = %d, want %d", got.NeedsInputSeconds, tc.needsInputSeconds)
			}
			if got.BlockedSeconds != tc.blockedSeconds || got.WorkedSeconds != tc.workedSeconds {
				t.Errorf("blocked, worked = %d, %d; want %d, %d", got.BlockedSeconds, got.WorkedSeconds, tc.blockedSeconds, tc.workedSeconds)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

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
