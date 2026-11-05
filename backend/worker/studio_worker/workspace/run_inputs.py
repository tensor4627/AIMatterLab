"""RunInputsMixin: implementation extracted from the legacy Service API."""
from studio_worker.infrastructure.paths import WORKER_ROOT
import base64
from copy import deepcopy
import io
import zipfile
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from studio_worker.tools.adapters import Adapter, ENGINES, SUPPORTED_ENGINES, SCIENTIFIC, process_env
from studio_worker.infrastructure.store import Store
from studio_worker.compute.runtime_service import RuntimeServiceMixin
from studio_worker.infrastructure.util import alive, atomic_json, contained, digest, identity, leaf, run_json

TERMINAL = ("succeeded", "failed", "cancelled")


class RunInputsMixin:
    def input_file(self, identifier, name):
        run = self.store.run(identifier)
        if name not in {asset["name"] for asset in run["snapshots"]}:
            raise ValueError("Select a recorded immutable input")
        root = Path(run["directory"]) / "simulation"
        from studio_worker.tools.archive_guard import guard_path_before_resolve
        guard_path_before_resolve(self, root / name)
        path = contained(root / name, [root])
        asset = next(x for x in run["snapshots"] if x["name"] == name)
        if digest(path) != asset["sha256"]:
            raise ValueError("Immutable snapshot changed")
        result = {"name":name, "size":path.stat().st_size, "sha256":asset["sha256"]}
        if result["size"] > 2 * 1024 * 1024:
            return {**result, "editable":False, "reason":"Input exceeds text review limit"}
        try:
            text = path.read_text(encoding="utf-8")
            if "\x00" in text:
                raise UnicodeError()
            return {**result, "editable":True, "text":text}
        except UnicodeError:
            return {**result, "editable":False, "reason":"Binary input; review SHA256 and source"}

    @staticmethod
    def input_name(name):
        if not isinstance(name, str) or not name or "\\" in name or ":" in name or name.startswith("/") or len(name)>240:
            raise ValueError("Relative input filename required")
        for part in name.split("/"):
            leaf(part)
        return name
