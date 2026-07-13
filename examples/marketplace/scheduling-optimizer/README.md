# Scheduling Optimizer

Marketplace plugin: diagnose scheduling problems, **confirm which columns/fields feed the solver**, map to a canonical JSON instance, and solve with **OR-Tools CP-SAT** via a bundled MCP server.

## Install

**Customize → Plugins → Marketplace → scheduling-optimizer → Install.**

No manual `pip` or shell setup. On install, Veylin creates a plugin `.venv` and installs `ortools`. MCP tools appear as `scheduling-optimizer/solver`.

## Tools

| Tool | Purpose |
| --- | --- |
| `validate_instance` | Schema / consistency check |
| `solve_schedule` | CP-SAT solve → `schedule` + `metrics` (+ auto-freeze under `replan_window`) |

## Example dialogue (column confirm first)

> 用户贴了一张表：订单号、数量、标准工时、机台、交期、备注。

助手应：

1. 推测映射（例如：标准工时→duration，机台→resources，交期→due，数量/备注不参与计算）
2. 用 `ask_user_question` 确认「以上理解是否正确」
3. 确认后再补齐缺项、`validate_instance`、`solve_schedule`
4. 展示 `metrics`（makespan、拖期订单数、利用率等）

**确认列映射之前不要求解。**

## Example: insert + local replan

> 在现有方案上插一单急单，上午已排的不要动。

1. 保留 baseline `schedule`
2. 设置 `replan_window` + `baseline_schedule`
3. 加入新 job → validate → solve → 对比 baseline `metrics`

## Soft preferences

```json
"preferences": {
  "prefer_resource": [{ "operation_id": "J1-O1", "resource_id": "M2", "weight": 5 }],
  "prefer_earlier": [{ "job_id": "J2", "weight": 1 }]
}
```

Preferences are soft; hard feasibility and primary objective (e.g. makespan) come first.
