"""Validate port identities and DAG structure before a planning draft is saved."""
import json

from studio_worker.tools.package_contract import normalize_inline_schema
from studio_worker.transport.roadmap_schema import ROADMAP_SCHEMA


class RoadmapError(ValueError):
    """A roadmap was rejected before any part of the task was saved."""


def _unique(values, where):
    if len(values) != len(set(values)):
        raise ValueError("Duplicate roadmap " + where)


def validate_roadmap(value, field_key):
    if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 131072:
        raise ValueError("Roadmap exceeds 128 KiB")
    plan = normalize_inline_schema(value, ROADMAP_SCHEMA, "roadmap")
    resources = [item["id"] for item in plan["resources"]]
    steps = {step["id"]: step for step in plan["steps"]}
    for ids, where in ((resources, "resource"), ([s["id"] for s in plan["steps"]], "step"),
                       (plan["inputs"], "initial input"), (plan["outputs"], "final output")):
        _unique(ids, where)
    known, initial = set(resources), set(plan["inputs"])
    if not (initial | set(plan["outputs"])) <= known:
        raise ValueError("Unknown roadmap boundary resource")
    for item in plan["resources"]:
        if any(check["requirement"] not in item.get("requirements", []) for check in item.get("checks", [])):
            raise ValueError("Roadmap check must refer to an original requirement")
        if "field" in item:
            field_key(item["field"])
            if item["id"] not in initial:
                raise ValueError("Only initial roadmap inputs can bind a parameter")
        if "file_name" in item and ("field" not in item or item["file_name"] in (".", "..")):
            raise ValueError("Roadmap file_name requires an initial file binding")
    producer = {}
    for step in steps.values():
        if "parameter_field" in step:
            field_key(step["parameter_field"])
        for side in (step["inputs"], step["outputs"]):
            _unique([binding["port"] for binding in side], "port on " + step["id"])
            if any(binding["resource"] not in known for binding in side):
                raise ValueError("Unknown roadmap port resource")
        for binding in step["outputs"]:
            resource = binding["resource"]
            if resource in initial or resource in producer:
                raise ValueError("Multiple roadmap sources for " + resource)
            producer[resource] = step["id"]
    visited, visiting = set(), set()

    def visit(step_id):
        if step_id in visited:
            return
        if step_id in visiting:
            raise ValueError("Cyclic roadmap at " + step_id)
        visiting.add(step_id)
        for binding in steps[step_id]["inputs"]:
            if binding["resource"] in producer:
                visit(producer[binding["resource"]])
        visiting.remove(step_id)
        visited.add(step_id)

    for step_id in steps:
        visit(step_id)
