# Compass 工具速查（14 个）

## 看健康 / 看排程（只读，优先用）

| 工具 | 何时用 | 要点 |
|---|---|---|
| `get_health` | "现在排产怎么样" | 返回运行报告：feasible/overloaded/partial/infeasible + 指标 + 叙述。回答概况类问题的第一入口。 |
| `get_schedule_rows` | 要看具体排程行/给表格供数 | 带类型化列（显示名、status 选项）；支持 workshop/status/order_id/limit 过滤。 |
| `get_workorder_rows` | 二级行下钻三级工序 | 传 order_id（或 wbs）+ 可选 stage_code/material；主从明细场景。 |
| `list_resources` / 资源负荷类 | "哪个设备最忙"“月度负荷趋势” | 鼓点（drum）= 负荷最高的瓶颈资源；分厂/工作中心同一套查询。 |
| 设备可替代性（eligibility） | "这道工序还能上什么设备" | locked/limited/flexible + dominant_share；基于真实历史。 |

## 改排产（治理通道，见 playbook.md）

| 工具 | 作用 |
|---|---|
| `propose_schedule_edit` | 提交编辑提案（resource / std_duration_days / is_bottleneck / due_at 四类字段） |
| `preview_schedule_edit` | 预览提案影响（before/after 对比）——**必经步骤** |
| `commit_schedule_edit` | 用户确认后提交；触发增量重排（秒级） |
| `discard_schedule_edits` | 放弃当前草稿 |

## 常见误区

- 不要用编辑工具去"试探"数据——只读工具足够回答分析类问题。
- `get_schedule_rows` 的 status 是元数据驱动的（derived/solved 等都是合法值），不要自行过滤掉不认识的状态。
- 数字如实转述：工具返回里的 total/limit 表示截断时要说明"仅展示前 N 条"。
