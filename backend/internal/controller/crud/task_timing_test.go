// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package crud

import (
	"context"
	"errors"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/golang/mock/gomock"
)

// stubAgentNamer answers Names from fixed maps and records the IDs it was
// asked for.
type stubAgentNamer struct {
	agents, models     map[int64]string
	err                error
	agentIDs, modelIDs []int64
}

func (f *stubAgentNamer) Names(_ context.Context, agentIDs, modelIDs []int64) (map[int64]string, map[int64]string, error) {
	f.agentIDs, f.modelIDs = agentIDs, modelIDs
	return f.agents, f.models, f.err
}

// useAgentNamer rebuilds the test controller so that it names agents through
// namer.
func useAgentNamer(e *testEnv, namer TaskAgentNames) {
	e.controller = New(Params{Repository: e.repo, TaskAgents: namer})
}

func TestGetTask_StateTransitions(t *testing.T) {
	e := newTestController(t)
	namer := &stubAgentNamer{agents: map[int64]string{7: "claude-code"}, models: map[int64]string{9: "Opus"}}
	useAgentNamer(e, namer)

	start := time.Now().Add(-time.Hour)
	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1, Status: "completed"}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return([]model.TaskStateTransition{
		{TaskID: 10, FromState: model.TaskStateNone, ToState: model.TaskStateOngoing, CreatedAt: start},
		{TaskID: 10, FromState: model.TaskStateOngoing, ToState: model.TaskStateCompleted, AgentID: 7, AgentModelID: 9, CreatedAt: start.Add(20 * time.Minute)},
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
	if resp.StateTransitions[0].Agent != "" || resp.StateTransitions[1].Agent != "claude-code" || resp.StateTransitions[1].AgentModel != "Opus" {
		t.Fatalf("transitions = %+v, want claude-code on Opus named on the change it made and nobody on the first", resp.StateTransitions)
	}
	if len(namer.agentIDs) != 1 || namer.agentIDs[0] != 7 || len(namer.modelIDs) != 1 || namer.modelIDs[0] != 9 {
		t.Fatalf("namer was asked for agents %v and models %v, want agents [7] and models [9]", namer.agentIDs, namer.modelIDs)
	}
	if resp.Timing.WorkedSeconds != 20*60 || resp.Timing.StartToCloseSeconds == nil || *resp.Timing.StartToCloseSeconds != 20*60 {
		t.Fatalf("timing = %+v", resp.Timing)
	}
}

func TestGetTask_StateTransitionsError(t *testing.T) {
	e := newTestController(t)

	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return(nil, errors.New("database unavailable"))

	if _, err := e.controller.GetTask(context.Background(), entity.GetTaskRequest{WorkspaceID: 1, TaskID: 10, UserID: testUserIDStr}); err == nil {
		t.Fatal("expected the history lookup's error")
	}
}

func TestGetTask_AgentNamesError(t *testing.T) {
	e := newTestController(t)
	namer := &stubAgentNamer{err: errors.New("database unavailable")}
	useAgentNamer(e, namer)

	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return([]model.TaskStateTransition{
		{TaskID: 10, ToState: model.TaskStateOngoing, AgentID: 7},
		{TaskID: 10, FromState: model.TaskStateOngoing, ToState: model.TaskStateBlocked, AgentID: 7},
	}, nil)

	if _, err := e.controller.GetTask(context.Background(), entity.GetTaskRequest{WorkspaceID: 1, TaskID: 10, UserID: testUserIDStr}); err == nil {
		t.Fatal("GetTask succeeded, want the namer's error returned")
	}
	if len(namer.agentIDs) != 1 || namer.modelIDs != nil {
		t.Fatalf("namer was asked for agents %v and models %v, want agent 7 once and no models", namer.agentIDs, namer.modelIDs)
	}
}

// Without a namer the history still loads, its agents unnamed.
func TestGetTask_NoTaskAgents(t *testing.T) {
	e := newTestController(t)

	e.repo.EXPECT().GetTask(gomock.Any(), int64(1), int64(10), testUserID).Return(model.Task{ID: 10, WorkspaceID: 1}, nil)
	e.repo.EXPECT().ListTaskStateTransitions(gomock.Any(), int64(10)).Return([]model.TaskStateTransition{
		{TaskID: 10, ToState: model.TaskStateOngoing, AgentID: 7},
	}, nil)

	resp, err := e.controller.GetTask(context.Background(), entity.GetTaskRequest{WorkspaceID: 1, TaskID: 10, UserID: testUserIDStr})
	if err != nil || len(resp.StateTransitions) != 1 || resp.StateTransitions[0].Agent != "" {
		t.Fatalf("GetTask = %+v, %v; want the one transition, with no agent name", resp, err)
	}
}
