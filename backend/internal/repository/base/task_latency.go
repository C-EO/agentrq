// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package base

import (
	"context"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/agentrq/agentrq/backend/internal/service/tasklatency"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Latency rollup tables, by the granularity they hold.
const (
	hourlyTaskLatencies  = "hourly_task_latencies"
	dailyTaskLatencies   = "daily_task_latencies"
	monthlyTaskLatencies = "monthly_task_latencies"
)

var taskLatencyRollupTable = map[tasklatency.Granularity]string{
	tasklatency.Hour:  hourlyTaskLatencies,
	tasklatency.Day:   dailyTaskLatencies,
	tasklatency.Month: monthlyTaskLatencies,
}

// recordTaskLatency writes the closed task's timing from its whole history,
// replacing the row an earlier close left.
func recordTaskLatency(tx *gorm.DB, t model.Task) error {
	var rows []model.TaskStateTransition
	if err := tx.Where("task_id = ?", t.ID).Order("created_at asc, id asc").Find(&rows).Error; err != nil {
		return err
	}
	closedAt := rows[len(rows)-1].CreatedAt
	timing := model.TaskTimingOf(rows, closedAt)
	return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.TaskLatency{
		TaskID:              t.ID,
		UserID:              t.UserID,
		WorkspaceID:         t.WorkspaceID,
		ClosedAt:            closedAt.Unix(),
		StartToCloseSeconds: timing.StartToCloseSeconds,
		WorkedSeconds:       timing.WorkedSeconds,
		BlockedSeconds:      timing.BlockedSeconds,
		NeedsInputSeconds:   timing.NeedsInputSeconds,
	}).Error
}

// latencyScope narrows a latency query to one workspace, or to every
// workspace of the user when workspaceID is 0.
func latencyScope(db *gorm.DB, workspaceID, userID int64) *gorm.DB {
	if workspaceID != 0 {
		return db.Where("workspace_id = ?", workspaceID)
	}
	return db.Where("user_id = ?", userID)
}

// ListTaskLatencies returns the tasks closed in [start, end), in scope.
func (r *repository) ListTaskLatencies(ctx context.Context, workspaceID, userID, start, end int64) ([]model.TaskLatency, error) {
	var rows []model.TaskLatency
	err := latencyScope(r.conn(ctx), workspaceID, userID).
		Where("closed_at >= ? AND closed_at < ?", start, end).
		Find(&rows).Error
	return rows, err
}

// ListTaskLatencyRollups returns the rollup rows of granularity g whose period
// starts in [start, end), in scope.
func (r *repository) ListTaskLatencyRollups(ctx context.Context, g tasklatency.Granularity, workspaceID, userID, start, end int64) ([]entity.TaskLatencyRollup, error) {
	var rows []entity.TaskLatencyRollup
	err := latencyScope(r.conn(ctx).Table(taskLatencyRollupTable[g]), workspaceID, userID).
		Where("period_start >= ? AND period_start < ?", start, end).
		Scan(&rows).Error
	return rows, err
}

// LatestTelemetryAggregation is the newest period key claimed for an
// aggregation type; ok is false when none has run yet.
func (r *repository) LatestTelemetryAggregation(ctx context.Context, aggregationType string) (string, bool, error) {
	var keys []string
	err := r.conn(ctx).Model(&model.TelemetryAggregation{}).
		Where("aggregation_type = ?", aggregationType).
		Order("period_key desc").Limit(1).
		Pluck("period_key", &keys).Error
	if err != nil || len(keys) == 0 {
		return "", false, err
	}
	return keys[0], true, nil
}

type latencyKey struct {
	userID, workspaceID int64
	metric              model.LatencyMetric
}

func latencyRollupRows(stats map[latencyKey]*tasklatency.Stats, periodStart int64) []entity.TaskLatencyRollup {
	rows := make([]entity.TaskLatencyRollup, 0, len(stats))
	for k, s := range stats {
		rows = append(rows, entity.TaskLatencyRollup{
			PeriodStart: periodStart,
			UserID:      k.userID,
			WorkspaceID: k.workspaceID,
			Metric:      uint8(k.metric),
			Count:       s.Count,
			Sum:         s.Sum,
			Min:         s.Min,
			Max:         s.Max,
			Histogram:   tasklatency.EncodeHist(s.Hist),
		})
	}
	return rows
}

// AggregateHourlyTaskLatency rolls the tasks closed in [periodStart,
// periodEnd) — normally one hour — up into hourly_task_latencies. A re-run
// over the same hour is a no-op.
func (r *repository) AggregateHourlyTaskLatency(ctx context.Context, periodStart, periodEnd int64) error {
	var facts []model.TaskLatency
	if err := r.conn(ctx).Where("closed_at >= ? AND closed_at < ?", periodStart, periodEnd).Find(&facts).Error; err != nil {
		return err
	}
	stats := map[latencyKey]*tasklatency.Stats{}
	for _, f := range facts {
		for _, m := range model.LatencyMetrics {
			v, ok := f.Value(m)
			if !ok {
				continue
			}
			k := latencyKey{f.UserID, f.WorkspaceID, m}
			if stats[k] == nil {
				stats[k] = &tasklatency.Stats{}
			}
			stats[k].Add(v)
		}
	}
	return r.writeTaskLatencyRollups(ctx, hourlyTaskLatencies, latencyRollupRows(stats, periodStart))
}

// AggregateDailyTaskLatency merges the hourly rows of [periodStart, periodEnd)
// — normally one day — into daily_task_latencies.
func (r *repository) AggregateDailyTaskLatency(ctx context.Context, periodStart, periodEnd int64) error {
	return r.mergeTaskLatencyRollups(ctx, hourlyTaskLatencies, dailyTaskLatencies, periodStart, periodEnd)
}

// AggregateMonthlyTaskLatency merges the daily rows of [periodStart,
// periodEnd) into monthly_task_latencies. It runs every day the month is
// open, so each run replaces the month's rows with the fresh total.
func (r *repository) AggregateMonthlyTaskLatency(ctx context.Context, periodStart, periodEnd int64) error {
	return r.mergeTaskLatencyRollups(ctx, dailyTaskLatencies, monthlyTaskLatencies, periodStart, periodEnd)
}

func (r *repository) mergeTaskLatencyRollups(ctx context.Context, from, to string, periodStart, periodEnd int64) error {
	var src []entity.TaskLatencyRollup
	if err := r.conn(ctx).Table(from).
		Where("period_start >= ? AND period_start < ?", periodStart, periodEnd).
		Scan(&src).Error; err != nil {
		return err
	}
	stats := map[latencyKey]*tasklatency.Stats{}
	for _, row := range src {
		k := latencyKey{row.UserID, row.WorkspaceID, model.LatencyMetric(row.Metric)}
		if stats[k] == nil {
			stats[k] = &tasklatency.Stats{}
		}
		stats[k].Merge(tasklatency.Decode(row.Count, row.Sum, row.Min, row.Max, row.Histogram))
	}
	return r.writeTaskLatencyRollups(ctx, to, latencyRollupRows(stats, periodStart))
}

var taskLatencyRollupColumns = []clause.Column{
	{Name: "period_start"}, {Name: "user_id"}, {Name: "workspace_id"}, {Name: "metric"},
}

func (r *repository) writeTaskLatencyRollups(ctx context.Context, table string, rows []entity.TaskLatencyRollup) error {
	if len(rows) == 0 {
		return nil
	}
	conflict := clause.OnConflict{DoNothing: true}
	if table == monthlyTaskLatencies {
		conflict = clause.OnConflict{
			Columns:   taskLatencyRollupColumns,
			DoUpdates: clause.AssignmentColumns([]string{"count", "sum", "min", "max", "histogram"}),
		}
	}
	return r.conn(ctx).Table(table).Clauses(conflict).Create(&rows).Error
}
