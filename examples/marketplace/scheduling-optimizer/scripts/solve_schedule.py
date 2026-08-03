#!/usr/bin/env python3
"""Solve a scheduling instance with OR-Tools CP-SAT."""

from __future__ import annotations

import json
import sys
from typing import Any

from validate_instance import validate

try:
    from ortools.sat.python import cp_model
except ImportError as e:  # pragma: no cover
    print(json.dumps({"ok": False, "errors": [f"ortools not installed: {e}"]}))
    raise SystemExit(3)


def _horizon(instance: dict[str, Any]) -> int:
    if isinstance(instance.get("horizon"), (int, float)) and instance["horizon"] > 0:
        return int(instance["horizon"])
    total = 0
    for job in instance["jobs"]:
        for op in job["operations"]:
            total += int(op["duration"])
    return max(total * 2, 1)


def _merge_replan_frozen(instance: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Freeze baseline ops fully outside the replan window; merge with explicit frozen."""
    frozen: dict[str, dict[str, Any]] = {}
    for f in instance.get("frozen") or []:
        if isinstance(f, dict) and "operation_id" in f:
            frozen[str(f["operation_id"])] = dict(f)

    window = instance.get("replan_window")
    baseline = instance.get("baseline_schedule") or []
    if isinstance(window, dict) and baseline:
        ws = float(window["start"])
        we = float(window["end"])
        for row in baseline:
            if not isinstance(row, dict):
                continue
            oid = str(row["operation_id"])
            if oid in frozen:
                continue
            b_start = float(row["start"])
            b_end = float(row["end"])
            # Outside window: fully before or fully after
            if b_end <= ws or b_start >= we:
                entry: dict[str, Any] = {
                    "operation_id": oid,
                    "start": int(b_start),
                    "end": int(b_end),
                }
                if row.get("resource_id"):
                    entry["resource_id"] = row["resource_id"]
                frozen[oid] = entry
    return frozen


def _job_last_ops(instance: dict[str, Any]) -> dict[str, str]:
    return {job["id"]: job["operations"][-1]["id"] for job in instance["jobs"]}


def compute_metrics(
    instance: dict[str, Any],
    schedule: list[dict[str, Any]],
    makespan: int,
) -> dict[str, Any]:
    by_op = {row["operation_id"]: row for row in schedule}
    last_ops = _job_last_ops(instance)
    tardy_jobs = 0
    total_tardiness = 0
    flow_times: list[int] = []
    for job in instance["jobs"]:
        jid = job["id"]
        first_id = job["operations"][0]["id"]
        last_id = last_ops[jid]
        first = by_op.get(first_id)
        last = by_op.get(last_id)
        if first and last:
            flow_times.append(int(last["end"]) - int(first["start"]))
        due = job.get("due")
        if due is not None and last:
            tard = max(0, int(last["end"]) - int(due))
            if tard > 0:
                tardy_jobs += 1
                total_tardiness += tard

    resource_ids = [r["id"] for r in instance["resources"]]
    busy: dict[str, int] = {rid: 0 for rid in resource_ids}
    for row in schedule:
        rid = row.get("resource_id")
        if rid in busy:
            busy[rid] += int(row["duration"])
    denom = max(makespan, 1)
    utilization = {
        rid: round(busy[rid] / denom, 4) for rid in resource_ids
    }
    avg_flow = round(sum(flow_times) / len(flow_times), 4) if flow_times else 0.0
    return {
        "makespan": makespan,
        "tardy_jobs": tardy_jobs,
        "total_tardiness": total_tardiness,
        "avg_flow_time": avg_flow,
        "resource_utilization": utilization,
        "resource_busy_time": busy,
    }


def solve(instance: dict[str, Any]) -> dict[str, Any]:
    check = validate(instance)
    if not check.get("ok"):
        return check

    model = cp_model.CpModel()
    horizon = _horizon(instance)
    time_limit = float(instance.get("time_limit_sec") or 10)
    objective_name = instance.get("objective") or "makespan"

    starts: dict[str, cp_model.IntVar] = {}
    ends: dict[str, cp_model.IntVar] = {}
    intervals: dict[str, cp_model.IntervalVar] = {}
    optional: dict[tuple[str, str], cp_model.IntervalVar] = {}
    presence: dict[tuple[str, str], cp_model.BoolVar] = {}
    assigned_resource: dict[str, list[tuple[str, Any]]] = {}

    frozen = _merge_replan_frozen(instance)
    auto_frozen_ids = [
        oid
        for oid in frozen
        if oid
        not in {
            str(f["operation_id"])
            for f in (instance.get("frozen") or [])
            if isinstance(f, dict) and "operation_id" in f
        }
    ]

    for job in instance["jobs"]:
        release = int(job.get("release") or 0)
        for op in job["operations"]:
            oid = op["id"]
            dur = int(op["duration"])
            start = model.NewIntVar(release, horizon, f"start_{oid}")
            end = model.NewIntVar(release, horizon, f"end_{oid}")
            starts[oid] = start
            ends[oid] = end
            res_list = list(op["resources"])

            if oid in frozen:
                fr = frozen[oid]
                fs = int(fr["start"])
                fe = int(fr.get("end", fs + dur))
                model.Add(start == fs)
                model.Add(end == fe)
                # If baseline locked a resource and it is still eligible, force it
                locked_res = fr.get("resource_id")
                if locked_res and locked_res in res_list and len(res_list) > 1:
                    res_list = [locked_res]

            if len(res_list) == 1:
                interval = model.NewIntervalVar(start, dur, end, f"iv_{oid}")
                intervals[oid] = interval
                assigned_resource[oid] = [(res_list[0], model.NewConstant(1))]
                model.Add(end == start + dur)
            else:
                choices: list[cp_model.BoolVar] = []
                for rid in res_list:
                    pres = model.NewBoolVar(f"pres_{oid}_{rid}")
                    opt = model.NewOptionalIntervalVar(
                        start, dur, end, pres, f"opt_{oid}_{rid}"
                    )
                    presence[(oid, rid)] = pres
                    optional[(oid, rid)] = opt
                    choices.append(pres)
                model.AddExactlyOne(choices)
                assigned_resource[oid] = list(zip(res_list, choices))
                model.Add(end == start + dur)

    for job in instance["jobs"]:
        ops = job["operations"]
        for op in ops:
            oid = op["id"]
            for pred in op.get("predecessors") or []:
                model.Add(starts[oid] >= ends[pred])
        for i in range(1, len(ops)):
            cur = ops[i]
            prev = ops[i - 1]
            if not cur.get("predecessors"):
                model.Add(starts[cur["id"]] >= ends[prev["id"]])

    resource_cap = {r["id"]: int(r.get("capacity") or 1) for r in instance["resources"]}
    by_resource: dict[str, list[cp_model.IntervalVar]] = {rid: [] for rid in resource_cap}

    for oid, interval in intervals.items():
        rid = assigned_resource[oid][0][0]
        by_resource[rid].append(interval)
    for (oid, rid), opt in optional.items():
        by_resource[rid].append(opt)

    for rid, ivs in by_resource.items():
        if not ivs:
            continue
        cap = resource_cap[rid]
        if cap == 1:
            model.AddNoOverlap(ivs)
        else:
            model.AddCumulative(ivs, [1] * len(ivs), cap)

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, list(ends.values()))

    # Primary objective terms
    primary_terms: list[cp_model.LinearExpr] = []
    if objective_name == "makespan":
        primary_terms.append(makespan)
    else:
        tardiness_terms: list[cp_model.IntVar] = []
        for job in instance["jobs"]:
            due = job.get("due")
            if due is None:
                continue
            due_i = int(due)
            weight = int(job.get("weight") or 1)
            last_op = job["operations"][-1]["id"]
            tard = model.NewIntVar(0, horizon, f"tard_{job['id']}")
            model.Add(tard >= ends[last_op] - due_i)
            model.Add(tard >= 0)
            if objective_name == "weighted_tardiness" and weight != 1:
                weighted = model.NewIntVar(0, horizon * max(weight, 1), f"wtard_{job['id']}")
                model.Add(weighted == tard * weight)
                tardiness_terms.append(weighted)
            else:
                tardiness_terms.append(tard)
        if tardiness_terms:
            primary_terms.extend(tardiness_terms)
        else:
            primary_terms.append(makespan)

    # Soft preferences
    soft_terms: list[cp_model.LinearExpr] = []
    prefs = instance.get("preferences") or {}
    prefer_resource = prefs.get("prefer_resource") or []
    prefer_earlier = prefs.get("prefer_earlier") or []
    soft_weight_sum = 0

    for i, pr in enumerate(prefer_resource):
        oid = pr["operation_id"]
        rid = pr["resource_id"]
        w = int(pr.get("weight") or 1)
        soft_weight_sum += w
        lit = None
        for cand_rid, cand_lit in assigned_resource.get(oid, []):
            if cand_rid == rid:
                lit = cand_lit
                break
        if lit is None:
            # Preferred resource not in candidate list — skip
            continue
        # Penalty when not chosen: w * (1 - lit)
        soft_terms.append(w - w * lit)

    last_ops = _job_last_ops(instance)
    for i, pe in enumerate(prefer_earlier):
        jid = pe["job_id"]
        w = int(pe.get("weight") or 1)
        soft_weight_sum += w
        last_id = last_ops.get(jid)
        if last_id:
            soft_terms.append(ends[last_id] * w)

    primary_weight = max(1, soft_weight_sum) * horizon + 1
    if soft_terms:
        model.Minimize(sum(primary_terms) * primary_weight + sum(soft_terms))
    else:
        model.Minimize(sum(primary_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    status = solver.Solve(model)

    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "ok": False,
            "status": status_name,
            "errors": [
                f"no feasible schedule ({status_name}); "
                "relax due dates, add capacity, extend horizon, or widen replan_window"
            ],
            "horizon": horizon,
            "auto_frozen_operation_ids": auto_frozen_ids,
        }

    schedule: list[dict[str, Any]] = []
    for job in instance["jobs"]:
        for op in job["operations"]:
            oid = op["id"]
            chosen = None
            for rid, lit in assigned_resource[oid]:
                if solver.Value(lit) == 1:
                    chosen = rid
                    break
            schedule.append(
                {
                    "job_id": job["id"],
                    "operation_id": oid,
                    "resource_id": chosen,
                    "start": int(solver.Value(starts[oid])),
                    "end": int(solver.Value(ends[oid])),
                    "duration": int(op["duration"]),
                    "frozen": oid in frozen,
                }
            )

    schedule.sort(key=lambda x: (x["start"], x["operation_id"]))
    ms = int(solver.Value(makespan))
    metrics = compute_metrics(instance, schedule, ms)
    return {
        "ok": True,
        "status": status_name,
        "objective": objective_name,
        "objective_value": float(solver.ObjectiveValue()),
        "makespan": ms,
        "horizon": horizon,
        "schedule": schedule,
        "metrics": metrics,
        "auto_frozen_operation_ids": auto_frozen_ids,
        "stats": {
            "wall_time_sec": solver.WallTime(),
            "conflicts": solver.NumConflicts(),
            "branches": solver.NumBranches(),
        },
    }


def main() -> int:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            raw = f.read()
    elif not sys.stdin.isatty():
        raw = sys.stdin.read()
    else:
        print(json.dumps({"ok": False, "errors": ["expected JSON on stdin or a file path"]}))
        return 1
    if not raw.strip():
        print(json.dumps({"ok": False, "errors": ["empty input"]}))
        return 1
    try:
        instance = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "errors": [f"invalid JSON: {e}"]}))
        return 1
    result = solve(instance)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
