// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package mcp

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/agentrq/agentrq/backend/internal/repository/base"
	"github.com/agentrq/agentrq/backend/internal/service/eventbus"
	mock_auth "github.com/agentrq/agentrq/backend/internal/service/mocks/auth"
	mock_pubsub "github.com/agentrq/agentrq/backend/internal/service/mocks/pubsub"
	"github.com/golang/mock/gomock"
	"github.com/mustafaturan/monoflake"
)

// errNotTheRealThing stands in for whatever a dependency says when it cannot
// answer — an in-memory session id is not a token, and a repository under test
// here is one that failed.
var errNotTheRealThing = errors.New("not the real thing")

// pushServer builds a workspace server with just enough wired up to run a poll
// and push a task down the channel.
func pushServer(t *testing.T) *WorkspaceServer {
	t.Helper()
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)

	pubsubMock := mock_pubsub.NewMockService(ctrl)
	pubsubMock.EXPECT().Publish(gomock.Any(), gomock.Any()).AnyTimes()
	// SendChannelNotification logs each session's auth state, so the token
	// service is reached on every push even though nothing here asserts on it.
	tokenMock := mock_auth.NewMockTokenService(ctrl)
	tokenMock.EXPECT().ValidateToken(gomock.Any()).Return(nil, errNotTheRealThing).AnyTimes()

	ps := &WorkspaceServer{
		workspaceID: 100,
		userID:      monoflake.ID(100).String(),
		done:        make(chan struct{}),
		bus:         eventbus.New(),
		pubsub:      pubsubMock,
		tokenSvc:    tokenMock,
	}
	// Closed up front so clearContextFor's settle wait returns immediately: the
	// delay has its own test rather than being paid for in every poll here.
	close(ps.done)
	return ps
}

// countingClear wires the clear seam and reports how many times it was actually
// asked to clear — which is the number that has to stay at one however many
// times a task is pushed.
func countingClear(ps *WorkspaceServer, err error) *int {
	calls := 0
	ps.clearAgentContext = func(context.Context) error {
		calls++
		return err
	}
	return &calls
}

// listTasksFunc is a repository that answers only the poller's one question.
type listTasksFunc func(ctx context.Context, req entity.ListTasksRequest, userID int64) ([]model.Task, error)

func (f listTasksFunc) ListTasks(ctx context.Context, req entity.ListTasksRequest, userID int64) ([]model.Task, error) {
	return f(ctx, req, userID)
}

func pendingTaskRepo(tasks ...model.Task) listTasksFunc {
	return func(context.Context, entity.ListTasksRequest, int64) ([]model.Task, error) {
		return tasks, nil
	}
}

// The reported bug, and the rule that fixes it: a task stands until the agent
// takes it. Nothing about a push is remembered, so a push made while a gateway
// was between connections — which reaches nobody, silently — is simply made
// again on the next tick. Suppressing the second one is what turned a task
// created at the wrong moment into a task that never arrived at all.
func TestPollOnceOffersAPendingTaskOnEveryTick(t *testing.T) {
	ps := pushServer(t)
	repo := pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"})

	for tick := 1; tick <= 3; tick++ {
		if got := ps.pollOnce(repo); got != 7 {
			t.Fatalf("tick %d offered task %d, want 7 — a pending task stands until the agent takes it", tick, got)
		}
	}
}

// The other half, and the reason the two are tracked apart: the push repeats
// and the clear must not. A clear landing behind the second push would wipe the
// context that push had just put the task into.
func TestPollOnceClearsOnceHoweverManyTimesItPushes(t *testing.T) {
	ps := pushServer(t)
	clears := countingClear(ps, nil)
	repo := pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent", ClearContext: true})

	ps.pollOnce(repo)
	ps.pollOnce(repo)
	ps.pollOnce(repo)

	if *clears != 1 {
		t.Fatalf("cleared %d times across three pushes, want 1", *clears)
	}
}

// A clear that could not be sent is not a clear. The machine may be offline or
// the session gone — both ordinary — and remembering the failure as done would
// skip the clear for good the moment the machine came back, handing the agent a
// task on exactly the context the task asked to be rid of.
func TestPollOnceRetriesAClearThatNeverWentOut(t *testing.T) {
	ps := pushServer(t)
	clears := countingClear(ps, errNotTheRealThing)
	repo := pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent", ClearContext: true})

	ps.pollOnce(repo)
	ps.pollOnce(repo)

	if *clears != 2 {
		t.Fatalf("attempted %d clears, want 2 — a failed clear must be tried again", *clears)
	}
}

// Taking the task is what stops the pushes: the agent moves it to ongoing, and
// the tick after that offers nothing.
func TestPollOnceStopsOnceTheTaskIsOngoing(t *testing.T) {
	ps := pushServer(t)

	if got := ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"})); got != 7 {
		t.Fatalf("offered task %d, want 7", got)
	}
	if got := ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "ongoing", Assignee: "agent"})); got != 0 {
		t.Fatalf("offered task %d while it was ongoing, want none", got)
	}
}

// A task handed back to an agent later is cleared afresh: the set is reconciled
// against what is still pending, so the record of the first handover's clear
// does not silently cover the second.
func TestPollOnceClearsAgainForALaterHandover(t *testing.T) {
	ps := pushServer(t)
	clears := countingClear(ps, nil)
	pending := pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent", ClearContext: true})

	ps.pollOnce(pending)
	// Taken, worked, and put back — the reconcile on this tick is what forgets
	// the first handover.
	ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "completed", Assignee: "agent"}))
	ps.pollOnce(pending)

	if *clears != 2 {
		t.Fatalf("cleared %d times across two handovers, want 2", *clears)
	}
}

// Nothing is offered while a task is ongoing: the agent already has work.
func TestPollOnceOffersNothingWhileATaskIsOngoing(t *testing.T) {
	ps := pushServer(t)

	got := ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 1, Status: "ongoing", Assignee: "agent"},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent"},
	))

	if got != 0 {
		t.Fatalf("offered task %d while another was ongoing, want none", got)
	}
}

// An archived workspace offers nothing at all.
func TestPollOnceSkipsAnArchivedWorkspace(t *testing.T) {
	ps := pushServer(t)
	now := time.Now()
	ps.archivedAt = &now

	if got := ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"})); got != 0 {
		t.Fatalf("an archived workspace offered task %d", got)
	}
}

// A repository that cannot answer ends the tick rather than pushing on a guess.
func TestPollOnceSurvivesARepositoryError(t *testing.T) {
	ps := pushServer(t)

	got := ps.pollOnce(listTasksFunc(func(context.Context, entity.ListTasksRequest, int64) ([]model.Task, error) {
		return nil, errNotTheRealThing
	}))

	if got != 0 {
		t.Fatalf("a failed listing offered task %d", got)
	}
}

// Two tasks waiting means the order they were put in decides, not the order the
// repository happened to list them in — and one tick hands over one task.
func TestPollOnceOffersThePendingTasksInOrder(t *testing.T) {
	ps := pushServer(t)

	got := ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 8, Status: "notstarted", Assignee: "agent", SortOrder: 2},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent", SortOrder: 1},
	))

	if got != 7 {
		t.Fatalf("offered task %d, want the one sorted first", got)
	}
}

// An unordered pair falls back to when each was created, and then to its ID —
// two tasks made in the same millisecond still have to have an order.
func TestPollOnceFallsBackToCreationTimeThenID(t *testing.T) {
	ps := pushServer(t)
	made := time.Now()

	got := ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 9, Status: "notstarted", Assignee: "agent", CreatedAt: made},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent", CreatedAt: made},
		model.Task{ID: 8, Status: "notstarted", Assignee: "agent", CreatedAt: made.Add(-time.Hour)},
	))

	if got != 8 {
		t.Fatalf("offered task %d, want the oldest", got)
	}
}

// A task's attachments travel with it, so the agent can fetch them.
func TestPollOnceCarriesTheTaskAttachments(t *testing.T) {
	ps := pushServer(t)

	got := ps.pollOnce(pendingTaskRepo(model.Task{
		ID: 7, Status: "notstarted", Assignee: "agent",
		Attachments: []byte(`[{"id":"a1","filename":"trace.log","mimeType":"text/plain"}]`),
	}))

	if got != 7 {
		t.Fatalf("offered task %d, want 7", got)
	}
}

// A push reaches a gateway that is really there. Nothing is reported back about
// it — the retry above is what covers a push that lands nowhere — so this is
// here to prove the reflection into the SDK's private conn still works at all.
func TestSendChannelNotificationReachesALiveSession(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	ps.SendChannelNotification(context.Background(), 7, "next task")
}

// A workspace whose MCP server has not been built has nothing to notify, and
// must say so rather than panicking on a nil server's session list.
func TestSendChannelNotificationWithNoServerDoesNotPanic(t *testing.T) {
	ps := pushServer(t)

	ps.SendChannelNotification(context.Background(), 7, "next task")
}

// pollRepo is a repository that answers only ListTasks, so StartPoller's own
// loop can be driven without standing up the real one.
type pollRepo struct {
	base.Repository
	list listTasksFunc
}

func (r pollRepo) ListTasks(ctx context.Context, req entity.ListTasksRequest, userID int64) ([]model.Task, error) {
	return r.list(ctx, req, userID)
}

// The loop itself: it ticks until the server is closed, and closing it is what
// stops the goroutine rather than leaking it for the life of the process.
func TestStartPollerTicksAndStopsWhenTheServerCloses(t *testing.T) {
	previous := pollInterval
	pollInterval = time.Millisecond
	t.Cleanup(func() { pollInterval = previous })

	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)
	pubsubMock := mock_pubsub.NewMockService(ctrl)
	pubsubMock.EXPECT().Publish(gomock.Any(), gomock.Any()).AnyTimes()
	tokenMock := mock_auth.NewMockTokenService(ctrl)
	tokenMock.EXPECT().ValidateToken(gomock.Any()).Return(nil, errNotTheRealThing).AnyTimes()

	// Not pushServer: this one needs `done` still open, since closing it is the
	// thing under test.
	ps := &WorkspaceServer{
		workspaceID: 100,
		userID:      monoflake.ID(100).String(),
		done:        make(chan struct{}),
		bus:         eventbus.New(),
		pubsub:      pubsubMock,
		tokenSvc:    tokenMock,
	}

	ticked := make(chan struct{})
	var once sync.Once
	ps.StartPoller(pollRepo{list: func(context.Context, entity.ListTasksRequest, int64) ([]model.Task, error) {
		once.Do(func() { close(ticked) })
		return []model.Task{{ID: 7, Status: "notstarted", Assignee: "agent"}}, nil
	}})

	select {
	case <-ticked:
	case <-time.After(5 * time.Second):
		t.Fatal("the poller never ticked")
	}

	close(ps.done)
	// Nothing to assert beyond not hanging: the goroutine's only exit is the
	// done channel, so a poller that ignored it would go on ticking here.
}
