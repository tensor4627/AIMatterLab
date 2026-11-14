"""Fresh dependency gating with real subprocesses and explicit synthetic packages.

The tiny packages are import fixtures, never scientific execution evidence.
"""
import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.adapters import Adapter
from studio_worker.service import Service


class PyDynImportGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.modules = self.root / "synthetic-packages"
        self.modules.mkdir()
        (self.modules / "torch.py").write_text(
            "from types import SimpleNamespace\n__version__='import-fixture'\n"
            "version=SimpleNamespace(cuda=None)\ncuda=SimpleNamespace(is_available=lambda:False)\n")
        for name in ("cupy", "ase"):
            (self.modules / (name + ".py")).write_text("__version__='import-fixture'\n")
        (self.modules / "pydyn").mkdir()
        self.pydyn = self.modules / "pydyn/__init__.py"
        self.pydyn.write_text("__version__='import-fixture'\n")
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        (self.inputs / "run.py").write_text("from pathlib import Path\nPath('executed.marker').write_text('must not run during validation')\n")
        self.service = Service(self.root / "service", schedule=False)
        self.env = self.service.register_environment({"name": "Synthetic import contract fixture",
            "executables": {"python": sys.executable}, "repositories": {"pydyn": str(self.modules)}})
        self.project = self.service.register_project({"name": "Import gate only", "policy": {
            "input_roots": [str(self.inputs)], "environments": [self.env["id"]]}})
        self.run = self.service.prepare({"project_id": self.project["id"], "environment_id": self.env["id"],
            "engine": "pydyn.md", "inputs": {"run.py": str(self.inputs / "run.py")},
            "gpu": 0, "max_seconds": 10, "idempotency_key": "import-gate"})

    def tearDown(self):
        self.service.close()
        self.service.store.db.close()
        self.tmp.cleanup()

    def validate_once(self):
        original = Adapter.probe
        with patch.object(Adapter, "probe", autospec=True, side_effect=original) as probe:
            result = self.service.validate(self.run["id"])
        self.assertEqual(probe.call_count, 1, "one current observation, not cached evidence or double imports")
        for directory in ("simulation", "results"):
            self.assertFalse((Path(result["directory"]) / directory / "executed.marker").exists())
        return result

    def test_registered_sources_import_without_sampling_and_do_not_execute_user_script(self):
        result = self.validate_once()
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["validation"]["runtime_imports"]["status"], "passed")
        self.assertEqual(result["validation"]["scientific_status"], "not_run")
        self.assertFalse(result["provenance"]["pydyn_sampling"])
        self.assertTrue(Path(result["provenance"]["modules"]["pydyn"]["file"]).is_relative_to(self.modules))

    def test_missing_pydyn_fails_before_queue_or_launch(self):
        self.pydyn.write_text("raise ModuleNotFoundError('controlled missing pydyn')\n")
        with patch.object(Adapter, "launch", side_effect=AssertionError("must not launch")) as launch:
            result = self.validate_once()
            self.assertEqual(result["status"], "draft")
            self.assertEqual(result["validation"]["status"], "failed")
            self.assertIn("pydyn", result["validation"]["message"])
            self.assertIn("source repositories", result["validation"]["message"])
            with self.assertRaisesRegex(ValueError, "Required PyDyn runtime imports failed"):
                self.service.submit(result["id"])
            self.service.tick()
            launch.assert_not_called()

    def test_cached_healthy_and_cached_blocked_never_replace_current_imports(self):
        self.assertEqual(self.validate_once()["status"], "ready")
        self.pydyn.write_text("raise ModuleNotFoundError('module changed after prior validation')\n")
        failed = self.validate_once()
        self.assertEqual(failed["validation"]["status"], "failed")
        self.assertEqual(failed["provenance"]["modules"]["pydyn"]["status"], "blocked")
        self.pydyn.write_text("__version__='restored-import-fixture'\n")
        restored = self.validate_once()
        self.assertEqual(restored["status"], "ready")
        self.assertEqual(restored["provenance"]["modules"]["pydyn"]["version"], "restored-import-fixture")

    def test_another_required_dependency_is_also_blocking(self):
        (self.modules / "cupy.py").write_text("raise ImportError('controlled CuPy loader failure')\n")
        result = self.validate_once()
        self.assertEqual(result["validation"]["status"], "failed")
        self.assertIn("cupy", result["validation"]["message"])

    def test_probe_exception_cannot_be_promoted_to_ready(self):
        with patch.object(Adapter, "probe", side_effect=ValueError("bounded probe failure")) as probe:
            result = self.service.validate(self.run["id"])
        self.assertEqual(probe.call_count, 1)
        self.assertEqual(result["validation"]["status"], "failed")
        self.assertIn("bounded probe failure", result["validation"]["message"])

    def test_report_identity_missing_modules_and_wrong_registered_source_fail_closed(self):
        good = Adapter("pydyn.md").probe(self.env)
        bad_reports = [
            {**good, "scope": None},
            {**good, "scope": []},
            {**good, "scope": {"engine": "pydyn.sampling"}},
            {**good, "executable": "/different/python"},
            {**good, "modules": {}},
        ]
        mismatch = copy.deepcopy(good)
        mismatch["modules"]["pydyn"]["file"] = str(self.root / "different/pydyn/__init__.py")
        bad_reports.append(mismatch)
        for report in bad_reports:
            with self.subTest(report=report), self.assertRaises(ValueError):
                Adapter("pydyn.md").pydyn_import_contract(self.env, report)

    def test_direct_adapter_validation_reads_current_environment(self):
        adapter = Adapter("pydyn.md")
        original = adapter.probe
        with patch.object(adapter, "probe", wraps=original) as probe:
            report = adapter.validate(self.run, self.env, Path(self.run["directory"]) / "results")
        probe.assert_called_once_with(self.env)
        self.assertEqual(report["runtime_imports"]["status"], "passed")

    def test_other_engine_does_not_gain_python_import_gate(self):
        adapter = Adapter("gpumd.md")
        with patch.object(adapter, "runtime_check", return_value={"status": "not_run"}), patch.object(adapter, "input_contract"), patch.object(adapter, "probe", side_effect=AssertionError("unrelated import")):
            report = adapter.validate({"parameters": {}}, self.env, self.root)
        self.assertEqual(report["status"], "passed")
        self.assertNotIn("runtime_imports", report)


if __name__ == "__main__":
    unittest.main()
