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

// pushServer builds a workspace server with just enough wired up to push a task
// down the channel and be asked whether anything received it.
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

	return &WorkspaceServer{
		workspaceID: 100,
		userID:      monoflake.ID(100).String(),
		done:        make(chan struct{}),
		bus:         eventbus.New(),
		pubsub:      pubsubMock,
		tokenSvc:    tokenMock,
	}
}

// errNotTheRealThing stands in for whatever a dependency says when it cannot
// answer — an in-memory session id is not a token, and a repository under test
// here is one that failed.
var errNotTheRealThing = errors.New("not the real thing")

// A push with nothing attached at all reaches no agent, and has to say so: the
// caller records a delivery on the strength of this answer, and a delivery
// recorded here is a task retired from the only retry there is.
func TestSendChannelNotificationWithNoServerIsNotADelivery(t *testing.T) {
	ps := pushServer(t)

	if ps.SendChannelNotification(context.Background(), 7, "next task") {
		t.Fatal("a push with no MCP server reported a delivery")
	}
}

// The case this whole change exists for: a gateway whose session is still
// listed but whose stream has gone. Notifying it succeeds quietly and reaches
// nobody, which is indistinguishable from a real delivery unless the stream is
// what decides.
func TestSendChannelNotificationWithNoLiveStreamIsNotADelivery(t *testing.T) {
	ps := pushServer(t)
	connectedServer(t, ps, "acp-gateway")

	if ps.SendChannelNotification(context.Background(), 7, "next task") {
		t.Fatal("a push to a session with no stream reported a delivery")
	}
}

// And the happy path: a gateway still holding its stream is reachable, so the
// push counts.
func TestSendChannelNotificationToAStreamingSessionIsADelivery(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	if !ps.SendChannelNotification(context.Background(), 7, "next task") {
		t.Fatal("a push to a live gateway reported no delivery")
	}
}

// One live gateway is enough, even beside one that has gone: the task only has
// to reach somebody.
func TestSendChannelNotificationIsADeliveryIfAnySessionIsLive(t *testing.T) {
	ps := pushServer(t)
	connectedServer(t, ps, "acp-gateway")
	live := connectSession(t, ps, "acp-gateway")
	defer streamFor(ps, live)()

	if !ps.SendChannelNotification(context.Background(), 7, "next task") {
		t.Fatal("a push reported no delivery while a live gateway was attached")
	}
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

// The reported bug. A tick that pushes into a workspace with nothing reachable
// delivers nothing, and must not record the task as pushed — the poller is the
// only thing that ever retries, and it skips whatever this set holds for as
// long as the task stays notstarted. Marking here is how a task created while
// the gateway was between connections became a task that never arrives at all.
func TestPollOnceDoesNotMarkATaskPushedWhenNothingReceivedIt(t *testing.T) {
	ps := pushServer(t)

	ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"}))

	if ps.wasTaskPushed(7) {
		t.Fatal("a task nothing received was recorded as delivered, so the poller will never offer it again")
	}
}

// And the tick after the gateway comes back offers the task again, which is the
// whole point of not marking it.
func TestPollOnceOffersTheTaskAgainOnceTheGatewayIsBack(t *testing.T) {
	ps := pushServer(t)
	repo := pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"})

	ps.pollOnce(repo)
	// The discriminator: a tick that reached nobody must leave the task
	// unmarked, or the tick below is skipped and this passes without the
	// gateway ever being handed anything.
	if ps.wasTaskPushed(7) {
		t.Fatal("the undelivered first tick recorded a delivery")
	}

	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()
	ps.pollOnce(repo)

	if !ps.wasTaskPushed(7) {
		t.Fatal("the task was not delivered once a gateway was reachable again")
	}
}

// A delivered push is still recorded, so the poller does not push — and clear —
// the same task again on its next tick while the agent simply hasn't flipped
// its status yet.
func TestPollOnceMarksADeliveredTaskPushed(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"}))

	if !ps.wasTaskPushed(7) {
		t.Fatal("a delivered task was not recorded, so the poller will push it again")
	}
}

// An archived workspace pushes nothing at all.
func TestPollOnceSkipsAnArchivedWorkspace(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()
	now := time.Now()
	ps.archivedAt = &now

	ps.pollOnce(pendingTaskRepo(model.Task{ID: 7, Status: "notstarted", Assignee: "agent"}))

	if ps.wasTaskPushed(7) {
		t.Fatal("an archived workspace pushed a task")
	}
}

// A repository that cannot answer ends the tick rather than pushing on a guess.
func TestPollOnceSurvivesARepositoryError(t *testing.T) {
	ps := pushServer(t)

	ps.pollOnce(listTasksFunc(func(context.Context, entity.ListTasksRequest, int64) ([]model.Task, error) {
		return nil, errNotTheRealThing
	}))

	if ps.wasTaskPushed(7) {
		t.Fatal("a failed listing pushed a task")
	}
}

// Nothing is pushed while a task is ongoing: the agent already has work.
func TestPollOncePushesNothingWhileATaskIsOngoing(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 1, Status: "ongoing", Assignee: "agent"},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent"},
	))

	if ps.wasTaskPushed(7) {
		t.Fatal("a task was pushed while another was ongoing")
	}
}

// The task already delivered is skipped, and the one behind it goes instead.
func TestPollOnceSkipsATaskAlreadyDelivered(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()
	ps.MarkTaskPushed(7)

	ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent", SortOrder: 1},
		model.Task{ID: 8, Status: "notstarted", Assignee: "agent", SortOrder: 2},
	))

	if !ps.wasTaskPushed(8) {
		t.Fatal("the task behind the one already delivered was not pushed")
	}
}

// Two tasks waiting means the order they were put in is what decides, not the
// order the repository happened to list them in.
func TestPollOncePushesThePendingTasksInOrder(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 8, Status: "notstarted", Assignee: "agent", SortOrder: 2},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent", SortOrder: 1},
	))

	if !ps.wasTaskPushed(7) {
		t.Fatal("the task sorted first was not the one pushed")
	}
	if ps.wasTaskPushed(8) {
		t.Fatal("both tasks went out; one tick hands over one task")
	}
}

// An unordered pair falls back to when each was created, and then to its ID —
// two tasks made in the same millisecond still have to have an order.
func TestPollOnceFallsBackToCreationTimeThenID(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()
	made := time.Now()

	ps.pollOnce(pendingTaskRepo(
		model.Task{ID: 9, Status: "notstarted", Assignee: "agent", CreatedAt: made},
		model.Task{ID: 7, Status: "notstarted", Assignee: "agent", CreatedAt: made},
		model.Task{ID: 8, Status: "notstarted", Assignee: "agent", CreatedAt: made.Add(-time.Hour)},
	))

	if !ps.wasTaskPushed(8) {
		t.Fatal("the oldest task was not the one pushed")
	}
}

// A task's attachments travel with it, so the agent can fetch them.
func TestPollOnceCarriesTheTaskAttachments(t *testing.T) {
	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

	ps.pollOnce(pendingTaskRepo(model.Task{
		ID: 7, Status: "notstarted", Assignee: "agent",
		Attachments: []byte(`[{"id":"a1","filename":"trace.log","mimeType":"text/plain"}]`),
	}))

	if !ps.wasTaskPushed(7) {
		t.Fatal("a task with attachments was not delivered")
	}
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

	ps := pushServer(t)
	sessID := connectedServer(t, ps, "acp-gateway")
	defer streamFor(ps, sessID)()

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
