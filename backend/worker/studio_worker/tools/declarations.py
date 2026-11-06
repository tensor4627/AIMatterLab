"""Declaration-driven production operation binding for external AimLab tools.

Reads ``aimlab-tools/manifest.json`` from already registered environment repositories.
No network, filesystem writes or process execution.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


class DeclarationError(ValueError):
    """The declaration cannot be bound to a production command."""


_TOKEN = re.compile(r"\{([^{}]+)\}")
_EXECUTABLE = re.compile(r"^executable:([a-z][a-z0-9-]*)$")
_MISSING = object()


def _normalize(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _load_manifest(repository):
    path = Path(repository) / "aimlab-tools" / "manifest.json"
    if not path.is_file():
        return None
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        return None
    return manifest


def find_declaration(repositories, engine):
    """Return the single declaration for ``engine`` from registered repositories, or None."""
    matches = []
    for root in (repositories or {}).values():
        if not root:
            continue
        manifest = _load_manifest(root)
        if manifest is None:
            continue
        for function in manifest.get("functions", []):
            if not isinstance(function, dict):
                continue
            declared = function.get("engine") or function.get("id")
            if declared == engine:
                matches.append({
                    "tool_id": manifest.get("id"),
                    "repository": str(Path(root).resolve()),
                    "function": function,
                })
    if len(matches) > 1:
        raise DeclarationError("Multiple aimlab-tools declarations for engine " + str(engine))
    return matches[0] if matches else None


def _executable(environment, name):
    executables = (environment or {}).get("executables", {})
    value = executables.get(name) if isinstance(executables, dict) else None
    if not isinstance(value, str) or not value:
        raise DeclarationError("Register an available executable: " + name)
    return value


def _lookup(values, declared_id):
    if not isinstance(values, dict):
        return _MISSING
    if declared_id in values:
        return values[declared_id]
    target = _normalize(declared_id)
    for key, value in values.items():
        normalized = _normalize(key)
        if normalized and (normalized == target or normalized.startswith(target) or target.startswith(normalized)):
            return value
    return _MISSING


def _scalar(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    raise DeclarationError("Operation parameter is not a scalar or string array")


def _append_value(argv, value, token):
    if isinstance(value, list):
        if not all(isinstance(item, (str, int, float)) and not isinstance(item, bool) for item in value):
            raise DeclarationError("Operation parameter array must contain strings or numbers: " + token)
        argv.extend(_scalar(item) for item in value)
    else:
        argv.append(_scalar(value))


def bind_operation(declaration, spec, environment):
    """Bind a validated declaration's operation.command into a production argv list."""
    function = declaration.get("function", {})
    command = function.get("operation", {}).get("command")
    if not isinstance(command, list) or not command:
        raise DeclarationError("Declaration operation.command is required")
    inputs = spec.get("inputs", {}) or {}
    parameters = spec.get("parameters", {}) or {}
    declared_inputs = {item.get("id"): item for item in function.get("inputs", []) if isinstance(item, dict) and item.get("id")}
    declared_parameters = {item.get("id"): item for item in function.get("parameters", []) if isinstance(item, dict) and item.get("id")}
    entrypoint = Path(declaration.get("repository", "")) / str(function.get("entrypoint", ""))
    argv = []
    for token in command:
        if not isinstance(token, str) or not token:
            raise DeclarationError("Invalid operation token")
        matches = list(_TOKEN.finditer(token))
        if not matches:
            argv.append(token)
            continue
        if token.count("{") != len(matches) or token.count("}") != len(matches):
            raise DeclarationError("Invalid operation token syntax: " + token)
        expanded = []
        cursor = 0
        omitted = False
        for match in matches:
            expanded.append(token[cursor:match.start()])
            name = match.group(1)
            if name == "python":
                expanded.append(_executable(environment, "python"))
            elif name == "entrypoint":
                if not entrypoint.is_file():
                    raise DeclarationError("Missing declared entrypoint: " + str(function.get("entrypoint", "")))
                expanded.append(str(entrypoint))
            elif _EXECUTABLE.match(name):
                expanded.append(_executable(environment, _EXECUTABLE.match(name).group(1)))
            elif name in declared_inputs:
                value = _lookup(inputs, name)
                if value is _MISSING:
                    if declared_inputs[name].get("required"):
                        raise DeclarationError("Missing required input: " + name)
                    omitted = True
                else:
                    _append_value(expanded, value, name)
            elif name in declared_parameters:
                value = _lookup(parameters, name)
                if value is _MISSING:
                    if declared_parameters[name].get("required"):
                        raise DeclarationError("Missing required parameter: " + name)
                    value = declared_parameters[name].get("default", _MISSING)
                    if value is _MISSING or value is None:
                        omitted = True
                    else:
                        _append_value(expanded, value, name)
                else:
                    _append_value(expanded, value, name)
            else:
                raise DeclarationError("Unknown operation token: {" + name + "}")
            cursor = match.end()
        expanded.append(token[cursor:])
        parts = [part for part in expanded if part != ""]
        if omitted:
            # An omitted optional value must not leave a dangling flag or group.
            if not parts and argv and argv[-1].startswith("-"):
                argv.pop()
            continue
        if parts:
            argv.extend(parts)
    return {
        "argv": argv,
        "entrypoint": str(entrypoint),
        "tool_id": declaration.get("tool_id"),
        "engine": function.get("engine") or function.get("id"),
    }
