"""Declaration-driven Adapter.prepare pilot tests; no engine launch and no scientific validation."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from studio_worker.tools import adapters
from studio_worker.tools.declarations import bind_operation, find_declaration


def hotpp_eval_manifest():
    return {
        "schema_version": 1,
        "id": "hotpp",
        "functions": [{
            "id": "hotpp.eval",
            "engine": "hotpp.eval",
            "entrypoint": "hotpp/entrypoints/main.py",
            "inputs": [],
            "parameters": [
                {"id": "model-file", "required": True},
                {"id": "dataset-file", "required": True}
            ],
            "operation": {
                "command": ["{executable:hotpp}", "eval", "-m", "{model-file}", "-d", "{dataset-file}", "--device", "cuda", "--datatype", "ase"],
                "failure_handling": "Inspect logs before retrying."
            }
        }]
    }


def write_manifest(root, value):
    target = Path(root) / "aimlab-tools" / "manifest.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(value), encoding="utf-8")


class DeclarationDrivenPrepare(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        write_manifest(self.root, hotpp_eval_manifest())
        self.environment = {
            "executables": {"hotpp": sys.executable, "nep": sys.executable, "python": sys.executable},
            "repositories": {"hotpp": self.root},
        }
        self.spec = {
            "engine": "hotpp.eval",
            "inputs": {"model.pth": "/tasks/model.pth", "data.xyz": "/tasks/data.xyz"},
            "parameters": {"model_file": "model.pth", "dataset_file": "data.xyz"},
        }

    def test_declaration_driven_prepare_matches_the_hardcoded_adapter(self):
        baseline = adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment)
        with patch.dict(os.environ, {"STUDIO_DECLARATION_DRIVEN": "1", "STUDIO_DECLARATION_ENGINES": "hotpp.eval"}):
            declared = adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment)
        self.assertEqual(declared, baseline)
        self.assertEqual(declared, [sys.executable, "eval", "-m", "model.pth", "-d", "data.xyz", "--device", "cuda", "--datatype", "ase"])

    def test_flag_off_or_engine_not_allowed_keeps_the_hardcoded_adapter(self):
        baseline = adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment)
        with patch.dict(os.environ, {"STUDIO_DECLARATION_DRIVEN": "0"}):
            self.assertEqual(adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment), baseline)
        with patch.dict(os.environ, {"STUDIO_DECLARATION_DRIVEN": "1", "STUDIO_DECLARATION_ENGINES": "hotpp.train"}):
            self.assertEqual(adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment), baseline)

    def test_missing_repository_declaration_falls_back_without_guessing(self):
        baseline = adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment)
        with patch.dict(os.environ, {"STUDIO_DECLARATION_DRIVEN": "1", "STUDIO_DECLARATION_ENGINES": "hotpp.eval"}):
            self.assertEqual(adapters.Adapter("hotpp.eval").prepare(self.spec, {"executables": self.environment["executables"], "repositories": {}}), baseline)

    def test_default_migration_set_covers_every_builtin_engine(self):
        self.assertEqual(set(adapters.DEFAULT_DECLARATION_ENGINES), set(adapters.ENGINES))
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_DECLARATION")}
        with patch.dict(os.environ, clean, clear=True):
            with patch("studio_worker.tools.declarations.bind_operation", side_effect=lambda *args, **kwargs: {"argv": ["SENTINEL"]}):
                self.assertEqual(adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment), ["SENTINEL"])

    def test_nep_eval_uses_the_declaration_when_the_repository_has_the_helper(self):
        root = tempfile.mkdtemp()
        (Path(root) / "tools").mkdir()
        (Path(root) / "tools" / "nep_predict.py").write_text("", encoding="utf-8")
        write_manifest(root, {
            "schema_version": 1,
            "id": "gpu-sampling",
            "functions": [{
                "id": "nep.eval",
                "engine": "nep.eval",
                "entrypoint": "tools/nep_predict.py",
                "inputs": [{"id": "nep-in", "required": True}],
                "parameters": [{"id": "dataset-role", "required": True}],
                "operation": {"command": ["{python}", "{entrypoint}", "{executable:nep}", "{dataset-role}"], "failure_handling": "Inspect logs."}
            }]
        })
        spec = {
            "engine": "nep.eval",
            "inputs": {"nep.in": "/tasks/nep.in", "evaluation.xyz": "/tasks/evaluation.xyz", "nep.txt": "/tasks/nep.txt"},
            "parameters": {"dataset_role": "test"},
        }
        environment = {**self.environment, "repositories": {"gpu-sampling": root}}
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_DECLARATION")}
        with patch.dict(os.environ, clean, clear=True):
            self.assertEqual(
                adapters.Adapter("nep.eval").prepare(spec, environment),
                [sys.executable, str(Path(root) / "tools" / "nep_predict.py"), sys.executable, "test"],
            )

    def test_nep_eval_requires_a_registered_tool_source_without_declaration(self):
        spec = {
            "engine": "nep.eval",
            "inputs": {"nep.in": "/tasks/nep.in", "evaluation.xyz": "/tasks/evaluation.xyz", "nep.txt": "/tasks/nep.txt"},
            "parameters": {"dataset_role": "test"},
        }
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_DECLARATION")}
        with patch.dict(os.environ, clean, clear=True), self.assertRaisesRegex(ValueError, "Register the GPUMD tool source"):
            adapters.Adapter("nep.eval").prepare(spec, {**self.environment, "repositories": {}})
        source = tempfile.mkdtemp()
        (Path(source) / "tools").mkdir()
        (Path(source) / "tools" / "nep_predict.py").write_text("", encoding="utf-8")
        with patch.dict(os.environ, clean, clear=True):
            self.assertEqual(
                adapters.Adapter("nep.eval").prepare(spec, {**self.environment, "repositories": {"gpumd": source}}),
                [sys.executable, str(Path(source) / "tools" / "nep_predict.py"), sys.executable, "test"],
            )

    def test_strict_mode_rejects_missing_declarations_but_accepts_a_registered_source(self):
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_")}
        with patch.dict(os.environ, {**clean, "STUDIO_REQUIRE_TOOL_DECLARATIONS": "1"}, clear=True):
            with self.assertRaisesRegex(ValueError, "Tool declaration required for engine hotpp.eval"):
                adapters.Adapter("hotpp.eval").prepare(self.spec, {**self.environment, "repositories": {}})
            self.assertEqual(
                adapters.Adapter("hotpp.eval").prepare(self.spec, self.environment),
                [sys.executable, "eval", "-m", "model.pth", "-d", "data.xyz", "--device", "cuda", "--datatype", "ase"],
            )

    def test_binding_module_rejects_a_missing_required_parameter(self):
        declaration = find_declaration({"hotpp": self.root}, "hotpp.eval")
        with self.assertRaisesRegex(ValueError, "Missing required parameter"):
            bind_operation(declaration, {"inputs": {}, "parameters": {"model_file": "model.pth"}}, self.environment)


if __name__ == "__main__":
    unittest.main()
