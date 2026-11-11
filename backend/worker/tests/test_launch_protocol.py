"""Crash/recovery and cancellation tests; no scientific engine is launched."""
import json
import os
import subprocess
import sqlite3
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute import runner, scheduler as scheduler_module, launch_protocol
from studio_worker.compute.launch_protocol import LAUNCH_SCHEMA, launch_digest, CancellationPoll, CancellationUnavailable
from studio_worker.transport.routes import dispatch
from studio_worker.compute.runs import RunsMixin
from studio_worker.infrastructure.util import atomic_json
from test_scheduler_isolation import _Scheduler, _queued_run, _FakeProcess


OBSERVED = {"pid": 424242, "start": "fixture", "boot": "fixture"}


class _Owner(RunsMixin, _Scheduler):
    pass


class _Child:
    pid = 424243
    returncode = 0

    def poll(self):
        return self.returncode


class LaunchProtocol(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.owner = _Owner(self.root)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: self.owner.close())
        self.directory = self.root / "run"
        (self.directory / "results").mkdir(parents=True)
        run = _queued_run("run", self.directory)
        run["engine"] = "pydyn.md"
        self.owner.store.add_run(run)

    def reopen(self):
        self.owner.close()
        self.owner = _Owner(self.root)

    def claimed(self, **changes):
        launch = {"schema": LAUNCH_SCHEMA, "run_id": "run", "claim": "test-claim",
                  "store_root": str(self.owner.store.root), "command": [sys.executable, "-c", "print('done')"],
                  "environment": dict(os.environ), "max_seconds": 10}
        run = self.owner.store.run("run")
        self.owner.store.update(run, status="unknown", launch_claim={"schema": 1,
            "token": launch["claim"], "payload_sha256": launch_digest(launch)}, **changes)
        atomic_json(self.directory / "launch.json", launch)
        return launch

    def supervise(self, child=None):
        run = self.owner.store.run("run")
        expected = {"store_root": str(self.owner.store.root), "run_id": "run", "claim": run["launch_claim"]["token"]} if run.get("launch_claim") else None
        with patch.object(runner.signal, "signal"), patch.object(runner, "identity", return_value=OBSERVED), patch.object(
                runner.subprocess, "Popen", return_value=child or _Child()) as spawn:
            runner.supervise(self.directory, expected)
        return spawn.call_count

    def test_crash_after_claim_before_launch_file_never_retries(self):
        with patch.object(scheduler_module, "atomic_json", side_effect=SystemExit("crash before launch file")), patch.object(
                scheduler_module.subprocess, "Popen") as spawn:
            with self.assertRaises(SystemExit):
                self.owner.dispatch()
        self.assertEqual(spawn.call_count, 0)
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")
        self.assertTrue(self.owner.store.run("run")["launch_claim"])
        self.reopen()
        with patch.object(scheduler_module.subprocess, "Popen") as retry:
            self.owner.tick()
        self.assertEqual(retry.call_count, 0)

    def test_crash_after_launch_file_before_popen_never_retries(self):
        with patch.object(scheduler_module.subprocess, "Popen", side_effect=SystemExit("crash before Popen")):
            with self.assertRaises(SystemExit):
                self.owner.dispatch()
        self.assertTrue((self.directory / "launch.json").is_file())
        self.reopen()
        with patch.object(scheduler_module.subprocess, "Popen") as retry:
            self.owner.tick()
        self.assertEqual(retry.call_count, 0)
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")

    def test_crash_after_popen_adopts_receipt_without_second_spawn(self):
        def spawned(*args, **kwargs):
            launch = json.loads((self.directory / "launch.json").read_text())
            atomic_json(self.directory / "exit.json", {"exit_code": 0, "cancelled": False,
                        "launch_claim": launch["claim"]})
            return _FakeProcess()
        with patch.object(scheduler_module.subprocess, "Popen", side_effect=spawned) as spawn, patch.object(
                scheduler_module, "identity", side_effect=SystemExit("crash after Popen")):
            with self.assertRaises(SystemExit):
                self.owner.dispatch()
        self.assertEqual(spawn.call_count, 1)
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")
        self.reopen()
        with patch.object(scheduler_module.subprocess, "Popen") as retry:
            self.owner.tick()
        self.assertEqual(retry.call_count, 0)
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")

    def test_spawn_exception_preserves_claim_and_unknown(self):
        with patch.object(scheduler_module.subprocess, "Popen", side_effect=OSError("injected launch error")) as spawn:
            self.owner.tick()
            self.owner.tick()
        self.assertEqual(spawn.call_count, 1)
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")

    def test_unconfirmed_process_identity_stays_unknown(self):
        with patch.object(scheduler_module.subprocess, "Popen", return_value=_FakeProcess()), patch.object(
                scheduler_module, "identity", return_value=None):
            self.owner.dispatch()
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")

    def test_concurrent_dispatchers_share_one_claim(self):
        entered = threading.Barrier(2)
        self.owner.verify_snapshot = lambda run: entered.wait(5)
        with patch.object(scheduler_module.subprocess, "Popen", return_value=_FakeProcess()) as spawn, patch.object(
                scheduler_module, "identity", return_value=OBSERVED):
            threads = [threading.Thread(target=self.owner.dispatch) for _ in range(2)]
            for thread in threads: thread.start()
            for thread in threads: thread.join(5)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(spawn.call_count, 1)

    def test_independent_store_connections_cannot_replace_a_claim(self):
        other = _Owner(self.root)
        self.addCleanup(other.close)
        stale = other.store.run("run")
        first = self.owner.store.claim_launch(self.owner.store.run("run"), {"token": "first"})
        self.assertIsNotNone(first)
        self.assertIsNone(other.store.claim_launch(stale, {"token": "second"}))
        self.assertEqual(other.store.run("run")["launch_claim"]["token"], "first")

    def test_store_claim_cannot_overwrite_concurrent_queued_cancellation(self):
        other = _Owner(self.root)
        self.addCleanup(other.close)
        stale = self.owner.store.run("run")
        other.store.update(other.store.run("run"), status="cancelled")
        self.assertIsNone(self.owner.store.claim_launch(stale, {"token": "too-late"}))
        self.assertEqual(self.owner.store.run("run")["status"], "cancelled")

    def test_dispatch_preserves_cancel_request_made_during_supervisor_spawn(self):
        def spawn(*args, **kwargs):
            self.owner.cancel("run")
            return _FakeProcess()
        with patch.object(scheduler_module.subprocess, "Popen", side_effect=spawn), patch.object(
                scheduler_module, "identity", return_value=OBSERVED), patch("studio_worker.compute.runs.Adapter.cancel", return_value=False):
            self.owner.dispatch()
        self.assertTrue(self.owner.store.run("run")["cancel_requested"])
        self.assertEqual(self.supervise(), 0)
        self.owner.reconcile()
        self.assertEqual(self.owner.store.run("run")["status"], "cancelled")

    def test_legacy_queued_completion_is_adopted_without_resubmission(self):
        atomic_json(self.directory / "exit.json", {"exit_code": 0, "cancelled": False})
        with patch.object(scheduler_module.subprocess, "Popen") as spawn:
            self.owner.tick()
        self.assertEqual(spawn.call_count, 0)
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")

    def test_legacy_queued_launch_file_alone_is_unknown(self):
        atomic_json(self.directory / "launch.json", {"command": ["legacy"]})
        with patch.object(scheduler_module.subprocess, "Popen") as spawn:
            self.owner.tick()
        self.assertEqual(spawn.call_count, 0)
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")

    def test_recovery_adopts_only_matching_live_supervisor_identity(self):
        self.claimed()
        atomic_json(self.directory / "identity.json", {**OBSERVED, "launch_claim": "wrong-claim"})
        with patch.object(scheduler_module, "alive", side_effect=lambda value: value == OBSERVED):
            self.owner.reconcile()
            self.assertEqual(self.owner.store.run("run")["status"], "unknown")
            atomic_json(self.directory / "identity.json", {**OBSERVED, "launch_claim": "test-claim"})
            self.owner.reconcile()
        self.assertEqual(self.owner.store.run("run")["status"], "running")
        self.assertEqual(self.owner.store.run("run")["identity"], OBSERVED)

    def test_receipt_from_another_launch_is_rejected(self):
        self.claimed()
        atomic_json(self.directory / "exit.json", {"exit_code": 0, "launch_claim": "wrong-claim"})
        self.owner.tick()
        run = self.owner.store.run("run")
        self.assertEqual(run["status"], "unknown")
        self.assertIn("launch claim", run["receipt_error"])

    def test_bad_identity_does_not_hide_matching_completion(self):
        self.claimed()
        (self.directory / "identity.json").write_text("{not JSON")
        atomic_json(self.directory / "exit.json", {"exit_code": 0, "launch_claim": "test-claim"})
        self.owner.tick()
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")

    def test_supervisor_marker_prevents_a_second_child_and_preserves_receipts(self):
        self.claimed()
        self.assertEqual(self.supervise(), 1)
        before = (self.directory / "exit.json").read_bytes()
        self.assertEqual(self.supervise(), 0)
        self.assertEqual((self.directory / "exit.json").read_bytes(), before)
        self.owner.reconcile()
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")

    def test_interrupted_supervisor_marker_also_prevents_retry(self):
        self.claimed()
        (self.directory / "supervisor.claim.json").write_text("{interrupted")
        self.assertEqual(self.supervise(), 0)
        self.assertFalse((self.directory / "exit.json").exists())

    def test_modified_launch_payload_is_blocked_before_child_start(self):
        launch = self.claimed()
        launch["command"] = ["changed-after-claim"]
        atomic_json(self.directory / "launch.json", launch)
        self.assertEqual(self.supervise(), 0)
        result = json.loads((self.directory / "exit.json").read_text())
        self.assertIn("claim", result["reason"])
        self.assertNotEqual(result["exit_code"], 0)

    def test_new_claim_cannot_downgrade_to_legacy_by_removing_schema(self):
        launch = self.claimed()
        del launch["schema"]
        atomic_json(self.directory / "launch.json", launch)
        with patch.object(runner.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(ValueError, "persisted claim"):
                self.supervise()
        self.assertEqual(spawn.call_count, 0)

    def test_new_claim_cannot_downgrade_by_stripping_all_protocol_metadata(self):
        launch = self.claimed(cancel_requested=True)
        for field in ("schema", "store_root", "run_id", "claim"):
            del launch[field]
        atomic_json(self.directory / "launch.json", launch)
        with patch.object(runner.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(ValueError, "persisted claim"):
                self.supervise()
        self.assertEqual(spawn.call_count, 0)

    def test_unknown_schema_or_partial_metadata_never_enters_legacy_path(self):
        for extra in ({"schema": "unknown-protocol"}, {"run_id": "run"}):
            atomic_json(self.directory / "launch.json", {"command": ["legacy"], "environment": {}, "max_seconds": 1, **extra})
            with patch.object(runner.subprocess, "Popen") as spawn:
                with self.assertRaisesRegex(ValueError, "legacy execution"):
                    self.supervise()
            self.assertEqual(spawn.call_count, 0)

    def test_pending_cancel_is_durable_and_prevents_child_start_without_identity(self):
        self.claimed()
        with patch("studio_worker.compute.runs.Adapter.cancel", return_value=False):
            result = self.owner.cancel("run")
        self.assertTrue(result["cancel_requested"])
        self.reopen()
        self.assertEqual(self.supervise(), 0)
        self.owner.reconcile()
        self.assertEqual(self.owner.store.run("run")["status"], "cancelled")

    def test_cancel_and_child_gate_have_a_defined_order(self):
        self.claimed()
        entered, release, cancelled, child_stopped = (threading.Event() for _ in range(4))
        class WaitingChild(_Child):
            def poll(self):
                return 0 if child_stopped.is_set() else None
        def spawn(*args, **kwargs):
            entered.set()
            if not release.wait(5): raise RuntimeError("test gate release timed out")
            return WaitingChild()
        def cancel():
            self.owner.cancel("run")
            cancelled.set()
        with patch.object(runner.signal, "signal"), patch.object(runner, "identity", return_value=OBSERVED), patch.object(
                runner.subprocess, "Popen", side_effect=spawn), patch.object(runner.os, "killpg", create=True,
                side_effect=lambda *args: child_stopped.set()), patch("studio_worker.compute.runs.Adapter.cancel", return_value=False):
            supervisor = threading.Thread(target=runner.supervise, args=(self.directory,))
            supervisor.start()
            self.assertTrue(entered.wait(5))
            cancelling = threading.Thread(target=cancel)
            cancelling.start()
            try:
                self.assertFalse(cancelled.wait(.1), "Cancellation cannot pass a child-start transaction already in progress")
            finally:
                release.set()
                supervisor.join(5)
                cancelling.join(5)
        self.assertFalse(supervisor.is_alive())
        self.assertFalse(cancelling.is_alive())
        self.assertTrue(cancelled.is_set())
        self.assertTrue(child_stopped.is_set(), "Detached supervisor must observe the persisted cancellation")
        self.assertTrue(json.loads((self.directory / "exit.json").read_text())["cancelled"])

    def test_legacy_launch_format_still_runs(self):
        atomic_json(self.directory / "launch.json", {"command": ["legacy"], "environment": {}, "max_seconds": 1})
        self.assertEqual(self.supervise(), 1)
        self.assertEqual(json.loads((self.directory / "exit.json").read_text())["exit_code"], 0)

    def v2_claim(self):
        launch = self.claimed()
        launch["protocol_version"] = 2
        host = {"machine": "machine-fixture", "boot": "boot-fixture"}
        self.owner.store.update(self.owner.store.run("run"), launch_claim={"schema": 1, "protocol_version": 2,
            "host": host, "token": launch["claim"], "payload_sha256": launch_digest(launch)})
        atomic_json(self.directory / "launch.json", launch)
        return launch, host

    def test_human_recovery_fences_unstarted_child_and_keeps_claim_evidence(self):
        launch, host = self.v2_claim()
        with patch.object(launch_protocol, "host_identity", return_value=host):
            result = dispatch(self.owner, "POST", "/api/run/reconcile", {"run_id": "run"}, admin=True)
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["reconciliation"]["reason"], "child_never_started")
        self.assertEqual(result["launch_claim"]["token"], launch["claim"])
        self.assertTrue((self.directory / "launch.json").is_file())
        self.assertEqual(self.supervise(), 0, "A late supervisor cannot start the cancelled child")

    def test_recovery_is_desktop_only_and_legacy_missing_files_are_not_proof(self):
        self.claimed()
        with self.assertRaises(PermissionError):
            dispatch(self.owner, "POST", "/api/run/reconcile", {"run_id": "run"}, admin=False)
        result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reconciliation"]["status"], "blocked")

    def test_recorded_child_without_receipt_never_releases_same_boot_resources(self):
        launch, host = self.v2_claim()
        atomic_json(self.directory / "child.start.json", {"claim": launch["claim"], "host": host})
        with patch.object(launch_protocol, "host_identity", return_value=host):
            result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reconciliation"]["reason"], "child_may_be_running")

    def test_reboot_resolution_requires_same_machine_and_matching_child_claim(self):
        launch, host = self.v2_claim()
        atomic_json(self.directory / "child.start.json", {"claim": launch["claim"], "host": host})
        with patch.object(launch_protocol, "host_identity", return_value={"machine": "another-machine", "boot": "new-boot"}):
            self.assertEqual(self.owner.resolve_unknown("run")["status"], "unknown")
        with patch.object(launch_protocol, "host_identity", return_value={**host, "boot": "new-boot"}):
            result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["reconciliation"]["reason"], "worker_rebooted")

    def test_invalid_child_evidence_and_changed_payload_remain_unknown(self):
        launch, host = self.v2_claim()
        with patch.object(launch_protocol, "host_identity", return_value=host):
            for body in ("{invalid", json.dumps({"claim": "wrong", "host": host})):
                (self.directory / "child.start.json").write_text(body)
                self.assertEqual(self.owner.resolve_unknown("run")["status"], "unknown")
            (self.directory / "child.start.json").unlink()
            launch["command"] = ["changed"]
            atomic_json(self.directory / "launch.json", launch)
            self.assertEqual(self.owner.resolve_unknown("run")["reconciliation"]["reason"], "launch_claim_mismatch")

    def test_deleted_run_directory_is_never_proof_of_unstarted_child(self):
        launch, host = self.v2_claim()
        shutil.rmtree(self.directory)
        with patch.object(launch_protocol, "host_identity", return_value=host):
            result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reconciliation"]["reason"], "run_directory_unavailable")

    @unittest.skipUnless(os.name == "posix", "Linux worker symlink boundary")
    def test_linked_run_directory_and_launch_marker_cannot_release_resources(self):
        launch, host = self.v2_claim()
        original = self.root / "original-run"
        self.directory.rename(original)
        self.directory.symlink_to(original, target_is_directory=True)
        with patch.object(launch_protocol, "host_identity", return_value=host):
            self.assertEqual(self.owner.resolve_unknown("run")["reconciliation"]["reason"], "run_directory_unavailable")
            self.directory.unlink(); original.rename(self.directory)
            (self.directory / "child.start.json").symlink_to(self.root / "missing-evidence")
            self.assertEqual(self.owner.resolve_unknown("run")["reconciliation"]["reason"], "launch_evidence_linked")

    def test_deleted_file_cannot_erase_committed_child_start_intent(self):
        launch, host = self.v2_claim()
        with patch.object(launch_protocol, "host_identity", return_value=host):
            with launch_protocol.child_launch_gate(self.directory, launch):
                pass
            fresh = self.owner.store.run("run")
            updated = self.owner.store.compare_update(fresh, error="Controlled reconciliation diagnostic")
            self.assertIsNotNone(updated, "Supervisor and Store must share identical row encoding for CAS")
            self.assertEqual(updated["child_start_intent"], fresh["child_start_intent"])
            (self.directory / "child.start.json").unlink()
            result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reconciliation"]["reason"], "child_may_be_running")

    def test_dispatch_snapshot_cannot_erase_concurrent_child_intent_when_marker_is_deleted(self):
        host = {"machine": "machine-fixture", "boot": "boot-fixture"}
        def child_started_after_scheduler_read(_pid):
            launch = json.loads((self.directory / "launch.json").read_text())
            with launch_protocol.child_launch_gate(self.directory, launch):
                pass  # Controlled launch boundary; no scientific child is run.
            (self.directory / "child.start.json").unlink()
            return None
        with patch.object(scheduler_module, "host_identity", return_value=host), patch.object(
                launch_protocol, "host_identity", return_value=host), patch.object(
                scheduler_module.subprocess, "Popen", return_value=_FakeProcess()), patch.object(
                scheduler_module, "identity", side_effect=child_started_after_scheduler_read):
            self.owner.dispatch()
            recorded = self.owner.store.run("run")
            self.assertIn("child_start_intent", recorded)
            result = self.owner.resolve_unknown("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reconciliation"]["reason"], "child_may_be_running")
        self.assertEqual(result["child_start_intent"], recorded["child_start_intent"])

    def test_cancel_snapshot_cannot_erase_concurrent_child_intent_without_file_marker(self):
        launch, host = self.v2_claim()
        original = self.owner.store.update
        def concurrent_update(run, **changes):
            if changes.get("cancel_requested") and not self.owner.store.run("run").get("child_start_intent"):
                with launch_protocol.child_launch_gate(self.directory, launch):
                    pass
                (self.directory / "child.start.json").unlink()
            return original(run, **changes)
        with patch.object(launch_protocol, "host_identity", return_value=host), patch.object(
                self.owner.store, "update", side_effect=concurrent_update), patch("studio_worker.compute.runs.Adapter.cancel", return_value=False):
            result = self.owner.cancel("run")
            self.assertTrue(result["cancel_requested"])
            self.assertIn("child_start_intent", result)
            repaired = self.owner.resolve_unknown("run")
        self.assertEqual(repaired["status"], "unknown")
        self.assertEqual(repaired["reconciliation"]["reason"], "child_may_be_running")

    def test_stale_reconciliation_cannot_resurrect_a_terminal_run(self):
        for observation in ("live", "missing", "receipt", "malformed"):
            with self.subTest(observation=observation):
                self.claimed(identity=OBSERVED)
                stale = self.owner.store.run("run")
                if observation == "missing": self.owner.store.update(stale, status="running")
                self.owner.store.update(dict(stale), status="cancelled")
                receipt = self.directory / "exit.json"
                receipt.unlink(missing_ok=True)
                if observation == "receipt": atomic_json(receipt, {"exit_code": 0, "launch_claim": "test-claim"})
                if observation == "malformed": receipt.write_text("{invalid")
                with patch.object(scheduler_module, "alive", return_value=observation == "live"):
                    self.owner.reconcile_run(stale)
                self.assertEqual(self.owner.store.run("run")["status"], "cancelled")

    def test_recovery_waits_for_child_gate_and_cannot_release_started_child(self):
        launch, host = self.v2_claim()
        entered, release, recovered = threading.Event(), threading.Event(), threading.Event()
        def child_gate():
            with launch_protocol.child_launch_gate(self.directory, launch):
                entered.set()
                release.wait(5)
        def recover():
            self.owner.resolve_unknown("run")
            recovered.set()
        with patch.object(launch_protocol, "host_identity", return_value=host):
            gate = threading.Thread(target=child_gate); gate.start()
            self.assertTrue(entered.wait(3))
            repair = threading.Thread(target=recover); repair.start()
            try: self.assertFalse(recovered.wait(.1))
            finally:
                release.set(); gate.join(5); repair.join(5)
        self.assertTrue(recovered.is_set())
        self.assertEqual(self.owner.store.run("run")["status"], "unknown")

    def test_legacy_cancel_returns_unknown_and_unconfirmed_without_signalling(self):
        atomic_json(self.directory / "launch.json", {"command": ["legacy"]})
        with patch("studio_worker.compute.runs.Adapter.cancel", return_value=False):
            result = self.owner.cancel("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["cancellation"]["status"], "unconfirmed")
        self.assertFalse(result["cancellation"]["signal_sent"])

    def test_failed_dispatcher_cannot_overwrite_another_committed_claim(self):
        def competing_claim(run):
            self.owner.store.claim_launch(self.owner.store.run("run"), {"token": "another-owner"})
            raise OSError("snapshot reader failed")
        self.owner.verify_snapshot = competing_claim
        with patch.object(scheduler_module.subprocess, "Popen") as spawn:
            self.owner.dispatch()
        result = self.owner.store.run("run")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["launch_claim"]["token"], "another-owner")
        spawn.assert_not_called()

    def test_cancellation_poll_retries_transient_errors_but_not_integrity_failure(self):
        poll = CancellationPoll(budget=2)
        with patch.object(launch_protocol, "cancellation_requested", side_effect=[sqlite3.OperationalError("database is locked"), True]) as read:
            self.assertFalse(poll.read(self.directory, {}, 0))
            self.assertFalse(poll.read(self.directory, {}, .1))
            self.assertEqual(read.call_count, 1)
            self.assertTrue(poll.read(self.directory, {}, .25))
        with patch.object(launch_protocol, "cancellation_requested", side_effect=ValueError("claim mismatch")):
            with self.assertRaisesRegex(ValueError, "claim mismatch"):
                poll.read(self.directory, {}, 1)

    def test_persistent_cancellation_read_failure_has_bounded_retry(self):
        poll = CancellationPoll(budget=2)
        with patch.object(launch_protocol, "cancellation_requested", side_effect=sqlite3.OperationalError("database is locked")):
            self.assertFalse(poll.read(self.directory, {}, 0))
            with self.assertRaises(CancellationUnavailable): poll.read(self.directory, {}, 2)

    def test_transient_read_errors_do_not_disable_time_limit_or_immediately_kill(self):
        self.claimed()
        clock, signals = [0.0], []
        class WaitingChild(_Child):
            returncode = -15
            def poll(self): return -15 if signals else None
        def tick(seconds): clock[0] += seconds
        with patch.object(runner.signal, "signal"), patch.object(runner, "identity", return_value=OBSERVED), patch.object(
                runner.subprocess, "Popen", return_value=WaitingChild()), patch.object(runner.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
                runner.time, "sleep", side_effect=tick), patch.object(runner.os, "killpg", create=True, side_effect=lambda pid, sig: signals.append(sig)), patch.object(
                launch_protocol, "cancellation_requested", side_effect=sqlite3.OperationalError("database is locked")):
            runner.supervise(self.directory)
        self.assertEqual(signals, [runner.signal.SIGTERM])
        self.assertGreaterEqual(clock[0], 10)
        self.assertEqual(json.loads((self.directory / "exit.json").read_text())["reason"], "time_limit")

    def test_poll_retry_still_observes_cancel_and_integrity_errors_fail_closed(self):
        for failure, expected_signal, expected_reason in (
                (sqlite3.OperationalError("database is locked"), runner.signal.SIGTERM, None),
                (ValueError("Launch claim mismatch"), runner.signal.SIGKILL, "Launch claim mismatch")):
            with self.subTest(failure=type(failure).__name__):
                self.claimed()
                for name in ("supervisor.claim.json", "exit.json"):
                    (self.directory / name).unlink(missing_ok=True)
                clock, signals = [0.0], []
                class WaitingChild(_Child):
                    def poll(self): return -15 if signals else None
                    def wait(self): return -15
                def tick(seconds): clock[0] += seconds
                with patch.object(runner.signal, "signal"), patch.object(runner, "identity", return_value=OBSERVED), patch.object(
                        runner.subprocess, "Popen", return_value=WaitingChild()), patch.object(runner.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
                        runner.time, "sleep", side_effect=tick), patch.object(runner.os, "killpg", create=True, side_effect=lambda pid, sig: signals.append(sig)), patch.object(
                        launch_protocol, "cancellation_requested", side_effect=[failure, True]):
                    runner.supervise(self.directory)
                self.assertEqual(signals, [expected_signal])
                self.assertEqual(json.loads((self.directory / "exit.json").read_text())["reason"], expected_reason)

    def test_real_bounded_supervisor_and_child_survive_owner_recreation(self):
        launch = self.claimed()
        launch["command"] = [sys.executable, "-c", "import time; time.sleep(.2); print('lifecycle-only')"]
        run = self.owner.store.run("run")
        self.owner.store.update(run, launch_claim={"schema": 1, "token": launch["claim"], "payload_sha256": launch_digest(launch)})
        atomic_json(self.directory / "launch.json", launch)
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        process = subprocess.Popen([sys.executable, "-m", "studio_worker.runner", str(self.directory)],
                                   env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.reopen()
        stdout, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, (stdout, stderr))
        self.owner.tick()
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")
        self.assertIn("lifecycle-only", (self.directory / "console.log").read_text())

    def test_concurrent_real_supervisors_start_exactly_one_bounded_child(self):
        launch = self.claimed()
        launch["command"] = [sys.executable, "-c", "from pathlib import Path; import time; "
                             "Path('child-starts.txt').open('a').write('started\\n'); time.sleep(.1)"]
        self.owner.store.update(self.owner.store.run("run"), launch_claim={"schema": 1,
            "token": launch["claim"], "payload_sha256": launch_digest(launch)})
        atomic_json(self.directory / "launch.json", launch)
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        processes = [subprocess.Popen([sys.executable, "-m", "studio_worker.runner", str(self.directory)],
                                      env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE) for _ in range(2)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, (stdout, stderr))
        self.assertEqual((self.directory / "results/child-starts.txt").read_text(), "started\n")
        self.owner.tick()
        self.assertEqual(self.owner.store.run("run")["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()
