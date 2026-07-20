# Natural-language constraints → model

Map user wording into hard fields or soft `preferences`. Confirm ambiguous wording.

| User says | Map to |
| --- | --- |
| 必须在 X 前完成 | `job.due = X` (hard for reporting; use tardiness objective if soft deadline) |
| 不能用 A 机台 | remove A from `operation.resources` |
| 尽量用 A 机台 | `preferences.prefer_resource` |
| 越早越好 / 加急 | `preferences.prefer_earlier` and/or higher `weight` |
| 已经开干了，早上那段别动 | `frozen` or `replan_window` + `baseline_schedule` |
| B 必须在 A 之后 | `predecessors` |
| 两台并联当一台产能2 | `capacity: 2` on one resource **or** two resource ids — ask which |
| 插一单急单 | add job + replan skill; ask priority vs freeze existing |

If text constraint cannot be represented, say so and ask to approximate or drop — never pretend the solver enforced an unmodeled rule.
