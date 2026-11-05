"""Authoritative selected-environment probes shared by HTTP and MCP readers."""
import copy

from studio_worker.tools.adapters import Adapter, ENGINES
from studio_worker.compute.runtime_guides import RuntimeGuides, fingerprint, safe_identifier


class RuntimeServiceMixin:
    def _runtime_selection(self, data):
        if not isinstance(data, dict):
            raise ValueError("Selected environment and engine required")
        identifier = safe_identifier(data.get("environment_id"))
        engine = data.get("engine", "pydyn.md")
        if engine not in ENGINES:
            raise ValueError("Unsupported probe engine")
        return identifier, engine

    def probe(self, data):
        identifier, engine = self._runtime_selection(data)
        # SDK imports can take time; the run store remains available. Recheck
        # the complete registration under its lock before committing a receipt.
        with self.store.lock:
            environment = copy.deepcopy(self.store.get("environment", identifier))
            before = fingerprint(environment)
        guides = RuntimeGuides(self.root / "runtime-guides")
        try:
            report = Adapter(engine).probe(copy.deepcopy(environment))
            with self.store.lock:
                current = self.store.get("environment", identifier)
                if fingerprint(current) != before:
                    raise ValueError("Environment registration changed during probe; targeted probe required")
                guides.record(environment, engine, report)
                receipt = guides.read(current, engine)
        except Exception as error:
            with self.store.lock:
                current = self.store.get("environment", identifier)
                if fingerprint(current) == before:
                    guides.record_failure(environment, engine, error)
            raise
        return {**report, "runtime_guide": receipt}

    def read_runtime_guide(self, data):
        identifier, engine = self._runtime_selection(data)
        with self.store.lock:
            environment = self.store.get("environment", identifier)
            return RuntimeGuides(self.root / "runtime-guides").read(environment, engine)
