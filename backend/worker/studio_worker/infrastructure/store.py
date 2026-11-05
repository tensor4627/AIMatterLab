import json
import sqlite3
import threading
import time
from pathlib import Path


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
            self.db.execute("INSERT INTO runs VALUES(?,?,?,?,?)",
                            (run["id"], run["project_id"], run["idempotency_key"],
                             run["request_hash"], json.dumps(run)))
            self.db.commit()
        self.event(run["id"], {"state": run["status"]})
        return run

    def update(self, run, **changes):
        with self.lock:
            run.update(changes, updated_at=time.time())
            self.db.execute("UPDATE runs SET data=? WHERE id=?", (json.dumps(run), run["id"]))
            self.db.commit()
        if "status" in changes:
            self.event(run["id"], {"state": changes["status"]})
        return run

    def event(self, run, value):
        with self.lock:
            self.db.execute("INSERT INTO events(run,time,data) VALUES(?,?,?)",
                            (run, time.time(), json.dumps(value)))
            self.db.commit()

    def events(self, after=0):
        with self.lock:
            rows = self.db.execute("SELECT seq,run,time,data FROM events WHERE seq>? ORDER BY seq LIMIT 500",
                                  (int(after),)).fetchall()
        return [{"seq": s, "run": r, "time": t, **json.loads(d)} for s, r, t, d in rows]
