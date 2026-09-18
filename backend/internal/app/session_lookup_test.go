// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang/mock/gomock"
	"github.com/mustafaturan/monoflake"

	"github.com/agentrq/agentrq/backend/internal/controller/machine"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	mock_repository "github.com/agentrq/agentrq/backend/internal/service/mocks/repository"
)

// The authorisation boundary for the terminal socket, and the only place the
// attach learns which workspace it belongs to.
//
// That last part is why this is tested rather than left to the wiring: the
// workspace reaches telemetry through this struct and nowhere else, so
// dropping it here would leave every terminal view attributed to no workspace
// with nothing failing anywhere.
func TestSessionLookupDescribesTheAttach(t *testing.T) {
	const userID int64 = 3
	userBase62 := monoflake.ID(userID).String()

	ctrl := gomock.NewController(t)
	repo := mock_repository.NewMockRepository(ctrl)
	repo.EXPECT().GetSession(gomock.Any(), int64(500), userID).
		Return(model.Session{ID: 500, UserID: userID, MachineID: 11, WorkspaceID: 70}, nil)
	repo.EXPECT().GetMachine(gomock.Any(), int64(11), userID).
		Return(model.Machine{ID: 11, UserID: userID, InstanceID: "pod-a"}, nil)
	repo.EXPECT().SystemGetUser(gomock.Any(), userID).
		Return(model.User{ID: userID, Name: "Ada"}, nil)

	tokens := newTestTokenService(t)
	l := sessionLookup{repo: repo, tokens: tokens}

	r := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/x/terminal", nil)
	r.AddCookie(&http.Cookie{Name: "at", Value: newTestToken(t, tokens, userBase62)})

	at, err := l.LookupSession(r, 500)
	if err != nil {
		t.Fatal(err)
	}

	if at.MachineID != 11 || at.InstanceID != "pod-a" {
		t.Errorf("machine = %d on %q", at.MachineID, at.InstanceID)
	}
	if at.UserID != userID {
		t.Errorf("userID = %d, want %d", at.UserID, userID)
	}
	// The line this test exists for.
	if at.WorkspaceID != 70 {
		t.Errorf("workspaceID = %d, want 70 — a terminal view is counted against it", at.WorkspaceID)
	}
	// A display name, never the email address: presence answers "who else is
	// typing" without handing every viewer somebody's contact details.
	if at.ViewerName != "Ada" {
		t.Errorf("viewerName = %q", at.ViewerName)
	}
}

// A user with no name set is still someone, so they get a placeholder rather
// than an empty entry nobody can interpret.
func TestSessionLookupNamesAnAnonymousViewer(t *testing.T) {
	const userID int64 = 3
	ctrl := gomock.NewController(t)
	repo := mock_repository.NewMockRepository(ctrl)
	repo.EXPECT().GetSession(gomock.Any(), int64(500), userID).
		Return(model.Session{ID: 500, UserID: userID, MachineID: 11, WorkspaceID: 70}, nil)
	repo.EXPECT().GetMachine(gomock.Any(), int64(11), userID).
		Return(model.Machine{ID: 11, UserID: userID}, nil)
	repo.EXPECT().SystemGetUser(gomock.Any(), userID).Return(model.User{}, errors.New("gone"))

	tokens := newTestTokenService(t)
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.AddCookie(&http.Cookie{Name: "at", Value: newTestToken(t, tokens, monoflake.ID(userID).String())})

	l := sessionLookup{repo: repo, tokens: tokens}
	at, err := l.LookupSession(r, 500)
	if err != nil {
		t.Fatal(err)
	}
	if at.ViewerName != "Someone" {
		t.Errorf("viewerName = %q, want the placeholder", at.ViewerName)
	}
}

// Every refusal, and all of them empty: the reason is the caller's to decide,
// not this function's to leak.
func TestSessionLookupRefusals(t *testing.T) {
	const userID int64 = 3
	userBase62 := monoflake.ID(userID).String()

	t.Run("no cookie", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		l := sessionLookup{repo: mock_repository.NewMockRepository(ctrl), tokens: newTestTokenService(t)}
		if _, err := l.LookupSession(httptest.NewRequest(http.MethodGet, "/x", nil), 500); err == nil {
			t.Fatal("expected a refusal")
		}
	})

	t.Run("unreadable token", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		l := sessionLookup{repo: mock_repository.NewMockRepository(ctrl), tokens: newTestTokenService(t)}
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		r.AddCookie(&http.Cookie{Name: "at", Value: "not-a-token"})
		if _, err := l.LookupSession(r, 500); err == nil {
			t.Fatal("expected a refusal")
		}
	})

	// Scoped to the user by the query itself: a session belonging to somebody
	// else is not found, which is also the right thing to tell the caller.
	t.Run("somebody else's session", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := mock_repository.NewMockRepository(ctrl)
		repo.EXPECT().GetSession(gomock.Any(), int64(500), userID).
			Return(model.Session{}, errors.New("not found"))
		tokens := newTestTokenService(t)
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		r.AddCookie(&http.Cookie{Name: "at", Value: newTestToken(t, tokens, userBase62)})
		l := sessionLookup{repo: repo, tokens: tokens}
		if _, err := l.LookupSession(r, 500); err == nil {
			t.Fatal("expected a refusal")
		}
	})

	t.Run("machine gone", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		repo := mock_repository.NewMockRepository(ctrl)
		repo.EXPECT().GetSession(gomock.Any(), int64(500), userID).
			Return(model.Session{ID: 500, UserID: userID, MachineID: 11}, nil)
		repo.EXPECT().GetMachine(gomock.Any(), int64(11), userID).
			Return(model.Machine{}, errors.New("not found"))
		tokens := newTestTokenService(t)
		r := httptest.NewRequest(http.MethodGet, "/x", nil)
		r.AddCookie(&http.Cookie{Name: "at", Value: newTestToken(t, tokens, userBase62)})
		l := sessionLookup{repo: repo, tokens: tokens}
		if _, err := l.LookupSession(r, 500); err == nil {
			t.Fatal("expected a refusal")
		}
	})
}

// A stub that records what it was asked to count.
type stubTerminalCounter struct {
	got []entity.RecordTerminalViewRequest
}

func (s *stubTerminalCounter) RecordTerminalView(_ context.Context, req entity.RecordTerminalViewRequest) {
	s.got = append(s.got, req)
}

// The hook the terminal socket calls, and the two things it can get wrong:
// which id goes where, and which end of the visit it is.
func TestCountTerminalViewCarriesTheAttachThrough(t *testing.T) {
	for _, tc := range []struct {
		name string
		open bool
	}{
		{name: "attach", open: true},
		{name: "detach", open: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := &stubTerminalCounter{}
			at := machine.Attachment{MachineID: 11, UserID: 3, WorkspaceID: 70, ViewerName: "Ada"}

			countTerminalView(rec, tc.open)(httptest.NewRequest(http.MethodGet, "/x", nil), 500, at)

			if len(rec.got) != 1 {
				t.Fatalf("counted %d times, want 1", len(rec.got))
			}
			got := rec.got[0]
			if got.UserID != 3 || got.WorkspaceID != 70 {
				t.Errorf("scope = user %d / workspace %d", got.UserID, got.WorkspaceID)
			}
			// The session comes from the socket, not the attachment — mixing
			// it up with the machine id is the mistake this guards.
			if got.SessionID != 500 {
				t.Errorf("sessionID = %d, want 500", got.SessionID)
			}
			if got.Open != tc.open {
				t.Errorf("open = %v, want %v", got.Open, tc.open)
			}
		})
	}
}
