"""Standalone distribution resources; no engine, daemon or user-state execution."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from runtime_resources import worker_files, runtime_identity, verify_tool_contract


class RuntimeResourcesTests(unittest.TestCase):
    def source(self, root):
        source = root / "tests" / "worker"
        (source / "studio_worker").mkdir(parents=True)
        (source / "bootstrap.py").write_text("# fixture\n", encoding="utf-8")
        (source / "studio_worker" / "engine_contracts.json").write_text('{"fixture":1}', encoding="utf-8")
        (source / "studio_worker" / "tool_package.schema.json").write_text('{"fixture":1}', encoding="utf-8")
        return source

    def test_inventory_uses_relative_exclusions_and_stable_utf8_posix_names(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(Path(directory))
            (source / "studio_worker" / "\ue000.py").write_text("# a", encoding="utf-8")
            (source / "studio_worker" / "\U00010000.py").write_text("# b", encoding="utf-8")
            (source / "tests").mkdir()
            (source / "tests" / "ignored.py").write_text("# ignored", encoding="utf-8")
            (source / "studio_worker" / "private.json").write_text("{}", encoding="utf-8")
            names = worker_files(source)
            self.assertEqual(names, ["bootstrap.py", "studio_worker/engine_contracts.json", "studio_worker/tool_package.schema.json", "studio_worker/\ue000.py", "studio_worker/\U00010000.py"])
            digest = hashlib.sha256()
            for name in names:
                digest.update(name.encode("utf-8"))
                digest.update((source / name).read_bytes())
            self.assertEqual(runtime_identity(source, names), digest.hexdigest()[:20])

    def test_standalone_resource_needs_no_parent_canonical_but_checkout_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(Path(directory))
            verify_tool_contract(source)
            canonical = source.parent / "contracts" / "tools" / "engine-contracts.json"
            canonical.parent.mkdir(parents=True)
            canonical.write_bytes((source / "studio_worker" / "engine_contracts.json").read_bytes())
            verify_tool_contract(source)
            canonical.write_text('{"fixture":2}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale"):
                verify_tool_contract(source)

    def test_local_contract_is_required_even_for_standalone_distribution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(Path(directory))
            (source / "studio_worker" / "engine_contracts.json").unlink()
            with self.assertRaisesRegex(ValueError, "unavailable"):
                verify_tool_contract(source)


if __name__ == "__main__":
    unittest.main()
