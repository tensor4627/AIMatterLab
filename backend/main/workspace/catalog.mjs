import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {sanitizeProtocolTranscript} from '../../../contracts/agent/transcript-sanitizer.mjs';
const transcriptKind=kind=>/^(?:(?:compatible|deepseek)(?:-native|-legacy|-dsh)?-history|compatible-codex-thread|thread|agent-thread|conversation-context-history)$/.test(kind);
function transcriptRecord(kind,value){
 if(!transcriptKind(kind))return value;
 const {id,threadId,thread_id,provider,...content}=value;
 return {...sanitizeProtocolTranscript(content,[],{kind}),...id!==undefined?{id}:{},...threadId!==undefined?{threadId}:{},...thread_id!==undefined?{thread_id}:{},...provider!==undefined?{provider}:{}};
}
export class Catalog {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'catalog.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))');
    this.db.exec('CREATE TABLE IF NOT EXISTS record_recovery(kind TEXT,id TEXT,data TEXT,error TEXT,detected_at INTEGER,PRIMARY KEY(kind,id,data))');
  }
  decode(kind,id,data) {
    try {
      const value=JSON.parse(data);
      if(transcriptKind(kind)&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('Expected a transcript object record');
      const clean=transcriptRecord(kind,value);
      if(JSON.stringify(clean)!==data&&transcriptKind(kind))this.put(kind,id,clean);
      return clean;
    } catch(error) {
      this.db.prepare('INSERT OR IGNORE INTO record_recovery VALUES(?,?,?,?,?)').run(kind,id,data,String(error.message).slice(0,300),Date.now());
      throw Object.assign(Error('Stored '+kind+' record is damaged; original preserved for recovery'),{code:'catalog_record_corrupt',cause:error});
    }
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);
    return row ? this.decode(kind,id,row.data) : null;
  }
  put(kind,id,data) {
    const clean=transcriptRecord(kind,data);
    this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(kind,id,JSON.stringify(clean));
    return clean;
  }
  remove(kind,id){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
  keys(kind){return this.db.prepare('SELECT id FROM records WHERE kind=?').all(kind).map(row=>row.id);}
  transaction(work){this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  list(kind) {
    const values=[];
    for(const row of this.db.prepare('SELECT id,data FROM records WHERE kind=?').all(kind)){
      try{const value=this.decode(kind,row.id,row.data);if(!value||typeof value!=='object'||Array.isArray(value)){this.db.prepare('INSERT OR IGNORE INTO record_recovery VALUES(?,?,?,?,?)').run(kind,row.id,row.data,'Expected an object list record',Date.now());continue;}values.push({id:row.id,...value});}catch(error){if(error.code!=='catalog_record_corrupt')throw error;}
    }
    return values;
  }
  recovery(){return this.db.prepare('SELECT kind,id,error,detected_at FROM record_recovery ORDER BY detected_at').all();}
}
