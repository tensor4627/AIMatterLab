import json
import math
import os
import sqlite3
import sys
import threading
import time
from contextlib import closing, contextmanager, nullcontext
from pathlib import Path
from time import monotonic, sleep

SCHEMA_VERSION = 2


def finite_json(value):
    """Normalize non-finite floats so persisted JSON and HTTP serialization agree."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: finite_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(item) for item in value]
    return value


def encoded(value, *, sort_keys=False):
    return json.dumps(finite_json(value), allow_nan=False, sort_keys=sort_keys)


def _sqlite_sort_key(value):
    """Order JSON scalar fields consistently with SQLite storage classes."""
    if value is None:
        return (0, 0.0, "")
    if isinstance(value, bool):
        return (1, float(int(value)), "")
    if isinstance(value, (int, float)):
        return (1, float(value), "")
    return (2, 0.0, str(value))


def _uses_wsl1_database_lock():
    if sys.platform != "linux":
        return False
    release = os.uname().release.lower()
    return release.startswith("4.4.") and release.endswith("-microsoft")


@contextmanager
def _database_file_lock(root, timeout):
    # WSL 1 can fail to enforce SQLite's POSIX byte-range locks. Its flock
    # locks exclude independent processes and are released when a process dies.
    import fcntl

    with (Path(root) / "worker.sqlite.flock").open("ab") as handle:
        deadline = monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise sqlite3.OperationalError("database is locked") from exc
                sleep(min(.02, remaining))
        yield


def _connect_worker_database(root, *, wsl1, timeout=5, check_same_thread=True):
    path = Path(root) / "worker.sqlite"
    if wsl1 and any(path.with_name(path.name + suffix).exists() for suffix in ("-wal", "-shm")):
        # Legacy clients do not take our flock. Retain their live or unrecovered
        # WAL files and leave the mode change to a clean reopen.
        raise sqlite3.OperationalError(
            "Worker database has live or unrecovered WAL files. Close the original worker and its supervisors "
            "and recover any remaining WAL before reopening on WSL 1."
        )
    connection = sqlite3.connect(path, timeout=timeout, check_same_thread=check_same_thread)
    if wsl1:
        try:
            if connection.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                raise sqlite3.OperationalError("Could not open the WSL 1 worker database in rollback journal mode")
        except BaseException:
            connection.close()
            raise
    return connection


@contextmanager
def supervisor_connection(root, *, timeout):
    wsl1 = _uses_wsl1_database_lock()
    lock = _database_file_lock(root, timeout) if wsl1 else nullcontext()
    with lock, closing(_connect_worker_database(root, wsl1=wsl1, timeout=timeout)) as connection:
        yield connection


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._wsl1 = _uses_wsl1_database_lock()
        self._file_lock_held = False
        with self.database_access():
            self.db = _connect_worker_database(self.root, wsl1=self._wsl1, check_same_thread=False)
            try:
                if not self._wsl1:
                    self.db.execute("PRAGMA journal_mode=WAL")
                self.db.executescript("""
                  CREATE TABLE IF NOT EXISTS objects (
                    kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
                  CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, project TEXT NOT NULL, key TEXT NOT NULL,
                    request_hash TEXT NOT NULL, data TEXT NOT NULL,
                    UNIQUE(project,key));
                  CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT, time REAL, data TEXT);
                """)
                self._json_extract_supported = self._probe_json_extract()
                self._ensure_json_indexes()
                self.db.commit()
                self._migrate()
            except BaseException:
                self.db.close()
                raise

    def _probe_json_extract(self):
        try:
            row = self.db.execute(
                "SELECT json_extract('{\"ok\":1}','$.ok'), json_type('{\"ok\":1}','$.ok'), json_set('{}','$.ok',1)"
            ).fetchone()
        except sqlite3.OperationalError:
            return False
        return bool(row and row[0] == 1 and row[1] == "integer")

    def _ensure_json_indexes(self):
        if not self._json_extract_supported:
            return
        statements = (
            "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(json_extract(data, '$.status'))",
            "CREATE INDEX IF NOT EXISTS idx_objects_kind_status ON objects(kind, json_extract(data, '$.status'))",
            "CREATE INDEX IF NOT EXISTS idx_objects_kind_source ON objects(kind, json_extract(data, '$.sourceId'))",
            "CREATE INDEX IF NOT EXISTS idx_objects_kind_schedule ON objects(kind, json_extract(data, '$.scheduleId'))",
        )
        for statement in statements:
            try:
                self.db.execute(statement)
            except sqlite3.OperationalError:
                # Older SQLite builds may disallow expression indexes or lack deterministic JSON1 flags.
                break

    @contextmanager
    def database_access(self):
        """Protect SQLite operations without extending the file lock to unrelated I/O."""
        with self.lock:
            if not self._wsl1 or self._file_lock_held:
                yield
                return
            with _database_file_lock(self.root, timeout=5):
                self._file_lock_held = True
                try:
                    yield
                finally:
                    self._file_lock_held = False

    def _migrate(self):
        """Versioned schema upgrades. Existing pre-version stores become version 1."""
        with self.database_access():
            current = self.db.execute("PRAGMA user_version").fetchone()[0]
            if current > SCHEMA_VERSION:
                raise RuntimeError(f"Worker store schema {current} is newer than supported {SCHEMA_VERSION}")
            if current < 1:
                # The tables above already exist for legacy stores; version 1 only
                # records the baseline so future migrations can be ordered.
                self.db.execute("PRAGMA user_version=1")
                self.db.commit()
            if current < 2:
                # Project revisions are additive. Legacy rows remain byte-for-byte
                # intact and read as revision zero until their first CAS update.
                self.db.execute("PRAGMA user_version=2")
                self.db.commit()

    @property
    def schema_version(self):
        with self.database_access():
            return self.db.execute("PRAGMA user_version").fetchone()[0]

    def put(self, kind, value):
        if kind == "project":
            return self.put_project(value)
        with self.database_access(), self.db:
            self.db.execute("INSERT OR REPLACE INTO objects VALUES(?,?,?)",
                            (kind, value["id"], encoded(value)))
        return value

    def put_project(self, value):
        """All project writers, including internal workspace writers, use CAS."""
        value = dict(value)
        expected = value.pop("revision", 0)
        if type(expected) is not int or expected < 0:
            raise ValueError("project_edit_conflict: Invalid project revision")
        with self.database_access():
            try:
                self.db.execute("BEGIN IMMEDIATE")
                row = self.db.execute("SELECT data FROM objects WHERE kind='project' AND id=?", (value["id"],)).fetchone()
                previous = json.loads(row[0]) if row else None
                revision = previous.pop("revision", 0) if previous is not None else 0
                if previous is not None and encoded(previous, sort_keys=True) == encoded(value, sort_keys=True):
                    self.db.commit()
                    return {**value, "revision": revision}
                if revision != expected or (previous is None and expected != 0):
                    raise ValueError("project_edit_conflict: Project changed; reload its current revision before saving")
                result = {**value, "revision": revision + 1 if previous is not None else 0}
                self.db.execute("INSERT OR REPLACE INTO objects VALUES('project',?,?)", (value["id"], encoded(result)))
                self.db.commit()
                return result
            except Exception:
                self.db.rollback()
                raise

    def put_task_parameters(self, value):
        # Legacy clients replace the form without sending a roadmap. Merge just that
        # omitted column of the JSON object in the same SQLite write as the form.
        if not self._json_extract_supported:
            payload = dict(value)
            with self.database_access():
                try:
                    if not self.db.in_transaction:
                        self.db.execute("BEGIN IMMEDIATE")
                    if "roadmap" not in payload:
                        row = self.db.execute(
                            "SELECT data FROM objects WHERE kind='task-parameters' AND id=?",
                            (value["id"],),
                        ).fetchone()
                        if row:
                            previous = json.loads(row[0])
                            if isinstance(previous.get("roadmap"), dict):
                                payload["roadmap"] = previous["roadmap"]
                    self.db.execute(
                        "INSERT OR REPLACE INTO objects VALUES('task-parameters',?,?)",
                        (value["id"], encoded(payload)),
                    )
                    self.db.commit()
                except Exception:
                    self.db.rollback()
                    raise
            return value
        with self.database_access(), self.db:
            self.db.execute("""
                INSERT INTO objects(kind,id,data) VALUES ('task-parameters',?,?)
                ON CONFLICT(kind,id) DO UPDATE SET data=CASE
                  WHEN json_type(excluded.data,'$.roadmap') IS NULL
                   AND json_type(objects.data,'$.roadmap')='object'
                  THEN json_set(excluded.data,'$.roadmap',json_extract(objects.data,'$.roadmap'))
                  ELSE excluded.data END""", (value["id"], encoded(value)))
        return value

    def get(self, kind, identifier):
        with self.database_access():
            row = self.db.execute("SELECT data FROM objects WHERE kind=? AND id=?",
                                  (kind, identifier)).fetchone()
        if not row:
            raise ValueError(f"Unknown {kind}: {identifier}")
        value = json.loads(row[0])
        if kind == "project": value.setdefault("revision", 0)
        return value

    def put_many(self, records):
        """Commit related desktop setup records together."""
        if any(kind == "project" for kind, _ in records):
            raise ValueError("Project updates require revision comparison through put_project")
        with self.database_access():
            try:
                self.db.executemany('INSERT OR REPLACE INTO objects VALUES(?,?,?)',
                                    [(kind,value['id'],encoded(value)) for kind,value in records])
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def list(self, kind):
        with self.database_access():
            rows = self.db.execute("SELECT data FROM objects WHERE kind=?", (kind,)).fetchall()
        values = [json.loads(row[0]) for row in rows]
        if kind == "project":
            for value in values: value.setdefault("revision", 0)
        return values

    def db_exists(self, kind, identifier):
        with self.database_access():
            return self.db.execute("SELECT 1 FROM objects WHERE kind=? AND id=?", (kind,identifier)).fetchone() is not None

    def roadmap_ids(self, *, task_id=None, active=False):
        if not self._json_extract_supported:
            with self.database_access():
                rows = self.db.execute("SELECT id, data FROM objects WHERE kind='roadmap-state'").fetchall()
            items = [(identifier, json.loads(raw)) for identifier, raw in rows]
            if active:
                return [identifier for identifier, data in items if data.get("status") in ("running", "unknown")]
            matched = [(identifier, data) for identifier, data in items if data.get("task_id") == task_id]
            matched.sort(key=lambda pair: _sqlite_sort_key(pair[1].get("confirmed_at")), reverse=True)
            return [identifier for identifier, _ in matched]
        query = "SELECT id FROM objects WHERE kind='roadmap-state'"
        if active:
            query += " AND json_extract(data,'$.status') IN ('running','unknown')"
        else:
            query += " AND json_extract(data,'$.task_id')=? ORDER BY json_extract(data,'$.confirmed_at') DESC"
        with self.database_access():
            return [row[0] for row in self.db.execute(query,() if active else (task_id,))]

    def run(self, identifier):
        with self.database_access():
            row = self.db.execute("SELECT data FROM runs WHERE id=?", (identifier,)).fetchone()
        if not row:
            raise ValueError("Unknown run")
        return json.loads(row[0])

    def by_key(self, project, key):
        with self.database_access():
            row = self.db.execute("SELECT data FROM runs WHERE project=? AND key=?",
                                  (project, key)).fetchone()
        return json.loads(row[0]) if row else None

    def runs(self):
        with self.database_access():
            rows = self.db.execute("SELECT data FROM runs ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def runs_by_status(self, *statuses, ascending=False):
        if not statuses:
            return []
        order = "ASC" if ascending else "DESC"
        if not self._json_extract_supported:
            wanted = set(statuses)
            with self.database_access():
                rows = self.db.execute(f"SELECT data FROM runs ORDER BY rowid {order}").fetchall()
            return [item for item in (json.loads(row[0]) for row in rows) if item.get("status") in wanted]
        placeholders = ",".join("?" for _ in statuses)
        with self.database_access():
            rows = self.db.execute(
                f"SELECT data FROM runs WHERE json_extract(data,'$.status') IN ({placeholders}) ORDER BY rowid {order}",
                statuses,
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def objects_by_status(self, kind, *statuses):
        if not statuses:
            return []
        if not self._json_extract_supported:
            wanted = set(statuses)
            return [item for item in self.list(kind) if item.get("status") in wanted]
        placeholders = ",".join("?" for _ in statuses)
        with self.database_access():
            rows = self.db.execute(
                f"SELECT data FROM objects WHERE kind=? AND json_extract(data,'$.status') IN ({placeholders})",
                (kind, *statuses),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def objects_by_source(self, kind, source_id):
        if not self._json_extract_supported:
            return [item for item in self.list(kind) if item.get("sourceId") == source_id]
        with self.database_access():
            rows = self.db.execute(
                "SELECT data FROM objects WHERE kind=? AND json_extract(data,'$.sourceId')=?",
                (kind, source_id),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def schedule_rounds(self, schedule_id, limit=12):
        limit = int(limit)
        if limit <= 0:
            return []
        if not self._json_extract_supported:
            matched = [item for item in self.list("managed-schedule-round") if item.get("scheduleId") == schedule_id]
            matched.sort(key=lambda item: _sqlite_sort_key(item.get("occurrence")), reverse=True)
            return matched[:limit]
        with self.database_access():
            rows = self.db.execute(
                "SELECT data FROM objects WHERE kind='managed-schedule-round' AND json_extract(data,'$.scheduleId')=?"
                " ORDER BY json_extract(data,'$.occurrence') DESC LIMIT ?",
                (schedule_id, limit),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def add_run(self, run):
        with self.database_access():
            try:
                self.db.execute("INSERT INTO runs VALUES(?,?,?,?,?)",
                                (run["id"], run["project_id"], run["idempotency_key"],
                                 run["request_hash"], encoded(run)))
                self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                (run["id"], time.time(), encoded({"state": run["status"]})))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
        return run

    def update(self, run, **changes):
        """Merge explicit changes into the latest row under a cross-process lock.

        Supervisors commit launch evidence through independent SQLite connections;
        a caller's previously read dictionary must never replace that evidence.
        State/claim changes still require the caller's observed ownership.
        """
        with self.database_access():
            try:
                if not self.db.in_transaction:
                    self.db.execute("BEGIN IMMEDIATE")
                row = self.db.execute("SELECT data FROM runs WHERE id=?", (run["id"],)).fetchone()
                if not row:
                    raise ValueError("Unknown run")
                current = json.loads(row[0])
                if current.get("launch_claim") != run.get("launch_claim"):
                    raise ValueError("Run launch claim changed; reread the current run")
                if ("status" in changes and current["status"] != run["status"] and
                        changes["status"] != current["status"]):
                    raise ValueError("Run state changed; reread the current run")
                if (current.get("child_start_intent") is not None and
                        changes.get("child_start_intent", current["child_start_intent"]) != current["child_start_intent"]):
                    raise ValueError("Committed child start evidence cannot be replaced")
                updated = {**current, **changes, "updated_at": time.time()}
                self.db.execute("UPDATE runs SET data=? WHERE id=?", (encoded(updated), run["id"]))
                if "status" in changes:
                    self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                    (run["id"], time.time(), encoded({"state": changes["status"]})))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
            run.clear()
            run.update(updated)
        return run

    def claim_launch(self, run, claim):
        """Commit an at-most-once launch intent, including across connections.

        Compare against the exact previously read row so cancellation or another
        scheduler's claim cannot be overwritten by a stale queued snapshot.
        """
        if run.get("status") != "queued" or run.get("launch_claim"):
            return None
        with self.database_access():
            updated = {**run, "status": "unknown", "launch_claim": claim,
                       "launch_error": "Supervisor launch has not yet been confirmed", "updated_at": time.time()}
            try:
                changed = self.db.execute("UPDATE runs SET data=? WHERE id=? AND data=?",
                                          (encoded(updated), run["id"], encoded(run))).rowcount
                if not changed:
                    self.db.rollback()
                    return None
                self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                (run["id"], time.time(), encoded({"state": "unknown"})))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
            run.update(updated)
            return run

    def compare_update(self, run, **changes):
        """Update only the exact observed run, without stealing another claim."""
        with self.database_access():
            updated = {**run, **changes, "updated_at": time.time()}
            try:
                changed = self.db.execute("UPDATE runs SET data=? WHERE id=? AND data=?",
                                          (encoded(updated), run["id"], encoded(run))).rowcount
                if not changed:
                    self.db.rollback()
                    return None
                if "status" in changes:
                    self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                    (run["id"], time.time(), encoded({"state": changes["status"]})))
                self.db.commit()
                return updated
            except Exception:
                self.db.rollback()
                raise

    def event(self, run, value):
        with self.database_access(), self.db:
            self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                            (run, time.time(), encoded(value)))

    def prune_events(self, keep=200000):
        """Bound the event log without touching runs or objects."""
        if type(keep) is not int or keep < 0:
            raise ValueError("Event retention must be a nonnegative integer")
        with self.database_access(), self.db:
            cursor = self.db.execute(
                "DELETE FROM events WHERE seq <= (SELECT COALESCE(MAX(seq),0)-? FROM events)",
                (keep,))
            return cursor.rowcount

    def events(self, after=0):
        with self.database_access():
            rows = self.db.execute("SELECT seq,run,time,data FROM events WHERE seq>? ORDER BY seq LIMIT 500",
                                  (int(after),)).fetchall()
        return [{"seq": s, "run": r, "time": t, **json.loads(d)} for s, r, t, d in rows]
