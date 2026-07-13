---
name: scheduling-explain-whatif
description: >
  Explain solved schedules with metrics; support multi-round iteration with baseline
  retention and diffs. For insert/change/local window, prefer scheduling-replan.
---

# Explain and iteration

## Metrics block (always)

From `solve_schedule.metrics` present:

- makespan
- tardy_jobs / total_tardiness
- avg_flow_time
- resource_utilization (per machine)

See `references/metrics.md`.

## Mini Gantt

Per resource, list operations in time order; flag jobs with `end > due`.

## Multi-round protocol

1. Keep **baseline**: last accepted `instance` + `schedule` + `metrics`.
2. Each change → rebuild instance → validate → solve → **diff** makespan / tardy_jobs / per-job completion vs baseline.
3. Ask whether to accept the new baseline before write-back.
4. Never invent deltas; only compare solver outputs.

## What-if (simple)

Copy baseline instance; change due / duration / capacity; re-solve; diff.

For **new orders, order edits, or local replan windows**, use **`scheduling-replan`**.
