#!/usr/bin/env python3
"""Validate a scheduling instance JSON against the Veylin schema."""

from __future__ import annotations

import json
import sys
from typing import Any


def _err(msg: str) -> dict[str, Any]:
    return {"ok": False, "errors": [msg]}


def validate(instance: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(instance, dict):
        return _err("instance must be a JSON object")

    jobs = instance.get("jobs")
    resources = instance.get("resources")
    if not isinstance(jobs, list) or len(jobs) == 0:
        errors.append("jobs must be a non-empty array")
    if not isinstance(resources, list) or len(resources) == 0:
        errors.append("resources must be a non-empty array")

    resource_ids: set[str] = set()
    if isinstance(resources, list):
        for i, res in enumerate(resources):
            if not isinstance(res, dict):
                errors.append(f"resources[{i}] must be an object")
                continue
            rid = res.get("id")
            if not isinstance(rid, str) or not rid:
                errors.append(f"resources[{i}].id is required")
                continue
            if rid in resource_ids:
                errors.append(f"duplicate resource id: {rid}")
            resource_ids.add(rid)
            cap = res.get("capacity", 1)
            if not isinstance(cap, (int, float)) or cap < 1:
                errors.append(f"resources[{i}].capacity must be >= 1")

    op_ids: set[str] = set()
    job_ids: set[str] = set()
    if isinstance(jobs, list):
        for ji, job in enumerate(jobs):
            if not isinstance(job, dict):
                errors.append(f"jobs[{ji}] must be an object")
                continue
            jid = job.get("id")
            if not isinstance(jid, str) or not jid:
                errors.append(f"jobs[{ji}].id is required")
                continue
            if jid in job_ids:
                errors.append(f"duplicate job id: {jid}")
            job_ids.add(jid)
            ops = job.get("operations")
            if not isinstance(ops, list) or len(ops) == 0:
                errors.append(f"jobs[{ji}].operations must be a non-empty array")
                continue
            for oi, op in enumerate(ops):
                if not isinstance(op, dict):
                    errors.append(f"jobs[{ji}].operations[{oi}] must be an object")
                    continue
                oid = op.get("id")
                if not isinstance(oid, str) or not oid:
                    errors.append(f"jobs[{ji}].operations[{oi}].id is required")
                    continue
                if oid in op_ids:
                    errors.append(f"duplicate operation id: {oid}")
                op_ids.add(oid)
                dur = op.get("duration")
                if not isinstance(dur, (int, float)) or dur <= 0:
                    errors.append(f"operation {oid}: duration must be > 0")
                res_list = op.get("resources")
                if not isinstance(res_list, list) or len(res_list) == 0:
                    errors.append(f"operation {oid}: resources must be a non-empty array")
                elif resource_ids:
                    for r in res_list:
                        if r not in resource_ids:
                            errors.append(f"operation {oid}: unknown resource {r!r}")
                preds = op.get("predecessors", [])
                if preds is None:
                    preds = []
                if not isinstance(preds, list):
                    errors.append(f"operation {oid}: predecessors must be an array")

    # Second pass: predecessor existence
    if isinstance(jobs, list) and not errors:
        for job in jobs:
            if not isinstance(job, dict):
                continue
            for op in job.get("operations") or []:
                if not isinstance(op, dict):
                    continue
                oid = op.get("id")
                for p in op.get("predecessors") or []:
                    if p not in op_ids:
                        errors.append(f"operation {oid}: unknown predecessor {p!r}")

    objective = instance.get("objective", "makespan")
    if objective not in ("makespan", "tardiness", "weighted_tardiness"):
        errors.append("objective must be makespan|tardiness|weighted_tardiness")

    horizon = instance.get("horizon")
    if horizon is not None and (not isinstance(horizon, (int, float)) or horizon <= 0):
        errors.append("horizon must be > 0 when set")

    frozen = instance.get("frozen")
    if frozen is not None:
        if not isinstance(frozen, list):
            errors.append("frozen must be an array")
        else:
            for i, fr in enumerate(frozen):
                if not isinstance(fr, dict) or "operation_id" not in fr or "start" not in fr:
                    errors.append(f"frozen[{i}] needs operation_id and start")
                elif op_ids and fr.get("operation_id") not in op_ids:
                    errors.append(f"frozen[{i}]: unknown operation_id {fr.get('operation_id')!r}")

    window = instance.get("replan_window")
    if window is not None:
        if not isinstance(window, dict):
            errors.append("replan_window must be an object")
        else:
            ws, we = window.get("start"), window.get("end")
            if not isinstance(ws, (int, float)) or not isinstance(we, (int, float)):
                errors.append("replan_window.start/end must be numbers")
            elif we <= ws:
                errors.append("replan_window.end must be > start")
            baseline = instance.get("baseline_schedule")
            if baseline is None:
                errors.append("replan_window requires baseline_schedule")
            elif not isinstance(baseline, list) or len(baseline) == 0:
                errors.append("baseline_schedule must be a non-empty array when replan_window is set")
            else:
                for i, row in enumerate(baseline):
                    if not isinstance(row, dict):
                        errors.append(f"baseline_schedule[{i}] must be an object")
                        continue
                    if "operation_id" not in row or "start" not in row or "end" not in row:
                        errors.append(f"baseline_schedule[{i}] needs operation_id, start, end")
                    elif op_ids and row.get("operation_id") not in op_ids:
                        errors.append(
                            f"baseline_schedule[{i}]: unknown operation_id {row.get('operation_id')!r}"
                        )

    prefs = instance.get("preferences")
    if prefs is not None:
        if not isinstance(prefs, dict):
            errors.append("preferences must be an object")
        else:
            for i, pr in enumerate(prefs.get("prefer_resource") or []):
                if not isinstance(pr, dict):
                    errors.append(f"prefer_resource[{i}] must be an object")
                    continue
                if pr.get("operation_id") not in op_ids:
                    errors.append(f"prefer_resource[{i}]: unknown operation_id")
                if pr.get("resource_id") not in resource_ids:
                    errors.append(f"prefer_resource[{i}]: unknown resource_id")
            for i, pe in enumerate(prefs.get("prefer_earlier") or []):
                if not isinstance(pe, dict):
                    errors.append(f"prefer_earlier[{i}] must be an object")
                    continue
                if pe.get("job_id") not in job_ids:
                    errors.append(f"prefer_earlier[{i}]: unknown job_id")

    if errors:
        return {"ok": False, "errors": errors}
    return {
        "ok": True,
        "summary": {
            "jobs": len(job_ids),
            "operations": len(op_ids),
            "resources": len(resource_ids),
            "objective": objective,
            "has_replan_window": window is not None,
            "has_preferences": bool(prefs),
        },
    }


def main() -> int:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            raw = f.read()
    elif not sys.stdin.isatty():
        raw = sys.stdin.read()
    else:
        print(json.dumps(_err("expected JSON on stdin or a file path argument")))
        return 1
    if not raw.strip():
        print(json.dumps(_err("empty input")))
        return 1
    try:
        instance = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps(_err(f"invalid JSON: {e}")))
        return 1
    result = validate(instance)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
