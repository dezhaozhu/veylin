---
name: scheduling-data-ingest
description: >
  Map tables/CSV/oral descriptions into the canonical scheduling JSON. ALWAYS speculate
  which columns/fields are used for calculation, confirm with ask_user_question, then
  fill gaps. Never solve before mapping confirmation.
---

# Scheduling data ingest

## Gate 0 — Column / field mapping (mandatory)

Before building any instance JSON:

### If the user has a table / CSV / spreadsheet

1. List headers (and 1–2 sample rows if helpful).
2. **Speculate** a mapping table, for example:

| Source column | Maps to | Role |
| --- | --- | --- |
| 订单号 | `job.id` | identity |
| 工序工时 | `operation.duration` | calculation |
| 机台 | `operation.resources` | calculation |
| 交期 | `job.due` | calculation |
| 备注 | — | **not used in solve** |

3. Call **`ask_user_question`** with clear options, e.g.:
   - Confirm proposed mapping
   - Or let the user pick/correct which columns are duration / resource / due / job id / ignored
4. **Do not** call `validate_instance` or `solve_schedule` until the user confirms or corrects the mapping.
5. See `references/column-mapping.md` for naming heuristics.

### If the user only describes verbally

1. Restate the fields you will use (job id, durations, machines, dues, objective).
2. `ask_user_question` to confirm that understanding is correct.
3. Then ask for missing values via the checklist.

## Gate 1 — Completeness (`references/checklist.md`)

After mapping is confirmed, ensure:

- duration for every operation
- at least one resource per operation
- job identity
- due / release / priority / weight if the objective needs them
- whether work already started → `frozen` or baseline
- shifts / unavailable windows (if mentioned)
- preferences / soft constraints from wording

Missing required calculation fields → `ask_user_question`; **do not guess numbers**.

## Canonical instance shape

```json
{
  "jobs": [
    {
      "id": "J1",
      "release": 0,
      "due": 20,
      "weight": 1,
      "operations": [
        {
          "id": "J1-O1",
          "duration": 3,
          "resources": ["M1"],
          "predecessors": []
        }
      ]
    }
  ],
  "resources": [{ "id": "M1", "capacity": 1 }],
  "objective": "makespan",
  "horizon": null,
  "time_limit_sec": 10,
  "frozen": [],
  "preferences": {
    "prefer_resource": [],
    "prefer_earlier": []
  },
  "replan_window": null,
  "baseline_schedule": null
}
```

- One resource on an op = fixed machine; several = flexible (FJSP).
- `preferences` = soft only (never invent if user did not imply preference).
- For local replan, set `replan_window` + `baseline_schedule` (see `scheduling-replan`).

## Steps after confirmation

1. Build JSON from confirmed mapping.
2. Call **`validate_instance`**; fix all errors.
3. Hand off to solve / replan skills — still no hand-crafted timelines.
