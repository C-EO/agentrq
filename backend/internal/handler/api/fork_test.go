// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/repository/base"
	"github.com/agentrq/agentrq/backend/internal/service/eventbus"
	"github.com/gofiber/fiber/v2"
	"github.com/mustafaturan/monoflake"
)

type mockCrudForkTask struct {
	crud.Controller
	ongoing []entity.Task
	forkErr error
	got     entity.ForkTaskRequest
}

func (m *mockCrudForkTask) ListTasks(ctx context.Context, req entity.ListTasksRequest) (*entity.ListTasksResponse, error) {
	return &entity.ListTasksResponse{Tasks: m.ongoing}, nil
}

func (m *mockCrudForkTask) ForkTask(ctx context.Context, req entity.ForkTaskRequest) (*entity.ForkTaskResponse, error) {
	m.got = req
	if m.forkErr != nil {
		return nil, m.forkErr
	}
	return &entity.ForkTaskResponse{Task: entity.Task{
		ID: 77, WorkspaceID: req.WorkspaceID, Status: req.Status, Title: "Fork: Build it", Body: "Forked from task x.",
	}}, nil
}

func postFork(t *testing.T, ctrl *mockCrudForkTask, srv *fakeWorkspaceServer, body string) *http.Response {
	t.Helper()
	app := fiber.New()
	h := &handler{crud: ctrl, mcpManager: &fakeMCPManager{server: srv}, bus: eventbus.New()}
	app.Post(_routePathFork, func(c *fiber.Ctx) error {
		c.Locals("user_id", monoflake.ID(100).String())
		return h.forkTask()(c)
	})
	url := "/workspaces/" + monoflake.ID(1).String() + "/tasks/" + monoflake.ID(9).String() + "/fork"
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// An idle agent gets the fork as ongoing, and straight away: the poller never
// offers an ongoing task, so a fork that is not pushed here is never sent.
func TestForkTask_OngoingAndPushedWhenTheAgentHasRoom(t *testing.T) {
	ctrl := &mockCrudForkTask{}
	srv := &fakeWorkspaceServer{}
	resp := postFork(t, ctrl, srv, `{"messageId":"`+monoflake.ID(5).String()+`"}`)

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if ctrl.got.Status != "ongoing" || ctrl.got.WorkspaceID != 1 || ctrl.got.TaskID != 9 || ctrl.got.MessageID != 5 {
		t.Errorf("fork request = %+v", ctrl.got)
	}
	if srv.notifiedTaskID != 77 || !strings.Contains(srv.notifiedContent, "Forked from task") {
		t.Errorf("pushed task %d with %q", srv.notifiedTaskID, srv.notifiedContent)
	}
	var out struct {
		Task struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"task"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Task.ID != monoflake.ID(77).String() || out.Task.Status != "ongoing" {
		t.Errorf("response task = %+v", out.Task)
	}
}

// Forking the task the agent is working on is the usual case, and there the
// fork waits as notstarted for the poller rather than being pushed mid-turn.
func TestForkTask_WaitsAsNotStartedWhileTheAgentIsBusy(t *testing.T) {
	ctrl := &mockCrudForkTask{ongoing: []entity.Task{{ID: 9, Status: "ongoing"}}}
	srv := &fakeWorkspaceServer{}
	resp := postFork(t, ctrl, srv, `{"messageId":"`+monoflake.ID(5).String()+`"}`)

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	if ctrl.got.Status != "notstarted" {
		t.Errorf("status = %q, want notstarted", ctrl.got.Status)
	}
	if len(srv.calls) != 0 {
		t.Errorf("calls = %v, want no push while busy", srv.calls)
	}
}

func TestForkTask_RejectsAMissingMessageID(t *testing.T) {
	for _, body := range []string{`{}`, `not json`} {
		resp := postFork(t, &mockCrudForkTask{}, &fakeWorkspaceServer{}, body)
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("%s: status = %d, want 422", body, resp.StatusCode)
		}
	}
}

func TestForkTask_NotFound(t *testing.T) {
	srv := &fakeWorkspaceServer{}
	resp := postFork(t, &mockCrudForkTask{forkErr: base.ErrNotFound}, srv, `{"messageId":"`+monoflake.ID(5).String()+`"}`)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if len(srv.calls) != 0 {
		t.Errorf("calls = %v, want nothing pushed for a failed fork", srv.calls)
	}
}

func TestForkTask_ServerError(t *testing.T) {
	resp := postFork(t, &mockCrudForkTask{forkErr: errors.New("boom")}, &fakeWorkspaceServer{}, `{"messageId":"`+monoflake.ID(5).String()+`"}`)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
}

type mockCrudPushEvent struct {
	crud.Controller
	err error
}

func (m *mockCrudPushEvent) GetEvent(ctx context.Context, req entity.GetEventRequest) (*entity.GetEventResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &entity.GetEventResponse{Event: entity.Event{Name: "deployed"}}, nil
}

// A task bound to an event carries the publish instruction in its push, and
// one whose event cannot be read is still pushed, without it.
func TestPushTaskToAgent_EventInstruction(t *testing.T) {
	task := entity.Task{ID: 7, WorkspaceID: 1, Title: "t", EventID: 3, Attachments: []entity.Attachment{{ID: "a1", Filename: "log.txt"}}}

	srv := &fakeWorkspaceServer{}
	h := &handler{crud: &mockCrudPushEvent{}, mcpManager: &fakeMCPManager{server: srv}}
	h.pushTaskToAgent(context.Background(), monoflake.ID(100).String(), task)
	if !strings.Contains(srv.notifiedContent, "deployed") || !strings.Contains(srv.notifiedContent, "log.txt") {
		t.Errorf("content = %q, want the attachment and the event instruction", srv.notifiedContent)
	}

	srv = &fakeWorkspaceServer{}
	h = &handler{crud: &mockCrudPushEvent{err: errors.New("gone")}, mcpManager: &fakeMCPManager{server: srv}}
	h.pushTaskToAgent(context.Background(), monoflake.ID(100).String(), task)
	if srv.notifiedTaskID != 7 || strings.Contains(srv.notifiedContent, "deployed") {
		t.Errorf("pushed %d with %q", srv.notifiedTaskID, srv.notifiedContent)
	}
}
