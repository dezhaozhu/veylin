# Replan guide

## Insert

1. Confirm any new columns (mapping gate).
2. Append job(s); set release/due/weight.
3. Keep prior schedule as `baseline_schedule` if freezing past work.
4. Solve → metrics diff.

## Change

Patch fields on existing jobs; re-solve; list jobs whose completion moved > 0.

## Local window

```json
"replan_window": { "start": T0, "end": T1 },
"baseline_schedule": [ /* prior schedule rows */ ]
```

- Ops with baseline end ≤ T0 or start ≥ T1 → auto-frozen.
- Overlapping ops may move; NoOverlap still applies with frozen intervals.

## Infeasible

Propose in order: widen window → unfreeze specific ops → relax dues → add capacity → split batch. Ask user which lever to pull.
