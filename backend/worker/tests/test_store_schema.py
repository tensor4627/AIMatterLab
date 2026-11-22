import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from select import select
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.infrastructure import store as store_module
from studio_worker.infrastructure.store import SCHEMA_VERSION, Store


def _run(identifier="run-a", project="project"):
    return {"id": identifier, "project_id": project, "idempotency_key": identifier,
            "request_hash": "hash-" + identifier, "status": "draft", "directory": "/tmp/" + identifier}


class StoreSchemaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_new_store_records_schema_version_and_reopen_keeps_it(self):
        store = Store(Path(self.tmp.name) / "service")
        self.assertEqual(store.schema_version, SCHEMA_VERSION)
        store.add_run(_run())
        store.db.close()
        reopened = Store(Path(self.tmp.name) / "service")
        self.addCleanup(reopened.db.close)
        self.assertEqual(reopened.schema_version, SCHEMA_VERSION)
        self.assertEqual(reopened.run("run-a")["status"], "draft")

    @unittest.skipUnless(sys.platform == "linux", "requires Linux flock")
    def test_wsl1_reopens_clean_wal_and_preserves_legacy_state(self):
        root = Path(self.tmp.name) / "service"
        with patch.object(store_module, "_uses_wsl1_database_lock", return_value=False):
            legacy = Store(root)
        try:
            self.assertEqual(legacy.db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
            project = legacy.put("project", {"id": "project", "policy": {"engines": ["pydyn.md"]}})
            run = legacy.add_run({**_run(), "status": "queued"})
            claimed = legacy.claim_launch(run, {"token": "original-owner"})
            events = legacy.events()
            wal_files = [root / filename for filename in ("worker.sqlite-wal", "worker.sqlite-shm")]
            legacy.db.execute("BEGIN IMMEDIATE")
            original = [path.read_bytes() for path in wal_files]
            with patch.object(store_module, "_uses_wsl1_database_lock", return_value=True):
                with self.assertRaisesRegex(sqlite3.OperationalError, "live or unrecovered WAL"):
                    Store(root)
            self.assertEqual([path.read_bytes() for path in wal_files], original)
            legacy.db.rollback()
        finally:
            legacy.db.close()
        with patch.object(store_module, "_uses_wsl1_database_lock", return_value=True):
            reopened = Store(root)
        self.addCleanup(reopened.db.close)
        with reopened.database_access():
            self.assertEqual(reopened.db.execute("PRAGMA journal_mode").fetchone()[0], "delete")
            self.assertEqual(reopened.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(reopened.schema_version, SCHEMA_VERSION)
        self.assertEqual(reopened.get("project", "project"), project)
        self.assertEqual(reopened.run("run-a"), claimed)
        self.assertEqual(reopened.events(), events)

    @unittest.skipUnless(sys.platform == "linux", "requires Linux flock")
    def test_wsl1_serializes_worker_and_supervisor_access_and_recovers_after_exit(self):
        root = Path(self.tmp.name) / "service"
        with patch.object(store_module, "_uses_wsl1_database_lock", return_value=True):
            store = Store(root)
        self.addCleanup(store.db.close)
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        writer_script = r"""
import os
import sqlite3
import sys
from studio_worker.infrastructure import store

store._uses_wsl1_database_lock = lambda: True
print("ready", flush=True)
if sys.stdin.readline() != "write\n":
    sys.exit(1)

try:
    with store.supervisor_connection(sys.argv[1], timeout=.2) as db, db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT INTO events(run,time,data) VALUES ('supervisor',1,'{}')")
        if sys.argv[2] == "crash":
            os._exit(23)
except sqlite3.OperationalError as exc:
    print(str(exc))
    sys.exit(2)
"""

        @contextmanager
        def start_writer(mode):
            command = [sys.executable, "-S", "-c", writer_script, str(root), mode]
            with subprocess.Popen(command, env=environment, text=True, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                try:
                    self.assertTrue(select([process.stdout], [], [], 10)[0], "SQLite writer startup timed out")
                    ready = process.stdout.readline()
                    if ready != "ready\n":
                        stdout, stderr = process.communicate(timeout=5)
                        self.fail(f"SQLite writer failed to initialize: {ready + stdout!r}, {stderr!r}")
                    yield process
                finally:
                    if process.poll() is None:
                        process.kill()

        def run_writer(process, expected_code, expected_stdout=""):
            stdout, stderr = process.communicate("write\n", timeout=5)
            self.assertEqual((process.returncode, stdout.strip()), (expected_code, expected_stdout), stderr)

        # The guard also covers the interval between SQLite transactions.
        with start_writer("commit") as process, store.database_access():
            run_writer(process, 2, "database is locked")
            store.event("worker", {"state": "retained"})

        with start_writer("crash") as process:
            run_writer(process, 23)
        self.assertEqual([event["run"] for event in store.events()], ["worker"])
        with start_writer("commit") as process:
            run_writer(process, 0)
        self.assertEqual([event["run"] for event in store.events()], ["worker", "supervisor"])

    def test_add_run_writes_state_event_in_the_same_transaction(self):
        store = Store(Path(self.tmp.name) / "service")
        self.addCleanup(store.db.close)
        store.add_run(_run())
        events = store.events()
        self.assertEqual([(event["run"], event["state"]) for event in events], [("run-a", "draft")])

    def test_duplicate_run_insert_rolls_back_without_an_extra_event(self):
        store = Store(Path(self.tmp.name) / "service")
        self.addCleanup(store.db.close)
        store.add_run(_run())
        with self.assertRaises(Exception):
            store.add_run(_run())
        self.assertEqual(len(store.events()), 1)
        self.assertEqual(store.run("run-a")["status"], "draft")

    def test_status_changes_keep_their_event(self):
        store = Store(Path(self.tmp.name) / "service")
        self.addCleanup(store.db.close)
        run = store.add_run(_run())
        store.update(run, status="ready")
        store.update(run, status="queued")
        self.assertEqual([event["state"] for event in store.events()], ["draft", "ready", "queued"])

    def test_event_retention_keeps_the_latest_events_only(self):
        store = Store(Path(self.tmp.name) / "service")
        self.addCleanup(store.db.close)
        for index in range(6):
            store.event("run-a", {"index": index})
        removed = store.prune_events(keep=2)
        self.assertEqual(removed, 4)
        self.assertEqual([event["index"] for event in store.events()], [4, 5])
        with self.assertRaises(ValueError):
            store.prune_events(keep=-1)



    def test_non_finite_floats_are_persisted_as_null(self):
        store = Store(Path(self.tmp.name) / "service")
        self.addCleanup(store.db.close)
        store.put("artifact", {"id": "nan-artifact", "finite": 1.5, "nan": float("nan"),
                               "nested": {"inf": float("inf"), "values": [float("-inf"), 2.0]}})
        stored = store.get("artifact", "nan-artifact")
        self.assertEqual(stored["finite"], 1.5)
        self.assertIsNone(stored["nan"])
        self.assertIsNone(stored["nested"]["inf"])
        self.assertEqual(stored["nested"]["values"], [None, 2.0])
        run = store.add_run(_run())
        store.update(run, status="ready", validation={"score": float("nan")})
        self.assertIsNone(store.run("run-a")["validation"]["score"])
        store.event("run-a", {"value": float("nan")})
        self.assertIsNone(store.events()[-1]["value"])

    def test_legacy_project_migration_preserves_bytes_authorization_and_runs(self):
        root = Path(self.tmp.name) / "service"
        store = Store(root)
        legacy = {"id": "p", "name": "Original", "policy": {"engines": ["pydyn.md"], "input_roots": ["/original"], "environments": ["e"]}}
        raw = json.dumps(legacy, indent=2)
        store.db.execute("INSERT INTO objects VALUES('project','p',?)", (raw,))
        store.db.execute("PRAGMA user_version=1"); store.db.commit()
        store.add_run(_run()); store.db.close()
        store = Store(root); self.addCleanup(store.db.close)
        self.assertEqual(store.schema_version, 2)
        self.assertEqual(store.db.execute("SELECT data FROM objects WHERE kind='project'").fetchone()[0], raw)
        self.assertEqual(store.get("project", "p"), {**legacy, "revision": 0})
        self.assertEqual(store.run("run-a"), _run())

    def test_project_revision_rejects_stale_writers_across_connections(self):
        root = Path(self.tmp.name) / "service"
        first, second = Store(root), Store(root)
        self.addCleanup(first.db.close); self.addCleanup(second.db.close)
        original = first.put("project", {"id": "p", "name": "Original", "policy": {"engines": []}})
        stale = second.get("project", "p")
        updated = first.put("project", {**original, "name": "Reviewed new name"})
        self.assertEqual(updated["revision"], 1)
        with self.assertRaisesRegex(ValueError, "project_edit_conflict"):
            second.put("project", {**stale, "policy": {"engines": ["pydyn.md"]}})
        self.assertEqual(first.get("project", "p"), updated)
        self.assertEqual(second.put("project", {**original, "name": "Reviewed new name"}), updated)

    def test_missing_revision_legacy_update_is_only_allowed_before_first_edit(self):
        store = Store(Path(self.tmp.name) / "service"); self.addCleanup(store.db.close)
        original = {"id": "p", "name": "Original"}
        store.put("project", original)
        changed = store.put("project", {**original, "name": "First edit"})
        self.assertEqual(changed["revision"], 1)
        with self.assertRaisesRegex(ValueError, "project_edit_conflict"):
            store.put("project", {**original, "name": "Stale edit"})
        self.assertEqual(store.put("project", {"id": "p", "name": "First edit"}), changed)
        with self.assertRaises(ValueError): store.put_many([("project", original)])

    def test_compare_update_cannot_remove_a_committed_claim(self):
        store = Store(Path(self.tmp.name) / "service"); self.addCleanup(store.db.close)
        run = _run(); run["status"] = "queued"; store.add_run(run)
        stale = store.run(run["id"])
        claimed = store.claim_launch(store.run(run["id"]), {"token": "owner"})
        self.assertIsNone(store.compare_update(stale, status="failed"))
        self.assertEqual(store.run(run["id"]), claimed)

    def test_stale_update_merges_latest_supervisor_evidence_across_connections(self):
        root = Path(self.tmp.name) / "service"
        store, other = Store(root), Store(root)
        self.addCleanup(store.db.close); self.addCleanup(other.db.close)
        run = _run(); run["status"] = "unknown"; store.add_run(run)
        stale = store.run(run["id"])
        intent = {"claim": "fixture", "host": {"machine": "fixture", "boot": "same-boot"}}
        other.update(other.run(run["id"]), child_start_intent=intent)
        for changes in ({"identity": None}, {"cancel_requested": True}, {"reconciliation": {"status": "blocked"}}):
            result = store.update(dict(stale), **changes)
            self.assertEqual(result["child_start_intent"], intent)
            self.assertEqual(other.run(run["id"])["child_start_intent"], intent)
        with self.assertRaisesRegex(ValueError, "cannot be replaced"):
            store.update(store.run(run["id"]), child_start_intent=None)

    def test_stale_update_does_not_resurrect_terminal_state_or_replace_claim(self):
        root = Path(self.tmp.name) / "service"
        store, other = Store(root), Store(root)
        self.addCleanup(store.db.close); self.addCleanup(other.db.close)
        run = _run(); run["status"] = "unknown"; store.add_run(run)
        stale = store.run(run["id"])
        other.update(other.run(run["id"]), status="cancelled")
        with self.assertRaisesRegex(ValueError, "state changed"):
            store.update(stale, status="running")
        self.assertEqual(store.run(run["id"])["status"], "cancelled")
        other.update(other.run(run["id"]), launch_claim={"token": "other"})
        with self.assertRaisesRegex(ValueError, "claim changed"):
            store.update(stale, error="stale dispatch error")
        self.assertNotIn("error", store.run(run["id"]))
if __name__ == "__main__":
    unittest.main()
