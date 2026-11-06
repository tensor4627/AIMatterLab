import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
if __name__ == "__main__":
    unittest.main()
