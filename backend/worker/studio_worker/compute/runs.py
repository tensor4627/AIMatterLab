"""RunsMixin: implementation extracted from the legacy Service API."""
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


class RunsMixin:
    def prepare(self, spec, *, _workflow_context=None):
        from studio_worker.compute.ssh_service import require_local_execution
        require_local_execution(self)
        spec = dict(spec)
        if "continuation_metadata" in spec:
            raise ValueError("Continuation metadata is worker-owned")
        if set(spec) & {'studio_workflow_binding', 'workflow_execution_id', 'workflow_step_id', 'workflow_context', 'workflow_directory', '_workflow_context'}:
            raise PermissionError('Workflow run binding is worker-owned')
        if _workflow_context is not None:
            from studio_worker.workspace.tool_workflows import prepare_binding
            spec['studio_workflow_binding'] = prepare_binding(self, _workflow_context, spec)
        for key in ("project_id", "environment_id", "engine", "inputs", "gpu", "max_seconds", "idempotency_key"):
            if key not in spec:
                raise ValueError("Missing " + key)
        if not isinstance(spec["idempotency_key"], str) or not 1 <= len(spec["idempotency_key"]) <= 128:
            raise ValueError("Bounded idempotency_key required")
        if not isinstance(spec["inputs"], dict) or not spec["inputs"]:
            raise ValueError("Explicit inputs required")
        spec["max_seconds"] = int(spec["max_seconds"])
        project, environment = self.authorize(spec)
        if spec.get("workflow_id"):
            workflow = self.store.get("workflow", spec["workflow_id"])
            if workflow["project_id"] != project["id"]: raise PermissionError("Workflow belongs to another project")
            if workflow.get('schema_version') == 2 and _workflow_context is None: raise PermissionError('Tool-group workflows require the worker-owned step preparation route')
        roots = list(project["policy"]["input_roots"]) + [str(self.root / "projects" / project["id"] / "inputs")]
        if (spec.get("studio_workflow_binding") or {}).get("schema_version")==2:
            # prepare_binding matched this exact server-created spec and invocation.
            roots.extend(spec["inputs"].values())
        if spec.get("parent_run"):
            parent = self.store.run(spec["parent_run"])
            if parent["project_id"] != project["id"] or parent["status"] not in TERMINAL:
                raise PermissionError("Invalid continuation parent")
            roots.append(parent["directory"])
        if spec.get("revision_of"):
            previous = self.store.run(spec["revision_of"])
            if previous["project_id"] != project["id"] or previous["status"] not in ("draft", "ready"):
                raise PermissionError("Only an unsubmitted run in the same project can be revised")
            roots.append(previous["directory"])
        request_hash = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        with self.store.lock:
            previous = self.store.by_key(spec["project_id"], spec["idempotency_key"])
            if previous:
                if previous["request_hash"] != request_hash:
                    raise ValueError("Idempotency key already used for a different request")
                return previous
            command = Adapter(spec["engine"]).prepare(spec, environment)
            from studio_worker.infrastructure.util import stable_file_snapshot
            executable = Path(command[0]).resolve()
            executable_snapshot = {"path":command[0], "resolved_path":str(executable), **stable_file_snapshot(executable)}
            from studio_worker.workspace.private_lineage import propagate,check_producer,versions_for
            selected_paths=[]
            for input_name,input_source in spec['inputs'].items():
                self.input_name(input_name);candidate=contained(input_source,roots)
                if not candidate.is_file():raise ValueError('Input unavailable: '+input_name)
                selected_paths.append(str(candidate))
            check_producer(self,spec)
            private_entries=propagate(self,selected_paths,project['id'])
            private_versions=versions_for(self,selected_paths)
            if (spec.get("studio_workflow_binding") or {}).get("schema_version")==2:
                from studio_worker.workspace.roadmap_execution import records
                state,_,node,_ = records(self,_workflow_context)
                for ref in node["inputs"].values():
                    for version in state.get("initial_private_versions",{}).get(ref["resource"],[]):
                        if version not in private_versions: private_versions.append(version)
                        if version["entry_id"] not in private_entries: private_entries.append(version["entry_id"])
            identifier = secrets.token_hex(12)
            prefix = spec.get("directory_name", "")
            if prefix and (not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", prefix)):
                raise ValueError("Invalid scoped working directory name")
            if _workflow_context is not None:
                from studio_worker.workspace.tool_workflows import run_directory
                directory = run_directory(self, _workflow_context, identifier)
            else:
                directory = self.root / "runs" / ((prefix+"-" if prefix else "")+identifier)
            (directory / "simulation").mkdir(parents=True)
            (directory / "results").mkdir()
            snapshots = []
            persisted = False
            try:
                for name, source in spec["inputs"].items():
                    self.input_name(name)
                    path = contained(source, roots)
                    if not path.is_file():
                        raise ValueError("Input unavailable: " + name)
                    destination = directory / "simulation" / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    (directory / "results" / name).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, destination)
                    shutil.copyfile(destination, directory / "results" / name)
                    snapshots.append({"name": name, "source": str(path), "sha256": digest(destination),
                                      "size": destination.stat().st_size})
                    destination.chmod(0o444)
                input_contract = Adapter(spec["engine"]).input_contract(spec, directory / "simulation") if spec["engine"]=="gpumd.neb" else None
                run = {**spec, "id": identifier, "name": spec.get("name", spec["engine"]),
                       "request_hash": request_hash, "status": "draft", "validation": {"status": "not_run"},
                       "directory": str(directory), "snapshots": snapshots, "command": command,
                       "executable_snapshot":executable_snapshot,
                       **({"private_cv_entries":private_entries} if private_entries else {}),
                       **({"input_contract":input_contract} if input_contract is not None else {}),
                       "private_cv_versions":private_versions,
                       "seed": spec.get("parameters",{}).get("seed"),
                       "seed_note": "See immutable engine inputs; unspecified RNG defaults are not inferred",
                       "created_at": time.time(), "updated_at": time.time(),
                       "environment_snapshot": environment, "identity": None}
                atomic_json(directory / "reproduction.json", run)
                self.store.add_run(run); persisted = True
                if spec.get("workflow_id") and _workflow_context is None:
                    workflow=self.store.get("workflow",spec["workflow_id"])
                    workflow["run_ids"].append(run["id"])
                    self.store.put("workflow",workflow)
                return run
            except Exception:
                # A new workflow intent may already have a durable run row. Preserve its
                # directory for exact by-key reconciliation; never erase unknown evidence.
                if _workflow_context is None and not persisted: shutil.rmtree(directory)
                raise

    def revise(self, identifier, changes, edits):
        with self.store.lock:
            parent = self.store.run(identifier)
            if (parent.get("studio_workflow_binding") or {}).get("schema_version")==2:
                raise PermissionError("A confirmed graph invocation cannot be revised in place")
            allowed = ("name","engine","environment_id","gpu","max_seconds","inputs","parameters")
            spec = {k:parent[k] for k in ("project_id",*allowed) if k in parent}
            if any(k not in allowed and k != "idempotency_key" for k in changes):
                raise ValueError("Unsupported review field")
            spec.update({k:v for k,v in changes.items() if k in allowed})
            # Continuation ancestry is worker-owned, never a renderer review field.
            if parent.get("parent_run"):
                spec["parent_run"] = parent["parent_run"]
            spec.update(revision_of=parent["id"], origin=parent.get("origin","desktop"),
                idempotency_key=changes["idempotency_key"])
            if not isinstance(edits,dict):
                raise ValueError("Explicit text edits required")
            prepared = self.store.by_key(spec["project_id"], spec["idempotency_key"])
            edit_hash = hashlib.sha256(json.dumps(edits, sort_keys=True).encode()).hexdigest()
            if prepared:
                if prepared.get("revision_of") != identifier or prepared.get("review_changes") != changes or prepared.get("review_edit_hash") != edit_hash:
                    raise ValueError("Idempotency key already used for different reviewed inputs")
                return prepared
            if parent["status"] not in ("draft", "ready"):
                raise ValueError("Submitted inputs cannot be revised")
            inputs = dict(spec["inputs"])
            staging = self.root / "projects" / parent["project_id"] / "inputs" / ("review-"+secrets.token_hex(12))
            staging.mkdir(parents=True)
            retained = False
            try:
                for name,content in edits.items():
                    self.input_name(name)
                    if name not in inputs or not isinstance(content,str) or len(content.encode()) > 2*1024*1024:
                        raise ValueError("Invalid reviewed text input")
                    target = staging / name
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_text(content,encoding="utf-8")
                    inputs[name] = str(target)
                spec["inputs"] = inputs
                run = self.prepare(spec)
                retained = True
                if parent.get("continuation_metadata"):
                    metadata = deepcopy(parent["continuation_metadata"])
                    snapshots = {item["name"]: item for item in run["snapshots"]}
                    if snapshots.get("run.in", {}).get("sha256") != metadata["input"]["sha256"]:
                        metadata["velocity_initialization"] = "not_checked"
                    if snapshots.get("model.xyz", {}).get("sha256") != metadata["checkpoint"]["sha256"]:
                        metadata["checkpoint"]["source_name"] = None
                        metadata["velocity_initialization"] = "not_checked"
                    if "model.xyz" in snapshots:
                        metadata["checkpoint"]["sha256"] = snapshots["model.xyz"]["sha256"]
                    if "run.in" in snapshots:
                        metadata["input"]["sha256"] = snapshots["run.in"]["sha256"]
                    self.store.update(run, continuation_metadata=metadata)
                self.store.update(run, review_changes=changes, review_edit_hash=edit_hash)
                atomic_json(Path(run["directory"])/"reproduction.json",run)
                self.store.update(parent,status="cancelled",superseded_by=run["id"],cancel_reason="review_revision")
                return run
            finally:
                if not retained:
                    shutil.rmtree(staging)

    def verify_snapshot(self, run):
        executable = run.get("executable_snapshot")
        if executable:
            from studio_worker.infrastructure.util import stable_file_snapshot
            current = Path(run["command"][0]).resolve()
            if str(current) != executable['resolved_path'] or stable_file_snapshot(current)['sha256'] != executable['sha256']:
                raise ValueError("Prepared executable changed; create a new attempt with the current environment")
        for asset in run["snapshots"]:
            for folder in ("simulation", "results"):
                path = Path(run["directory"]) / folder / asset["name"]
                if not path.is_file() or digest(path) != asset["sha256"]:
                    raise ValueError("Input changed after preparation: " + asset["name"])

    def validate(self, identifier, *, _workflow_context=None):
        from studio_worker.compute.ssh_service import require_local_execution
        require_local_execution(self)
        with self.store.lock:
            run = self.store.run(identifier)
            if run.get('studio_workflow_binding'):
                from studio_worker.workspace.tool_workflows import assert_bound_run
                assert_bound_run(self, run, _workflow_context, 'validating')
            if run["status"] not in ("draft", "ready"):
                raise ValueError("Only an unsubmitted run can be validated")
            self.authorize(run)
            self.store.update(run, status="validating")
        try:
            self.verify_snapshot(run)
            key = json.dumps({"engine":run["engine"], "environment":run["environment_snapshot"]}, sort_keys=True)
            current_probe = None
            if run["engine"] == "pydyn.md" or key not in self.provenance:
                try:
                    current_probe = Adapter(run["engine"]).probe(run["environment_snapshot"])
                except Exception as exc:
                    current_probe = {"status":"blocked", "error":str(exc)}
                self.provenance[key] = current_probe
            self.store.update(run, provenance=current_probe if run["engine"] == "pydyn.md" else self.provenance[key])
            from studio_worker.tools.cell_derivative_contract import derive as derive_cell_contract
            contract=derive_cell_contract(self,run)
            self.verify_snapshot(run)
            options = {"cell_derivative_contract": contract}
            if run["engine"] == "pydyn.md":
                # Reuse only this invocation's fresh observation, never cached provenance.
                options["probe_report"] = current_probe
            report = Adapter(run["engine"]).validate(run, run["environment_snapshot"],
                                                     Path(run["directory"]) / "results", **options)
            if run.get('studio_workflow_binding'):
                with self.store.lock:
                    assert_bound_run(self, run, _workflow_context, 'validating')
                    self.store.update(run, status="ready", validation=report)
            else:
                self.store.update(run, status="ready", validation=report)
        except Exception as exc:
            self.store.update(run, status="draft", validation={"status": "failed", "message": str(exc)})
        atomic_json(Path(run["directory"]) / "validation.json", run["validation"])
        return run

    def submit(self, identifier, *, _workflow_context=None):
        from studio_worker.compute.ssh_service import require_local_execution
        require_local_execution(self)
        with self.store.lock:
            run = self.store.run(identifier)
            if run["status"] in ("queued", "running", "unknown", *TERMINAL):
                return run
            if run.get('studio_workflow_binding'):
                from studio_worker.workspace.tool_workflows import assert_bound_run
                assert_bound_run(self, run, _workflow_context, 'submitting')
            self.authorize(run)
            if run["status"] not in ("draft", "ready"):
                raise ValueError("Only an unsubmitted input snapshot can be submitted")
            self.verify_snapshot(run)
            if run["engine"] in ("gpumd.md", "gpumd.sampling") and run.get("parent_run"):
                Adapter(run["engine"]).input_contract(run, Path(run["directory"]) / "simulation")
            # Scientific/parameter findings do not grant permission and do not
            # revoke it. Serialized bias compatibility remains mandatory.
            required = run["engine"].endswith("sampling") or run["engine"] in ("bias.validate", "pydyn.md")
        check = {"status":"not_run", "required":False, "scope":"No serialized bias artifact for this engine"}
        if required:
            try:
                adapter = Adapter(run["engine"])
                if run["engine"] == "pydyn.md":
                    observed = adapter.probe(run["environment_snapshot"])
                    report = {**adapter.pydyn_import_contract(run["environment_snapshot"], observed), "provenance":observed}
                else:
                    report = adapter.validate(run, run["environment_snapshot"],
                        Path(run["directory"]) / "results", execution_only=True)
                    if report.get("artifact_status") != "passed":
                        raise ValueError("Serialized artifact/target check did not confirm compatibility")
                check = {"status":"passed", "required":True, "checked_at":time.time(), "report":report}
            except Exception as exc:
                with self.store.lock:
                    self.store.update(self.store.run(identifier), execution_check={"status":"failed", "required":True, "message":str(exc), "checked_at":time.time()})
                raise
        with self.store.lock:
            current = self.store.run(identifier)
            if current["status"] in ("queued", "running", "unknown", *TERMINAL):
                return current
            if current["status"] not in ("draft", "ready"):
                raise ValueError("Run changed during execution checks")
            if current.get('studio_workflow_binding'):
                assert_bound_run(self, current, _workflow_context, 'submitting')
            self.authorize(current)
            self.verify_snapshot(current)
            return self.store.update(current, status="queued", execution_check=check)

    def cancel(self, identifier):
        with self.store.lock:
            run = self.store.run(identifier)
            self.authorize(run)
            from studio_worker.compute.launch_protocol import has_launch_evidence
            if run["status"] == "queued" and not has_launch_evidence(run):
                return self.store.update(run, status="cancelled")
            if run["status"] == "queued":
                run = self.store.update(run, status="unknown")
            if run["status"] not in ("running", "unknown"):
                return run
            if run.get("launch_claim"):
                # Persist before signalling. A supervisor that has not acquired
                # its child-start gate will observe this and never start a child;
                # an already detached supervisor also polls this durable request.
                self.store.update(run, cancel_requested=True)
                signalled = False
                try:
                    signalled = bool(Adapter(run["engine"]).cancel(run))
                except ProcessLookupError:
                    pass  # The detached supervisor may have just completed.
                return self.store.update(run, cancellation={"status": "requested", "signal_sent": signalled,
                    "message": "Cancellation is recorded; process completion has not yet been confirmed."})
            if not Adapter(run["engine"]).cancel(run):
                return self.store.update(run, cancellation={"status": "unconfirmed", "signal_sent": False,
                    "message": "Run state is retained for reconciliation; process identity is unknown and no signal was sent."})
            return self.store.update(run, cancel_requested=True, cancellation={"status": "requested", "signal_sent": True,
                "message": "Stop signal sent; waiting for the completion receipt."})

    def resolve_unknown(self, identifier):
        """Human recovery only: never infer completion from missing process files."""
        from studio_worker.compute.launch_protocol import recovery_proof
        run = self.store.run(identifier)
        self.authorize(run)
        if run["status"] == "unknown":
            self.reconcile_run(run)
        with self.store.lock:
            try:
                # Shared with the supervisor's final check AND child creation.
                # Once committed terminal, any late supervisor is fenced out.
                self.store.db.execute("BEGIN IMMEDIATE")
                run = self.store.run(identifier)
                if run["status"] in TERMINAL:
                    self.store.db.commit()
                    return run
                if run["status"] != "unknown":
                    return self.store.update(run, reconciliation={"status": "blocked", "reason": "run_still_active",
                        "message": "The supervisor is still active; request cancellation and wait for its receipt.", "checked_at": time.time()})
                try:
                    proven, reason, message = recovery_proof(run)
                except (OSError, ValueError, TypeError, KeyError, AttributeError):
                    proven, reason, message = False, "evidence_unreadable", "Launch evidence could not be verified; the run remains unknown."
                changes = {"reconciliation": {"status": "resolved" if proven else "blocked", "reason": reason,
                                               "message": message, "checked_at": time.time()}}
                if proven:
                    changes.update(status="cancelled", cancel_requested=True, launch_error=None)
                return self.store.update(run, **changes)
            except Exception:
                self.store.db.rollback()
                raise

    def resume(self, identifier, parameters):
        from studio_worker.compute.ssh_service import require_local_execution
        require_local_execution(self)
        run = self.store.run(identifier)
        if run["status"] not in TERMINAL:
            raise ValueError("A continuation requires a terminal parent")
        parameters = dict(parameters)
        inputs = {x["name"]:str(Path(run["directory"])/"simulation"/x["name"]) for x in run["snapshots"]}
        results = Path(run["directory"])/"results"
        names = parameters.get("checkpoint_files", [])
        for name in names:
            self.input_name(name)
            path = contained(results/name,[results])
            if not path.is_file():
                raise ValueError("Checkpoint unavailable")
            inputs[name] = str(path)
        if run["engine"] == "hotpp.train":
            checkpoint = parameters.get("checkpoint")
            if checkpoint not in inputs or checkpoint not in names:
                raise ValueError("Select an actual HotPP checkpoint")
            inputs["resume.ckpt"] = inputs.pop(checkpoint)
            parameters["checkpoint"] = "resume.ckpt"
            continuation = parameters.get("continuation_config")
            if not continuation:
                raise ValueError("Supply continuation_config with explicit additional training limits")
            project,_ = self.authorize(run)
            inputs["input.yaml"] = str(contained(continuation,project["policy"]["input_roots"]))
        elif run["engine"] in ("gpumd.md","gpumd.sampling"):
            if "restart.xyz" not in names:
                raise ValueError("GPUMD continuation requires restart.xyz")
            continuation = parameters.get("continuation_run_in")
            if not continuation:
                raise ValueError("Supply continuation_run_in explicitly; no implicit velocity or thermostat reset")
            project,_ = self.authorize(run)
            target = contained(continuation, project["policy"]["input_roots"])
            if any(line.split("#")[0].strip().startswith("velocity") for line in target.read_text().splitlines()):
                raise ValueError("Continuation input must preserve restart velocities")
            if run["engine"] == "gpumd.sampling" and run["parameters"]["mode"] != "static":
                raise ValueError("History-dependent GPUMD sampling requires an explicit workflow with its independent restart contract")
            inputs["run.in"] = str(target)
            inputs["model.xyz"] = inputs.pop("restart.xyz")
        elif run["engine"].startswith("pydyn."):
            continuation = parameters.get("continuation_script")
            if not continuation or not names:
                raise ValueError("Supply an explicit continuation_script and checkpoint files")
            project,_ = self.authorize(run)
            inputs["run.py"] = str(contained(continuation,project["policy"]["input_roots"]))
            if run["engine"] == "pydyn.sampling":
                manifest_name = parameters.get("paired_manifest")
                if manifest_name not in names:
                    raise ValueError("Explicit paired_manifest required")
                manifest = json.loads((results/manifest_name).read_text())
                if manifest.get("schema") != "pydyn-pygas-pair-v1":
                    raise ValueError("Unknown paired checkpoint schema")
                for entry in manifest["files"].values():
                    name = str(Path(manifest_name).parent/entry["path"])
                    self.input_name(name)
                    target = contained(results/name,[results])
                    if digest(target) != entry["sha256"]:
                        raise ValueError("Paired checkpoint hash mismatch")
                    inputs[name] = str(target)
        else:
            raise ValueError("This engine does not declare a checkpoint continuation")
        spec = {key:run[key] for key in ("project_id","environment_id","engine","gpu","max_seconds")}
        child_parameters = deepcopy({**run.get("parameters",{}),**parameters})
        gpumd = run["engine"] in ("gpumd.md", "gpumd.sampling")
        if gpumd:
            for group, key in (("structure", "has_initial_velocities"),
                               ("dynamics", "velocity_initialization_temperature_K")):
                if isinstance(child_parameters.get(group), dict):
                    child_parameters[group].pop(key, None)
        spec.update(inputs=inputs,parameters=child_parameters,
            parent_run=run["id"],name=run["name"]+" → continuation",idempotency_key=parameters["idempotency_key"])
        with self.store.lock:
            existing = self.store.by_key(spec["project_id"], spec["idempotency_key"])
            prepared = self.prepare(spec)
            # Only this new draft receives evidence; retries must not rewrite any run.
            if gpumd and existing is None:
                snapshots = {item["name"]: item for item in prepared["snapshots"]}
                actual_input = (Path(prepared["directory"])/"simulation"/"run.in").read_text()
                no_velocity_command = not any(line.split("#")[0].strip().startswith("velocity")
                                              for line in actual_input.splitlines())
                metadata = {"schema": "gpumd-continuation-v1", "parent_run": run["id"],
                    "parameter_scope": "inherited_unverified",
                    "checkpoint": {"input": "model.xyz", "source_name": "restart.xyz",
                        "sha256": snapshots["model.xyz"]["sha256"], "has_velocities": None,
                        "velocity_status": "not_checked"},
                    "input": {"name": "run.in", "sha256": snapshots["run.in"]["sha256"]},
                    "velocity_initialization": "no_velocity_command" if no_velocity_command else "not_checked"}
                self.store.update(prepared, continuation_metadata=metadata)
                atomic_json(Path(prepared["directory"])/"reproduction.json", prepared)
            return prepared
