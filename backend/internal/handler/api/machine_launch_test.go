// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/mustafaturan/monoflake"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	machinectrl "github.com/agentrq/agentrq/backend/internal/controller/machine"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/daemon/wire"
)

// errNotFoundForTest stands in for whatever error the real crud controller
// returns when a machine or workspace does not belong to the caller — these
// handlers fail open the same way regardless of which one it is, so the tests
// do not need the real sentinel.
var errNotFoundForTest = errors.New("not found")

// acpGatewayCrud answers only the two lookups these handlers make; anything
// else panics through the embedded nil interface, the same guard killCrud
// uses in session_kill_test.go.
type acpGatewayCrud struct {
	crud.Controller
	machineErr   error
	workspace    entity.Workspace
	workspaceErr error
}

func (c *acpGatewayCrud) GetMachine(context.Context, entity.GetMachineRequest) (*entity.GetMachineResponse, error) {
	if c.machineErr != nil {
		return nil, c.machineErr
	}
	return &entity.GetMachineResponse{}, nil
}

func (c *acpGatewayCrud) GetWorkspace(context.Context, entity.GetWorkspaceRequest) (*entity.GetWorkspaceResponse, error) {
	if c.workspaceErr != nil {
		return nil, c.workspaceErr
	}
	return &entity.GetWorkspaceResponse{Workspace: c.workspace}, nil
}

// answeringConn stands in for a daemon that replies to whatever it is sent
// immediately, so [machinectrl.Registry.Ask] resolves without a real socket
// or a test-slowing timeout. It parses the request itself, so a test can
// assert on what the handler actually asked for.
type answeringConn struct {
	reg     *machinectrl.Registry
	replyOp wire.Op
	body    any
	got     wire.Control
}

func (c *answeringConn) Send(f wire.Frame) error {
	ctl, err := wire.ParseControl(f)
	if err != nil {
		return err
	}
	c.got = ctl
	c.reg.Deliver(wire.Control{ID: ctl.ID, Op: c.replyOp, Body: mustMarshal(c.body)})
	return nil
}

func (c *answeringConn) Close() error { return nil }

func mustMarshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func acpGatewayApp(c crud.Controller, reg *machinectrl.Registry) *fiber.App {
	h := &handler{crud: c, machineRegistry: reg}
	app := fiber.New()
	app.Use(func(ctx *fiber.Ctx) error {
		ctx.Locals("user_id", "user-1")
		return ctx.Next()
	})
	app.Get(_routePathAcpAgents, h.listAcpAgents())
	app.Get(_routePathAcpModels, h.listAcpModels())
	return app
}

func decodeAcpAgents(t *testing.T, res *http.Response) wire.AcpAgentsList {
	t.Helper()
	var out wire.AcpAgentsList
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func decodeAcpModels(t *testing.T, res *http.Response) wire.AcpModelsList {
	t.Helper()
	var out wire.AcpModelsList
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func TestListAcpAgentsReturnsTheDaemonsAnswer(t *testing.T) {
	reg := machinectrl.NewRegistry("pod-a")
	conn := &answeringConn{reg: reg, replyOp: wire.OpAcpAgents, body: wire.AcpAgentsList{
		Agents: []wire.AcpAgent{{ID: "codex-acp", Name: "Codex", Runtimes: []string{"npx"}}},
	}}
	reg.Add(11, conn)

	res, _ := acpGatewayApp(&acpGatewayCrud{}, reg).Test(
		httptest.NewRequest(http.MethodGet, "/machines/"+monoflake.ID(11).String()+"/acp-agents", nil))

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	got := decodeAcpAgents(t, res)
	if len(got.Agents) != 1 || got.Agents[0].ID != "codex-acp" {
		t.Errorf("agents = %+v", got.Agents)
	}
	if conn.got.Op != wire.OpListAcpAgents {
		t.Errorf("daemon was asked op %q, want %q", conn.got.Op, wire.OpListAcpAgents)
	}
}

// Every reason this could fail to get an answer — a machine that is not the
// caller's, one this instance does not hold — is the same 200 with an empty
// list: the launch form's free text is always the fallback, and there is
// nothing an error status would tell it that emptiness does not already say.
func TestListAcpAgentsFailsOpen(t *testing.T) {
	tests := map[string]struct {
		crud *acpGatewayCrud
		reg  *machinectrl.Registry
	}{
		"unowned or missing machine": {
			crud: &acpGatewayCrud{machineErr: errNotFoundForTest},
			reg:  machinectrl.NewRegistry("pod-a"),
		},
		"machine not connected here": {
			crud: &acpGatewayCrud{},
			reg:  machinectrl.NewRegistry("pod-a"), // nothing added for machine 11
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			res, _ := acpGatewayApp(tc.crud, tc.reg).Test(
				httptest.NewRequest(http.MethodGet, "/machines/"+monoflake.ID(11).String()+"/acp-agents", nil))
			if res.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200", res.StatusCode)
			}
			if got := decodeAcpAgents(t, res); len(got.Agents) != 0 {
				t.Errorf("agents = %+v, want none", got.Agents)
			}
		})
	}
}

func TestListAcpModelsAsksWithTheWorkspacesDirectory(t *testing.T) {
	reg := machinectrl.NewRegistry("pod-a")
	conn := &answeringConn{reg: reg, replyOp: wire.OpAcpModels, body: wire.AcpModelsList{
		Agent:  "codex-acp",
		Models: []wire.AcpModel{{ID: "gpt-5.5", Name: "5.5", Current: true}},
	}}
	reg.Add(11, conn)
	c := &acpGatewayCrud{workspace: entity.Workspace{WorkingDirectory: "/work/ws"}}

	url := "/workspaces/" + monoflake.ID(70).String() + "/acp-models?machineId=" + monoflake.ID(11).String() + "&agent=codex-acp"
	res, _ := acpGatewayApp(c, reg).Test(httptest.NewRequest(http.MethodGet, url, nil))

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	got := decodeAcpModels(t, res)
	if got.Agent != "codex-acp" || len(got.Models) != 1 || got.Models[0].ID != "gpt-5.5" {
		t.Errorf("AcpModelsList = %+v", got)
	}

	var sent wire.ListAcpModels
	if err := json.Unmarshal(conn.got.Body, &sent); err != nil {
		t.Fatal(err)
	}
	if sent.Dir != "/work/ws" || sent.Agent != "codex-acp" {
		t.Errorf("daemon was asked %+v, want dir=/work/ws agent=codex-acp", sent)
	}
}

func TestListAcpModelsFailsOpen(t *testing.T) {
	base := "/workspaces/" + monoflake.ID(70).String() + "/acp-models"
	machineQ := "machineId=" + monoflake.ID(11).String()

	tests := map[string]struct {
		url  string
		crud *acpGatewayCrud
	}{
		"no agent named": {
			url:  base + "?" + machineQ,
			crud: &acpGatewayCrud{workspace: entity.Workspace{WorkingDirectory: "/work/ws"}},
		},
		"no machine named": {
			url:  base + "?agent=codex-acp",
			crud: &acpGatewayCrud{workspace: entity.Workspace{WorkingDirectory: "/work/ws"}},
		},
		"workspace has no working directory yet": {
			url:  base + "?" + machineQ + "&agent=codex-acp",
			crud: &acpGatewayCrud{workspace: entity.Workspace{}},
		},
		"workspace not owned by the caller": {
			url:  base + "?" + machineQ + "&agent=codex-acp",
			crud: &acpGatewayCrud{workspaceErr: errNotFoundForTest},
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			reg := machinectrl.NewRegistry("pod-a")
			reg.Add(11, &stubDaemonConn{})
			res, _ := acpGatewayApp(tc.crud, reg).Test(httptest.NewRequest(http.MethodGet, tc.url, nil))
			if res.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200", res.StatusCode)
			}
			if got := decodeAcpModels(t, res); len(got.Models) != 0 {
				t.Errorf("models = %+v, want none", got.Models)
			}
		})
	}
}
