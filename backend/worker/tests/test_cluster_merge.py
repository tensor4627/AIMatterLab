import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import Clusters
from studio_worker.infrastructure.store import Store


class _Service:
    def __init__(self, root):
        self.root = Path(root)
        self.store = Store(self.root / "service")


class ClusterMergeTest(unittest.TestCase):
    """A long SSH poll must merge into the current row, not overwrite it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = _Service(self.tmp.name)
        self.clusters = Clusters(self.service)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.service.store.db.close)

    def add(self, identifier):
        directory = Path(self.tmp.name) / "cluster-runs" / identifier
        directory.mkdir(parents=True)
        run = {"id": identifier, "kind": "cluster-run", "project_id": "project", "cluster_id": "cluster",
               "directory": str(directory), "status": "queued", "job_id": None, "cancel_requested": False,
               "identity_verified": False, "created_at": 1, "updated_at": 1}
        self.service.store.put("cluster-run", run)
        return run

    def test_merge_keeps_concurrent_cancellation_and_new_job_identity(self):
        self.add("a")
        stale = self.clusters.raw("a")
        current = self.clusters.raw("a")
        current.update(cancel_requested=True, identity_verified=True, job_id="42")
        self.service.store.put("cluster-run", current)
        merged = self.clusters.merge("a", status="running", scheduler_state="RUNNING", job_id="42")
        self.assertTrue(merged["cancel_requested"], "Concurrent human cancellation must not be overwritten")
        self.assertTrue(merged["identity_verified"], "Verified scheduler identity must not be reverted")
        self.assertEqual(merged["status"], "running")
        self.assertEqual(self.clusters.raw("a")["status"], "running")

    def test_save_is_the_explicit_stale_write_and_merge_is_not(self):
        self.add("b")
        stale = self.clusters.raw("b")
        current = self.clusters.raw("b")
        current.update(cancel_requested=True)
        self.service.store.put("cluster-run", current)
        self.clusters.save(stale, status="unknown")
        self.assertFalse(self.clusters.raw("b")["cancel_requested"])


if __name__ == "__main__":
    unittest.main()
