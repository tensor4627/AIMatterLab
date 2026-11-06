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
from studio_worker.tools.adapters import Adapter, ENGINES, SUPPORTED_ENGINES, SCIENTIFIC, process_env
from studio_worker.infrastructure.store import Store
from studio_worker.compute.runtime_service import RuntimeServiceMixin
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
            if run["status"] not in ("running", "unknown"):
                continue
            try:
                self.reconcile_run(run)
            except Exception as exc:
                # One unreadable run record or vanished directory must never stop
                # reconciliation or queued-run dispatch.
                self.store.event(run.get("id"), {"error": "Run reconciliation failed: " + str(exc)[:300]})

    def dispatch(self):
        with self.store.lock:
            runs = self.store.runs()
            busy = [r for r in runs if r["status"] in ("running", "unknown")]
            candidates = [r for r in reversed(runs) if r["status"] == "queued"]
            cluster_runs = self.store.list("cluster-run")
        for run in candidates:
            try:
                # Authorization, snapshot hashing and process start are I/O bound and
                # must not hold the Store lock shared with every HTTP request.
                project, _ = self.authorize(run)
                if any(busy_run["gpu"] == run["gpu"] for busy_run in busy):
                    continue
                if sum(busy_run["project_id"] == run["project_id"] for busy_run in busy) + sum(
                        value.get("project_id") == run["project_id"] and value.get("status") in ("queued", "running", "unknown")
                        for value in cluster_runs) >= project["policy"]["max_concurrent"]:
                    continue
                self.verify_snapshot(run)
                directory = Path(run["directory"])
                atomic_json(directory / "launch.json", {"command": run["command"],
                             "environment": process_env(run["environment_snapshot"], run["gpu"]),
                             "max_seconds": run["max_seconds"]})
                env = os.environ.copy()
                env["PYTHONPATH"] = str(WORKER_ROOT)
                process = subprocess.Popen([sys.executable, "-m", "studio_worker.runner", str(directory)],
                                           env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
                with self.store.lock:
                    current = self.store.run(run["id"])
                    if current["status"] != "queued":
                        # Cancelled between selection and launch: never resurrect it.
                        _terminate(process)
                        continue
                    self.processes[run["id"]] = process
                    self.store.update(run, status="running", identity=identity(process.pid), started_at=time.time())
                    busy.append(run)
            except Exception as exc:
                self.store.update(run, status="failed", error=str(exc))

    def reconcile_run(self, run):
        directory = Path(run["directory"])
        receipt = directory / "exit.json"
        if receipt.exists():
            fingerprint = _receipt_fingerprint(receipt)
            try:
                result = json.loads(receipt.read_text())
                if not isinstance(result, dict) or "exit_code" not in result:
                    raise ValueError("Malformed run receipt")
            except Exception as exc:
                # Preserve the unreadable receipt as evidence and stop retrying the
                # same corrupt bytes on every tick. A rewritten valid receipt is
                # processed on the next tick.
                if run.get("receipt_error") and run.get("receipt_fingerprint") == fingerprint:
                    return
                self.store.update(run, status="unknown", receipt_error="Unreadable run receipt: " + str(exc)[:200], receipt_fingerprint=fingerprint)
                return
            state = "failed" if result.get("reason") == "time_limit" else (
                "cancelled" if result.get("cancelled") else "succeeded" if result.get("exit_code") == 0 else "failed")
            self.store.update(run, status=state, exit=result)
            process = self.processes.pop(run["id"], None)
            if process:
                try:
                    process.wait(timeout=2)
                except Exception:
                    pass
            atomic_json(directory / "reproduction.json", run)
        elif alive(run.get("identity")):
            if run["status"] == "unknown":
                self.store.update(run, status="running")
        elif time.time() - run.get("started_at", 0) > 2:
            self.store.update(run, status="unknown")

    def cluster_loop(self):
        delay, failures = 15, 0
        while not self.stop_event.wait(delay):
            try:
                self.clusters.tick()
                failures, delay = 0, 15
            except Exception:
                failures += 1
                delay = min(300, 15 * (2 ** min(failures, 4)))
                self.store.event(None, {"kind": "cluster", "error": "Remote monitor unavailable; retrying in %ss" % delay})

    def loop(self):
        while not self.stop_event.wait(0.3):
            try:
                self.tick()
            except Exception as exc:
                self.store.event(None, {"error": str(exc)})

    def close(self):
        self.stop_event.set()
        self.clusters.close()
        if hasattr(self, "scheduler"):
            self.scheduler.join(3)
        if hasattr(self, "authority_lock"):
            self.authority_lock.close()
