"""RunArtifactsMixin: implementation extracted from the legacy Service API."""
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


class RunArtifactsMixin:
    def collect(self, identifier):
        run = self.store.run(identifier)
        return {"run": run["id"], "artifacts": Adapter(run["engine"]).collect(
                Path(run["directory"]) / "results"), "validation": run["validation"]}

    def log(self, identifier, offset=0):
        run = self.store.run(identifier)
        path = Path(run["directory"]) / "console.log"
        if not path.exists():
            return {"text": "", "offset": 0}
        with open(path, "rb") as stream:
            stream.seek(min(max(0, int(offset)), path.stat().st_size))
            data = stream.read(256 * 1024)
            return {"text": data.decode("utf-8", "replace"), "offset": stream.tell()}

    def file(self, identifier, name, offset=0):
        run = self.store.run(identifier)
        root = Path(run["directory"]) / "results"
        from studio_worker.tools.archive_guard import guard_path_before_resolve
        guard_path_before_resolve(self, root / name)
        path = contained(root / name, [root])
        if not path.is_file():
            raise ValueError("Artifact unavailable")
        if path.suffix.lower() in (".png",".jpg",".jpeg",".webp"):
            if path.stat().st_size > 4*1024*1024:
                raise ValueError("Image preview limit is 4 MiB")
            mime="image/png" if path.suffix.lower()==".png" else "image/webp" if path.suffix.lower()==".webp" else "image/jpeg"
            return {"name":name,"image":"data:"+mime+";base64,"+base64.b64encode(path.read_bytes()).decode(),"size":path.stat().st_size}
        with open(path, "rb") as stream:
            stream.seek(max(0, int(offset)))
            data = stream.read(256 * 1024)
            return {"name": name, "text": data.decode("utf-8", "replace"),
                    "offset": stream.tell(), "size": path.stat().st_size}

    def export(self, identifier):
        run = self.store.run(identifier)
        collected = self.collect(identifier)
        buffer = io.BytesIO()
        included, omitted, budget = [], [], 32 * 1024 * 1024
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for asset in run["snapshots"]:
                path = Path(run["directory"]) / "simulation" / asset["name"]
                if digest(path) != asset["sha256"]:
                    raise ValueError("Immutable input snapshot changed")
                if path.stat().st_size <= budget:
                    archive.write(path, "inputs/" + asset["name"])
                    included.append(asset["name"])
                    budget -= path.stat().st_size
                else:
                    omitted.append({**asset, "reason":"32 MiB bundle limit; supply original by hash"})
            archive.writestr("reproduction.json", json.dumps({"run":run, **collected,
                "exported_at":time.time(), "included_inputs":included, "omitted_inputs":omitted}, indent=2))
            archive.writestr("README.txt", "Inputs are immutable copies. Large inputs are listed by source and SHA256. Logs and output hashes are recorded; scientific validity is separate from process completion.")
        return {"base64":base64.b64encode(buffer.getvalue()).decode(), "omitted_inputs":omitted}
