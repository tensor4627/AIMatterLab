"""RunArtifactsMixin: implementation extracted from the legacy Service API."""
import base64
import io
import zipfile
import hashlib
import json
import re
import time
from pathlib import Path
from studio_worker.tools.adapters import Adapter
from studio_worker.infrastructure.util import contained, stable_file_snapshot


_PRIVATE_DIAGNOSTIC = re.compile(
    r'''(\bBearer\s+)[^\s"'<>]+|((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|'''
    r'''client[_-]?secret|private[_-]?key)["']?\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,"'<>}]+)|\bsk-[A-Za-z0-9_-]+''',
    re.IGNORECASE,
)
_NATIVE_RUNTIME_FIELDS = ("status", "executable", "sha256", "scope")


def _evidence_text(value):
    value = _PRIVATE_DIAGNOSTIC.sub(lambda match: (match[1] or match[2] or "") + "[redacted]", value)
    return value if len(value) <= 12000 else value[:12000] + " [truncated]"


def _evidence_fields(record, fields):
    return {key: _evidence_text(value) if isinstance(value, str) else value
            for key, value in record.items() if key in fields and (value is None or type(value) in (str, int, float, bool))}


def _module_names(evidence, record):
    names = record.get("modules")
    if isinstance(names, list):
        evidence["modules"] = [_evidence_text(name) for name in names if isinstance(name, str)]


def _export_provenance(record):
    evidence = _evidence_fields(record, ("status", "error", "observed_at", "platform", "python", "executable", "scope",
        "cuda", "cuda_available", "gpu", "pydyn_sampling", "pydyn_sampling_origin", "sampling_error",
        "pydyn_sampling_status", "process_limits_status"))
    for key, fields in (
        ("scope", ("engine",)),
        ("native_runtime", _NATIVE_RUNTIME_FIELDS),
        ("pygas_upstream", ("commit", "version")),
        ("pygas_capabilities", ("CVOnlyProcedure", "MetaDProcedure", "WTMetaDProcedure", "OPESProcedure", "export_model_bundle")),
    ):
        if isinstance(record.get(key), dict):
            evidence[key] = _evidence_fields(record[key], fields)
    if isinstance(record.get("scope"), dict):
        _module_names(evidence["scope"], record["scope"])
    for key, fields in (
        ("modules", ("version", "file", "status", "error", "registration_match", "source_sha256", "source_hash_status")),
        ("repositories", ("path", "commit", "dirty", "status", "reason")),
    ):
        if isinstance(record.get(key), dict):
            evidence[key] = {name: _evidence_fields(section, fields) for name, section in record[key].items() if isinstance(section, dict)}
    if isinstance(record.get("process_limits"), dict):
        evidence["process_limits"] = {name: limits for name, limits in record["process_limits"].items()
            if name in ("address_space", "data", "rss", "stack") and isinstance(limits, list)
            and len(limits) == 2 and all(type(value) is int for value in limits)}
    return evidence


def _export_execution_check(record):
    evidence = _evidence_fields(record, ("status", "required", "checked_at", "message", "scope"))
    report = record.get("report")
    if isinstance(report, dict):
        details = _evidence_fields(report, ("status", "artifact_status", "scientific_status", "scope"))
        _module_names(details, report)
        if isinstance(report.get("native_runtime"), dict):
            details["native_runtime"] = _evidence_fields(report["native_runtime"], _NATIVE_RUNTIME_FIELDS)
        if isinstance(report.get("provenance"), dict):
            details["provenance"] = _export_provenance(report["provenance"])
        evidence["report"] = details
    return evidence


class RunArtifactsMixin:
    def collect(self, identifier, names=None):
        return self._collect_run_artifacts(self.store.run(identifier), names)

    def _collect_run_artifacts(self, run, names=None):
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
        collected = self._collect_run_artifacts(run)
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
            # These are worker-owned SQLite observations. A log may be absent or
            # stale; it stays a separately hashed file and cannot supply these fields.
            if isinstance(run.get("provenance"), dict):
                execution["provenance"] = _export_provenance(run["provenance"])
            if isinstance(run.get("execution_check"), dict):
                execution["execution_check"] = _export_execution_check(run["execution_check"])
            archive.writestr("reproduction.json", json.dumps({**collected, "execution":execution,
                "exported_at":time.time(), "included_inputs":included, "omitted_inputs":omitted,
                "included_files":files,"omitted_outputs":omitted_outputs,
                "scope":"Hashes describe included stable file bytes only. Live artifact metadata is an observation; scientific validity is separate."}, indent=2))
            archive.writestr("README.txt", "Inputs are immutable copies. reproduction.json lists every included input, output and log with its snapshot hash, plus omitted files and reasons. Large inputs are listed by source and SHA256. Other artifact metadata is a live observation without a hash. The execution record includes available worker-recorded runtime provenance and execution checks, with allowlisted fields and bounded diagnostics. Scientific validity is separate from process completion.")
        bundle = buffer.getvalue()
        return {"base64":base64.b64encode(bundle).decode(), "sha256":hashlib.sha256(bundle).hexdigest(), "omitted_inputs":omitted}
