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
    target.parent.mkdir(parents=True, exist_ok=True)
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

    def test_nep_eval_uses_the_declaration_with_native_prediction_inputs(self):
        root = tempfile.mkdtemp()
        write_manifest(root, {
            "schema_version": 1,
            "id": "gpu-sampling",
            "functions": [{
                "id": "nep.eval",
                "engine": "nep.eval",
                "entrypoint": "aimlab-tools/tests/nep-eval/run-test.py",
                "inputs": [{"id": "nep-in", "required": True}, {"id": "train-xyz", "required": True}, {"id": "nep-txt", "required": True}],
                "parameters": [],
                "operation": {"command": ["{executable:nep}"], "failure_handling": "Inspect logs."}
            }]
        })
        spec = {
            "engine": "nep.eval",
            "inputs": {"nep.in": "/tasks/nep.in", "train.xyz": "/tasks/train.xyz", "nep.txt": "/tasks/nep.txt"},
            "parameters": {},
        }
        environment = {**self.environment, "repositories": {"gpu-sampling": root}}
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_DECLARATION")}
        with patch.dict(os.environ, clean, clear=True):
            self.assertEqual(adapters.Adapter("nep.eval").prepare(spec, environment), [sys.executable])

    def test_nep_eval_uses_native_prediction_inputs_without_a_helper(self):
        spec = {
            "engine": "nep.eval",
            "inputs": {"nep.in": "/tasks/nep.in", "train.xyz": "/tasks/train.xyz", "nep.txt": "/tasks/nep.txt"},
            "parameters": {},
        }
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_")}
        with patch.dict(os.environ, clean, clear=True):
            self.assertEqual(adapters.Adapter("nep.eval").prepare(spec, {"executables": {"nep": sys.executable}}), [sys.executable])
            with self.assertRaisesRegex(ValueError, "native prediction input"):
                adapters.Adapter("nep.eval").prepare({"engine": "nep.eval", "inputs": {"nep.in": "/tasks/nep.in", "evaluation.xyz": "/tasks/evaluation.xyz", "nep.txt": "/tasks/nep.txt"}, "parameters": {}}, {"executables": {"nep": sys.executable}})

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

    def test_declaration_path_keeps_required_input_validation(self):
        spec = {
            "engine": "hotpp.eval",
            "inputs": {},
            "parameters": {"model_file": "model.pth", "dataset_file": "data.xyz"},
        }
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_")}
        with patch.dict(os.environ, clean, clear=True), self.assertRaisesRegex(ValueError, "Missing inputs"):
            adapters.Adapter("hotpp.eval").prepare(spec, self.environment)

    def test_declaration_path_normalizes_public_mode_before_binding(self):
        root = tempfile.mkdtemp()
        script = Path(root) / "agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py"
        script.parent.mkdir(parents=True)
        script.write_text("", encoding="utf-8")
        write_manifest(root, {
            "schema_version": 1,
            "id": "pygas",
            "functions": [{
                "id": "bias.validate",
                "engine": "bias.validate",
                "entrypoint": "agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py",
                "inputs": [{"id": "bias-model", "required": False, "default": None}, {"id": "structure", "required": False, "default": None}],
                "parameters": [
                    {"id": "bias-file", "required": True},
                    {"id": "structure-file", "required": True},
                    {"id": "mode", "required": True},
                    {"id": "cutoff", "required": True},
                    {"id": "cv-size", "required": True},
                    {"id": "validation", "required": False, "default": None},
                    {"id": "kernel-capacity", "required": False, "default": None},
                ],
                "operation": {"command": [
                    "{python}", "{entrypoint}", "{bias-file}", "{structure-file}",
                    "--mode", "{mode}", "--cutoff", "{cutoff}", "--cv-size", "{cv-size}",
                    "--device", "cuda", "--history", "{validation}", "--kernel-capacity", "{kernel-capacity}",
                ], "failure_handling": "Inspect logs."},
            }],
        })
        environment = {
            "executables": {"python": sys.executable, "pygas": sys.executable},
            "repositories": {"pygas": root},
        }
        spec = {
            "engine": "bias.validate",
            "inputs": {"bias.pt": "/tasks/bias.pt", "model.xyz": "/tasks/model.xyz"},
            "parameters": {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5, "mode": "metad"},
        }
        clean = {key: value for key, value in os.environ.items() if not key.startswith("STUDIO_")}
        with patch.dict(os.environ, clean, clear=True):
            argv = adapters.Adapter("bias.validate").prepare(spec, environment)
        self.assertEqual(argv[argv.index("--mode") + 1], "bias")
        self.assertNotIn("--history", argv)
        self.assertNotIn("--kernel-capacity", argv)

    def test_declaration_missing_required_token_or_tool_identity_is_rejected(self):
        root = tempfile.mkdtemp()
        write_manifest(root, {
            "schema_version": 1,
            "id": "gpu-sampling",
            "functions": [{
                "id": "hotpp.eval",
                "engine": "hotpp.eval",
                "entrypoint": "hotpp/entrypoints/main.py",
                "inputs": [],
                "parameters": [{"id": "model-file", "required": True}, {"id": "dataset-file", "required": True}],
                "operation": {"command": ["{executable:hotpp}", "eval", "-m", "{model-file}", "-d", "{dataset-file}", "--device", "cuda"], "failure_handling": "Inspect logs."},
            }],
        })
        declaration = find_declaration({"hotpp": root}, "hotpp.eval")
        spec = {"inputs": {}, "parameters": {"model_file": "model.pth", "dataset_file": "data.xyz"}}
        with self.assertRaisesRegex(ValueError, "does not match the engine contract tool id"):
            bind_operation(declaration, spec, self.environment)

        write_manifest(root, {
            "schema_version": 1,
            "id": "hotpp",
            "functions": [{
                "id": "hotpp.train",
                "engine": "hotpp.train",
                "entrypoint": "hotpp/entrypoints/main.py",
                "inputs": [{"id": "input-yaml", "required": True}],
                "parameters": [],
                "operation": {"command": ["{executable:hotpp}", "train", "-i", "{input-yaml}", "-o", "model"], "failure_handling": "Inspect logs."},
            }],
        })
        declaration = find_declaration({"hotpp": root}, "hotpp.train")
        with self.assertRaisesRegex(ValueError, "missing required token"):
            bind_operation(declaration, {"inputs": {"input.yaml": "/tasks/input.yaml"}, "parameters": {}}, self.environment)


if __name__ == "__main__":
    unittest.main()
