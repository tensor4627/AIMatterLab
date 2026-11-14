import test from 'node:test';import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {deltaBundle} from '../../desktop/platform/terminal-service/worker-delta.mjs';
const row=(path,text)=>{const bytes=Buffer.from(text);return {path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};};
const meta=({base64,...value})=>value;
test('delta inventory chooses only known changed or added source bytes and declares the complete target',()=>{
 const files=[row('bootstrap.py','base'),row('studio_worker/changed.py','updated'),row('studio_worker/added.py','added')],payload={schema_version:1,profile_id:'owned',port:23456,expected_runtime_id:'a'.repeat(20),files};
 const delta=deltaBundle(payload,[meta(files[0]),meta(row(files[1].path,'old')),meta(row('studio_worker/deleted.py','old'))]);
 assert.deepEqual(delta.changedPaths,['studio_worker/changed.py','studio_worker/added.py']);assert.equal(delta.sourceBytes,12);
 const raw=gunzipSync(delta.packed),value=JSON.parse(raw);assert.deepEqual(value.files,files.slice(1));assert.deepEqual(value.manifest,files.map(meta));assert.equal(delta.end.uncompressed_sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(delta.end.size,delta.packed.length);
});
test('matching hashes transfer zero source bytes; malformed or duplicate inventories fail closed',()=>{
 const files=[row('bootstrap.py','unchanged')],payload={files};assert.equal(deltaBundle(payload,files.map(meta)).sourceBytes,0);
 for(const inventory of [null,Array(513).fill(meta(files[0])),[meta(files[0]),meta(files[0])],[{...meta(files[0]),sha256:'x'}],[{...meta(files[0]),size:-1}],[{...meta(files[0]),base64:'untrusted'}]])assert.throws(()=>deltaBundle(payload,inventory),/service_protocol_failed/);
});
