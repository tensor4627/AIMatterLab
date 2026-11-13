import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSshServiceResources} from '../../backend/main/compute/ssh-service-resources.mjs';
import {bundledWorkerRuntimeId} from '../../backend/main/compute/worker-service-version.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ssh-resources-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const name of ['bootstrap.py','install.py','runtime_resources.py','ssh_service_bootstrap.py','ssh_service_bridge.py','studio_worker/server.py','studio_worker/engine_contracts.json','studio_worker/pygas-editor-hints.json','studio_worker/tool_package.schema.json']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),name.endsWith('.json')?'{}':'# inert '+name+'\n');}return root;}
test('fixed source manifest matches runtime identity and carries no runtime data or sibling engines',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'connection.json'),'PRIVATE NEVER TRANSFER');fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'tests','private.py'),'PRIVATE NEVER TRANSFER');
 const result=prepareSshServiceResources(root,{profileId:'owned-profile'});assert.equal(result.payload.expected_runtime_id,bundledWorkerRuntimeId(root));assert.equal(result.source,'# inert ssh_service_bootstrap.py\n');assert(!JSON.stringify(result).includes('PRIVATE NEVER TRANSFER'));assert(result.payload.port>=20000&&result.payload.port<50000);
 for(const file of result.payload.files)assert.equal(createHash('sha256').update(Buffer.from(file.base64,'base64')).digest('hex'),file.sha256);
});

test('explicit released worker binding retains exact legacy bytes after the Python metadata update',()=>{
 const source=path.resolve('backend/worker'),current=prepareSshServiceResources(source,{profileId:'owned-profile'}),legacy=prepareSshServiceResources(source,{profileId:'owned-profile',expectedRuntimeId:'62034ec6cfc1428aaa4d'});
 assert.equal(legacy.payload.expected_runtime_id,'62034ec6cfc1428aaa4d');assert.equal(current.payload.files.length,legacy.payload.files.length);
 const changed=current.payload.files.filter((row,index)=>row.base64!==legacy.payload.files[index].base64);assert.deepEqual(changed.map(row=>row.path),['pyproject.toml']);
 assert(Buffer.from(legacy.payload.files.find(row=>row.path==='pyproject.toml').base64,'base64').toString().includes('requires-python = ">=3.10"'));
 assert.throws(()=>prepareSshServiceResources(source,{profileId:'owned-profile',expectedRuntimeId:'f'.repeat(20)}),/resources_changed/);
});
test('missing worker entry fails instead of sending a partial install',t=>{const root=fixture(t);fs.unlinkSync(path.join(root,'runtime_resources.py'));assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_incomplete/);});
test('linked source trees and arbitrary profile paths cannot enter the trusted bundle',t=>{
 const root=fixture(t);assert.throws(()=>prepareSshServiceResources(root,{profileId:'../escape'}),/resources_invalid/);const alias=path.join(root,'linked');fs.symlinkSync(path.join(root,'studio_worker'),alias,'junction');assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_invalid/);
});
test('manifest limits match the remote installer before any payload is sent',t=>{
 const root=fixture(t);assert.throws(()=>prepareSshServiceResources(root,{profileId:'a'.repeat(101)}),/resources_invalid/);
 for(let index=0;index<4;index++)fs.writeFileSync(path.join(root,'studio_worker','bounded-'+index+'.py'),Buffer.alloc(2*1024*1024,120));
 assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_invalid/);
});

test('versioned SSH transport is separate from the immutable worker and cannot rewrite existing task provenance',t=>{
 const root=fixture(t),transport=fs.mkdtempSync(path.join(os.tmpdir(),'studio-transport-source-'));t.after(()=>fs.rmSync(transport,{recursive:true,force:true}));
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned loader one\n');fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge one\n');
 const old=prepareSshServiceResources(root,{profileId:'owned-profile'}),one=prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport});
 assert.deepEqual(one.payload,old.payload);assert.equal(one.source,'# owned loader one\n');assert.equal(one.transport.sha256,createHash('sha256').update(one.transport.source).digest('hex'));
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned loader two\n');fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge two\n');const next=prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport});assert.equal(next.payload.expected_runtime_id,old.payload.expected_runtime_id);assert.notEqual(next.transport.sha256,one.transport.sha256);
});

test('linked or oversized separate transport source fails before an SSH payload is published',t=>{
 const root=fixture(t),transport=fs.mkdtempSync(path.join(os.tmpdir(),'studio-transport-bounds-'));t.after(()=>fs.rmSync(transport,{recursive:true,force:true}));
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned\n');fs.writeFileSync(path.join(transport,'bridge.py'),Buffer.alloc(128*1024+1,120));assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport}),/resources_invalid/);
 fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge\n');const linked=path.join(transport,'linked');fs.symlinkSync(transport,linked,'junction');assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:linked}),/resources_invalid/);
});
