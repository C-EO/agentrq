// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package app

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/agentrq/agentrq/backend/internal/controller/crud"
	"github.com/agentrq/agentrq/backend/internal/controller/mcp"
	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/repository/base"
)

// fakeSkillCrud answers the skill calls the store makes, and records which
// workspace and user each one named.
type fakeSkillCrud struct {
	crud.Controller

	skills                        []entity.Skill
	workspaces                    map[int64]string
	listErr, getErr, fileErr, err error
	scopes                        []string
}

func (f *fakeSkillCrud) scope(workspaceID int64, userID string) {
	f.scopes = append(f.scopes, userID+"@"+string(rune('0'+workspaceID)))
}

func (f *fakeSkillCrud) ListSkills(_ context.Context, req entity.ListSkillsRequest) (*entity.ListSkillsResponse, error) {
	f.scope(req.WorkspaceID, req.UserID)
	return &entity.ListSkillsResponse{Skills: f.skills}, f.listErr
}

func (f *fakeSkillCrud) GetWorkspace(_ context.Context, req entity.GetWorkspaceRequest) (*entity.GetWorkspaceResponse, error) {
	name, ok := f.workspaces[req.ID]
	if !ok {
		return nil, base.ErrNotFound
	}
	return &entity.GetWorkspaceResponse{Workspace: entity.Workspace{Name: name}}, nil
}

func (f *fakeSkillCrud) GetSkill(_ context.Context, req entity.GetSkillRequest) (*entity.GetSkillResponse, error) {
	f.scope(req.WorkspaceID, req.UserID)
	return &entity.GetSkillResponse{Skill: entity.Skill{Files: []entity.SkillFile{{Path: "SKILL.md"}, {Path: "a.md"}}}}, f.getErr
}

func (f *fakeSkillCrud) GetSkillFile(_ context.Context, req entity.GetSkillFileRequest) (*entity.GetSkillFileResponse, error) {
	f.scope(req.WorkspaceID, req.UserID)
	return &entity.GetSkillFileResponse{File: entity.SkillFile{Content: "content of " + req.Path}}, f.fileErr
}

func (f *fakeSkillCrud) SaveSkillFile(_ context.Context, req entity.SaveSkillFileRequest) (*entity.SaveSkillFileResponse, error) {
	f.scope(req.WorkspaceID, req.UserID)
	return nil, f.err
}

func (f *fakeSkillCrud) DeleteSkill(_ context.Context, req entity.DeleteSkillRequest) error {
	f.scope(req.WorkspaceID, req.UserID)
	return f.err
}

func (f *fakeSkillCrud) DeleteSkillFile(_ context.Context, req entity.DeleteSkillFileRequest) (*entity.DeleteSkillFileResponse, error) {
	f.scope(req.WorkspaceID, req.UserID)
	return nil, f.err
}

func newSkillStore(f *fakeSkillCrud) *skillStore {
	return &skillStore{crud: f, workspaceID: 7, userID: "owner"}
}

func TestSkillStore_List(t *testing.T) {
	f := &fakeSkillCrud{
		skills: []entity.Skill{
			{Name: "own", Description: "Mine."},
			{Name: "a", Description: "A.", SharedFromWorkspaceID: 8},
			{Name: "b", Description: "B.", SharedFromWorkspaceID: 8},
			{Name: "c", Description: "C.", SharedFromWorkspaceID: 9},
		},
		workspaces: map[int64]string{8: "Platform"},
	}
	got, err := newSkillStore(f).ListSkills(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []mcp.SkillSummary{
		{Name: "own", Description: "Mine."},
		{Name: "a", Description: "A.", SharedFrom: `workspace "Platform"`},
		{Name: "b", Description: "B.", SharedFrom: `workspace "Platform"`},
		// A workspace the owner cannot see any more is still named, vaguely.
		{Name: "c", Description: "C.", SharedFrom: "another workspace"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
	if !reflect.DeepEqual(f.scopes, []string{"owner@7"}) {
		t.Errorf("scopes: %v", f.scopes)
	}
}

func TestSkillStore_Load(t *testing.T) {
	f := &fakeSkillCrud{}
	content, files, found, err := newSkillStore(f).LoadSkillFile(context.Background(), "tdd", "SKILL.md")
	if err != nil || !found || content != "content of SKILL.md" || !reflect.DeepEqual(files, []string{"SKILL.md", "a.md"}) {
		t.Errorf("got %q %v %v %v", content, files, found, err)
	}
	if !reflect.DeepEqual(f.scopes, []string{"owner@7", "owner@7"}) {
		t.Errorf("scopes: %v", f.scopes)
	}
}

// Only a SKILL.md comes with the list of files, so a sub file is one lookup.
func TestSkillStore_LoadSubFileIsOneLookup(t *testing.T) {
	f := &fakeSkillCrud{}
	content, files, found, err := newSkillStore(f).LoadSkillFile(context.Background(), "tdd", "a.md")
	if err != nil || !found || content != "content of a.md" || files != nil {
		t.Errorf("got %q %v %v %v", content, files, found, err)
	}
	if len(f.scopes) != 1 {
		t.Errorf("calls: %v", f.scopes)
	}
}

func TestSkillStore_Errors(t *testing.T) {
	refusal := &crud.SkillError{Kind: crud.SkillReadOnly, Message: "read-only here"}
	other := errors.New("db down")
	ctx := context.Background()

	isRefusal := func(err error) bool {
		var r *mcp.SkillRefusal
		return errors.As(err, &r) && r.Message == "read-only here"
	}

	// A miss is not an error, from either lookup a load makes.
	for _, f := range []*fakeSkillCrud{{getErr: base.ErrNotFound}, {fileErr: base.ErrNotFound}} {
		if _, _, found, err := newSkillStore(f).LoadSkillFile(ctx, "tdd", "SKILL.md"); found || err != nil {
			t.Errorf("miss: found %v err %v", found, err)
		}
	}
	for _, f := range []*fakeSkillCrud{{getErr: refusal}, {fileErr: refusal}} {
		if _, _, _, err := newSkillStore(f).LoadSkillFile(ctx, "tdd", "SKILL.md"); !isRefusal(err) {
			t.Errorf("load refusal: %v", err)
		}
	}
	if _, err := newSkillStore(&fakeSkillCrud{listErr: refusal}).ListSkills(ctx); !isRefusal(err) {
		t.Errorf("list refusal: %v", err)
	}
	if err := newSkillStore(&fakeSkillCrud{err: refusal}).SaveSkillFile(ctx, "tdd", "SKILL.md", "x"); !isRefusal(err) {
		t.Errorf("save refusal: %v", err)
	}
	if err := newSkillStore(&fakeSkillCrud{err: other}).SaveSkillFile(ctx, "tdd", "SKILL.md", "x"); err != other {
		t.Errorf("other errors pass unchanged: %v", err)
	}
	if err := newSkillStore(&fakeSkillCrud{}).SaveSkillFile(ctx, "tdd", "SKILL.md", "x"); err != nil {
		t.Errorf("save: %v", err)
	}

	for _, tc := range []struct {
		err     error
		deleted bool
		refused bool
	}{
		{nil, true, false},
		{base.ErrNotFound, false, false},
		{refusal, false, true},
	} {
		s := newSkillStore(&fakeSkillCrud{err: tc.err})
		for name, run := range map[string]func() (bool, error){
			"skill": func() (bool, error) { return s.DeleteSkill(ctx, "tdd") },
			"file":  func() (bool, error) { return s.DeleteSkillFile(ctx, "tdd", "a.md") },
		} {
			deleted, err := run()
			if deleted != tc.deleted || isRefusal(err) != tc.refused || (!tc.refused && err != nil) {
				t.Errorf("delete %s with %v: deleted %v err %v", name, tc.err, deleted, err)
			}
		}
	}
}
