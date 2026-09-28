// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package machine

import (
	"errors"
	"strings"
	"testing"

	"github.com/mustafaturan/monoflake"

	"github.com/agentrq/agentrq/daemon/wire"
)

func TestKillSession(t *testing.T) {
	session := monoflake.ID(500).String()
	if err := KillSession(nil, 1, session); !errors.Is(err, ErrNoConnections) {
		t.Errorf("no registry: err = %v", err)
	}
	r := NewRegistry("pod-a")
	if err := KillSession(r, 1, session); !errors.Is(err, ErrNotConnected) {
		t.Errorf("not connected: err = %v", err)
	}

	c := &fakeConn{}
	r.Add(1, c)
	if err := KillSession(r, 1, session); err != nil {
		t.Fatalf("err = %v", err)
	}
	ctl, err := wire.ParseControl(c.sent[0])
	if err != nil || ctl.Op != wire.OpKillSession || !strings.Contains(string(ctl.Body), "500") {
		t.Errorf("sent %+v, %v; want a kill of session 500", ctl, err)
	}

	c.sendErr = errors.New("socket closed")
	if err := KillSession(r, 1, session); !errors.Is(err, ErrUnreachable) {
		t.Errorf("send fails: err = %v", err)
	}
}
