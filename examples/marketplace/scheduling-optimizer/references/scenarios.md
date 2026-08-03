# Scenario → modeling map

| Scenario | Modeling |
| --- | --- |
| Single / parallel machines | One op per job; resources with capacity ≥ 1; Cumulative or NoOverlap |
| Flow / hybrid flow | Fixed stage sequence; parallel machines as multi-capacity or alternate resources |
| Job shop | Per-job operation chain; each op one machine |
| Flexible job shop (FJSP) | `resources: [M1, M2, …]` on an op (exactly one chosen) |
| Open shop | Omit default chain; only explicit predecessors |
| RCPSP / multi-project | Precedence + Cumulative on renewable resources |
| Freeze / insert / maintenance | `frozen[]` fixed intervals; maintenance as a frozen dummy op on that resource |

Always solve with MCP `solve_schedule` after `validate_instance`.
