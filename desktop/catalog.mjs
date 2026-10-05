import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export class Catalog {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'catalog.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))');
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);
    return row ? JSON.parse(row.data) : null;
  }
  put(kind,id,data) {
    this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(kind,id,JSON.stringify(data));
    return data;
  }
  list(kind) {
    return this.db.prepare('SELECT id,data FROM records WHERE kind=?').all(kind).map(r => ({ id:r.id, ...JSON.parse(r.data) }));
  }
}
