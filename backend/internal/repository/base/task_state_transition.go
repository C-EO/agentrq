// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package base

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/agentrq/agentrq/backend/internal/data/model"
	"gorm.io/gorm"
)

// ListTaskStateTransitions returns a task's status changes, oldest first.
func (r *repository) ListTaskStateTransitions(ctx context.Context, taskID int64) ([]model.TaskStateTransition, error) {
	var rows []model.TaskStateTransition
	err := r.conn(ctx).
		Where("task_id = ?", taskID).
		Order("created_at asc, id asc").
		Find(&rows).Error
	return rows, err
}

func recordTaskStateTransition(tx *gorm.DB, t model.Task, from, to model.TaskState) error {
	return tx.Create(&model.TaskStateTransition{
		UserID:      t.UserID,
		WorkspaceID: t.WorkspaceID,
		TaskID:      t.ID,
		FromState:   from,
		ToState:     to,
	}).Error
}

// currentTaskState is the state the task's history last moved it to, or, for a
// task with no history yet, the one its status names. The two differ while the
// task needs input, which is a state of the history only.
func currentTaskState(tx *gorm.DB, taskID int64, status string) (model.TaskState, error) {
	var last model.TaskStateTransition
	err := tx.Where("task_id = ?", taskID).Order("created_at desc, id desc").Take(&last).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.TaskStateFromStatus(status), nil
	}
	return last.ToState, err
}

// hasRequestStatus reports whether a message's metadata carries a top-level
// status — the mark of a question to the human (a permission request, an
// elicitation) — so only those writes pay for syncNeedsInput.
func hasRequestStatus(metadata []byte) bool {
	if len(metadata) == 0 {
		return false
	}
	var m struct {
		Status *string `json:"status"`
	}
	return json.Unmarshal(metadata, &m) == nil && m.Status != nil
}

// syncNeedsInput records the task starting or ending a wait on the human: it
// needs input while any message in its thread is a question still pending.
// The task's status is never touched — needing input is a state of the history
// only, so nothing that reads the status behaves differently for it.
func syncNeedsInput(tx *gorm.DB, taskID int64) error {
	var t model.Task
	err := tx.Select("id, user_id, workspace_id, status").Where("id = ?", taskID).Take(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	current, err := currentTaskState(tx, taskID, t.Status)
	if err != nil {
		return err
	}

	var pending int64
	if err := tx.Model(&model.Message{}).
		Where("task_id = ?", taskID).
		Where(pendingRequestClause(tx)).
		Count(&pending).Error; err != nil {
		return err
	}

	switch {
	case pending > 0 && current != model.TaskStateNeedsInput && !isClosedTaskState(current):
		return recordTaskStateTransition(tx, t, current, model.TaskStateNeedsInput)
	case pending == 0 && current == model.TaskStateNeedsInput:
		return recordTaskStateTransition(tx, t, current, model.TaskStateFromStatus(t.Status))
	}
	return nil
}

// pendingRequestClause matches a message whose metadata's top-level status is
// "pending". Top-level on purpose: a plan's entries carry a status of their
// own, and a plan item still to do is not a question to anyone.
func pendingRequestClause(tx *gorm.DB) string {
	if tx.Dialector.Name() == "postgres" {
		return "metadata->>'status' = 'pending'"
	}
	return "json_valid(metadata) AND json_extract(metadata, '$.status') = 'pending'"
}

func isClosedTaskState(s model.TaskState) bool {
	return s == model.TaskStateCompleted || s == model.TaskStateRejected
}
