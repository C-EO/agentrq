// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

package crud

import (
	"context"
	"errors"
	"testing"
	"time"

	entity "github.com/agentrq/agentrq/backend/internal/data/entity/crud"
	"github.com/agentrq/agentrq/backend/internal/data/model"
	"github.com/agentrq/agentrq/backend/internal/service/tasklatency"
	"github.com/golang/mock/gomock"
)

func latencyHour(h int) int64 { return time.Date(2026, 9, 27, h, 0, 0, 0, time.UTC).Unix() }

// A custom day in UTC: 24 hourly buckets, whatever the local zone.
func latencyDayRequest(workspaceID int64, aggregate string) entity.GetTaskLatencyStatsRequest {
	return entity.GetTaskLatencyStatsRequest{
		WorkspaceID: workspaceID, UserID: testUserIDStr, Range: "custom",
		From: latencyHour(0), To: latencyHour(23) + 3599, Aggregate: aggregate,
	}
}

func rollupRow(period int64, m model.LatencyMetric, values ...int64) entity.TaskLatencyRollup {
	var s tasklatency.Stats
	for _, v := range values {
		s.Add(v)
	}
	return entity.TaskLatencyRollup{PeriodStart: period, Metric: uint8(m), Count: s.Count, Sum: s.Sum, Min: s.Min, Max: s.Max, Histogram: tasklatency.EncodeHist(s.Hist)}
}

func seconds(v entity.TaskLatencyValue) int64 {
	if v.Seconds == nil {
		return -1
	}
	return *v.Seconds
}

// Buckets up to the newest claimed run come from the rollups, the rest from
// the task rows, and a bucket both touch merges them.
func TestGetTaskLatencyStats_RollupsThenTail(t *testing.T) {
	e := newTestController(t)
	s2c := int64(1800)

	e.repo.EXPECT().GetWorkspace(gomock.Any(), int64(1), testUserID).Return(model.Workspace{ID: 1}, nil)
	e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly).Return("2026-09-27T09", true, nil)
	e.repo.EXPECT().ListTaskLatencyRollups(gomock.Any(), tasklatency.Hour, int64(1), testUserID, latencyHour(0), latencyHour(10)).
		Return([]entity.TaskLatencyRollup{
			rollupRow(latencyHour(9), model.LatencyMetricWorked, 600, 1200),
			rollupRow(latencyHour(9), model.LatencyMetricBlocked, 0, 0),
		}, nil)
	e.repo.EXPECT().ListTaskLatencies(gomock.Any(), int64(1), testUserID, latencyHour(10), latencyHour(24)).
		Return([]model.TaskLatency{
			{TaskID: 5, ClosedAt: latencyHour(10) + 60, StartToCloseSeconds: &s2c, WorkedSeconds: 60, BlockedSeconds: 30},
		}, nil)

	res, err := e.controller.GetTaskLatencyStats(context.Background(), latencyDayRequest(1, tasklatency.AggregateMax))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Granularity != "hour" || res.Aggregate != "max" || len(res.Points) != 24 {
		t.Fatalf("granularity %s, aggregate %s, %d points", res.Granularity, res.Aggregate, len(res.Points))
	}
	nine, ten := res.Points[9], res.Points[10]
	if nine.PeriodStart != latencyHour(9) || nine.Closed != 2 || seconds(nine.Worked) != 1200 || seconds(nine.Blocked) != 0 {
		t.Fatalf("09:00 = %+v", nine)
	}
	// No task in the rollup had a start-to-close: a gap, not zero.
	if nine.StartToClose.Seconds != nil || seconds(ten.StartToClose) != 1800 || seconds(ten.Blocked) != 30 {
		t.Fatalf("09:00, 10:00 = %+v, %+v", nine, ten)
	}
	if res.Points[0].Worked.Seconds != nil || res.Points[0].Closed != 0 {
		t.Fatalf("an empty hour must be a gap: %+v", res.Points[0])
	}
	if s := res.Summary; s.Closed != 3 || seconds(s.Worked) != 1200 || seconds(s.Blocked) != 30 || s.StartToClose.Count != 1 {
		t.Fatalf("summary = %+v", s)
	}
}

// With no rollup run yet, everything is read from the task rows; account
// scope skips the ownership check.
func TestGetTaskLatencyStats_NoRollupYet(t *testing.T) {
	e := newTestController(t)
	e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly).Return("", false, nil)
	e.repo.EXPECT().ListTaskLatencies(gomock.Any(), int64(0), testUserID, latencyHour(0), latencyHour(24)).
		Return([]model.TaskLatency{
			{ClosedAt: latencyHour(3), WorkedSeconds: 100},
			{ClosedAt: latencyHour(3) + 10, WorkedSeconds: 300},
			{ClosedAt: latencyHour(3) + 20, WorkedSeconds: 50},
		}, nil)

	res, err := e.controller.GetTaskLatencyStats(context.Background(), latencyDayRequest(0, tasklatency.AggregateMin))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p := res.Points[3]; p.Closed != 3 || seconds(p.Worked) != 50 {
		t.Fatalf("03:00 = %+v", p)
	}
}

// A claim past the period's end reads nothing from the rollups' future: the
// tail is clamped to the period.
func TestGetTaskLatencyStats_ClaimPastThePeriod(t *testing.T) {
	e := newTestController(t)
	e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), tasklatency.ClaimHourly).Return("2026-10-05T00", true, nil)
	e.repo.EXPECT().ListTaskLatencyRollups(gomock.Any(), tasklatency.Hour, int64(0), testUserID, latencyHour(0), latencyHour(24)).Return(nil, nil)
	e.repo.EXPECT().ListTaskLatencies(gomock.Any(), int64(0), testUserID, latencyHour(24), latencyHour(24)).Return(nil, nil)

	res, err := e.controller.GetTaskLatencyStats(context.Background(), latencyDayRequest(0, tasklatency.AggregateP50))
	if err != nil || res.Summary.Closed != 0 || res.Summary.Worked.Seconds != nil {
		t.Fatalf("res = %+v, %v", res, err)
	}
}

func TestGetTaskLatencyStats_Errors(t *testing.T) {
	boom := errors.New("boom")
	for _, tc := range []struct {
		name  string
		setup func(e *testEnv)
		ws    int64
	}{
		{"not the caller's workspace", func(e *testEnv) {
			e.repo.EXPECT().GetWorkspace(gomock.Any(), int64(1), testUserID).Return(model.Workspace{}, boom)
		}, 1},
		{"claim lookup", func(e *testEnv) {
			e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), gomock.Any()).Return("", false, boom)
		}, 0},
		{"rollups", func(e *testEnv) {
			e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), gomock.Any()).Return("2026-09-27T05", true, nil)
			e.repo.EXPECT().ListTaskLatencyRollups(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, boom)
		}, 0},
		{"task rows", func(e *testEnv) {
			e.repo.EXPECT().LatestTelemetryAggregation(gomock.Any(), gomock.Any()).Return("", false, nil)
			e.repo.EXPECT().ListTaskLatencies(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, boom)
		}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestController(t)
			tc.setup(e)
			if _, err := e.controller.GetTaskLatencyStats(context.Background(), latencyDayRequest(tc.ws, "p50")); !errors.Is(err, boom) {
				t.Fatalf("got %v, want boom", err)
			}
		})
	}
}
