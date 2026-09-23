// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
)

// A hand-written fake rather than a generated mock: one CI job runs this
// package's tests without generating mocks.
type mockSkillCrud struct {
	crud.Controller

	list    entity.SearchSkillsRequest
	getFile entity.GetSkillFileRequest
	get     entity.GetSkillRequest

	listErr, fileErr, getErr error
}

func (m *mockSkillCrud) SearchSkills(_ context.Context, req entity.SearchSkillsRequest) (*entity.SearchSkillsResponse, error) {
	m.list = req
	return &entity.SearchSkillsResponse{Skills: []entity.Skill{{Name: "tdd", Description: "Test first.", SharedFromWorkspaceID: 301}}, Total: 1}, m.listErr
}

func (m *mockSkillCrud) GetSkillFile(_ context.Context, req entity.GetSkillFileRequest) (*entity.GetSkillFileResponse, error) {
	m.getFile = req
	return &entity.GetSkillFileResponse{Skill: entity.Skill{Name: req.Name}, File: entity.SkillFile{Path: req.Path, Content: "body of " + req.Path}}, m.fileErr
}

func (m *mockSkillCrud) GetSkill(_ context.Context, req entity.GetSkillRequest) (*entity.GetSkillResponse, error) {
	m.get = req
	return &entity.GetSkillResponse{Skill: entity.Skill{Name: req.Name, Files: []entity.SkillFile{{Path: "SKILL.md"}, {Path: "refs/a.md"}}}}, m.getErr
}

func TestSearchSkills_ScopesToTheAuthenticatedUserAndWorkspace(t *testing.T) {
	ctrl := &mockSkillCrud{}
	s := &WorkspaceServer{crud: ctrl}
	body := textOf(t, toolResult(s.handleSearchSkills(authedContext(), nil, SearchSkillsParams{WorkspaceID: base62(testWorkspace), Q: "test", Limit: 5, Offset: 10})))

	if ctrl.list.UserID != testUserID || ctrl.list.WorkspaceID != testWorkspace || ctrl.list.Query != "test" || ctrl.list.Limit != 5 || ctrl.list.Offset != 10 {
		t.Errorf("request = %+v", ctrl.list)
	}
	for _, want := range []string{`"total":1`, `"name":"tdd"`, `"description":"Test first."`, `"sharedFromWorkspaceId":"` + base62(301) + `"`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %s lacks %s", body, want)
		}
	}
}

func TestGetSkill(t *testing.T) {
	for _, tc := range []struct {
		uri, path string
		files     bool
	}{
		{"skill://TDD", "SKILL.md", true},
		{"skill://tdd/SKILL.md", "SKILL.md", true},
		{"skill://tdd/refs/a.md", "refs/a.md", false},
	} {
		ctrl := &mockSkillCrud{}
		s := &WorkspaceServer{crud: ctrl}
		body := textOf(t, toolResult(s.handleGetSkill(authedContext(), nil, GetSkillParams{WorkspaceID: base62(testWorkspace), URI: tc.uri})))

		want := entity.GetSkillFileRequest{UserID: testUserID, WorkspaceID: testWorkspace, Name: "tdd", Path: tc.path}
		if ctrl.getFile != want {
			t.Errorf("%s: request = %+v, want %+v", tc.uri, ctrl.getFile, want)
		}
		if !strings.Contains(body, `"content":"body of `+tc.path+`"`) {
			t.Errorf("%s: body %s", tc.uri, body)
		}
		// A SKILL.md comes with the skill's list of files; a sub file does not.
		if got := strings.Contains(body, `"files":[{"path":"SKILL.md"`); got != tc.files {
			t.Errorf("%s: lists files = %v, want %v: %s", tc.uri, got, tc.files, body)
		}
	}
}

func TestSkillTools_ReportFailures(t *testing.T) {
	refusal := &crud.SkillError{Kind: crud.SkillReadOnly, Message: "read-only here"}
	for _, tc := range []struct {
		name string
		ctrl *mockSkillCrud
		run  func(s *WorkspaceServer) callResult
		want string
	}{
		{"list", &mockSkillCrud{listErr: errors.New("db down")}, func(s *WorkspaceServer) callResult {
			return toolResult(s.handleSearchSkills(authedContext(), nil, SearchSkillsParams{WorkspaceID: base62(testWorkspace), Q: "test", Limit: 5, Offset: 10}))
		}, "db down"},
		{"bad uri", &mockSkillCrud{}, func(s *WorkspaceServer) callResult {
			return toolResult(s.handleGetSkill(authedContext(), nil, GetSkillParams{WorkspaceID: base62(testWorkspace), URI: "memory://x.md"}))
		}, "not a skill URI"},
		{"file", &mockSkillCrud{fileErr: refusal}, func(s *WorkspaceServer) callResult {
			return toolResult(s.handleGetSkill(authedContext(), nil, GetSkillParams{WorkspaceID: base62(testWorkspace), URI: "skill://tdd"}))
		}, "read-only here"},
		{"file list", &mockSkillCrud{getErr: errors.New("db down")}, func(s *WorkspaceServer) callResult {
			return toolResult(s.handleGetSkill(authedContext(), nil, GetSkillParams{WorkspaceID: base62(testWorkspace), URI: "skill://tdd"}))
		}, "db down"},
	} {
		res := tc.run(&WorkspaceServer{crud: tc.ctrl})
		if !res.isError || !strings.Contains(res.text, tc.want) {
			t.Errorf("%s: got %+v, want an error containing %q", tc.name, res, tc.want)
		}
	}
}
