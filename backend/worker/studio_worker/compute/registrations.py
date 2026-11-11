"""RegistrationsMixin: implementation extracted from the legacy Service API."""
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


class RegistrationsMixin:
    def register_project(self, value):
        with self.store.lock:
            return self._register_project(value)

    def _register_project(self, value):
        value = dict(value)
        if not value.get("name"):
            raise ValueError("Project name required")
        value.setdefault("id", secrets.token_hex(8))
        leaf(value["id"])
        policy = value.setdefault("policy", {})
        for key, default in {"engines": list(ENGINES), "gpus": [0], "max_seconds": 3600,
                             "max_concurrent": 1, "input_roots": [], "environments": []}.items():
            policy.setdefault(key, default)
        if not policy["input_roots"] or any(not Path(p).is_absolute() for p in policy["input_roots"]):
            raise ValueError("Explicit absolute input roots required")
        if not isinstance(policy["gpus"], list) or not policy["gpus"] or any(
                not isinstance(g, int) or g < 0 for g in policy["gpus"]):
            raise ValueError("GPU IDs must be nonnegative integers")
        if int(policy["max_seconds"]) <= 0 or int(policy["max_concurrent"]) <= 0:
            raise ValueError("Resource limits must be positive")
        policy["max_seconds"] = int(policy["max_seconds"])
        policy["max_concurrent"] = int(policy["max_concurrent"])
        if any(e not in SUPPORTED_ENGINES for e in policy["engines"]):
            raise ValueError("Unsupported engine authorization")
        self.clusters.validate_project_policies(value)
        return self.store.put("project", value)

    def register_environment(self, value):
        with self.store.lock:
            return self._register_environment(value)

    def _register_environment(self, value):
        value = dict(value)
        draft_id=value.pop('setup_draft_id',None)
        draft=None
        if draft_id is not None:
            leaf(draft_id)
            draft=self.store.get('environment-draft',draft_id)
            if draft.get('status')!='draft':raise ValueError('This setup proposal has already been saved; read the current registered environment')
        if not value.get("name") or not isinstance(value.get("executables"), dict):
            raise ValueError("Environment name and absolute executable paths required")
        for path in [*value["executables"].values(), *value.get("repositories", {}).values(), *value.get("skills", {}).values()]:
            if not Path(path).is_absolute():
                raise ValueError("Environment paths must be absolute Linux paths")
        value.setdefault("id", secrets.token_hex(8))
        leaf(value["id"])
        value["provider"] = "ssh" if getattr(self, 'ssh_service_mode', False) else "wsl"
        if draft is not None:
            self.store.put_many([('environment',value),('environment-draft',{**draft,'status':'applied','environment_id':value['id'],'applied_at':time.time()})])
            return value
        return self.store.put("environment", value)

    def authorize(self, spec):
        project = self.store.get("project", spec["project_id"])
        policy = project["policy"]
        if spec["engine"] not in policy["engines"]:
            raise PermissionError("Engine is not authorized")
        if spec["environment_id"] not in policy["environments"]:
            raise PermissionError("Environment is not authorized")
        if spec["gpu"] not in policy["gpus"]:
            raise PermissionError("GPU is not authorized")
        if not 0 < int(spec["max_seconds"]) <= int(policy["max_seconds"]):
            raise PermissionError("Duration exceeds project authorization")
        return project, self.store.get("environment", spec["environment_id"])
