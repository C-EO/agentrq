// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
)

func TestFromEntityAttachmentsToView_KeepsTheLink(t *testing.T) {
	got := fromEntityAttachmentsToView([]entity.Attachment{
		{ID: "a", Filename: "a.png", MimeType: "image/png", URL: "https://cdn/attachments/a"},
		{ID: "b", Filename: "b.txt", MimeType: "text/plain"},
	})
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	// camelCase, and no url key at all for a local attachment.
	want := `[{"id":"a","filename":"a.png","mimeType":"image/png","data":"","url":"https://cdn/attachments/a"},{"id":"b","filename":"b.txt","mimeType":"text/plain","data":""}]`
	if string(b) != want {
		t.Errorf("got %s", b)
	}
}

func TestFromGetTaskResponseEntityToHTTPResponse_StateTransitions(t *testing.T) {
	at := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	closeAfter := int64(600)
	raw := string(FromGetTaskResponseEntityToHTTPResponse(&entity.GetTaskResponse{
		Task:             entity.Task{ID: 1},
		StateTransitions: []entity.TaskStateTransition{{FromState: "", ToState: "ongoing", CreatedAt: at}},
		Timing:           entity.TaskTiming{StartedAt: &at, StartToCloseSeconds: &closeAfter, BlockedSeconds: 3, NeedsInputSeconds: 5, WorkedSeconds: 4},
	}))
	for _, want := range []string{
		`"stateTransitions":[{"fromState":"","toState":"ongoing","createdAt":"2026-09-27T10:00:00Z"}]`,
		`"timing":{"startedAt":"2026-09-27T10:00:00Z","closedAt":null,"startToCloseSeconds":600,"blockedSeconds":3,"needsInputSeconds":5,"workedSeconds":4}`,
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("response %s\nlacks %s", raw, want)
		}
	}
}
