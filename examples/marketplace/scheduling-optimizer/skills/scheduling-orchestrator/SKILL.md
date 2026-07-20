---
name: scheduling-orchestrator
description: >
  End-to-end scheduling optimizer. ALWAYS start with column/field mapping speculation
  and ask_user_question confirmation before solving. Covers diagnose, ingest, solve,
  explain, replan (insert/change/local window), metrics, and table write-back after
  a successful final schedule.
---

# Scheduling orchestrator

## Hard gates (do not skip)

1. **Column / field mapping confirmation first** — if the user provided a table, CSV, or named fields, follow `scheduling-data-ingest` / `references/column-mapping.md`: speculate mappings → `ask_user_question` → **do not call `solve_schedule` until confirmed**.
2. **Completeness checklist** — after mapping, run `references/checklist.md`; ask for missing items; do not invent durations/resources/dues.
3. **Solve only via MCP** — `scheduling-optimizer/solver` tools `validate_instance` then `solve_schedule`.
4. **Write-back after successful solve** — when `solve_schedule` returns `ok: true` and a source table exists, follow `references/write-back.md` in the **same turn** (right-side result columns; create if missing; skip duplicate/unchanged cells). Skip write-back if there is no table context. Never write on failed solves.

## Workflow

```
table/ask → column map + confirm → checklist / omissions → build instance
  → validate → size gate → solve → metrics + explain
  → (optional) replan loop → table_* write-back (final successful schedule)
```

1. Activate ingest + column mapping confirmation.
2. Diagnose scenario (`references/scenarios.md`).
3. Map NL constraints (`references/nl-constraints.md`) into hard fields / `preferences`.
4. `validate_instance` → if ops>80 or jobs>30, ask whether to split (by line/date/priority) before solve.
5. `solve_schedule` → present `metrics` (`references/metrics.md`).
6. Changes (new order, due change, local window) → `scheduling-replan`.
7. Keep the last successful instance + schedule as **baseline** for diffs.
8. After the turn’s final successful schedule: write back per `references/write-back.md` (overwrite same result columns on replan).

## MCP

Server: `scheduling-optimizer/solver`

- `validate_instance` — `{ instance }`
- `solve_schedule` — `{ instance }` (returns `schedule`, `metrics`, `auto_frozen_operation_ids`)

Table write-back uses Veylin tools: `table_get`, `table_edit_structure` (`add_columns`), `table_update_cells` (≤20 cells/call).

If tools are missing: install **scheduling-optimizer** from Marketplace and start a new turn.
