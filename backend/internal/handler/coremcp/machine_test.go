// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
)

type mockMachineCrud struct {
	crud.Controller

	createEnrolmentCode func(ctx context.Context, req entity.CreateEnrolmentCodeRequest) (*entity.CreateEnrolmentCodeResponse, error)
}

func (m *mockMachineCrud) CreateEnrolmentCode(ctx context.Context, req entity.CreateEnrolmentCodeRequest) (*entity.CreateEnrolmentCodeResponse, error) {
	return m.createEnrolmentCode(ctx, req)
}

func machineServer(baseURL string, ctrl *mockMachineCrud) *WorkspaceServer {
	return &WorkspaceServer{crud: ctrl, baseURL: baseURL}
}

func TestCreateEnrolmentCode_ScopesToTheAuthenticatedUser(t *testing.T) {
	var got entity.CreateEnrolmentCodeRequest
	expiresAt := time.Unix(1_700_000_000, 0).UTC()
	ctrl := &mockMachineCrud{createEnrolmentCode: func(_ context.Context, req entity.CreateEnrolmentCodeRequest) (*entity.CreateEnrolmentCodeResponse, error) {
		got = req
		return &entity.CreateEnrolmentCodeResponse{Code: "ABC123", ExpiresAt: expiresAt}, nil
	}}

	body := textOf(t, toolResult(machineServer("https://agentrq.example", ctrl).handleCreateEnrolmentCode(authedContext(), nil, struct{}{})))

	if got.UserID != testUserID {
		t.Errorf("UserID = %q, want %q", got.UserID, testUserID)
	}

	var parsed struct {
		Code         string `json:"code"`
		EnrolCommand string `json:"enrolCommand"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if parsed.Code != "ABC123" {
		t.Errorf("code = %q, want %q", parsed.Code, "ABC123")
	}
	want := "agentrqd enroll --server https://agentrq.example --code ABC123"
	if parsed.EnrolCommand != want {
		t.Errorf("enrolCommand = %q, want %q", parsed.EnrolCommand, want)
	}
}

// The tool mints a code and nothing else — it must not swallow an error the
// crud layer had a reason to return (rate limiting, for one).
func TestCreateEnrolmentCode_PropagatesError(t *testing.T) {
	ctrl := &mockMachineCrud{createEnrolmentCode: func(_ context.Context, _ entity.CreateEnrolmentCodeRequest) (*entity.CreateEnrolmentCodeResponse, error) {
		return nil, errors.New("rate limited")
	}}

	result := toolResult(machineServer("https://agentrq.example", ctrl).handleCreateEnrolmentCode(authedContext(), nil, struct{}{}))
	if !result.isError {
		t.Fatal("expected an error result")
	}
	if !strings.Contains(result.text, "rate limited") {
		t.Errorf("error text = %q, want it to mention %q", result.text, "rate limited")
	}
}
