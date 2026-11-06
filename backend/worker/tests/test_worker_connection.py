import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.transport.server import load_tokens


class WorkerCredentialsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def write(self, value):
        path = self.root / "connection.json"
        path.write_text(json.dumps(value))
        return path

    def test_missing_credentials_are_created_with_schema_and_are_stable(self):
        tokens = load_tokens(self.root)
        self.assertEqual(set(tokens), {"admin", "mcp"})
        self.assertTrue(all(isinstance(value, str) and len(value) >= 16 for value in tokens.values()))
        stored = json.loads((self.root / "connection.json").read_text())
        self.assertEqual(stored, {"schema_version": 1, **tokens})
        self.assertEqual(load_tokens(self.root), tokens)

    def test_legacy_credentials_are_validated_then_stamped_with_a_schema(self):
        legacy = {"admin": "a" * 32, "mcp": "b" * 32}
        self.write(legacy)
        self.assertEqual(load_tokens(self.root), legacy)
        self.assertEqual(json.loads((self.root / "connection.json").read_text()),
                         {"schema_version": 1, **legacy})

    def test_malformed_credentials_fail_fast_without_being_rewritten(self):
        for value in (["not", "an", "object"], {"admin": "a" * 32}, {"admin": "short", "mcp": "b" * 32}):
            with self.subTest(value=value):
                path = self.write(value)
                before = path.read_text()
                with self.assertRaises(RuntimeError):
                    load_tokens(self.root)
                self.assertEqual(path.read_text(), before)

    def test_invalid_json_fails_fast(self):
        path = self.root / "connection.json"
        path.write_text("{not json")
        with self.assertRaises(RuntimeError):
            load_tokens(self.root)
        self.assertEqual(path.read_text(), "{not json")


if __name__ == "__main__":
    unittest.main()
