# Evaluation metrics

Returned on successful `solve_schedule` as `metrics`:

| Field | Meaning |
| --- | --- |
| `makespan` | Max completion time over all operations |
| `tardy_jobs` | Jobs with last op end > due |
| `total_tardiness` | Sum of max(0, end − due) over jobs with due |
| `avg_flow_time` | Average (job last end − job first start) |
| `resource_utilization` | busy_time / makespan per resource |
| `resource_busy_time` | Sum of scheduled durations per resource |

## How to present

1. One-line verdict: status + makespan + tardy_jobs.
2. Utilization table for bottlenecks.
3. On replan: side-by-side baseline vs new for makespan / tardy_jobs / changed jobs.

Do not invent KPI values; only report solver `metrics` (and explicit diffs of those numbers).
