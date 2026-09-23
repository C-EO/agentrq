// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/agentrq/agentrq/backend/internal/service/skill"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Workspace skills: playbooks an agent loads when a task matches one, a
// SKILL.md and the files it points to. The tools disclose progressively —
// listSkills gives names and descriptions only, loadSkill one file at a time —
// because loading every skill up front would spend the context on the ones
// the task does not need.

// SkillSummary is one skill as listSkills shows it.
type SkillSummary struct {
	Name        string
	Description string
	// SharedFrom names the workspace that owns a skill shared into this one,
	// which makes it read-only here. Empty for the workspace's own skills.
	SharedFrom string
}

// SkillStore is this workspace's skills. It is bound to one workspace and its
// owner when the server is built, so no tool can name another workspace.
//
// A miss is reported as found or deleted being false, not as an error. A
// refusal the caller should read — a rule broken, a read-only skill — is a
// *SkillRefusal, passed to the agent word for word.
type SkillStore interface {
	ListSkills(ctx context.Context) ([]SkillSummary, error)
	// LoadSkillFile returns a file's content and the paths of every file in
	// its skill.
	LoadSkillFile(ctx context.Context, name, path string) (content string, files []string, found bool, err error)
	SaveSkillFile(ctx context.Context, name, path, content string) error
	DeleteSkill(ctx context.Context, name string) (deleted bool, err error)
	DeleteSkillFile(ctx context.Context, name, path string) (deleted bool, err error)
}

// SkillRefusal is a refusal written for the agent, such as an invalid SKILL.md
// or a write to a skill another workspace owns.
type SkillRefusal struct{ Message string }

func (r *SkillRefusal) Error() string { return r.Message }

// LoadSkillParams is the input to the loadSkill tool.
type LoadSkillParams struct {
	URI string `json:"uri" jsonschema:"The file to read, as skill://<name>/<path>. skill://<name> alone reads its SKILL.md."`
}

// SaveSkillParams is the input to the saveSkill tool.
type SaveSkillParams struct {
	URI     string `json:"uri" jsonschema:"The file to write, as skill://<name>/<path>. skill://<name> alone writes its SKILL.md."`
	Content string `json:"content" jsonschema:"The full new content of the file. This replaces it entirely — there is no append."`
}

// DeleteSkillParams is the input to the deleteSkill tool.
type DeleteSkillParams struct {
	URI string `json:"uri" jsonschema:"skill://<name> deletes the whole skill; skill://<name>/<path> deletes one file."`
}

const skillsUnavailable = "skills are not available on this server"

func textResult(format string, args ...any) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(format, args...)}}}
}

// skillFailure is a refusal passed on as written, or any other error prefixed
// with what was being attempted.
func skillFailure(err error, doing string) *mcp.CallToolResult {
	var refusal *SkillRefusal
	if errors.As(err, &refusal) {
		return toolError("%s", refusal.Message)
	}
	return toolError("failed to %s: %v", doing, err)
}

func (ps *WorkspaceServer) handleListSkills(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	ps.emitTelemetry(ctx, ActionMCPToolCall, "listSkills", clientIdentityFromRequest(req))

	if ps.skills == nil {
		return toolError(skillsUnavailable), nil, nil
	}
	skills, err := ps.skills.ListSkills(ctx)
	if err != nil {
		return skillFailure(err, "list skills"), nil, nil
	}
	if len(skills) == 0 {
		return textResult("This workspace has no skills yet. Write one with saveSkill, starting with skill://<name>/%s.", skill.FileName), nil, nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%d skills. Load the %s of any whose description matches your task with loadSkill.\n", len(skills), skill.FileName)
	for _, s := range skills {
		fmt.Fprintf(&b, "\n- %s: %s\n  %s", s.Name, s.Description, skill.URI(s.Name, skill.FileName))
		if s.SharedFrom != "" {
			fmt.Fprintf(&b, " (shared from %s, read-only)", s.SharedFrom)
		}
	}
	return textResult("%s", b.String()), nil, nil
}

func (ps *WorkspaceServer) handleLoadSkill(ctx context.Context, req *mcp.CallToolRequest, params LoadSkillParams) (*mcp.CallToolResult, any, error) {
	ps.emitTelemetry(ctx, ActionMCPToolCall, "loadSkill", clientIdentityFromRequest(req))

	name, p, err := skill.ParseURI(params.URI)
	if err != nil {
		return toolError("%v", err), nil, nil
	}
	if p == "" {
		p = skill.FileName
	}
	if ps.skills == nil {
		return toolError(skillsUnavailable), nil, nil
	}

	content, files, found, err := ps.skills.LoadSkillFile(ctx, name, p)
	if err != nil {
		return skillFailure(err, "load "+skill.URI(name, p)), nil, nil
	}
	if !found {
		// Not an error: a stale link or a guessed name, which listSkills
		// answers.
		return textResult("No skill or file at %s. Call listSkills to see the skills this workspace has.", skill.URI(name, p)), nil, nil
	}
	if p != skill.FileName {
		return textResult("%s", content), nil, nil
	}

	var others []string
	for _, f := range files {
		if f != skill.FileName {
			others = append(others, skill.URI(name, f))
		}
	}
	if len(others) == 0 {
		return textResult("%s", content), nil, nil
	}
	return textResult("%s\n\n---\nFiles in this skill:\n%s\n\nLoad one with loadSkill and its skill:// URI when %s points you to it.",
		content, strings.Join(others, "\n"), skill.FileName), nil, nil
}

func (ps *WorkspaceServer) handleSaveSkill(ctx context.Context, req *mcp.CallToolRequest, params SaveSkillParams) (*mcp.CallToolResult, any, error) {
	ps.emitTelemetry(ctx, ActionMCPToolCall, "saveSkill", clientIdentityFromRequest(req))

	name, p, err := skill.ParseURI(params.URI)
	if err != nil {
		return toolError("%v", err), nil, nil
	}
	if p == "" {
		p = skill.FileName
	}
	if ps.skills == nil {
		return toolError(skillsUnavailable), nil, nil
	}

	if err := ps.skills.SaveSkillFile(ctx, name, p, params.Content); err != nil {
		return skillFailure(err, "save "+skill.URI(name, p)), nil, nil
	}
	return textResult("Saved %s (%d bytes).", skill.URI(name, p), len(params.Content)), nil, nil
}

func (ps *WorkspaceServer) handleDeleteSkill(ctx context.Context, req *mcp.CallToolRequest, params DeleteSkillParams) (*mcp.CallToolResult, any, error) {
	ps.emitTelemetry(ctx, ActionMCPToolCall, "deleteSkill", clientIdentityFromRequest(req))

	name, p, err := skill.ParseURI(params.URI)
	if err != nil {
		return toolError("%v", err), nil, nil
	}
	if p == skill.FileName {
		return toolError("a skill cannot lose its %s; delete the whole skill with skill://%s instead", skill.FileName, name), nil, nil
	}
	if ps.skills == nil {
		return toolError(skillsUnavailable), nil, nil
	}

	var deleted bool
	target := "skill://" + name
	if p == "" {
		deleted, err = ps.skills.DeleteSkill(ctx, name)
	} else {
		target = skill.URI(name, p)
		deleted, err = ps.skills.DeleteSkillFile(ctx, name, p)
	}
	if err != nil {
		return skillFailure(err, "delete "+target), nil, nil
	}
	if !deleted {
		// Not an error: the state the caller asked for already holds.
		return textResult("Nothing at %s; nothing to delete.", target), nil, nil
	}
	return textResult("Deleted %s.", target), nil, nil
}
