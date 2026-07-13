---
name: scheduling-solve
description: >
  Hard scheduling via MCP solve_schedule only. Enforce size gates, never solve before
  column-mapping confirmation, surface metrics and structured relaxations on infeasibility.
---

# Scheduling solve

## Prerequisites

- Column/field mapping already confirmed (`scheduling-data-ingest`).
- Instance passed `validate_instance`.

## Size gate (prevent hopeless solves)

If `operations > 80` or `jobs > 30` (from validate summary):

1. `ask_user_question`: solve all at once vs split (by production line / due-date bucket / priority).
2. If split: solve batches sequentially or as separate instances; merge explanations carefully.
3. Do not silently drop jobs.

## Rule

Always call MCP **`solve_schedule`** with `{ "instance": { ... } }`.

Do **not**:

- Invent start/end under capacity contention
- Use shell/pip for the solver
- Claim optimality without `status`

## Interpret result

- `ok: true` → show `metrics` (see `references/metrics.md`) + compact Gantt from `schedule`
- `ok: false` → report `errors`; suggest concrete relaxations (due, capacity, horizon, unfreeze, widen `replan_window`)
- Prefer `time_limit_sec` 5–30 unless the user asks for longer
