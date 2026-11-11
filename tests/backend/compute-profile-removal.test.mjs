import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';

const wsl={kind:'wsl',name:'Removal fixture WSL',distribution:'Fixture Linux',root:'/fixture/service',port:19000,intent:'existing'};
const ssh={kind:'ssh',name:'Removal fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',identity_file:'~/.ssh/inert-reference',mode:'interactive'};
function fixture(t){const base=process.env.STUDIO_PROFILE_REMOVAL_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'profile-removal-')),catalog=new Catalog(root),profiles=createComputeProfiles({catalog,initialWsl:wsl});t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {catalog,profiles,root};}

for(const profile of [wsl,ssh])test('removing saved '+profile.kind+' metadata preserves every other catalog domain and profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...profile}),b=f.profiles.save({expectedVersion:0,...ssh,name:'Preserved other connection'});
 for(const kind of ['settings','worker-binding','environment','project','run','shared-terminal','credential-reference'])f.catalog.put(kind,'preserved',{kind,fixture:true});
 const before=f.catalog.db.prepare("SELECT kind,id,data FROM records WHERE kind!='compute-profile' ORDER BY kind,id").all();
 assert.deepEqual(f.profiles.remove({id:a.id,expectedVersion:a.version}),{removed:true,id:a.id,version:a.version});
 assert.throws(()=>f.profiles.read({id:a.id}),/compute_profile_unavailable/);assert.deepEqual(f.profiles.list(),[b]);
 const after=f.catalog.db.prepare("SELECT kind,id,data FROM records WHERE kind NOT IN ('compute-profile','compute-profile-registry') ORDER BY kind,id").all();assert.deepEqual(after,before);
 assert.equal(fs.readdirSync(f.root).some(name=>/key|credential/.test(name)),false);
});

test('stale version refuses removal without writing a seed marker or touching the latest profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),updated=f.profiles.save({id:a.id,expectedVersion:1,...ssh,name:'Newer retained version'});
 assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/compute_profile_changed/);assert.deepEqual(f.profiles.read({id:a.id}),updated);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('removal request is exact, versioned and never accepts transport or credential mutations',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh});
 for(const request of [null,{},[],{id:a.id},{id:a.id,expectedVersion:0},{id:a.id,expectedVersion:1.5},{id:'invalid',expectedVersion:1},{id:a.id,expectedVersion:1,disconnect:true},{id:a.id,expectedVersion:1,deleteRemote:true},{id:a.id,expectedVersion:1,password:'INERT TEST ONLY'}])assert.throws(()=>f.profiles.remove(request),/compute_profile_invalid_request/);
 assert.deepEqual(f.profiles.read({id:a.id}),a);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('missing saved record fails without inventing success or a seed marker',t=>{
 const f=fixture(t);assert.throws(()=>f.profiles.remove({id:'00000000-0000-4000-8000-000000000001',expectedVersion:1}),/compute_profile_unavailable/);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('deleting the last seeded WSL profile stays deleted across registry recreation and database reopen',t=>{
 const f=fixture(t),[a]=f.profiles.list();f.profiles.remove({id:a.id,expectedVersion:a.version});assert.deepEqual(f.profiles.list(),[]);
 const reopened=new Catalog(f.root);try{const again=createComputeProfiles({catalog:reopened,initialWsl:wsl});assert.deepEqual(again.list(),[]);assert.equal(reopened.get('compute-profile-registry','main').initial_wsl_seed_consumed,true);assert.throws(()=>again.read({id:a.id}),/compute_profile_unavailable/);}finally{reopened.db.close();}
});

test('marker write failure rolls back deletion and preserves the saved profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),put=f.catalog.put;
 f.catalog.put=function(kind,...args){if(kind==='compute-profile-registry')throw Error('owned marker fixture failure');return put.call(this,kind,...args);};
 assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/marker fixture failure/);assert.deepEqual(f.profiles.read({id:a.id}),a);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('removal requires a transaction-capable catalog before any mutation',()=>{
 let changes=0;const profiles=createComputeProfiles({catalog:{get:()=>null,list:()=>[],put:()=>changes++,remove:()=>changes++}});
 assert.throws(()=>profiles.remove({id:'00000000-0000-4000-8000-000000000001',expectedVersion:1}),/compute_profile_unavailable/);assert.equal(changes,0);
});

test('unknown or malformed registry marker refuses deletion and preserves both stored records byte for byte',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh});
 for(const marker of [{schema_version:2,initial_wsl_seed_consumed:true,future:'preserve'}, {schema_version:1,initial_wsl_seed_consumed:false},{schema_version:1},'malformed',[],false]){
  f.catalog.put('compute-profile-registry','main',marker);const before=f.catalog.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all();assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/compute_profile_unavailable/);assert.deepEqual(f.catalog.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all(),before);
 }
});

test('a valid existing registry marker is retained without rewriting extension fields',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),marker={schema_version:1,initial_wsl_seed_consumed:true,compatible_note:'retained'};f.catalog.put('compute-profile-registry','main',marker);assert.equal(f.profiles.remove({id:a.id,expectedVersion:1}).removed,true);assert.deepEqual(f.catalog.get('compute-profile-registry','main'),marker);
});
