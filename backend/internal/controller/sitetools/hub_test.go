// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package sitetools

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeConn records frames; onSend, when set, runs after each one is recorded.
type fakeConn struct {
	mu     sync.Mutex
	frames []Frame
	err    error
	onSend func(Frame)
}

func (c *fakeConn) Send(f Frame) error {
	c.mu.Lock()
	c.frames = append(c.frames, f)
	c.mu.Unlock()
	if c.onSend != nil {
		c.onSend(f)
	}
	return c.err
}

func (c *fakeConn) Close() error { return nil }

func counter() func() string {
	n := 0
	return func() string { n++; return "call-" + string(rune('0'+n)) }
}

func TestHubInstanceID(t *testing.T) {
	if got := NewHub("pod-1", counter()).InstanceID(); got != "pod-1" {
		t.Fatalf("InstanceID() = %q", got)
	}
}

func TestHubCallDeliver(t *testing.T) {
	h := NewHub("i", counter())
	c := &fakeConn{}
	c.onSend = func(f Frame) {
		go h.Deliver(Frame{Type: FrameResult, CallID: f.CallID, Text: "done"})
	}
	h.Add(1, "b", c)

	got, err := h.Call(context.Background(), 1, "b", "https://a.b", "search", json.RawMessage(`{"q":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if got.Text != "done" {
		t.Fatalf("result = %+v", got)
	}
	sent := c.frames[0]
	if sent.Type != FrameCall || sent.CallID != "call-1" || sent.Origin != "https://a.b" ||
		sent.Tool != "search" || string(sent.Arguments) != `{"q":1}` {
		t.Fatalf("sent %+v", sent)
	}
	if h.Deliver(Frame{Type: FrameResult, CallID: "call-1"}) {
		t.Fatal("a finished call must not accept a second result")
	}
}

func TestHubDeliverUnknown(t *testing.T) {
	h := NewHub("i", counter())
	if h.Deliver(Frame{Type: FrameResult, CallID: "nope"}) {
		t.Fatal("unknown callId delivered")
	}
	if h.Deliver(Frame{Type: FrameResult}) {
		t.Fatal("empty callId delivered")
	}
}

func TestHubDeliverTwiceBeforeRead(t *testing.T) {
	h := NewHub("i", counter())
	c := &fakeConn{}
	c.onSend = func(f Frame) {
		h.Deliver(Frame{Type: FrameResult, CallID: f.CallID, Text: "first"})
		if h.Deliver(Frame{Type: FrameResult, CallID: f.CallID, Text: "second"}) {
			t.Error("a second result to the same call was accepted")
		}
	}
	h.Add(1, "b", c)
	got, err := h.Call(context.Background(), 1, "b", "o", "t", nil)
	if err != nil || got.Text != "first" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestHubCallOffline(t *testing.T) {
	h := NewHub("i", counter())
	h.Add(1, "other", &fakeConn{})
	if _, err := h.Call(context.Background(), 1, "b", "o", "t", nil); !errors.Is(err, ErrOffline) {
		t.Fatalf("err = %v", err)
	}
	if _, err := h.Call(context.Background(), 2, "b", "o", "t", nil); !errors.Is(err, ErrOffline) {
		t.Fatalf("err = %v", err)
	}
}

func TestHubCallTimeout(t *testing.T) {
	h := NewHub("i", counter())
	h.deadline = 50 * time.Millisecond
	h.Add(1, "b", &fakeConn{})
	if _, err := h.Call(context.Background(), 1, "b", "o", "t", nil); !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v", err)
	}
	if n := len(h.pending); n != 0 {
		t.Fatalf("%d pending calls left behind", n)
	}
}

func TestHubCallContextCancelled(t *testing.T) {
	h := NewHub("i", counter())
	ctx, cancel := context.WithCancel(context.Background())
	c := &fakeConn{onSend: func(Frame) { cancel() }}
	h.Add(1, "b", c)
	if _, err := h.Call(ctx, 1, "b", "o", "t", nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}

func TestHubCallSendError(t *testing.T) {
	h := NewHub("i", counter())
	boom := errors.New("boom")
	h.Add(1, "b", &fakeConn{err: boom})
	if _, err := h.Call(context.Background(), 1, "b", "o", "t", nil); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if n := len(h.pending); n != 0 {
		t.Fatalf("%d pending calls left behind", n)
	}
}

func TestHubRemoveDuringCall(t *testing.T) {
	h := NewHub("i", counter())
	other := &fakeConn{}
	otherSent := make(chan string, 1)
	other.onSend = func(f Frame) { otherSent <- f.CallID }
	h.Add(1, "other", other)
	otherDone := make(chan Frame, 1)
	go func() {
		f, _ := h.Call(context.Background(), 1, "other", "o", "t", nil)
		otherDone <- f
	}()
	otherID := <-otherSent

	c := &fakeConn{}
	c.onSend = func(Frame) { go h.Remove(1, "b", c) }
	h.Add(1, "b", c)
	start := time.Now()
	if _, err := h.Call(context.Background(), 1, "b", "o", "t", nil); !errors.Is(err, ErrOffline) {
		t.Fatalf("err = %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("Remove did not fail the call immediately")
	}
	if h.Online(1, "b") {
		t.Fatal("removed browser still online")
	}

	// Another browser's pending call is untouched by that Remove.
	if !h.Deliver(Frame{Type: FrameResult, CallID: otherID, Text: "ok"}) {
		t.Fatal("the other browser's call was failed too")
	}
	if f := <-otherDone; f.Text != "ok" {
		t.Fatalf("other result = %+v", f)
	}
}

func TestHubDisplaced(t *testing.T) {
	h := NewHub("i", counter())
	old, cur := &fakeConn{}, &fakeConn{}
	if d := h.Add(1, "b", old); d != nil {
		t.Fatalf("first Add displaced %v", d)
	}
	if d := h.Add(1, "b", cur); d != old {
		t.Fatalf("displaced = %v, want the old conn", d)
	}
	h.Remove(1, "b", old)
	if !h.Online(1, "b") {
		t.Fatal("the displaced conn's Remove took the new one offline")
	}
	h.Remove(2, "b", old) // unknown user: a no-op
	h.Remove(1, "b", cur)
	if h.Online(1, "b") {
		t.Fatal("still online after Remove")
	}
}

func TestNewHubDefaults(t *testing.T) {
	if d := NewHub("i", counter()).deadline; d != CallDeadline {
		t.Fatalf("deadline = %v", d)
	}
}
