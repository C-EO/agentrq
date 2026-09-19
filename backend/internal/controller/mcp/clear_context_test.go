// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package mcp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/agentrq/agentrq/backend/internal/data/model"
)

// serverWithClear is a WorkspaceServer with nothing but the clear seam wired.
//
// Built by hand rather than through NewWorkspaceServer: everything else that
// constructor takes is irrelevant to this decision, and passing twenty-odd
// nils would obscure the one field under test.
func serverWithClear(fn ClearAgentContextFunc) *WorkspaceServer {
	return &WorkspaceServer{
		workspaceID:       1,
		done:              make(chan struct{}),
		clearAgentContext: fn,
	}
}

func TestClearIsAskedForOnlyWhenTheTaskWantsIt(t *testing.T) {
	calls := 0
	ps := serverWithClear(func(context.Context) error {
		calls++
		return nil
	})

	ps.clearContextFor(context.Background(), model.Task{ID: 7, ClearContext: false})

	if calls != 0 {
		t.Errorf("clear called %d times for a task that did not ask, want 0", calls)
	}
}

func TestClearIsAskedForWhenTheTaskWantsIt(t *testing.T) {
	calls := 0
	ps := serverWithClear(func(context.Context) error {
		calls++
		return nil
	})

	// Closed up front so the settle wait returns immediately: the delay is
	// covered by its own test rather than paid for in every other one.
	close(ps.done)
	ps.clearContextFor(context.Background(), model.Task{ID: 7, ClearContext: true})

	if calls != 1 {
		t.Errorf("clear called %d times, want 1", calls)
	}
}

// The whole point of the error being returned is that the caller may log it.
// A task must still be pushed: a workspace with no machine, an offline daemon,
// an exited session and a socket held by another instance are all ordinary
// states, and none is a reason to withhold work from an agent waiting for it.
func TestAFailedClearDoesNotStopTheTask(t *testing.T) {
	ps := serverWithClear(func(context.Context) error {
		return errors.New("no running session for this workspace")
	})

	done := make(chan struct{})
	go func() {
		ps.clearContextFor(context.Background(), model.Task{ID: 7, ClearContext: true})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		// It must not wait out the settle delay either: there is nothing to
		// settle when nothing was sent.
		t.Fatal("a failed clear blocked the push")
	}
}

// A server built without the seam — which is every test of every other part of
// this file, and any future caller that has nothing to send to.
func TestNoClearSeamIsNotACrash(t *testing.T) {
	ps := serverWithClear(nil)

	ps.clearContextFor(context.Background(), model.Task{ID: 7, ClearContext: true})
}

// /clear travels down the terminal while the task travels over the MCP
// session. Two transports with no ordering between them, so without this pause
// the task can land while the agent is still acting on the clear and be wiped
// by it — the exact opposite of what was asked for.
func TestTheClearIsGivenTimeToLandBeforeTheTaskIsPushed(t *testing.T) {
	ps := serverWithClear(func(context.Context) error { return nil })

	start := time.Now()
	go func() {
		// Stands in for the server shutting down mid-wait, which is the only
		// thing that may cut the settle short.
		time.Sleep(20 * time.Millisecond)
		close(ps.done)
	}()
	ps.clearContextFor(context.Background(), model.Task{ID: 7, ClearContext: true})

	if elapsed := time.Since(start); elapsed >= ClearSettleDelay {
		t.Errorf("waited %v; a shutdown should cut the settle short", elapsed)
	}
	if ClearSettleDelay <= 0 {
		t.Error("there is no settle at all, so the push is a race")
	}
}
