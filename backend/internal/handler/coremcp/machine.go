// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package coremcp

import (
	"context"
	"fmt"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/service/mcphint"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *WorkspaceServer) registerMachineTools() {
	mcp.AddTool(s.server, &mcp.Tool{Name: "createEnrolmentCode", Description: "Mint a one-time code for enrolling a new machine with agentrqd. It is shown once and expires shortly, so hand it to the human right away — see the agentrq://guides/agentrqd-setup resource for the rest of the setup", Annotations: mcphint.Write("Create an enrolment code")}, s.handleCreateEnrolmentCode)
}

// handleCreateEnrolmentCode mints the code; it never enrols anything itself.
// There is no remote enrolment — a human has to run the resulting command on
// the target machine themselves.
func (s *WorkspaceServer) handleCreateEnrolmentCode(ctx context.Context, req *mcp.CallToolRequest, args struct{}) (*mcp.CallToolResult, any, error) {
	userID := getUserID(ctx)
	res, err := s.crud.CreateEnrolmentCode(ctx, entity.CreateEnrolmentCodeRequest{UserID: userID})
	if err != nil {
		return errorResponse(err), nil, nil
	}

	return jsonResponse(map[string]any{
		"code":         res.Code,
		"expiresAt":    res.ExpiresAt,
		"enrolCommand": fmt.Sprintf("agentrqd enroll --server %s --code %s", s.baseURL, res.Code),
	}), nil, nil
}
