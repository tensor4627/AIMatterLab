"""Worker authority/lifecycle assembly; domain operations retain one Service/Store."""
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


from studio_worker.compute.registrations import RegistrationsMixin
from studio_worker.workspace.run_inputs import RunInputsMixin
from studio_worker.compute.runs import RunsMixin
from studio_worker.compute.scheduler import SchedulerMixin
from studio_worker.workspace.run_artifacts import RunArtifactsMixin
from studio_worker.tools.operations import ToolOperationsMixin

class Service(RegistrationsMixin, RunInputsMixin, RunsMixin, SchedulerMixin, RunArtifactsMixin, ToolOperationsMixin, RuntimeServiceMixin):
    def __init__(self, root, schedule=True):
        self.store = Store(root)
        self.root = self.store.root
        # Captured before any scheduler thread starts. The transport installer
        # sets this only for its dedicated, server-owned SSH service root.
        from studio_worker.compute.ssh_service import mode_for_root
        self.ssh_service_mode = mode_for_root(self.root)
        if os.name == "posix":
            import fcntl
            self.authority_lock = open(self.root / "authority.lock", "a")
            try:
                fcntl.flock(self.authority_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except Exception:
                self.authority_lock.close()
                self.store.db.close()
                raise
        from studio_worker.compute.cluster import Clusters
        from studio_worker.compute.managed_schedules import ManagedSchedules
        self.clusters = Clusters(self)
        self.managed_schedules = ManagedSchedules(self)
        self.stop_event = threading.Event()
        self.compute_setup_lock = threading.Lock()
        self.tool_configuration_lock = threading.RLock()
        self.tool_workflow_lock = threading.RLock()
        self._tool_workflow_token = object()
        self.processes = {}
        self.provenance = {}
        for run in self.store.runs():
            if run["status"] == "validating":
                self.store.update(run, status="draft", validation={"status":"blocked","message":"Service restarted during validation; validate again"})
        if schedule:
            self.scheduler = threading.Thread(target=self.loop, daemon=True)
            self.scheduler.start()
            self.cluster_monitor=threading.Thread(target=self.cluster_loop,daemon=True)
            self.cluster_monitor.start()
            self.roadmap_scheduler = threading.Thread(target=self.roadmap_loop,daemon=True)
            self.roadmap_scheduler.start()
