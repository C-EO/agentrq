// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package latencyaggregator

import (
	"context"
	"testing"
	"time"

	mock_repo "github.com/agentrq/agentrq/backend/internal/service/mocks/repository"
	"github.com/agentrq/agentrq/backend/internal/service/tasklatency"
	"github.com/golang/mock/gomock"
)

func newAggregator(t *testing.T) (*aggregator, *mock_repo.MockRepository) {
	ctrl := gomock.NewController(t)
	repo := mock_repo.NewMockRepository(ctrl)
	return New(repo).(*aggregator), repo
}

func unix(y int, m time.Month, d, h int) int64 {
	return time.Date(y, m, d, h, 0, 0, 0, time.UTC).Unix()
}

// The poller ticks until its context ends; at a quiet minute a tick does
// nothing, which the mock (with no expectations) enforces.
func TestStartStop(t *testing.T) {
	a, _ := newAggregator(t)
	a.every = time.Millisecond
	ticked := make(chan struct{}, 1)
	a.now = func() time.Time {
		select {
		case ticked <- struct{}{}:
		default:
		}
		return time.Date(2026, 9, 20, 13, 37, 0, 0, time.UTC)
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.Start(ctx)
	<-ticked
	cancel()
	time.Sleep(5 * time.Millisecond)
}

// Outside the three run times nothing touches the repository.
func TestTick_Quiet(t *testing.T) {
	a, _ := newAggregator(t)
	a.tick(context.Background(), time.Date(2026, 9, 20, 13, 37, 0, 0, time.UTC))
}

func TestTick_Hourly(t *testing.T) {
	a, repo := newAggregator(t)
	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly, "2026-09-20T13").Return(true, nil)
	repo.EXPECT().AggregateHourlyTaskLatency(gomock.Any(), unix(2026, 9, 20, 13), unix(2026, 9, 20, 14)).Return(nil)
	a.tick(context.Background(), time.Date(2026, 9, 20, 14, 0, 30, 0, time.UTC))
}

func TestTick_Daily(t *testing.T) {
	a, repo := newAggregator(t)
	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimDaily, "2026-09-19").Return(true, nil)
	repo.EXPECT().AggregateDailyTaskLatency(gomock.Any(), unix(2026, 9, 19, 0), unix(2026, 9, 20, 0)).Return(nil)
	a.tick(context.Background(), time.Date(2026, 9, 20, 0, 15, 0, 0, time.UTC))
}

func TestTick_Monthly(t *testing.T) {
	a, repo := newAggregator(t)
	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimMonthly, "2026-09-20").Return(true, nil)
	repo.EXPECT().AggregateMonthlyTaskLatency(gomock.Any(), unix(2026, 9, 1, 0), unix(2026, 9, 20, 0)).Return(nil)
	a.tick(context.Background(), time.Date(2026, 9, 20, 0, 30, 0, 0, time.UTC))
}

// On the 1st the run closes the previous month, last day included.
func TestTick_MonthlyOnTheFirst(t *testing.T) {
	a, repo := newAggregator(t)
	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimMonthly, "2026-10-01").Return(true, nil)
	repo.EXPECT().AggregateMonthlyTaskLatency(gomock.Any(), unix(2026, 9, 1, 0), unix(2026, 10, 1, 0)).Return(nil)
	a.tick(context.Background(), time.Date(2026, 10, 1, 0, 30, 0, 0, time.UTC))
}

// A lost claim, a claim error and an aggregation error each end the run
// without panicking; a lost or failed claim never aggregates.
func TestTick_ClaimLostOrFailed(t *testing.T) {
	a, repo := newAggregator(t)
	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly, gomock.Any()).Return(false, nil)
	a.tick(context.Background(), time.Date(2026, 9, 20, 14, 0, 0, 0, time.UTC))

	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly, gomock.Any()).Return(false, context.DeadlineExceeded)
	a.tick(context.Background(), time.Date(2026, 9, 20, 15, 0, 0, 0, time.UTC))

	repo.EXPECT().ClaimTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly, gomock.Any()).Return(true, nil)
	repo.EXPECT().AggregateHourlyTaskLatency(gomock.Any(), gomock.Any(), gomock.Any()).Return(context.DeadlineExceeded)
	a.tick(context.Background(), time.Date(2026, 9, 20, 16, 0, 0, 0, time.UTC))
}
