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
    secrets_path = root / "connection.json"
    if not secrets_path.exists():
        atomic_json(secrets_path, {"admin": secrets.token_urlsafe(32), "mcp": secrets.token_urlsafe(32)})
    secrets_path.chmod(0o600)
    tokens = json.loads(secrets_path.read_text())
    service = Service(root)
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
