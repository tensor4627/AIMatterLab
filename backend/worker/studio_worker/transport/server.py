"""Stable worker CLI and HTTP service assembly; router/MCP/HTTP own their policies."""
from studio_worker.infrastructure.paths import WORKER_ROOT
import re
import argparse
import hmac
import json
import os
import secrets
import sys
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from studio_worker.tools.adapters import Adapter, ENGINES
from studio_worker.compute.service import Service
from studio_worker.transport.runtime_projection import result_for_agent
from studio_worker.tools.templates import build_bias
from studio_worker.transport.task_schema import STEP_SCHEMA, validate_task
from studio_worker.infrastructure.util import leaf, atomic_json, digest, contained

from .routes import dispatch
from .mcp import TOOL_ROUTES, DESCRIPTIONS, tools
from . import mcp as _mcp
from .http_handler import handler_factory

def mcp_tool_call(service, params):
    # Preserve the old public namespace hook instead of capturing its dispatcher.
    return _mcp.mcp_tool_call(service, params, dispatch=dispatch)

CONNECTION_TOKEN_KEYS = ("admin", "mcp")


def load_tokens(root):
    """Load or create worker credentials; a malformed file fails fast instead of booting half-valid."""
    path = Path(root) / "connection.json"
    if not path.exists():
        atomic_json(path, {"schema_version": 1, **{key: secrets.token_urlsafe(32) for key in CONNECTION_TOKEN_KEYS}})
    try:
        path.chmod(0o600)
    except OSError:
        pass
    try:
        value = json.loads(path.read_text())
    except ValueError as exc:
        raise RuntimeError("Worker connection credentials are not valid JSON; preserve the file for diagnosis") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Worker connection credentials must be a JSON object")
    tokens = {key: value.get(key) for key in CONNECTION_TOKEN_KEYS}
    for key, token in tokens.items():
        if not isinstance(token, str) or len(token) < 16:
            raise RuntimeError("Worker connection credentials are incomplete; remove connection.json to regenerate both tokens")
    if value.get("schema_version") != 1:
        # Legacy token files are stamped only after validation, so a broken file never boots.
        atomic_json(path, {"schema_version": 1, **tokens})
    return tokens

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="~/.local/state/gpu-sampling-studio")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    if os.name != "posix":
        raise RuntimeError("The job service requires Linux/WSL process identities")
    import fcntl
    lock = open(root / "service.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    tokens = load_tokens(root)
    service = Service(root)
    service.listen_port = args.port
    # Generated inputs are intrinsically owned by each project, not user-grantable cross-project paths.
    original_authorize = service.authorize
    def authorize(spec):
        project, environment = original_authorize(spec)
        policy = dict(project["policy"])
        policy["input_roots"] = policy["input_roots"] + [str(root / "projects" / project["id"] / "inputs")]
        return {**project, "policy": policy}, environment
    service.authorize = authorize

    Handler = handler_factory(service, tokens, dispatch=dispatch, mcp_tool_call=mcp_tool_call, tools=tools)

    try:
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    finally:
        service.close()


if __name__ == "__main__":
    main()
