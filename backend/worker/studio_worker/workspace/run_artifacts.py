"""RunArtifactsMixin: implementation extracted from the legacy Service API."""
import base64
import io
import zipfile
import hashlib
import json
import time
from pathlib import Path
from studio_worker.tools.adapters import Adapter
from studio_worker.infrastructure.util import contained, stable_file_snapshot


class RunArtifactsMixin:
    def collect(self, identifier, names=None):
        run = self.store.run(identifier)
        return {"run": run["id"], "artifacts": Adapter(run["engine"]).collect(
                Path(run["directory"]) / "results", names), "validation": run["validation"], "observation":"live_metadata" if names is None else "selected_hash_snapshots", "observed_at":time.time()}

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
        files, omitted_outputs = [], []
        root = Path(run['directory'])
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for asset in run["snapshots"]:
                path = root / "simulation" / asset["name"]
                expected_size = asset.get('size')
                try:
                    size = expected_size if expected_size is not None else path.stat().st_size
                    if size <= budget:
                        metadata, content = stable_file_snapshot(path, include_bytes=True, max_bytes=budget)
                    else:
                        metadata, content = stable_file_snapshot(path), None
                except FileNotFoundError:
                    omitted.append({**asset, "reason":"Immutable input copy missing", "hash_status":"not_run"})
                    continue
                if metadata['sha256'] != asset['sha256'] or (expected_size is not None and metadata['size'] != expected_size):
                    raise ValueError("Immutable input snapshot changed")
                if content is not None:
                    name = "inputs/" + asset["name"]
                    archive.writestr(name, content)
                    files.append({"path":name, **metadata, "kind":"input"})
                    included.append(asset["name"])
                    budget -= len(content)
                else:
                    omitted.append({**asset, "reason":"32 MiB bundle limit; supply original by hash", "hash_status":"snapshot"})
            # Include bounded stable outputs and actual logs. Omitted live output
            # metadata never pretends to be a verified output hash.
            candidates=[("results/"+asset['name'],root/'results'/asset['name'],'output') for asset in collected['artifacts']]
            candidates += [(name,root/name,'log') for name in ('console.log','validation.json','execution-check.json','environment.json','exit.json')]
            for name,path,kind in candidates:
                try:
                    if path.stat().st_size > budget:
                        omitted_outputs.append({"path":name,"reason":"32 MiB bundle limit", "hash_status":"not_run"})
                        continue
                    metadata,content=stable_file_snapshot(path,include_bytes=True,max_bytes=budget)
                except FileNotFoundError:
                    omitted_outputs.append({"path":name,"reason":"File unavailable at export","hash_status":"not_run"})
                    continue
                except (OSError,ValueError) as exc:
                    omitted_outputs.append({"path":name,"reason":str(exc), "hash_status":"not_run"})
                    continue
                archive.writestr(name,content);budget-=len(content)
                files.append({"path":name,**metadata,"kind":kind})
            execution = {key:run[key] for key in ("id","name","engine","project_id","environment_id","command",
                         "executable_snapshot","parameters","snapshots","gpu","max_seconds","seed","seed_note",
                         "request_hash","studio_workflow_binding","parent_run","status") if key in run}
            environment = run.get("environment_snapshot") or {}
            execution["environment"] = {key:environment[key] for key in ("id","name","provider","version","executables","repositories") if key in environment}
            archive.writestr("reproduction.json", json.dumps({**collected, "execution":execution,
                "exported_at":time.time(), "included_inputs":included, "omitted_inputs":omitted,
                "included_files":files,"omitted_outputs":omitted_outputs,
                "scope":"Hashes describe included stable file bytes only. Live artifact metadata is an observation; scientific validity is separate."}, indent=2))
            archive.writestr("README.txt", "Inputs are immutable copies. reproduction.json lists every included input, output and log with its snapshot hash, plus omitted files and reasons. Large inputs are listed by source and SHA256. Other artifact metadata is a live observation without a hash. Scientific validity is separate from process completion.")
        bundle = buffer.getvalue()
        return {"base64":base64.b64encode(bundle).decode(), "sha256":hashlib.sha256(bundle).hexdigest(), "omitted_inputs":omitted}
