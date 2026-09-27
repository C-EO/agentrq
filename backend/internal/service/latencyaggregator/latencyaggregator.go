// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package latencyaggregator

import (
	"context"
	"time"

	zlog "github.com/rs/zerolog/log"

	"github.com/agentrq/agentrq/backend/internal/repository/base"
	"github.com/agentrq/agentrq/backend/internal/service/tasklatency"
)

type Service interface {
	Start(ctx context.Context)
}

type aggregator struct {
	repo  base.Repository
	every time.Duration
	now   func() time.Time
}

// New builds the task latency aggregator. On the telemetry aggregator's
// schedule, it rolls task_latencies up into hourly_task_latencies at the top
// of every hour, hourly into daily at 00:15 UTC, and daily into monthly at
// 00:30 UTC. Each run is claimed first, so several backend instances never
// roll the same period up twice.
func New(repo base.Repository) Service {
	return &aggregator{repo: repo, every: time.Minute, now: time.Now}
}

func (a *aggregator) Start(ctx context.Context) {
	ticker := time.NewTicker(a.every)
	go func() {
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				a.tick(ctx, a.now().UTC())
			}
		}
	}()
}

// tick matches the minute exactly, like the telemetry aggregator: a missed
// tick skips that run rather than firing late.
func (a *aggregator) tick(ctx context.Context, now time.Time) {
	now = now.Truncate(time.Minute)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	if now.Minute() == 0 {
		start := now.Add(-time.Hour)
		a.run(ctx, tasklatency.ClaimHourly, start.Format(tasklatency.HourKeyFormat), start, now, a.repo.AggregateHourlyTaskLatency)
	}
	if now.Hour() == 0 && now.Minute() == 15 {
		start := today.AddDate(0, 0, -1)
		a.run(ctx, tasklatency.ClaimDaily, start.Format(tasklatency.DayKeyFormat), start, today, a.repo.AggregateDailyTaskLatency)
	}
	if now.Hour() == 0 && now.Minute() == 30 {
		// The month yesterday was in, so the run on the 1st closes the
		// previous month with its last day rather than summing nothing.
		yesterday := today.AddDate(0, 0, -1)
		start := time.Date(yesterday.Year(), yesterday.Month(), 1, 0, 0, 0, 0, time.UTC)
		a.run(ctx, tasklatency.ClaimMonthly, today.Format(tasklatency.DayKeyFormat), start, today, a.repo.AggregateMonthlyTaskLatency)
	}
}

func (a *aggregator) run(ctx context.Context, claimType, key string, start, end time.Time, aggregate func(context.Context, int64, int64) error) {
	claimed, err := a.repo.ClaimTelemetryAggregation(ctx, claimType, key)
	if err != nil {
		zlog.Error().Err(err).Str("type", claimType).Msg("latencyaggregator: failed to claim")
		return
	}
	if !claimed {
		return
	}
	if err := aggregate(ctx, start.Unix(), end.Unix()); err != nil {
		zlog.Error().Err(err).Str("type", claimType).Time("period_start", start).Msg("latencyaggregator: aggregation failed")
	}
}
