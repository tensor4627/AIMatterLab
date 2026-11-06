import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA_VERSION = 1


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "worker.sqlite", check_same_thread=False)
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
        self.db.commit()
        self._migrate()

    def _migrate(self):
        """Versioned schema upgrades. Existing pre-version stores become version 1."""
        with self.lock:
            current = self.db.execute("PRAGMA user_version").fetchone()[0]
            if current > SCHEMA_VERSION:
                raise RuntimeError(f"Worker store schema {current} is newer than supported {SCHEMA_VERSION}")
            if current < 1:
                # The tables above already exist for legacy stores; version 1 only
                # records the baseline so future migrations can be ordered.
                self.db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                self.db.commit()

    @property
    def schema_version(self):
        with self.lock:
            return self.db.execute("PRAGMA user_version").fetchone()[0]

    def put(self, kind, value):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO objects VALUES(?,?,?)",
                            (kind, value["id"], json.dumps(value)))
            self.db.commit()
        return value

    def get(self, kind, identifier):
        with self.lock:
            row = self.db.execute("SELECT data FROM objects WHERE kind=? AND id=?",
                                  (kind, identifier)).fetchone()
        if not row:
            raise ValueError(f"Unknown {kind}: {identifier}")
        return json.loads(row[0])

    def put_many(self, records):
        """Commit related desktop setup records together."""
        with self.lock:
            try:
                self.db.executemany('INSERT OR REPLACE INTO objects VALUES(?,?,?)',
                                    [(kind,value['id'],json.dumps(value)) for kind,value in records])
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def list(self, kind):
        with self.lock:
            rows = self.db.execute("SELECT data FROM objects WHERE kind=?", (kind,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def run(self, identifier):
        with self.lock:
            row = self.db.execute("SELECT data FROM runs WHERE id=?", (identifier,)).fetchone()
        if not row:
            raise ValueError("Unknown run")
        return json.loads(row[0])

    def by_key(self, project, key):
        with self.lock:
            row = self.db.execute("SELECT data FROM runs WHERE project=? AND key=?",
                                  (project, key)).fetchone()
        return json.loads(row[0]) if row else None

    def runs(self):
        with self.lock:
            rows = self.db.execute("SELECT data FROM runs ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def add_run(self, run):
        with self.lock:
            try:
                self.db.execute("INSERT INTO runs VALUES(?,?,?,?,?)",
                                (run["id"], run["project_id"], run["idempotency_key"],
                                 run["request_hash"], json.dumps(run)))
                self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                (run["id"], time.time(), json.dumps({"state": run["status"]})))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
        return run

    def update(self, run, **changes):
        with self.lock:
            run.update(changes, updated_at=time.time())
            try:
                self.db.execute("UPDATE runs SET data=? WHERE id=?", (json.dumps(run), run["id"]))
                if "status" in changes:
                    self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                                    (run["id"], time.time(), json.dumps({"state": changes["status"]})))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
        return run

    def event(self, run, value):
        with self.lock:
            self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                            (run, time.time(), json.dumps(value)))
            self.db.commit()

    def prune_events(self, keep=200000):
        """Bound the event log without touching runs or objects."""
        if type(keep) is not int or keep < 0:
            raise ValueError("Event retention must be a nonnegative integer")
        with self.lock:
            cursor = self.db.execute(
                "DELETE FROM events WHERE seq <= (SELECT COALESCE(MAX(seq),0)-? FROM events)",
                (keep,))
            self.db.commit()
            return cursor.rowcount

    def events(self, after=0):
        with self.lock:
            rows = self.db.execute("SELECT seq,run,time,data FROM events WHERE seq>? ORDER BY seq LIMIT 500",
                                  (int(after),)).fetchall()
        return [{"seq": s, "run": r, "time": t, **json.loads(d)} for s, r, t, d in rows]
