// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"testing"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
)

// mockTaskCrud isolates the createTask tool from the rest of crud.Controller,
// the same way mockEventCrud does for the event tools.
type mockTaskCrud struct {
	crud.Controller

	createTask func(ctx context.Context, req entity.CreateTaskRequest) (*entity.CreateTaskResponse, error)
}

func (m *mockTaskCrud) CreateTask(ctx context.Context, req entity.CreateTaskRequest) (*entity.CreateTaskResponse, error) {
	return m.createTask(ctx, req)
}

func taskServer(ctrl *mockTaskCrud) *WorkspaceServer {
	return &WorkspaceServer{crud: ctrl}
}

// The supervisor writes full context into a task's body before handing it to
// another workspace, so the receiving agent should be able to ask for a clean
// slate the same way a workspace's own createTask tool already can.
func TestCreateTask_PassesClearContextThrough(t *testing.T) {
	var got entity.CreateTaskRequest
	ctrl := &mockTaskCrud{createTask: func(_ context.Context, req entity.CreateTaskRequest) (*entity.CreateTaskResponse, error) {
		got = req
		return &entity.CreateTaskResponse{Task: entity.Task{ID: testWorkspace, ClearContext: req.Task.ClearContext}}, nil
	}}

	textOf(t, toolResult(taskServer(ctrl).handleCreateTask(authedContext(), nil, CreateTaskParams{
		WorkspaceID:  base62(testWorkspace),
		Title:        "Wire up the new gateway",
		ClearContext: true,
	})))

	if !got.Task.ClearContext {
		t.Errorf("expected ClearContext to be carried through to the create request")
	}
}

// Omitting the field must not be silently coerced to true: a caller that
// says nothing gets the target workspace's own default, applied downstream
// in the crud controller, not a value forced here.
func TestCreateTask_ClearContextDefaultsToFalseWhenOmitted(t *testing.T) {
	var got entity.CreateTaskRequest
	ctrl := &mockTaskCrud{createTask: func(_ context.Context, req entity.CreateTaskRequest) (*entity.CreateTaskResponse, error) {
		got = req
		return &entity.CreateTaskResponse{Task: entity.Task{ID: testWorkspace}}, nil
	}}

	textOf(t, toolResult(taskServer(ctrl).handleCreateTask(authedContext(), nil, CreateTaskParams{
		WorkspaceID: base62(testWorkspace),
		Title:       "Wire up the new gateway",
	})))

	if got.Task.ClearContext {
		t.Errorf("expected ClearContext to stay false when the caller did not ask for it")
	}
	if got.Task.CreatedBy != "agent" {
		t.Errorf("CreatedBy = %q, want %q so the crud layer applies the workspace's clearContextDefault", got.Task.CreatedBy, "agent")
	}
}
