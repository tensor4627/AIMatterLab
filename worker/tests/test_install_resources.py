"""Actual immutable deployment must carry the catalog adapter used by the worker."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class InstallResourcesTests(unittest.TestCase):
 def test_catalog_adapter_is_deployed_versioned_and_allowlisted(self):
  source = Path(__file__).resolve().parents[1]
  with tempfile.TemporaryDirectory() as directory:
   base = Path(directory)
   fixture = base / "source"
   shutil.copytree(source, fixture, ignore=shutil.ignore_patterns("__pycache__", "tests"))
   (fixture / "studio_worker" / "unrelated-private.json").write_text('{"private": true}')
   def install():
    result = subprocess.run([sys.executable, str(fixture / "install.py"), "--source", str(fixture), "--root", str(base / "runtime")], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)
   first = install()
   runtime = Path(first["path"])
   relative = Path("studio_worker/pygas-editor-hints.json")
   self.assertEqual((runtime / relative).read_bytes(), (fixture / relative).read_bytes())
   self.assertFalse((runtime / "studio_worker/unrelated-private.json").exists())
   self.assertTrue((runtime / "studio_worker/engine_contracts.json").is_file())
   self.assertEqual(first, install())
   original = (runtime / relative).read_bytes()
   (fixture / relative).write_bytes(original + b"\n")
   second = install()
   self.assertNotEqual(first["id"], second["id"])
   self.assertEqual((runtime / relative).read_bytes(), original)
   self.assertEqual((Path(second["path"]) / relative).read_bytes(), original + b"\n")
   self.assertEqual(hashlib.sha256((runtime / relative).read_bytes()).hexdigest(), hashlib.sha256(original).hexdigest())


if __name__ == "__main__":
 unittest.main()
