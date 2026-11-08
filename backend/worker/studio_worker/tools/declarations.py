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
_SINGLE_TOKEN = re.compile(r"^\{([^{}]+)\}$")
_EXECUTABLE = re.compile(r"^executable:([a-z][a-z0-9-]*)$")
_SKILL = re.compile(r"^skill:([a-z][a-z0-9-]*)$")
_MISSING = object()


def _normalize(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _load_manifest(repository):
    path = Path(repository) / "aimlab-tools" / "manifest.json"
    if not path.is_file():
        return None
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise DeclarationError("Invalid aimlab-tools/manifest.json at " + str(path)) from error
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise DeclarationError("Unsupported aimlab-tools/manifest.json at " + str(path))
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


def _unique_match(values, declared_id, where):
    """Resolve a declared id by normalized name, allowing only an unambiguous prefix match."""
    target = _normalize(declared_id)
    if not target or not isinstance(values, dict):
        return _MISSING
    if declared_id in values:
        return declared_id
    exact = [key for key in values if _normalize(key) == target]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise DeclarationError("Ambiguous " + where + ": " + str(declared_id))
    prefix = [key for key in values if _normalize(key) and (
        _normalize(key).startswith(target) or target.startswith(_normalize(key)))]
    if len(prefix) == 1:
        return prefix[0]
    if len(prefix) > 1:
        raise DeclarationError("Ambiguous " + where + ": " + str(declared_id) + " matches " + ", ".join(sorted(prefix)))
    return _MISSING


def _lookup(values, declared_id):
    if not isinstance(values, dict):
        return _MISSING
    key = _unique_match(values, declared_id, "parameter")
    if key is _MISSING:
        return _MISSING
    return values[key]


def _input_name(inputs, declared_id):
    """Resolve a declared input id to the run-directory input file name (not the source path)."""
    return _unique_match(inputs, declared_id, "input")


def _ports(function):
    ports = []
    for kind in ("inputs", "parameters"):
        for item in function.get(kind, []):
            if isinstance(item, dict) and item.get("id"):
                ports.append({"kind": kind, "id": str(item["id"])})
    return ports


def _find_port(function, name):
    ports = _ports(function)
    target = _normalize(name)
    exact = [port for port in ports if _normalize(port["id"]) == target]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    prefix = [port for port in ports if target and (
        _normalize(port["id"]).startswith(target) or target.startswith(_normalize(port["id"])))]
    return prefix[0] if len(prefix) == 1 else None


def _require_declaration_tokens(function, command):
    """Reject declarations that declare a contract parameter but omit its argv token.

    This prevents silently dropping optional scientific choices when the declaration
    path replaces the built-in adapter argv.
    """
    from studio_worker.tools import engine_contracts
    engine = function.get("engine") or function.get("id")
    required = engine_contracts.declaration_tokens(engine)
    if not required:
        return
    tokens = {_normalize(match.group(1)) for entry in command for match in _TOKEN.finditer(entry)}
    missing = []
    for name in required:
        port = _find_port(function, name)
        if port is None or _normalize(port["id"]) not in tokens:
            missing.append(name)
    if missing:
        raise DeclarationError("Declaration operation.command is missing required token(s): " + ", ".join(missing))


def _scalar(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    raise DeclarationError("Operation parameter is not a scalar or string array")


def _array(value):
    if not isinstance(value, list) or not all(isinstance(item, (str, int, float)) and not isinstance(item, bool) for item in value):
        raise DeclarationError("Operation parameter array must contain strings or numbers")
    return [_scalar(item) for item in value]


def _resolve(name, *, function, inputs, parameters, environment, entrypoint):
    if name == "python":
        return ("scalar", _executable(environment, "python"))
    if name == "entrypoint":
        if not entrypoint.is_file():
            raise DeclarationError("Missing declared entrypoint: " + str(function.get("entrypoint", "")))
        return ("scalar", str(entrypoint))
    executable = _EXECUTABLE.match(name)
    if executable:
        return ("scalar", _executable(environment, executable.group(1)))
    skill = _SKILL.match(name)
    if skill:
        roots = (environment or {}).get("skills", {})
        value = roots.get(skill.group(1)) if isinstance(roots, dict) else None
        if not isinstance(value, str) or not value:
            raise DeclarationError("Register the external skill resource: " + skill.group(1))
        return ("scalar", value)
    declared_inputs = {item.get("id"): item for item in function.get("inputs", []) if isinstance(item, dict) and item.get("id")}
    declared_parameters = {item.get("id"): item for item in function.get("parameters", []) if isinstance(item, dict) and item.get("id")}
    if name in declared_inputs:
        value = _input_name(inputs, name)
        if value is _MISSING:
            if declared_inputs[name].get("required"):
                raise DeclarationError("Missing required input: " + name)
            return ("omit", None)
        return ("scalar", str(value))
    if name in declared_parameters:
        item = declared_parameters[name]
        value = _lookup(parameters, name)
        if value is _MISSING:
            if item.get("required"):
                raise DeclarationError("Missing required parameter: " + name)
            value = item.get("default", _MISSING)
            if value is _MISSING or value is None:
                return ("omit", None)
        if isinstance(value, list):
            return ("array", _array(value))
        return ("scalar", _scalar(value))
    raise DeclarationError("Unknown operation token: {" + name + "}")


def bind_operation(declaration, spec, environment):
    """Bind a validated declaration's operation.command into a production argv list."""
    function = declaration.get("function", {})
    command = function.get("operation", {}).get("command")
    if not isinstance(command, list) or not command:
        raise DeclarationError("Declaration operation.command is required")
    inputs = spec.get("inputs", {}) or {}
    parameters = spec.get("parameters", {}) or {}
    entrypoint = Path(declaration.get("repository", "")) / str(function.get("entrypoint", ""))
    resolved = lambda name: _resolve(name, function=function, inputs=inputs, parameters=parameters, environment=environment, entrypoint=entrypoint)
    argv = []
    for token in command:
        if not isinstance(token, str) or not token:
            raise DeclarationError("Invalid operation token")
        single = _SINGLE_TOKEN.match(token)
        if single:
            kind, value = resolved(single.group(1))
            if kind == "omit":
                if argv and argv[-1].startswith("-"):
                    argv.pop()
            elif kind == "array":
                argv.extend(value)
            else:
                argv.append(value)
            continue
        matches = list(_TOKEN.finditer(token))
        if not matches:
            argv.append(token)
            continue
        if token.count("{") != len(matches) or token.count("}") != len(matches):
            raise DeclarationError("Invalid operation token syntax: " + token)
        pieces = []
        cursor = 0
        omitted = False
        for match in matches:
            pieces.append(token[cursor:match.start()])
            kind, value = resolved(match.group(1))
            if kind == "omit":
                omitted = True
                break
            if kind == "array":
                raise DeclarationError("Array parameter cannot be embedded inside one argv token: " + token)
            pieces.append(value)
            cursor = match.end()
        if omitted:
            continue
        pieces.append(token[cursor:])
        argv.append("".join(pieces))
    from studio_worker.tools import engine_contracts
    engine = function.get("engine") or function.get("id")
    expected_tool = engine_contracts.aimlab_tool_id(engine)
    if expected_tool and declaration.get("tool_id") != expected_tool:
        raise DeclarationError("Declaration tool id " + str(declaration.get("tool_id")) + " does not match the engine contract tool id " + expected_tool + " for " + str(engine))
    _require_declaration_tokens(function, command)
    return {
        "argv": argv,
        "entrypoint": str(entrypoint),
        "tool_id": declaration.get("tool_id"),
        "engine": engine,
    }
