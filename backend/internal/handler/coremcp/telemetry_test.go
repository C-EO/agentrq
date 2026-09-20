// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"testing"

	mcpevent "github.com/agentrq/agentrq/backend/internal/controller/mcp"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	mock_pubsub "github.com/agentrq/agentrq/backend/internal/service/mocks/pubsub"
	"github.com/agentrq/agentrq/backend/internal/service/pubsub"
	"github.com/golang/mock/gomock"
	"github.com/mustafaturan/monoflake"
)

// A WorkspaceServer built without a pubsub (the shape every hand-built test
// fixture in this package takes, e.g. eventServer) must not panic when a
// handler still calls emitTelemetry.
func TestEmitTelemetry_NilPubSubIsANoop(t *testing.T) {
	srv := &WorkspaceServer{}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPToolCall, "getWorkspace", testWorkspace)
}

func TestEmitTelemetry_PublishesOnMCPTopic(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockPS := mock_pubsub.NewMockService(ctrl)
	mockPS.EXPECT().Publish(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, req pubsub.PublishRequest) (*pubsub.PublishResponse, error) {
			if req.PubSubID != entity.PubSubTopicMCP {
				t.Errorf("PubSubID = %d, want PubSubTopicMCP", req.PubSubID)
			}
			event, ok := req.Event.(mcpevent.MCPEvent)
			if !ok {
				t.Fatalf("Event type = %T, want mcpevent.MCPEvent", req.Event)
			}
			if event.Action != mcpevent.ActionMCPToolCall {
				t.Errorf("Action = %v, want ActionMCPToolCall", event.Action)
			}
			if event.WorkspaceID != testWorkspace {
				t.Errorf("WorkspaceID = %d, want %d", event.WorkspaceID, testWorkspace)
			}
			if event.ToolName != "getWorkspace" || event.Method != "getWorkspace" {
				t.Errorf("ToolName/Method = %q/%q, want %q", event.ToolName, event.Method, "getWorkspace")
			}
			if event.Actor != 2 {
				t.Errorf("Actor = %d, want 2 (agent)", event.Actor)
			}
			if want := monoflake.IDFromBase62(testUserID).Int64(); event.UserID != want {
				t.Errorf("UserID = %d, want %d", event.UserID, want)
			}
			return nil, nil
		},
	)

	srv := &WorkspaceServer{pubsub: mockPS}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPToolCall, "getWorkspace", testWorkspace)
}

// Resource and prompt reads are reported as method calls, not tool calls, so
// they don't inflate the same count a supervisor's tool use does.
func TestEmitTelemetry_MethodCallAction(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockPS := mock_pubsub.NewMockService(ctrl)
	mockPS.EXPECT().Publish(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, req pubsub.PublishRequest) (*pubsub.PublishResponse, error) {
			event := req.Event.(mcpevent.MCPEvent)
			if event.Action != mcpevent.ActionMCPMethodCall {
				t.Errorf("Action = %v, want ActionMCPMethodCall", event.Action)
			}
			if event.WorkspaceID != 0 {
				t.Errorf("WorkspaceID = %d, want 0 (resources/prompts have no single workspace)", event.WorkspaceID)
			}
			return nil, nil
		},
	)

	srv := &WorkspaceServer{pubsub: mockPS}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPMethodCall, "resource:new-workspace-guide", 0)
}
