import re

FIELD_TYPES = ["text", "number", "integer", "boolean", "file", "files", "list", "object", "select", "multiline"]
FIELD_SCHEMA = {"type": "object", "required": ["key", "label", "type", "required"], "additionalProperties": False,
    "properties": {"key": {"type": "string"}, "label": {"type": "string"}, "type": {"type": "string", "enum": FIELD_TYPES},
    "required": {"type": "boolean"}, "unit": {"type": "string"}, "description": {"type": "string"},
    "options": {"type": "array", "items": {"type": "string"}}}}
STEP_SCHEMA = {"anyOf": [{"type": "string"}, {"type": "object", "required": ["id", "title", "fields"], "additionalProperties": False,
    "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"},
    "tool": {"type": "string"}, "optional": {"type": "boolean"}, "fields": {"type": "array", "items": FIELD_SCHEMA}}}]}


def field_key(value):
    if not isinstance(value, str) or len(value) > 200:
        raise ValueError("Invalid field key")
    parts = value.split(".")
    if len(parts) > 12 or any(not re.fullmatch(r"[\w-]+", part, flags=re.ASCII) or part in ("__proto__", "prototype", "constructor") for part in parts):
        raise ValueError("Invalid field key")


def validate_task(data):
    if set(data) != {"task_id", "name", "steps", "parameters", "missing_fields"}:
        raise ValueError("present_task requires task_id, name, steps, parameters, missing_fields")
    if not isinstance(data["name"], str) or not data["name"].strip() or len(data["name"]) > 200 or not isinstance(data["parameters"], dict):
        raise ValueError("Invalid task name or parameters")
    steps, missing = data["steps"], data["missing_fields"]
    if not isinstance(steps, list) or len(steps) > 80 or not isinstance(missing, list):
        raise ValueError("Invalid workflow steps")
    for key in missing:
        field_key(key)
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
            for key, limit in (("unit", 40), ("description", 2000)):
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
