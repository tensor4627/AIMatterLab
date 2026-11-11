"""Durable, at-most-once local launch protocol shared by worker and supervisor."""
import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from studio_worker.infrastructure.store import encoded


LAUNCH_SCHEMA = "studio-local-launch-v1"
LAUNCH_EVIDENCE = ("launch.json", "supervisor.claim.json", "identity.json", "child.start.json", "child.json", "exit.json")


def host_identity():
    """Fail closed when this Linux worker's machine/boot identity is unavailable."""
    try:
        machine = Path("/etc/machine-id").read_text().strip()
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        return {"machine": machine, "boot": boot} if machine and boot else None
    except OSError:
        return None


def recovery_proof(run):
    """Called under the child-start SQLite write gate; absence alone is never proof."""
    directory = Path(run["directory"])
    claim = run.get("launch_claim", {})
    if not directory.is_dir() or directory.is_symlink() or directory.resolve() != directory:
        return False, "run_directory_unavailable", "The original run directory is missing or linked; launch absence cannot be verified."
    original_directory = directory.stat()
    if any((directory / name).is_symlink() for name in LAUNCH_EVIDENCE):
        return False, "launch_evidence_linked", "Linked launch evidence cannot prove that the process has stopped."
    here = host_identity()
    if claim.get("protocol_version") != 2 or not claim.get("host") or not here:
        return False, "launch_evidence_incomplete", "Cannot prove that the old process has stopped; launch evidence is retained."
    if claim["host"].get("machine") != here["machine"]:
        return False, "worker_host_changed", "The launch belongs to another machine; inspect it on the original worker."
    launch_path = directory / "launch.json"
    if launch_path.exists():
        launch = json.loads(launch_path.read_text())
        if launch.get("claim") != claim.get("token") or launch_digest(launch) != claim.get("payload_sha256"):
            return False, "launch_claim_mismatch", "Launch evidence does not match the recorded claim."
    marker = directory / "child.start.json"
    started = run.get("child_start_intent")
    try:
        with marker.open(encoding="utf-8") as handle:
            recorded = json.load(handle)
        if started is not None and (recorded.get("claim") != started.get("claim") or recorded.get("host") != started.get("host")):
            return False, "child_evidence_mismatch", "Stored child intent and its file evidence disagree."
        started = recorded
    except FileNotFoundError:
        pass
    if not directory.is_dir() or not os.path.samestat(original_directory, directory.stat()):
        return False, "run_directory_unavailable", "The run directory changed during reconciliation."
    if started is None:
        # v2 commits its child intent in SQLite before Popen. A missing file
        # cannot erase that intent; this same gate fences every late supervisor.
        return True, "child_never_started", "Verified that child creation never started; the launch is now fenced."
    if started.get("claim") != claim.get("token") or started.get("host", {}).get("machine") != here["machine"]:
        return False, "child_evidence_mismatch", "Child-start evidence cannot be verified."
    if started.get("host", {}).get("boot") and started["host"]["boot"] != here["boot"]:
        return True, "worker_rebooted", "Verified a new boot on the original machine; the old processes cannot still be running."
    return False, "child_may_be_running", "Child creation was recorded without a completion receipt; the process may still be running."


def launch_digest(launch):
    return hashlib.sha256(json.dumps(launch, sort_keys=True).encode("utf-8")).hexdigest()


def uses_launch_protocol(launch, expected=None):
    """Only genuine legacy launches may omit the protocol.

    New schedulers also pass the committed claim outside launch.json, so removal
    of all serialized protocol fields still cannot downgrade their supervisor.
    """
    fields = ("store_root", "run_id", "claim")
    if expected is not None:
        if launch.get("schema") != LAUNCH_SCHEMA or any(launch.get(key) != expected[key] for key in fields):
            raise ValueError("Launch protocol does not match the scheduler's persisted claim")
        return True
    if launch.get("schema") == LAUNCH_SCHEMA:
        if not all(isinstance(launch.get(key), str) and launch[key] for key in fields):
            raise ValueError("Launch protocol metadata is incomplete")
        return True
    if "schema" in launch or any(key in launch for key in fields):
        raise ValueError("Unknown or incomplete launch protocol cannot use legacy execution")
    return False


def has_launch_evidence(run):
    directory = Path(run["directory"])
    return bool(run.get("launch_claim")) or any((directory / name).exists() for name in LAUNCH_EVIDENCE)


def claim_supervisor(directory, launch):
    """Never delete this exclusive marker, including after an interrupted write."""
    try:
        with (Path(directory) / "supervisor.claim.json").open("x", encoding="utf-8") as handle:
            json.dump({"schema": LAUNCH_SCHEMA, "claim": launch["claim"], "pid": os.getpid()}, handle)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        return False
    return True


def read_claimed_run(connection, directory, launch):
    if not uses_launch_protocol(launch):
        raise ValueError("Persisted launch claim required")
    row = connection.execute("SELECT data FROM runs WHERE id=?", (launch["run_id"],)).fetchone()
    if not row:
        raise ValueError("Launch run is unavailable")
    run = json.loads(row[0])
    claim = run.get("launch_claim", {})
    if (claim.get("token") != launch["claim"] or claim.get("payload_sha256") != launch_digest(launch) or
            Path(run["directory"]).resolve() != Path(directory).resolve()):
        raise ValueError("Launch claim does not match the persisted run")
    return run


@contextmanager
def child_launch_gate(directory, launch):
    """Serialize child start with cancellation; keep legacy live runs compatible.

    A new supervisor may start its child only once, for its persisted claim. The
    SQLite write lock covers the last cancellation check and Popen; cancellation
    therefore happens either before the child start or after it, never between
    the check and its corresponding process creation.
    """
    if not uses_launch_protocol(launch):
        yield None
        return
    connection = sqlite3.connect(Path(launch["store_root"]) / "worker.sqlite", timeout=10)
    try:
        connection.execute("BEGIN IMMEDIATE")
        run = read_claimed_run(connection, directory, launch)
        if run["status"] not in ("running", "unknown") or run.get("cancel_requested"):
            raise InterruptedError("Cancelled or inactive before child launch")
        if launch.get("protocol_version") == 2:
            if run.get("child_start_intent"):
                raise ValueError("Child launch has already been claimed")
            intent = {"claim": launch["claim"], "host": host_identity(), "started_at": time.time()}
            # Commit BEFORE process creation. A crash or deleted evidence file
            # can never roll this durable intent back into 'never started'.
            run["child_start_intent"] = intent
            connection.execute("UPDATE runs SET data=? WHERE id=?", (encoded(run), run["id"]))
            connection.commit()
            connection.execute("BEGIN IMMEDIATE")
            run = read_claimed_run(connection, directory, launch)
            if run["status"] not in ("running", "unknown") or run.get("cancel_requested"):
                raise InterruptedError("Cancelled or inactive before child launch")
            with (Path(directory) / "child.start.json").open("x", encoding="utf-8") as handle:
                json.dump(intent, handle)
                handle.flush()
                os.fsync(handle.fileno())
            if os.name == "posix":
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(descriptor)
                finally: os.close(descriptor)
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def cancellation_requested(directory, launch):
    if not uses_launch_protocol(launch):
        return False
    connection = sqlite3.connect(Path(launch["store_root"]) / "worker.sqlite", timeout=.1)
    try:
        run = read_claimed_run(connection, directory, launch)
    finally:
        connection.close()
    return run.get("cancel_requested", False) or run["status"] not in ("running", "unknown")


class CancellationUnavailable(RuntimeError):
    pass


class CancellationPoll:
    """Retry transient storage failures without disabling time limits or signals."""
    def __init__(self, budget=15):
        self.budget, self.first_error, self.next_check, self.failures = budget, None, 0, 0
        self.diagnostic = None

    def read(self, directory, launch, now):
        if now < self.next_check:
            return False
        try:
            result = cancellation_requested(directory, launch)
        except (sqlite3.OperationalError, OSError) as exc:
            code = getattr(exc, "sqlite_errorcode", None)
            transient = isinstance(exc, OSError) or (code is not None and code & 255 in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_IOERR, sqlite3.SQLITE_CANTOPEN)) or str(exc).lower() in ("database is locked", "database table is locked")
            if not transient:
                raise
            if self.first_error is None: self.first_error = now
            self.failures += 1
            self.diagnostic = {"reason": "cancellation_read_retry", "failures": self.failures, "error": str(exc)[:200]}
            if now - self.first_error >= self.budget:
                raise CancellationUnavailable("Cancellation state unavailable after bounded retries") from exc
            self.next_check = now + min(2, .25 * 2 ** min(self.failures - 1, 3))
            return False
        self.first_error, self.failures, self.next_check = None, 0, now + .1
        return result
