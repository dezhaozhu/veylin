# Completeness and omission checklist

Ask (via `ask_user_question` or short clarifiers) when unclear. Do not invent.

## Required for any solve

- [ ] Job identity (id / order number)
- [ ] Every operation has **duration > 0**
- [ ] Every operation has ≥1 **resource**
- [ ] Resources list exists (machines / crews)

## Required depending on objective / story

- [ ] Due dates if optimizing or reporting tardiness
- [ ] Release times if jobs are not all available at 0
- [ ] Weights / priority if “重要订单先”
- [ ] Precedence beyond default within-job chain

## Common user omissions — proactively ask

- [ ] Work already started → freeze those ops or provide baseline
- [ ] Shifts / lunch / maintenance blackouts
- [ ] Changeover / setup between SKUs (if critical, model as extra duration or ask to approximate)
- [ ] Parallel identical machines (capacity > 1 vs separate resource ids)
- [ ] Whether flexible routing is allowed (multi-machine candidates)
- [ ] Soft preferences (“尽量用老机台”) → `preferences`, not hard filters unless user insists

## Before first solve

- [ ] Column mapping confirmed
- [ ] Size gate considered if large
- [ ] Objective chosen (`makespan` / `tardiness` / `weighted_tardiness`)
