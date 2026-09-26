// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package api

import (
	"encoding/json"

	view "github.com/agentrq/agentrq/backend/internal/data/view/api"
)

func FromBrowserTicketToHTTPResponse(ticket string, expiresIn int) []byte {
	b, _ := json.Marshal(view.BrowserTicket{Ticket: ticket, ExpiresIn: expiresIn})
	return b
}
