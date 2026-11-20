"""SchedulerMixin: implementation extracted from the legacy Service API."""
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
from studio_worker.tools.adapters import Adapter, ENGINES, SUPPORTED_ENGINES, SCIENTIFIC, process_env, allocated_gpu, run_process_env
from studio_worker.infrastructure.store import Store
from studio_worker.compute.runtime_service import RuntimeServiceMixin
from studio_worker.compute.launch_protocol import LAUNCH_SCHEMA, has_launch_evidence, launch_digest, host_identity
from studio_worker.infrastructure.util import alive, atomic_json, contained, digest, identity, leaf, run_json

TERMINAL = ("succeeded", "failed", "cancelled")


def _receipt_fingerprint(receipt):
    try:
        info = receipt.stat()
        return [int(info.st_size), int(info.st_mtime_ns)]
    except OSError:
        return None


def _terminate(process):
    for method in ("terminate", "kill"):
        terminate = getattr(process, method, None)
        if callable(terminate):
            try:
                terminate()
                return
            except Exception:
                pass


class SchedulerMixin:
    def tick(self):
        self.reconcile()
        self.dispatch()

    def reconcile(self):
        with self.store.lock:
            runs = self.store.runs()
        for run in runs:
            if run["status"] == "queued" and has_launch_evidence(run):
                # Older workers could crash after Popen while the row was still
                # queued. Even launch.json alone is ambiguous: never retry it.
                with self.store.lock:
                    current = self.store.run(run["id"])
                    if current["status"] == "queued":
                        run = self.store.update(current, status="unknown",
                            launch_error="Existing launch evidence requires reconciliation; not resubmitted")
            if run["status"] not in ("running", "unknown"):
                continue
            try:
                self.reconcile_run(run)
            except Exception as exc:
                # One unreadable run record or vanished directory must never stop
                # reconciliation or queued-run dispatch.
                self.store.event(run.get("id"), {"error": "Run reconciliation failed: " + str(exc)[:300]})

    def dispatch(self):
        if getattr(self, 'ssh_service_mode', False):
            return  # Reconnecting must never dispatch old local runs on a login host.
        with self.store.lock:
            runs = self.store.runs()
            busy = [r for r in runs if r["status"] in ("running", "unknown")]
            candidates = [r for r in reversed(runs) if r["status"] == "queued"]
            cluster_runs = self.store.list("cluster-run")
        for run in candidates:
            claimed = False
            baseline = deepcopy(run)
            try:
                # Authorization, snapshot hashing and process start are I/O bound and
                # must not hold the Store lock shared with every HTTP request.
                project, _ = self.authorize(run)
                if allocated_gpu(run) is not None and any(allocated_gpu(busy_run) == allocated_gpu(run) for busy_run in busy):
                    continue
                if sum(busy_run["project_id"] == run["project_id"] for busy_run in busy) + sum(
                        value.get("project_id") == run["project_id"] and value.get("status") in ("queued", "running", "unknown")
                        for value in cluster_runs) >= project["policy"]["max_concurrent"]:
                    continue
                self.verify_snapshot(run)
                link = run.get("studio_workflow_binding") or {}
                if link.get("schema_version")==2:
                    from studio_worker.workspace.roadmap_execution import RoadmapContext, records, check_version, check_run, check_fresh_outputs
                    state,snapshot,node,active = records(self,RoadmapContext(link["execution_id"],link["step_id"],self._tool_workflow_token))
                    check_version(self,snapshot,node)
                    check_run(self,state,node,active,run)
                    check_fresh_outputs(run,node)
                directory = Path(run["directory"])
                token = secrets.token_hex(24)
                launch = {"schema": LAUNCH_SCHEMA, "protocol_version": 2, "run_id": run["id"], "claim": token,
                          "store_root": str(self.store.root), "command": run["command"],
                          "environment": run_process_env(run),
                          "max_seconds": run["max_seconds"]}
                with self.store.lock:
                    current = self.store.run(run["id"])
                    if current["status"] != "queued":
                        continue
                    if has_launch_evidence(current):
                        self.store.update(current, status="unknown",
                            launch_error="Existing launch evidence requires reconciliation; not resubmitted")
                        busy.append(current)
                        continue
                    # Authorization/hashing above can overlap a policy edit.
                    # The returned project may have worker-owned input roots
                    # added by the server, so compare its CAS revision only.
                    # A changed policy is reauthorized on the next tick, without
                    # reserving or starting anything from this stale snapshot.
                    current_project = self.store.get("project", current["project_id"])
                    if current_project.get("revision", 0) != project.get("revision", 0):
                        continue
                    current_busy = [value for value in self.store.runs() if value["status"] in ("running", "unknown")]
                    if ((allocated_gpu(current) is not None and any(allocated_gpu(value) == allocated_gpu(current) for value in current_busy)) or
                            sum(value["project_id"] == current["project_id"] for value in current_busy) + sum(
                                value.get("project_id") == current["project_id"] and value.get("status") in ("queued", "running", "unknown")
                                for value in self.store.list("cluster-run")) >= project["policy"]["max_concurrent"]):
                        continue
                    # This commit precedes every possible process creation. A
                    # crash at any later point cannot make this run dispatchable.
                    reserved = self.store.claim_launch(current,
                        {"schema": 1, "protocol_version": 2, "host": host_identity(), "token": token, "claimed_at": time.time(), "payload_sha256": launch_digest(launch)})
                    if reserved is None:
                        continue
                    run = reserved
                    claimed = True
                    busy.append(run)
                atomic_json(directory / "launch.json", launch)
                env = os.environ.copy()
                env["PYTHONPATH"] = str(WORKER_ROOT)
                process = subprocess.Popen([sys.executable, "-m", "studio_worker.runner", str(directory),
                                            "--store-root", str(self.store.root), "--run-id", run["id"], "--launch-claim", token],
                                           env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
                with self.store.lock:
                    current = self.store.run(run["id"])
                    if current.get("launch_claim", {}).get("token") != token or current["status"] in TERMINAL:
                        _terminate(process)
                        continue
                    self.processes[run["id"]] = process
                    observed = identity(process.pid)
                    self.store.update(current, status="running" if observed else "unknown", identity=observed, started_at=time.time(),
                        launch_error=None if observed else "Supervisor identity has not yet been confirmed")
            except Exception as exc:
                with self.store.lock:
                    current = self.store.run(run["id"])
                    if claimed and current["status"] not in TERMINAL and current.get("launch_claim", {}).get("token") == token:
                        self.store.compare_update(current, status="unknown", error=str(exc))
                    elif not claimed:
                        self.store.compare_update(baseline, status="failed", error=str(exc))

    def reconcile_run(self, run):
        directory = Path(run["directory"])
        # Adopt the detached supervisor's own identity after a worker crash in
        # Popen/identity persistence. Legacy identity files have no claim field.
        identity_file = directory / "identity.json"
        if not alive(run.get("identity")) and identity_file.is_file():
            try:
                observed = json.loads(identity_file.read_text(encoding="utf-8"))
                expected_claim = run.get("launch_claim", {}).get("token")
                if (isinstance(observed, dict) and all(key in observed for key in ("pid", "start", "boot")) and
                        (not expected_claim or observed.get("launch_claim") == expected_claim)):
                    observed = {key: observed[key] for key in ("pid", "start", "boot")}
                    if alive(observed):
                        with self.store.lock:
                            current = self.store.run(run["id"])
                            if current["status"] not in ("running", "unknown"):
                                return
                            run = self.store.update(current, identity=observed)
            except (OSError, ValueError, TypeError):
                # A bad identity must not hide an otherwise valid completion
                # receipt. Missing identity remains unknown, never re-launched.
                pass
        receipt = directory / "exit.json"
        if receipt.exists():
            fingerprint = _receipt_fingerprint(receipt)
            try:
                result = json.loads(receipt.read_text())
                if not isinstance(result, dict) or "exit_code" not in result:
                    raise ValueError("Malformed run receipt")
                expected_claim = run.get("launch_claim", {}).get("token")
                if expected_claim and result.get("launch_claim") != expected_claim:
                    raise ValueError("Run receipt does not match its launch claim")
            except Exception as exc:
                # Preserve the unreadable receipt as evidence and stop retrying the
                # same corrupt bytes on every tick. A rewritten valid receipt is
                # processed on the next tick.
                if run.get("receipt_error") and run.get("receipt_fingerprint") == fingerprint:
                    return
                with self.store.lock:
                    self.store.compare_update(run, status="unknown", receipt_error="Unreadable run receipt: " + str(exc)[:200], receipt_fingerprint=fingerprint)
                return
            state = "failed" if result.get("reason") in ("time_limit", "cancellation_state_unavailable") else (
                "cancelled" if result.get("cancelled") else "succeeded" if result.get("exit_code") == 0 else "failed")
            with self.store.lock:
                run = self.store.compare_update(run, status=state, exit=result)
                if run is None:
                    return  # A concurrent state/evidence change is observed next tick.
            process = self.processes.pop(run["id"], None)
            if process:
                try:
                    process.wait(timeout=2)
                except Exception:
                    pass
            atomic_json(directory / "reproduction.json", run)
        elif alive(run.get("identity")):
            if run["status"] == "unknown":
                with self.store.lock:
                    self.store.compare_update(run, status="running", launch_error=None)
        elif time.time() - run.get("started_at", 0) > 2:
            if run["status"] != "unknown":
                with self.store.lock:
                    self.store.compare_update(run, status="unknown")

    def cluster_loop(self):
        delay, failures = 15, 0
        while not self.stop_event.wait(delay):
            try:
                self.clusters.tick()
                if getattr(self, 'ssh_service_mode', False):
                    from studio_worker.tools.resource_tools import ResourceTools
                    ResourceTools(self).tick()
                failures, delay = 0, 15
            except Exception:
                failures += 1
                delay = min(300, 15 * (2 ** min(failures, 4)))
                self.store.event(None, {"kind": "cluster", "error": "Remote monitor unavailable; retrying in %ss" % delay})

    def roadmap_loop(self):
        from studio_worker.workspace.roadmap_execution import RoadmapExecutions
        executions = RoadmapExecutions(self)
        while not self.stop_event.wait(0.5):
            try:
                executions.pump()
            except Exception as exc:
                self.store.event(None,{"kind":"roadmap","error":str(exc)[:2000]})

    def loop(self):
        ticks = 0
        while not self.stop_event.wait(0.3):
            try:
                self.tick()
                ticks += 1
            except Exception as exc:
                self.store.event(None, {"error": str(exc)})
            if ticks and ticks % 1000 == 0:
                try:
                    self.store.prune_events()
                except Exception:
                    pass

    def close(self):
        self.stop_event.set()
        if hasattr(self,"roadmap_scheduler"):
            self.roadmap_scheduler.join()
        self.clusters.close()
        if hasattr(self, "scheduler"):
            self.scheduler.join(3)
        if hasattr(self, "authority_lock"):
            self.authority_lock.close()
