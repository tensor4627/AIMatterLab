import json
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute import scheduler as scheduler_module
from studio_worker.compute.scheduler import SchedulerMixin
from studio_worker.infrastructure.store import Store


class _FakeProcess:
    pid = 424242

    def wait(self, timeout=None):
        return 0


class _Scheduler(SchedulerMixin):
    """Minimal scheduler owner: reconciliation must not need a full Service."""

    def __init__(self, root):
        self.store = Store(Path(root) / "service")
        self.store.put("project", {"id": "project", "policy": {"max_concurrent": 1}})
        self.processes = {}

    def close(self):
        self.store.db.close()

    def authorize(self, run):
        return self.store.get("project", run["project_id"]), {}

    def verify_snapshot(self, run):
        return None


def _running_run(identifier, directory, project="project"):
    return {"id": identifier, "project_id": project, "idempotency_key": identifier,
            "request_hash": identifier, "directory": str(directory), "status": "running",
            "identity": {}, "started_at": 0, "command": [], "environment_snapshot": {},
            "gpu": 0, "max_seconds": 1, "snapshots": []}


def _queued_run(identifier, directory, gpu=0):
    return {"id": identifier, "project_id": "project", "idempotency_key": identifier,
            "request_hash": identifier, "directory": str(directory), "status": "queued",
            "identity": None, "started_at": 0, "command": ["python", "job.py"],
            "environment_snapshot": {}, "gpu": gpu, "max_seconds": 1, "snapshots": []}


class SchedulerReconcileIsolation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.scheduler = _Scheduler(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.scheduler.close)

    def add(self, identifier, *, receipt=None, corrupt=False, project="project"):
        directory = Path(self.tmp.name) / identifier
        directory.mkdir()
        self.scheduler.store.add_run(_running_run(identifier, directory, project))
        if corrupt:
            (directory / "exit.json").write_text("{not valid json")
        elif receipt is not None:
            (directory / "exit.json").write_text(json.dumps(receipt))
        return directory

    def add_queued(self, identifier, gpu=0):
        directory = Path(self.tmp.name) / ("queued-" + identifier)
        directory.mkdir()
        self.scheduler.store.add_run(_queued_run(identifier, directory, gpu))
        return directory

    def patch_spawn(self):
        spawned = []
        original = scheduler_module.subprocess.Popen

        def fake(*args, **kwargs):
            spawned.append(args)
            return _FakeProcess()

        scheduler_module.subprocess.Popen = fake
        self.addCleanup(setattr, scheduler_module.subprocess, "Popen", original)
        identity_patch = patch.object(scheduler_module, "identity", return_value={"pid": 424242, "start": "fixture", "boot": "fixture"})
        identity_patch.start()
        self.addCleanup(identity_patch.stop)
        return spawned

    def test_corrupt_receipt_does_not_stop_other_run_reconciliation(self):
        first = self.add("a", corrupt=True)
        second = self.add("b", receipt={"exit_code": 0, "cancelled": False})
        self.scheduler.tick()
        failed = self.scheduler.store.run("a")
        self.assertEqual(failed["status"], "unknown")
        self.assertIn("Unreadable run receipt", failed["receipt_error"])
        self.assertEqual(self.scheduler.store.run("b")["status"], "succeeded")
        self.assertTrue((second / "reproduction.json").is_file())
        self.assertTrue((first / "exit.json").is_file(), "Corrupt receipt evidence must be preserved")

    def test_corrupt_receipt_is_not_rewritten_every_tick(self):
        self.add("a", corrupt=True)
        self.scheduler.tick()
        first = self.scheduler.store.run("a")
        self.scheduler.tick()
        second = self.scheduler.store.run("a")
        self.assertEqual(first["updated_at"], second["updated_at"])
        self.assertEqual(first["receipt_fingerprint"], second["receipt_fingerprint"])

    def test_rewritten_valid_receipt_is_processed(self):
        directory = self.add("a", corrupt=True)
        self.scheduler.tick()
        (directory / "exit.json").write_text(json.dumps({"exit_code": 1, "cancelled": False}))
        self.scheduler.tick()
        self.assertEqual(self.scheduler.store.run("a")["status"], "failed")

    def test_tick_dispatches_queued_work_even_when_another_receipt_is_corrupt(self):
        self.add("a", corrupt=True, project="other")
        self.add_queued("q", gpu=1)
        spawned = self.patch_spawn()
        self.scheduler.tick()
        self.assertEqual(len(spawned), 1, "Queued work must still start after a bad receipt")
        self.assertEqual(self.scheduler.store.run("q")["status"], "running")

    def test_tick_dispatches_queued_work_without_any_running_run(self):
        self.add_queued("q")
        spawned = self.patch_spawn()
        self.scheduler.tick()
        self.assertEqual(len(spawned), 1)
        self.assertEqual(self.scheduler.store.run("q")["status"], "running")

    def test_dispatch_does_not_hold_store_lock_during_snapshot_verification(self):
        self.add_queued("q")
        entered, release = threading.Event(), threading.Event()

        def verify(run):
            entered.set()
            release.wait(5)

        self.scheduler.verify_snapshot = verify
        self.patch_spawn()
        worker = threading.Thread(target=self.scheduler.dispatch)
        worker.start()
        self.assertTrue(entered.wait(5))
        acquired = threading.Event()

        def acquire_store_lock():
            with self.scheduler.store.lock:
                acquired.set()

        other = threading.Thread(target=acquire_store_lock)
        other.start()
        try:
            self.assertTrue(acquired.wait(2), "dispatch must not hold the Store lock during I/O")
        finally:
            release.set()
            worker.join(5)
            other.join(5)

    def test_cancelled_between_selection_and_launch_is_not_resurrected(self):
        self.add_queued("q")
        self.scheduler.verify_snapshot = lambda run: self.scheduler.store.update(run, status="cancelled")
        spawned = self.patch_spawn()
        self.scheduler.dispatch()
        self.assertEqual(self.scheduler.store.run("q")["status"], "cancelled")
        self.assertNotIn("q", self.scheduler.processes)
        self.assertEqual(spawned, [], "Cancellation before launch claim must prevent Popen itself")

    def test_policy_limit_lowered_during_snapshot_verification_defers_dispatch(self):
        project = self.scheduler.store.get("project", "project")
        project["policy"]["max_concurrent"] = 2
        self.scheduler.store.put("project", project)
        self.add("busy")
        self.add_queued("q", gpu=1)

        def verify(run):
            latest = self.scheduler.store.get("project", "project")
            latest["policy"]["max_concurrent"] = 1
            self.scheduler.store.put("project", latest)

        self.scheduler.verify_snapshot = verify
        spawned = self.patch_spawn()
        self.scheduler.dispatch()
        self.scheduler.dispatch()  # The current lower limit is applied next tick.
        current = self.scheduler.store.run("q")
        self.assertEqual(current["status"], "queued")
        self.assertNotIn("launch_claim", current)
        self.assertFalse((Path(current["directory"]) / "launch.json").exists())
        self.assertEqual(spawned, [])

    def test_authorization_revoked_during_snapshot_verification_defers_dispatch(self):
        self.add_queued("q")

        def verify(run):
            latest = self.scheduler.store.get("project", "project")
            latest["policy"]["engines"] = []
            self.scheduler.store.put("project", latest)

        self.scheduler.verify_snapshot = verify
        spawned = self.patch_spawn()
        self.scheduler.dispatch()
        current = self.scheduler.store.run("q")
        self.assertEqual(current["status"], "queued")
        self.assertNotIn("launch_claim", current)
        self.assertNotIn("q", self.scheduler.processes)
        self.assertEqual(spawned, [])

    def test_worker_added_authorized_input_roots_do_not_invalidate_project_revision(self):
        self.add_queued("q")
        original = self.scheduler.authorize

        def authorize(run):
            project, environment = original(run)
            project["policy"]["input_roots"] = [str(self.scheduler.store.root / "projects" / "project" / "inputs")]
            return project, environment

        self.scheduler.authorize = authorize
        spawned = self.patch_spawn()
        self.scheduler.dispatch()
        self.assertEqual(len(spawned), 1)
        self.assertEqual(self.scheduler.store.run("q")["status"], "running")


if __name__ == "__main__":
    unittest.main()
