# Column mapping — speculate then confirm

## Principle

Never assume which spreadsheet columns feed the solver. **Speculate → show mapping → `ask_user_question` → only then build the instance.**

## Heuristics (speculation only)

| Likely header keywords (zh/en) | Suggested field |
| --- | --- |
| 订单/工单/job/order/wo | `job.id` |
| 工序/operation/seq/步骤 | operation id or sequence |
| 工时/时长/duration/cycle/加工时间 | `operation.duration` |
| 机台/设备/资源/machine/resource/line | `operation.resources` |
| 交期/交货/due/deadline | `job.due` |
| 释放/到料/release/ready | `job.release` |
| 优先级/权重/priority/weight | `job.weight` |
| 数量/qty | usually **not** duration unless user confirms |
| 备注/状态/客户名 | often **ignored** for solve |

Ambiguous columns (e.g. “时间”, “数量”) → present options in `ask_user_question`, do not pick silently.

## Confirmation prompt pattern

1. Show a markdown mapping table including **unused** columns labeled “不参与计算”.
2. Ask: “以上列用于排产计算的理解是否正确？如需调整请指出哪一列应对应时长/机台/交期。”
3. Options example: Confirm as-is / Swap duration↔qty / I’ll specify mapping.

## After confirmation

Persist the agreed mapping in the thread (brief recap) so later inserts reuse it. If a new file has different headers, repeat Gate 0.
