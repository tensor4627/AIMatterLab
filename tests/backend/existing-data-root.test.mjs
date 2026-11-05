import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EXISTING_DATA_ROOT_READ,inspectExistingDataRoot} from "../../backend/main/compute/existing-worker.mjs";
const exec=promisify(execFile),python=process.env.STUDIO_TEST_PYTHON||'python';
const setup=String.raw`import tempfile,sqlite3,sys,os,json
from pathlib import Path
from unittest.mock import patch
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary).resolve();db=root/'worker.sqlite';mode=sys.argv[1];schemaMode=sys.argv[2]
 if mode!='missing':
  fixtureDb=sqlite3.connect(db)
  if mode in ('valid-wal','wal-only'):fixtureDb.execute('PRAGMA journal_mode=WAL')
  if mode!='wrong':fixtureDb.executescript('CREATE TABLE objects(kind TEXT,id TEXT,data TEXT); CREATE TABLE runs(id TEXT,project TEXT,key TEXT,request_hash TEXT,data TEXT);')
  else:fixtureDb.execute('CREATE TABLE unrelated(value TEXT)')
  fixtureDb.commit()
  if mode!='wal-only':fixtureDb.close()
 before={p.name:p.read_bytes() for p in root.iterdir()}
 sys.argv=['proof',str(root),schemaMode]
 if not hasattr(os,'getuid'):os.getuid=lambda:root.stat().st_uid
 original=Path.is_symlink
 with patch.object(Path,'is_symlink',lambda p:True if mode=='symlink' and p==db else original(p)):
  exec(PAYLOAD)
 after={p.name:p.read_bytes() for p in root.iterdir()}
 assert before==after,'Existing-root inspection wrote data'
 if mode=='wal-only':fixtureDb.close()
`;
for(const mode of ['valid','valid-wal','wal-only','missing','wrong','symlink'])test('exact existing database preflight is read-only: '+mode,async()=>{
 const {stdout}=await exec(python,['-B','-c','PAYLOAD='+JSON.stringify(EXISTING_DATA_ROOT_READ)+'\n'+setup,mode,'schema'],{windowsHide:true,timeout:6000,maxBuffer:8192});assert.equal(JSON.parse(stdout.trim()).status,mode.startsWith('valid')?'available':'unavailable');
});
test('existing database check uses exact argv and sanitizes errors',async()=>{
 let call;const settings={distribution:'Ubuntu',workerRoot:'/owned/existing'};assert.deepEqual(await inspectExistingDataRoot(settings,{execute:async(...args)=>{call=args;return {stdout:'{"status":"available"}'};}}),{status:'available'});assert.equal(call[0],'wsl.exe');assert.deepEqual(call[1].slice(0,6),['-d','Ubuntu','--','python3','-B','-c']);assert.equal(call[1].at(-2),settings.workerRoot);assert.equal(call[2].timeout,6000);assert.deepEqual(await inspectExistingDataRoot(settings,{execute:async()=>{throw Error('private-path-token');}}),{status:'unavailable'});
});

test('WAL-only schema still permits basic path proof for verified live attachment without writing sidecars',async()=>{
 const {stdout}=await exec(python,['-B','-c','PAYLOAD='+JSON.stringify(EXISTING_DATA_ROOT_READ)+'\n'+setup,'wal-only','path'],{windowsHide:true,timeout:6000,maxBuffer:8192});assert.equal(JSON.parse(stdout.trim()).status,'available');
});
