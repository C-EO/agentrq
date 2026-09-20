// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"testing"

	mcpevent "github.com/agentrq/agentrq/backend/internal/controller/mcp"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/service/pubsub"
	"github.com/mustafaturan/monoflake"
)

// fakePubSub is a hand-written pubsub.Service, not the generated gomock: this
// package's test files must compile without `make mocks` having run, since
// the "Documented tools match the servers" CI job runs `go test
// ./internal/handler/coremcp/ -run TestPluginDocs` directly, with no mock
// generation step first.
type fakePubSub struct {
	pubsub.Service
	onPublish func(req pubsub.PublishRequest)
}

func (f *fakePubSub) Publish(_ context.Context, req pubsub.PublishRequest) (*pubsub.PublishResponse, error) {
	if f.onPublish != nil {
		f.onPublish(req)
	}
	return nil, nil
}

// A WorkspaceServer built without a pubsub (the shape every hand-built test
// fixture in this package takes, e.g. eventServer) must not panic when a
// handler still calls emitTelemetry.
func TestEmitTelemetry_NilPubSubIsANoop(t *testing.T) {
	srv := &WorkspaceServer{}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPToolCall, "getWorkspace", testWorkspace)
}

func TestEmitTelemetry_PublishesOnMCPTopic(t *testing.T) {
	var got mcpevent.MCPEvent
	var gotTopic int64
	fps := &fakePubSub{onPublish: func(req pubsub.PublishRequest) {
		gotTopic = req.PubSubID
		got = req.Event.(mcpevent.MCPEvent)
	}}

	srv := &WorkspaceServer{pubsub: fps}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPToolCall, "getWorkspace", testWorkspace)

	if gotTopic != entity.PubSubTopicMCP {
		t.Errorf("PubSubID = %d, want PubSubTopicMCP", gotTopic)
	}
	if got.Action != mcpevent.ActionMCPToolCall {
		t.Errorf("Action = %v, want ActionMCPToolCall", got.Action)
	}
	if got.WorkspaceID != testWorkspace {
		t.Errorf("WorkspaceID = %d, want %d", got.WorkspaceID, testWorkspace)
	}
	if got.ToolName != "getWorkspace" || got.Method != "getWorkspace" {
		t.Errorf("ToolName/Method = %q/%q, want %q", got.ToolName, got.Method, "getWorkspace")
	}
	if got.Actor != 2 {
		t.Errorf("Actor = %d, want 2 (agent)", got.Actor)
	}
	if want := monoflake.IDFromBase62(testUserID).Int64(); got.UserID != want {
		t.Errorf("UserID = %d, want %d", got.UserID, want)
	}
}

// Resource and prompt reads are reported as method calls, not tool calls, so
// they don't inflate the same count a supervisor's tool use does.
func TestEmitTelemetry_MethodCallAction(t *testing.T) {
	var got mcpevent.MCPEvent
	fps := &fakePubSub{onPublish: func(req pubsub.PublishRequest) {
		got = req.Event.(mcpevent.MCPEvent)
	}}

	srv := &WorkspaceServer{pubsub: fps}
	srv.emitTelemetry(authedContext(), mcpevent.ActionMCPMethodCall, "resource:new-workspace-guide", 0)

	if got.Action != mcpevent.ActionMCPMethodCall {
		t.Errorf("Action = %v, want ActionMCPMethodCall", got.Action)
	}
	if got.WorkspaceID != 0 {
		t.Errorf("WorkspaceID = %d, want 0 (resources/prompts have no single workspace)", got.WorkspaceID)
	}
}
