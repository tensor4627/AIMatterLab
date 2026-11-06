"""Declaration binding unit tests; no engine launch and no scientific validation."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from studio_worker.tools.declarations import DeclarationError, bind_operation, find_declaration


def function(operation, *, inputs=None, parameters=None, entrypoint="bin/tool.py"):
    return {
        "id": "demo.run",
        "engine": "demo.run",
        "entrypoint": entrypoint,
        "inputs": inputs or [],
        "parameters": parameters or [],
        "operation": {"command": operation, "failure_handling": "Inspect logs before retrying."},
    }


def declaration(manifest_function):
    return {"tool_id": "demo-tool", "repository": tempfile.gettempdir(), "function": manifest_function}


def write_manifest(root, value):
    target = Path(root) / "aimlab-tools" / "manifest.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(value), encoding="utf-8")


class DeclarationBinding(unittest.TestCase):
    def environment(self):
        return {"executables": {"python": "/usr/bin/python3", "hotpp": "/opt/hotpp/bin/hotpp"}}

    def test_find_declaration_scans_registered_repositories_by_engine(self):
        root = tempfile.mkdtemp()
        write_manifest(root, {"schema_version": 1, "id": "demo-tool", "functions": [function(["{python}", "{entrypoint}"])]})
        found = find_declaration({"demo": root}, "demo.run")
        self.assertEqual(found["tool_id"], "demo-tool")
        self.assertIsNone(find_declaration({"demo": root}, "other.engine"))

    def test_executable_and_parameter_tokens_bind_without_test_wrappers(self):
        value = function(
            ["{executable:hotpp}", "eval", "-m", "{model-file}", "-d", "{dataset-file}", "--device", "cuda"],
            parameters=[{"id": "model-file", "required": True}, {"id": "dataset-file", "required": True}],
        )
        bound = bind_operation(declaration(value), {"inputs": {}, "parameters": {"model_file": "best.pt", "dataset_file": "data.xyz"}}, self.environment())
        self.assertEqual(bound["argv"], ["/opt/hotpp/bin/hotpp", "eval", "-m", "best.pt", "-d", "data.xyz", "--device", "cuda"])

    def test_input_ids_resolve_by_normalized_asset_name_and_arrays_expand(self):
        value = function(
            ["{python}", "{entrypoint}", "{run-py}", "{symbols}"],
            inputs=[{"id": "run-py", "required": True}],
            parameters=[{"id": "symbols", "required": True}],
            entrypoint="bin/run.py",
        )
        root = Path(tempfile.mkdtemp())
        (root / "bin").mkdir()
        (root / "bin" / "run.py").write_text("", encoding="utf-8")
        declaration_value = {"tool_id": "demo-tool", "repository": str(root), "function": value}
        bound = bind_operation(declaration_value, {"inputs": {"run.py": "/tmp/run.py"}, "parameters": {"symbols": ["C", "N"]}}, self.environment())
        self.assertEqual(bound["argv"], ["/usr/bin/python3", str(root / "bin" / "run.py"), "/tmp/run.py", "C", "N"])

    def test_omitted_optional_value_removes_its_flag(self):
        value = function(
            ["{executable:hotpp}", "train", "-i", "{input-yaml}", "-o", "model", "--load_checkpoint", "{checkpoint}"],
            inputs=[{"id": "input-yaml", "required": True}],
            parameters=[{"id": "checkpoint", "required": False, "default": None}],
        )
        bound = bind_operation(declaration(value), {"inputs": {"input.yaml": "/tmp/input.yaml"}, "parameters": {}}, self.environment())
        self.assertEqual(bound["argv"], ["/opt/hotpp/bin/hotpp", "train", "-i", "/tmp/input.yaml", "-o", "model"])

    def test_missing_required_input_and_unknown_tokens_fail(self):
        required = function(["{executable:hotpp}", "{model-file}"], inputs=[{"id": "model-file", "required": True}])
        with self.assertRaisesRegex(DeclarationError, "Missing required input"):
            bind_operation(declaration(required), {"inputs": {}, "parameters": {}}, self.environment())
        unknown = function(["{executable:hotpp}", "{not-declared}"])
        with self.assertRaisesRegex(DeclarationError, "Unknown operation token"):
            bind_operation(declaration(unknown), {"inputs": {}, "parameters": {}}, self.environment())
        with self.assertRaisesRegex(DeclarationError, "Register an available executable"):
            bind_operation(declaration(function(["{executable:missing}"])), {"inputs": {}, "parameters": {}}, {"executables": {}})


if __name__ == "__main__":
    unittest.main()
