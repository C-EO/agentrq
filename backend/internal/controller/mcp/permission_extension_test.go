// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package mcp

import (
	"context"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

// An extension's verdict is a real answer, and is not a person's.
//
// This is the whole reason SendPermissionVerdictFrom exists. Delivered through
// the human entry point an extension's decision would be counted under
// `permission_manual_allow` — the one number on the analytics screen that is
// supposed to mean somebody stopped and thought about it.
func TestExtensionVerdictIsNotCountedAsAManualApproval(t *testing.T) {
	ps, rec := approvalServer(t, nil)
	ps.permissionRequests["req-x1"] = "sess-1"

	_ = ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x1", Behavior: "allow", DecidedBy: "guardrail"})

	if got := rec.count("permission_extension_allow"); got != 1 {
		t.Errorf("expected 1 extension approval, got %d (all: %v)", got, rec.snapshot())
	}
	if got := rec.count("permission_manual_allow"); got != 0 {
		t.Errorf("nobody clicked anything, got %d manual (all: %v)", got, rec.snapshot())
	}
	if got := rec.count("permission_auto_allow"); got != 0 {
		t.Errorf("an extension is not an auto-allow rule either, got %d (all: %v)", got, rec.snapshot())
	}
}

// The same for the direction that costs nothing but a tool call.
func TestExtensionDenialIsCountedAsAnExtensionDenial(t *testing.T) {
	ps, rec := approvalServer(t, nil)
	ps.permissionRequests["req-x2"] = "sess-1"

	_ = ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x2", Behavior: "deny", DecidedBy: "guardrail"})

	if got := rec.count("permission_extension_deny"); got != 1 {
		t.Errorf("expected 1 extension denial, got %d (all: %v)", got, rec.snapshot())
	}
	if got := rec.count("permission_manual_deny"); got != 0 {
		t.Errorf("nobody clicked anything, got %d manual (all: %v)", got, rec.snapshot())
	}
}

// An empty decider is the browser, not a nameless extension.
//
// Every verdict from the web UI arrives with the field absent, so this is the
// overwhelmingly common path through the new entry point and it has to behave
// exactly as it did before the field existed.
func TestVerdictWithNoDeciderIsStillAManualOne(t *testing.T) {
	ps, rec := approvalServer(t, nil)
	ps.permissionRequests["req-x3"] = "sess-1"

	_ = ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x3", Behavior: "allow", DecidedBy: ""})

	if got := rec.count("permission_manual_allow"); got != 1 {
		t.Errorf("expected 1 manual approval, got %d (all: %v)", got, rec.snapshot())
	}
	if got := rec.count("permission_extension_allow"); got != 0 {
		t.Errorf("an unnamed decider is the human, got %d extension (all: %v)", got, rec.snapshot())
	}
}

// An extension may answer this request. It may not write a standing rule.
//
// "allow_always" does two things, and only the first of them was consented to:
// the rule it writes answers every future request without asking anybody, and
// it stays behind when the extension is uninstalled. Refused rather than
// downgraded to a plain allow — an extension that asked for the wrong thing
// should be told so, not quietly given something else.
func TestExtensionCannotWriteAnAutoAllowRule(t *testing.T) {
	ps, rec := approvalServer(t, nil)
	ps.permissionRequests["req-x4"] = "sess-1"
	ps.requestTools["req-x4"] = "Bash"
	ps.requestParams["req-x4"] = &PermissionRequestParams{
		RequestID:    "req-x4",
		ToolName:     "Bash",
		InputPreview: `{"command":"rm -rf /"}`,
	}

	err := ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x4", Behavior: "allow_always", DecidedBy: "guardrail"})

	if !errors.Is(err, ErrExtensionCannotRemember) {
		t.Fatalf("expected the standing rule refused, got %v", err)
	}
	if len(ps.autoAllowedTools) != 0 {
		t.Errorf("no rule should have been written, got %v", ps.autoAllowedTools)
	}
	if got := len(rec.snapshot()); got != 0 {
		t.Errorf("a refused verdict decides nothing and counts as nothing, got %v", rec.snapshot())
	}
}

// `decidedBy` is drawn in the task feed as the thing that made a decision, and
// it arrives in an HTTP body. A caller is already authenticated and already
// allowed to answer the request, so this is not about privilege — it is that an
// identifier written into the feed has to be an identifier.
func TestVerdictFromSomethingThatIsNotAnExtensionNameIsRefused(t *testing.T) {
	for _, name := range []string{"You", "not a name", "<b>ops</b>", "-leading", "trailing-", "UPPER"} {
		t.Run(name, func(t *testing.T) {
			ps, rec := approvalServer(t, nil)
			ps.permissionRequests["req-x5"] = "sess-1"

			err := ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x5", Behavior: "allow", DecidedBy: name})

			if !errors.Is(err, ErrBadDecider) {
				t.Fatalf("expected %q refused as a decider, got %v", name, err)
			}
			if got := len(rec.snapshot()); got != 0 {
				t.Errorf("a refused verdict counts as nothing, got %v", rec.snapshot())
			}
		})
	}
}

// The message the user is looking at says who answered it.
//
// Without this the feed shows "Allowed" on a card nobody clicked, which is the
// one outcome this whole feature must not produce: a decision the user is
// invited to remember making.
func TestExtensionVerdictRecordsTheDeciderOnTheMessage(t *testing.T) {
	replies := 0
	ps := permissionServer(t, &replies)
	sessID := connectedServer(t, ps, "agent")

	ps.permissionRequests["req-x6"] = sessID
	ps.permissionResponses["req-x6"] = 700
	ps.requestTaskIDs["req-x6"] = 42

	var written map[string]any
	ps.updateMessageMetadata = func(ctx context.Context, taskID, messageID int64, metadata any) error {
		written, _ = metadata.(map[string]any)
		return nil
	}

	if err := ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{RequestID: "req-x6", Behavior: "deny", DecidedBy: "guardrail"}); err != nil {
		t.Fatalf("expected the verdict delivered, got %v", err)
	}

	if written["status"] != "deny" {
		t.Errorf("expected the verdict recorded, got %v", written["status"])
	}
	if written["decidedBy"] != "guardrail" {
		t.Errorf("expected the deciding extension recorded, got %v", written["decidedBy"])
	}
}

// A verdict the user gave leaves no decider behind.
//
// An absent field is how "you did this" is said, and every message written
// before extensions existed says it that way. Writing `decidedBy: "you"` would
// be a value nothing else in the system produces.
func TestHumanVerdictRecordsNoDecider(t *testing.T) {
	replies := 0
	ps := permissionServer(t, &replies)
	sessID := connectedServer(t, ps, "agent")

	ps.permissionRequests["req-x7"] = sessID
	ps.permissionResponses["req-x7"] = 700
	ps.requestTaskIDs["req-x7"] = 42

	var written map[string]any
	ps.updateMessageMetadata = func(ctx context.Context, taskID, messageID int64, metadata any) error {
		written, _ = metadata.(map[string]any)
		return nil
	}

	if err := ps.SendPermissionVerdict(context.Background(), 42, "req-x7", "allow"); err != nil {
		t.Fatalf("expected the verdict delivered, got %v", err)
	}

	if _, ok := written["decidedBy"]; ok {
		t.Errorf("a human verdict should name no decider, got %v", written["decidedBy"])
	}
}

// A refusal that explains itself reaches the agent.
//
// The reason was already being written — `guardrail` answers "this deletes a
// directory tree, and nothing undoes it" — and it went to a log file and
// nowhere else. An agent told why can come back with something narrower; one
// told "denied" asks the same thing again, or abandons a task it could have
// finished.
func TestVerdictParamsCarryTheReasonWhenThereIsOne(t *testing.T) {
	params := verdictParams("req-1", "deny", "this deletes a directory tree")

	if params["reason"] != "this deletes a directory tree" {
		t.Errorf("expected the reason delivered, got %v", params["reason"])
	}
	if params["request_id"] != "req-1" || params["behavior"] != "deny" {
		t.Errorf("the rest of the notification must be unchanged, got %v", params)
	}
}

// A harness that does not know the field sees exactly what it saw before.
func TestVerdictParamsAreUnchangedWithoutAReason(t *testing.T) {
	params := verdictParams("req-1", "allow", "")

	if _, ok := params["reason"]; ok {
		t.Errorf("an absent reason must not become an empty one, got %v", params)
	}
	if len(params) != 2 {
		t.Errorf("expected only the two fields that were always there, got %v", params)
	}
}

// The reason ends up in the task's feed as well as in the agent's notification.
//
// A card saying "Denied" and nothing else leaves the user working out why
// something they did not do was done, which is the question a reason answers.
func TestExtensionVerdictRecordsItsReasonOnTheMessage(t *testing.T) {
	replies := 0
	ps := permissionServer(t, &replies)
	sessID := connectedServer(t, ps, "agent")

	ps.permissionRequests["req-r1"] = sessID
	ps.permissionResponses["req-r1"] = 700
	ps.requestTaskIDs["req-r1"] = 42

	var written map[string]any
	ps.updateMessageMetadata = func(ctx context.Context, taskID, messageID int64, metadata any) error {
		written, _ = metadata.(map[string]any)
		return nil
	}

	err := ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{
		RequestID: "req-r1",
		Behavior:  "deny",
		DecidedBy: "guardrail",
		Reason:    "this deletes a directory tree",
	})
	if err != nil {
		t.Fatalf("expected the verdict delivered, got %v", err)
	}

	if written["reason"] != "this deletes a directory tree" {
		t.Errorf("expected the reason recorded, got %v", written["reason"])
	}
	if written["decidedBy"] != "guardrail" {
		t.Errorf("expected the decider still recorded, got %v", written["decidedBy"])
	}
}

// A verdict with nothing to explain leaves no empty field behind.
func TestVerdictWithNoReasonRecordsNone(t *testing.T) {
	replies := 0
	ps := permissionServer(t, &replies)
	sessID := connectedServer(t, ps, "agent")

	ps.permissionRequests["req-r2"] = sessID
	ps.permissionResponses["req-r2"] = 700
	ps.requestTaskIDs["req-r2"] = 42

	var written map[string]any
	ps.updateMessageMetadata = func(ctx context.Context, taskID, messageID int64, metadata any) error {
		written, _ = metadata.(map[string]any)
		return nil
	}

	if err := ps.SendPermissionVerdict(context.Background(), 42, "req-r2", "allow"); err != nil {
		t.Fatalf("expected the verdict delivered, got %v", err)
	}

	if _, ok := written["reason"]; ok {
		t.Errorf("expected no reason recorded, got %v", written["reason"])
	}
}

// Nothing about explaining a refusal is particular to extensions.
//
// The field is on the route for every caller, so a client that wants to say why
// somebody denied something gets it delivered the same way.
func TestAHumanVerdictMayCarryAReasonToo(t *testing.T) {
	ps, rec := approvalServer(t, nil)
	ps.permissionRequests["req-r3"] = "sess-1"

	err := ps.SendPermissionVerdictFrom(context.Background(), 42, Verdict{
		RequestID: "req-r3",
		Behavior:  "deny",
		Reason:    "not on production",
	})
	if err == nil || !strings.Contains(err.Error(), "session") {
		// Delivery fails in this harness (no live session); what matters is that
		// it was treated as a human decision and got that far.
		t.Logf("delivery: %v", err)
	}

	if got := rec.count("permission_manual_deny"); got != 1 {
		t.Errorf("a reason must not change who decided, got %d (all: %v)", got, rec.snapshot())
	}
	if got := rec.count("permission_extension_deny"); got != 0 {
		t.Errorf("nobody named an extension, got %d (all: %v)", got, rec.snapshot())
	}
}

// The reason is prose from an HTTP body that ends up in a feed and in an agent's
// context, so it is bounded and stripped rather than trusted.
func TestSanitiseReason(t *testing.T) {
	if got := sanitiseReason("  this deletes a tree  "); got != "this deletes a tree" {
		t.Errorf("expected it trimmed, got %q", got)
	}

	// Newlines and tabs become spaces; everything else that cannot be printed
	// goes entirely — a reason that redraws the screen is not a reason.
	if got := sanitiseReason("line one\nline two\tand\x07three"); got != "line one line two and three" {
		t.Errorf("expected control characters handled, got %q", got)
	}

	// Truncated rather than refused, which is the opposite of how an oversized
	// memory is treated — here the answer matters more than the footnote.
	long := strings.Repeat("x", maxReasonLen+50)
	if got := sanitiseReason(long); len(got) != maxReasonLen {
		t.Errorf("expected %d characters kept, got %d", maxReasonLen, len(got))
	}

	// A multi-byte character must not be cut in half: the result is drawn to a
	// person, and half a rune does not render.
	wide := strings.Repeat("é", maxReasonLen)
	if got := sanitiseReason(wide); !utf8.ValidString(got) {
		t.Errorf("expected valid UTF-8, got %q", got)
	}

	if got := sanitiseReason(""); got != "" {
		t.Errorf("expected nothing from nothing, got %q", got)
	}
}
