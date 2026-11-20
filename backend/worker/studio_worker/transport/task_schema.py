import re
import math
from studio_worker.transport.roadmap import RoadmapError, validate_roadmap
from studio_worker.transport.task_draft_schema import TASK_DRAFT_SCHEMA

STEP_SCHEMA = TASK_DRAFT_SCHEMA["properties"]["steps"]["items"]
FIELD_SCHEMA = STEP_SCHEMA["anyOf"][1]["properties"]["fields"]["items"]
FIELD_TYPES = FIELD_SCHEMA["properties"]["type"]["enum"]


def field_key(value):
    if not isinstance(value, str) or len(value) > 200:
        raise ValueError("Invalid field key")
    parts = value.split(".")
    if len(parts) > 12 or any(not re.fullmatch(r"[\w-]+", part, flags=re.ASCII) or part in ("__proto__", "prototype", "constructor") for part in parts):
        raise ValueError("Invalid field key")


def validate_task(data):
    if set(data) - {"roadmap"} != {"task_id", "name", "steps", "parameters", "missing_fields"}:
        raise ValueError("present_task requires task_id, name, steps, parameters, missing_fields")
    if not isinstance(data["name"], str) or not data["name"].strip() or len(data["name"]) > 200 or not isinstance(data["parameters"], dict):
        raise ValueError("Invalid task name or parameters")
    steps, missing = data["steps"], data["missing_fields"]
    if not isinstance(steps, list) or len(steps) > 80 or not isinstance(missing, list):
        raise ValueError("Invalid workflow steps")
    # Legacy drafts include prose blockers; only typed field keys are paths.
    for key in missing:
        if not isinstance(key, str) or not key.strip() or len(key) > 2000:
            raise ValueError("Invalid missing requirement")
    identifiers, fields = set(), set()
    for step in steps:
        if isinstance(step, str):
            continue
        if not isinstance(step, dict) or set(step) - set(STEP_SCHEMA["anyOf"][1]["properties"]) or not all(k in step for k in ("id", "title", "fields")):
            raise ValueError("Invalid workflow step")
        if not isinstance(step["id"], str) or not step["id"] or step["id"] in identifiers or not isinstance(step["title"], str) or not step["title"] or not isinstance(step["fields"], list) or len(step["fields"]) > 100:
            raise ValueError("Invalid workflow step")
        identifiers.add(step["id"])
        for field in step["fields"]:
            if not isinstance(field, dict) or set(field) - set(FIELD_SCHEMA["properties"]) or not all(k in field for k in FIELD_SCHEMA["required"]):
                raise ValueError("Invalid parameter field")
            field_key(field["key"])
            if field["key"] in fields or not isinstance(field["label"], str) or not field["label"] or field["type"] not in FIELD_TYPES or not isinstance(field["required"], bool):
                raise ValueError("Invalid parameter field")
            fields.add(field["key"])
            if "advanced" in field and type(field["advanced"]) is not bool:raise ValueError("Invalid advanced flag")
            if "default" in field:
                value=field["default"]
                if value is not None and type(value) not in (str,int,float,bool):raise ValueError("Scalar default required")
                if type(value) is str and len(value)>4000 or type(value) in (int,float) and not math.isfinite(value):raise ValueError("Invalid default")
                if not isinstance(field.get("default_source"),str) or not field["default_source"].strip():raise ValueError("Traceable default source required")
                if value is not None:
                    kind=field["type"]
                    if kind in ("number","integer") and (type(value) not in (int,float) or kind=="integer" and int(value)!=value) or kind=="boolean" and type(value)is not bool or kind in ("text","file","select","multiline") and type(value)is not str or kind in ("files","list","object"):raise ValueError("Default does not match field type")
                    if kind=="select" and field.get("options") and value not in field["options"]:raise ValueError("Invalid default option")
            for key, limit in (("unit", 40), ("description", 2000),("default_source",2000)):
                if key in field and (not isinstance(field[key], str) or len(field[key]) > limit):
                    raise ValueError("Invalid field text")
            if "options" in field and (not isinstance(field["options"], list) or len(field["options"]) > 100 or not all(isinstance(v, str) for v in field["options"])):
                raise ValueError("Invalid field options")
    def walk(parameters, prefix=""):
        for key, value in parameters.items():
            path = f"{prefix}.{key}" if prefix else key
            field_key(path)
            if isinstance(value, dict):
                walk(value, path)
    walk(data["parameters"])
    if "roadmap" in data:
        try:
            validate_roadmap(data["roadmap"], field_key)
        except ValueError as exc:
            raise RoadmapError(str(exc)) from exc
