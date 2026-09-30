// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package memq

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestMemq(t *testing.T) {
	queues, err := New(Params{})
	if err != nil {
		t.Fatalf("failed to create memq: %v", err)
	}
	defer queues.Close()

	t.Run("a created queue accepts a task", func(t *testing.T) {
		queue, err := queues.Create(context.Background(), CreateRequest{Name: "test-q", Size: 10})
		if err != nil {
			t.Fatal(err)
		}

		err = queues.AddTask(context.Background(), AddTaskRequest{
			QueueID: queue.ID,
			Task:    Task{ID: 1, Val: "v1"},
		})
		if err != nil {
			t.Errorf("failed to add task: %v", err)
		}

		// Double check stats if possible (not exposed easily but we can check if it works)
	})

	t.Run("workers process every task added", func(t *testing.T) {
		queue, _ := queues.Create(context.Background(), CreateRequest{Name: "worker-q", Size: 10})

		var processed int32
		done := make(chan bool)

		handle := func(ctx context.Context, t Task) error {
			atomic.AddInt32(&processed, 1)
			if atomic.LoadInt32(&processed) == 2 {
				done <- true
			}
			return nil
		}

		err = queues.AddWorkers(context.Background(), AddWorkersRequest{
			QueueID: queue.ID,
			Count:   2,
			Handle:  handle,
		})
		if err != nil {
			t.Fatal(err)
		}

		queues.AddTask(context.Background(), AddTaskRequest{QueueID: queue.ID, Task: Task{ID: 1}})
		queues.AddTask(context.Background(), AddTaskRequest{QueueID: queue.ID, Task: Task{ID: 2}})

		select {
		case <-done:
			// Success
		case <-time.After(1 * time.Second):
			t.Errorf("only %d of 2 tasks were processed within a second", atomic.LoadInt32(&processed))
		}
	})

	t.Run("an unknown queue takes neither tasks nor workers", func(t *testing.T) {
		err := queues.AddTask(context.Background(), AddTaskRequest{QueueID: 999})
		if err != ErrQueueNotFound {
			t.Errorf("expected ErrQueueNotFound, got %v", err)
		}

		err = queues.AddWorkers(context.Background(), AddWorkersRequest{QueueID: 999})
		if err != ErrQueueNotFound {
			t.Errorf("expected ErrQueueNotFound, got %v", err)
		}
	})

	t.Run("a full queue refuses the next task", func(t *testing.T) {
		queue, _ := queues.Create(context.Background(), CreateRequest{Name: "full-q", Size: 1})
		queues.AddTask(context.Background(), AddTaskRequest{QueueID: queue.ID, Task: Task{ID: 1}})
		err := queues.AddTask(context.Background(), AddTaskRequest{QueueID: queue.ID, Task: Task{ID: 2}})
		if err != ErrQueueFull {
			t.Errorf("expected ErrQueueFull, got %v", err)
		}
	})

	t.Run("workers without a handler are refused", func(t *testing.T) {
		queue, _ := queues.Create(context.Background(), CreateRequest{Name: "invalid-h", Size: 10})
		err := queues.AddWorkers(context.Background(), AddWorkersRequest{QueueID: queue.ID, Handle: nil})
		if err != ErrInvalidTaskHandler {
			t.Errorf("expected ErrInvalidTaskHandler, got %v", err)
		}
	})

	t.Run("a worker survives a handler that panics", func(t *testing.T) {
		queue, _ := queues.Create(context.Background(), CreateRequest{Name: "panic-q", Size: 10})

		var panics int32
		handle := func(ctx context.Context, t Task) error {
			atomic.AddInt32(&panics, 1)
			panic("task handler crashed")
		}

		queues.AddWorkers(context.Background(), AddWorkersRequest{QueueID: queue.ID, Count: 1, Handle: handle})
		queues.AddTask(context.Background(), AddTaskRequest{QueueID: queue.ID, Task: Task{ID: 1}})

		// Wait a bit for recovery
		time.Sleep(100 * time.Millisecond)
		if atomic.LoadInt32(&panics) != 1 {
			t.Errorf("the handler ran %d times, want once", atomic.LoadInt32(&panics))
		}
	})
}

func TestErrError(t *testing.T) {
	var e err = "test-err"
	if e.Error() != "test-err" {
		t.Errorf("Error returned %q, want \"test-err\"", e.Error())
	}
}
