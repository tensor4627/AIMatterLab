import io
import json
import os
from importlib.util import find_spec
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service


@unittest.skipUnless(os.name == "posix" and find_spec("yaml"), "Linux worker with target PyYAML required")
class HotHamExecutionMode(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.service = Service(self.root / "worker", schedule=False)
        self.addCleanup(self.service.store.db.close)
        self.addCleanup(self.service.close)
        env = {"executables": {"python": sys.executable}}
        local = self.service.register_environment({"name": "target", **env})
        cluster = self.service.clusters.register({
            "name": "offline", "scheduler": "slurm", "target": "fixture@example.test", "ssh_client": "/usr/bin/ssh",
            "queue": "fixture", "remote_root": "/tmp/studio-fixture", "environment": env,
        })
        project = self.service.register_project({"name": "project", "policy": {
            "input_roots": [str(self.root)], "environments": [local["id"]], "clusters": [cluster["id"]]
        }})
        self.input_file = self.root / "hotham-input.yaml"
        self.spec = {"project_id": project["id"], "environment_id": local["id"], "cluster_id": cluster["id"],
                     "inputs": {self.input_file.name: str(self.input_file)}, "parameters": {}, "gpu": 0,
                     "max_seconds": 60, "resources": {"queue": "fixture", "cpus": 1, "gpus": 0, "memory_mb": 1024}}

    def test_prepare_uses_each_routes_scientific_input_and_command(self):
        launcher = [sys.executable, "-m", "torch.distributed.run", "--standalone", "--nproc_per_node=1",
                    "-m", "hotham.entrypoints.main", "hotham-input.yaml"]
        cases = [
            ("hotham.datasets", "generate_dataset.py", [sys.executable, "generate_dataset.py"]),
            ("hotham.train", "hotham-input.yaml", launcher),
            ("hotham.eval", "hotham-input.yaml", launcher),
            ("hotham.export", "hotham-input.yaml", launcher),
            ("hotham.diagonalize", "diagonal.py", [sys.executable, "diagonal.py", "-diag"]),
        ]
        for engine, name, expected in cases:
            with self.subTest(engine=engine):
                source = self.root / name
                source.write_text("# preparation fixture\n", encoding="utf-8")
                spec = {**self.spec, "engine": engine, "inputs": {name: str(source)}, "idempotency_key": engine}
                draft = self.service.prepare(spec)
                self.assertEqual(draft["command"], expected)
                with self.assertRaisesRegex(ValueError, "Missing inputs: " + name):
                    self.service.prepare({**spec, "idempotency_key": engine + "-missing",
                                          "inputs": {"unrelated.txt": str(source)}})

    def test_local_submit_validates_the_selected_operation_without_optional_validation(self):
        for i, (engine, mode, valid) in enumerate([
            ("hotham.train", "0", True), ("hotham.train", "-1", True),
            ("hotham.eval", "1", True), ("hotham.export", "2", True),
            ("hotham.eval", "0", False), ("hotham.train", "2", False),
            ("hotham.export", '"2"', False), ("hotham.eval", "true", False),
        ]):
            with self.subTest(engine=engine, mode=mode):
                self.input_file.write_text(f"prediction: {mode}\n", encoding="utf-8")
                draft = self.service.prepare({**self.spec, "engine": engine, "idempotency_key": str(i)})
                if valid:
                    run = self.service.submit(draft["id"])
                    self.assertEqual(run["status"], "queued")
                    self.assertEqual(run["execution_check"]["report"]["prediction"], int(mode))
                else:
                    with self.assertRaisesRegex(ValueError, "prediction"):
                        self.service.submit(draft["id"])
                    run = self.service.store.run(draft["id"])
                    self.assertEqual(run["status"], "draft")
                    self.assertEqual(run["execution_check"]["status"], "failed")

    def test_cluster_allocation_rejects_train_yaml_for_an_evaluation(self):
        clusters = self.service.clusters
        self.input_file.write_text("prediction: 0\n", encoding="utf-8")
        run = clusters.prepare({**self.spec, "engine": "hotham.eval", "idempotency_key": "allocation"})
        sandbox = self.root / "allocation"
        with tarfile.open(fileobj=io.BytesIO(clusters.archive(clusters.raw(run["id"]))), mode="r:gz") as archive:
            for member in archive:
                target = sandbox / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
        result = subprocess.run([sys.executable, ".studio/validate.py"], cwd=sandbox, capture_output=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        check = json.loads((sandbox / "execution-check.json").read_text())
        self.assertEqual(check["status"], "failed")
        self.assertIn("prediction: 1", check["message"])
