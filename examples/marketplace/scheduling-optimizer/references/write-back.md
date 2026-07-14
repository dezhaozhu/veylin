# Write-back — schedule → source table

After a **successful** `solve_schedule` (`ok: true`), if the user provided a table (or the thread already has a sheet used for ingest), write results into that sheet **in the same turn**. No extra confirmation gate.

Skip write-back when there is no table context (oral / JSON-only input). Never write on `ok: false`.

## Flow

1. Present `metrics` + compact schedule / Gantt.
2. `table_get` the source sheet (reuse the sheet from ingest).
3. Ensure result columns exist (right side) — see below.
4. Align schedule rows to existing `row_key`s via confirmed mapping.
5. Build cell updates; **omit** cells whose current value already equals the target.
6. `table_update_cells` in batches of **≤ 20** cells.

## Result columns (append on the right)

Fixed display names (do not invent synonyms):

| Column | Value |
| --- | --- |
| `计划开始` | `schedule[].start` (or job-level min start) |
| `计划结束` | `schedule[].end` (or job-level max end) |
| `计划资源` | `schedule[].resource_id` (or job-level joined resources) |

If ingest confirmed an **operation** column on the source table, also use:

| Column | Value |
| --- | --- |
| `计划工序` | `schedule[].operation_id` |

### Job-level vs operation-level

- **Operation-level source rows** (one row per op): match `job_id` + `operation_id`; write the four columns above as needed.
- **Job-level source rows** (one row per order): aggregate per `job_id` — `计划开始` = min(start), `计划结束` = max(end), `计划资源` = distinct `resource_id` joined with `,`. Do **not** `add_rows` per operation (that duplicates orders).

## Create missing columns only

1. Inspect current column **display names** from `table_get` / sheet schema.
2. For each required result column that is **absent**, call:

```json
{
  "ops": [{ "op": "add_columns", "names": ["计划开始", "计划结束", "计划资源"] }]
}
```

(`table_edit_structure`; `add_columns` appends to the **right**.)

3. Only list names that are missing. If `计划开始` already exists, do **not** add `start` / `计划开始时间` / a second copy.

## Do not write duplicates

- **No new result rows** — only update `row_key`s that already map from ingest.
- **Skip equal cells** — if the cell’s current value string-equals the target, leave it out of `updates`.
- **No duplicate columns** — never re-`add_columns` for names that already exist.
- Replan / re-solve: **overwrite the same result columns** with the new final schedule; still skip unchanged cells.

## Row alignment

- Match using the job / operation columns confirmed in `scheduling-data-ingest`.
- Schedule rows that cannot be matched: list them in the reply; **do not** `add_rows` for them.

## Tool limits

- `table_update_cells`: max **20** cells per call — split large write-backs.
- Column may be display name (`计划开始`) or key; prefer the display names above.
