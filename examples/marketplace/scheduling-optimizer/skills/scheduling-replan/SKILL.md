---
name: scheduling-replan
description: >
  Insert orders, change orders, and local-window replan. Freeze outside replan_window via
  baseline_schedule; always validate → solve → metrics diff vs baseline.
---

# Scheduling replan

## When to use

- New rush order / insert job
- Order change (due, duration, resource, cancel)
- Small-range adjustment (“only reshuffle afternoon”, “keep morning fixed”)

## Baseline

Require a baseline `schedule` from a previous `solve_schedule` (or user-provided plan).

## Local window

Set on the instance:

```json
"replan_window": { "start": 10, "end": 40 },
"baseline_schedule": [
  { "operation_id": "J1-O1", "resource_id": "M1", "start": 0, "end": 3 }
]
```

Solver auto-freezes baseline ops **fully outside** the window (`auto_frozen_operation_ids`). Ops overlapping the window may move. Explicit `frozen[]` still wins.

## Insert order

1. Add new job/ops to instance (after column mapping if new columns appear — re-confirm).
2. Optionally freeze already-started work.
3. `validate_instance` → `solve_schedule`.
4. Diff vs baseline metrics and affected jobs.

## Change order

1. Patch due / duration / resources / weight on the job.
2. Re-validate and solve; highlight jobs whose completion moved.

## Discipline

- Do not drop hard constraints silently when infeasible — list relax options.
- On successful solve, treat the new schedule as baseline and write back per `references/write-back.md` (same result columns; skip unchanged cells). Do not write on failure.
- See `references/replan.md`.
