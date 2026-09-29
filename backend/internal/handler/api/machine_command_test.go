// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/mustafaturan/monoflake"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	machinectrl "github.com/agentrq/agentrq/backend/internal/controller/machine"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/daemon/wire"
)

// A daemon socket that keeps what it is sent.
type recordingDaemonConn struct {
	mu     sync.Mutex
	frames []wire.Frame
}

func (c *recordingDaemonConn) Send(f wire.Frame) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.frames = append(c.frames, f)
	return nil
}
func (c *recordingDaemonConn) Close() error { return nil }

func (c *recordingDaemonConn) ops(t *testing.T) []wire.Control {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]wire.Control, 0, len(c.frames))
	for _, f := range c.frames {
		ctl, err := wire.ParseControl(f)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, ctl)
	}
	return out
}

type commandCrud struct {
	crud.Controller
	running  string
	offered  string
	err      error
	recorded []entity.RecordMachineCommandRequest
}

func (m *commandCrud) RestartMachine(_ context.Context, req entity.RestartMachineRequest) (*entity.RestartMachineResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &entity.RestartMachineResponse{MachineID: monoflake.IDFromBase62(req.MachineID).Int64(), RunningVersion: m.running}, nil
}

func (m *commandCrud) ApproveMachineUpdate(_ context.Context, req entity.ApproveMachineUpdateRequest) (*entity.ApproveMachineUpdateResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	if req.Version != m.offered {
		return nil, crud.ErrNoUpdateOffered
	}
	return &entity.ApproveMachineUpdateResponse{
		MachineID: monoflake.IDFromBase62(req.MachineID).Int64(), Version: m.offered, RunningVersion: m.running,
	}, nil
}

func (m *commandCrud) RecordMachineCommand(_ context.Context, req entity.RecordMachineCommandRequest) {
	m.recorded = append(m.recorded, req)
}

func commandApp(c crud.Controller, reg *machinectrl.Registry) *fiber.App {
	h := &handler{crud: c, machineRegistry: reg}
	app := fiber.New()
	app.Use(func(ctx *fiber.Ctx) error {
		ctx.Locals("user_id", "user-1")
		return ctx.Next()
	})
	app.Post(_routePathMachineRestart, h.restartMachine())
	app.Post(_routePathMachineUpdate, h.approveMachineUpdate())
	return app
}

// connected is a registry holding machine 11, whose hello said caps.
func connected(caps ...string) (*machinectrl.Registry, *recordingDaemonConn) {
	reg := machinectrl.NewRegistry("pod-a")
	conn := &recordingDaemonConn{}
	reg.Add(11, conn)
	reg.SetCapabilities(11, conn, caps)
	return reg, conn
}

var machine11 = monoflake.ID(11).String()

func post(t *testing.T, app *fiber.App, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestRestartMachineSendsTheRestartAndCountsIt(t *testing.T) {
	reg, conn := connected(wire.CapabilityFork, wire.CapabilityRestart)
	c := &commandCrud{running: "0.9.3"}

	status, body := post(t, commandApp(c, reg), "/machines/"+machine11+"/restart", "")

	if status != http.StatusAccepted {
		t.Fatalf("status = %d (%s), want 202", status, body)
	}
	ops := conn.ops(t)
	if len(ops) != 1 || ops[0].Op != wire.OpRestart {
		t.Fatalf("sent %+v", ops)
	}
	if len(c.recorded) != 1 || c.recorded[0].Action != entity.ActionMachineRestart ||
		c.recorded[0].MachineID != 11 || c.recorded[0].UserID != "user-1" {
		t.Errorf("counted %+v", c.recorded)
	}
}

func TestApproveMachineUpdateSendsTheApprovedVersionAndCountsIt(t *testing.T) {
	reg, conn := connected(wire.CapabilityRestart, wire.CapabilityUpdate)
	c := &commandCrud{running: "0.9.3", offered: "0.9.4"}

	status, body := post(t, commandApp(c, reg), "/machines/"+machine11+"/update", `{"version":"0.9.4"}`)

	if status != http.StatusAccepted {
		t.Fatalf("status = %d (%s), want 202", status, body)
	}
	ops := conn.ops(t)
	if len(ops) != 1 || ops[0].Op != wire.OpUpdateNow {
		t.Fatalf("sent %+v", ops)
	}
	var req wire.UpdateNow
	if err := json.Unmarshal(ops[0].Body, &req); err != nil || req.Version != "0.9.4" {
		t.Errorf("sent %s (%v)", ops[0].Body, err)
	}
	if len(c.recorded) != 1 || c.recorded[0].Action != entity.ActionMachineUpdate {
		t.Errorf("counted %+v", c.recorded)
	}
}

// An older daemon is refused rather than sent something it would ignore, or
// act on without bringing its agents back listed.
func TestAnOlderDaemonIsNotSentACommand(t *testing.T) {
	cases := map[string]struct {
		running string
		caps    []string
	}{
		"too old":                   {"0.9.2", []string{wire.CapabilityRestart, wire.CapabilityUpdate}},
		"a development build":       {"dev", []string{wire.CapabilityRestart, wire.CapabilityUpdate}},
		"new enough, not saying so": {"0.9.3", []string{wire.CapabilityFork}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			for _, path := range []string{"/restart", "/update"} {
				reg, conn := connected(tc.caps...)
				c := &commandCrud{running: tc.running, offered: "0.9.4"}

				status, body := post(t, commandApp(c, reg), "/machines/"+machine11+path, `{"version":"0.9.4"}`)

				if status != http.StatusConflict || !strings.Contains(body, wire.MinRemoteControlVersion) {
					t.Errorf("%s: status = %d (%s), want 409 naming the version", path, status, body)
				}
				if len(conn.ops(t)) != 0 || len(c.recorded) != 0 {
					t.Errorf("%s: sent %d, counted %d", path, len(conn.ops(t)), len(c.recorded))
				}
			}
		})
	}
}

// A daemon whose update is not built in says restart and not update.
func TestAnUpdateNeedsItsOwnCapability(t *testing.T) {
	reg, conn := connected(wire.CapabilityRestart)
	c := &commandCrud{running: "0.9.3", offered: "0.9.4"}

	status, _ := post(t, commandApp(c, reg), "/machines/"+machine11+"/update", `{"version":"0.9.4"}`)
	if status != http.StatusConflict || len(conn.ops(t)) != 0 {
		t.Errorf("status = %d, sent %d", status, len(conn.ops(t)))
	}
}

func TestACommandThatCannotBeDeliveredSaysWhy(t *testing.T) {
	t.Run("not connected", func(t *testing.T) {
		c := &commandCrud{running: "0.9.3"}
		status, _ := post(t, commandApp(c, machinectrl.NewRegistry("pod-a")), "/machines/"+machine11+"/restart", "")
		if status != http.StatusConflict {
			t.Errorf("status = %d, want 409", status)
		}
	})
	t.Run("no machine connections on this server", func(t *testing.T) {
		c := &commandCrud{running: "0.9.3"}
		status, _ := post(t, commandApp(c, nil), "/machines/"+machine11+"/restart", "")
		if status != http.StatusServiceUnavailable {
			t.Errorf("status = %d, want 503", status)
		}
	})
	t.Run("the socket has gone", func(t *testing.T) {
		reg := machinectrl.NewRegistry("pod-a")
		conn := &brokenDaemonConn{}
		reg.Add(11, conn)
		reg.SetCapabilities(11, conn, []string{wire.CapabilityRestart})
		c := &commandCrud{running: "0.9.3"}
		status, _ := post(t, commandApp(c, reg), "/machines/"+machine11+"/restart", "")
		if status != http.StatusBadGateway || len(c.recorded) != 0 {
			t.Errorf("status = %d, counted %d", status, len(c.recorded))
		}
	})
	t.Run("not the caller's machine", func(t *testing.T) {
		reg, conn := connected(wire.CapabilityRestart)
		c := &commandCrud{err: errors.New("record not found")}
		status, _ := post(t, commandApp(c, reg), "/machines/"+machine11+"/restart", "")
		if status == http.StatusAccepted || len(conn.ops(t)) != 0 {
			t.Errorf("status = %d, sent %d", status, len(conn.ops(t)))
		}
	})
}

func TestApproveMachineUpdateRefusals(t *testing.T) {
	reg, conn := connected(wire.CapabilityRestart, wire.CapabilityUpdate)
	app := commandApp(&commandCrud{running: "0.9.3", offered: "0.9.4"}, reg)

	if status, _ := post(t, app, "/machines/"+machine11+"/update", `{"version":"0.9.9"}`); status != http.StatusConflict {
		t.Errorf("a version never offered: status = %d, want 409", status)
	}
	if status, _ := post(t, app, "/machines/"+machine11+"/update", `not json`); status != http.StatusUnprocessableEntity {
		t.Errorf("an unreadable body: status = %d, want 422", status)
	}
	failing := commandApp(&commandCrud{err: errors.New("boom")}, reg)
	if status, _ := post(t, failing, "/machines/"+machine11+"/update", `{"version":"0.9.4"}`); status == http.StatusAccepted {
		t.Errorf("a failed read: status = %d", status)
	}
	if len(conn.ops(t)) != 0 {
		t.Errorf("sent %d", len(conn.ops(t)))
	}
}

// Neither can fail for the values the handlers pass; covered so a change that
// makes them fail answers rather than panics.
func TestCommandMachineRefusesWhatItCannotEncode(t *testing.T) {
	reg, conn := connected(wire.CapabilityRestart)
	h := &handler{machineRegistry: reg}
	app := fiber.New()
	app.Post("/unencodable", func(c *fiber.Ctx) error {
		h.commandMachine(c, 11, "0.9.3", wire.CapabilityRestart, wire.OpRestart, make(chan int))
		return nil
	})
	app.Post("/no-op", func(c *fiber.Ctx) error {
		h.commandMachine(c, 11, "0.9.3", wire.CapabilityRestart, "", struct{}{})
		return nil
	})
	for _, path := range []string{"/unencodable", "/no-op"} {
		if status, _ := post(t, app, path, ""); status != http.StatusInternalServerError {
			t.Errorf("%s: status = %d, want 500", path, status)
		}
	}
	if len(conn.ops(t)) != 0 {
		t.Errorf("sent %d", len(conn.ops(t)))
	}
}
