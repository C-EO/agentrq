// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package model

import "time"

// TaskState is a task status as stored in task_state_transitions. The values
// are stored, so new ones only ever go on the end.
type TaskState int8

const (
	// TaskStateNone is the state a task comes from when it is created, and
	// what an unrecognised status is recorded as.
	TaskStateNone TaskState = iota
	TaskStateNotStarted
	TaskStateOngoing
	TaskStateBlocked
	TaskStateCompleted
	TaskStateRejected
	TaskStateCron
	// TaskStateNeedsInput is never a task's status: the history moves a task
	// into it while a question to the human is pending in its thread, and out
	// of it when the last one is answered.
	TaskStateNeedsInput
)

var taskStateByStatus = map[string]TaskState{
	"notstarted": TaskStateNotStarted,
	"ongoing":    TaskStateOngoing,
	"blocked":    TaskStateBlocked,
	"completed":  TaskStateCompleted,
	"rejected":   TaskStateRejected,
	"cron":       TaskStateCron,
	"needsinput": TaskStateNeedsInput,
}

// TaskStateFromStatus maps a task's status string to its stored state.
func TaskStateFromStatus(status string) TaskState {
	return taskStateByStatus[status]
}

// String is the status string the state was recorded from; "" for none.
func (s TaskState) String() string {
	for status, state := range taskStateByStatus {
		if state == s {
			return status
		}
	}
	return ""
}

// TaskStateTransition records one change of a task's status. Written by the
// repository beside every task write that changes the status, so no caller
// can change one without leaving a row.
type TaskStateTransition struct {
	ID          int64 `gorm:"primaryKey"`
	UserID      int64 `gorm:"index:idx_task_state_transitions_user_id"`
	WorkspaceID int64 `gorm:"index:idx_task_state_transitions_workspace_id"`
	TaskID      int64 `gorm:"index:idx_task_state_transitions_task_id"`
	FromState   TaskState
	ToState     TaskState
	// AgentID is the Agent that made the change, as it named itself, and
	// AgentModelID the AgentModel it was running; 0 when a person or the
	// server made it, or the agent never said.
	AgentID      int64 `gorm:"not null;default:0"`
	AgentModelID int64 `gorm:"not null;default:0"`
	CreatedAt    time.Time
}
