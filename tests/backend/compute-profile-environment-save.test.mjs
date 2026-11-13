import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createComputeProfiles,previewComputeProfileUpdate} from '../../backend/main/compute/compute-profiles.mjs';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {saveComputeProfileWithEnvironment} from '../../backend/main/compute/compute-profile-environment-save.mjs';

const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const content={kind:'ssh',name:'Owned fixture',host:'fixture.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};
async function fixture(t,{live=true,service={status:'disconnected',workflowReady:false}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-environment-save-')),catalog=new Catalog(root),registry=createComputeProfiles({catalog}),profile=registry.save({expectedVersion:0,...content}),events=[],sessionId='owned-session',receipts=new WeakMap();
 let knownVersion=1,binding,gate,prepareError,mainPending=false;
 const facts=()=>({sessionId,resource:{kind:'ssh-terminal',profileId:profile.id,profileVersion:knownVersion},operator:'human',processStatus:'running',alive:true,agentReady:false,authentication:'not_observed',managedRuns:false});
 const terminal={
  inUseProfileIds:()=>live?[profile.id]:[],resourceState:async()=>facts(),
  async prepareProfileEnvironmentUpdate({previous,next}){events.push('prepare');if(prepareError)throw Error(prepareError);const captured={revision:binding.revision(),knownVersion,previous,next};if(gate)await gate;const receipt=Object.freeze({sessionIds:Object.freeze(live?[sessionId]:[])});receipts.set(receipt,captured);return receipt;},
  assertProfileEnvironmentUpdate(receipt){const captured=receipts.get(receipt);if(!captured||captured.revision!==binding.revision()||captured.knownVersion!==knownVersion)throw Error('terminal_context_changed');},
  commitProfileEnvironmentUpdate(receipt,saved){terminal.assertProfileEnvironmentUpdate(receipt);assert.deepEqual(saved,receipts.get(receipt).next);assert.equal(registry.read({id:profile.id}).version,saved.version);knownVersion=saved.version;receipts.delete(receipt);events.push('terminal-commit');return {sessionIds:live?[sessionId]:[]};},
 };
 binding=createComputeResourceBinding({catalog,profiles:registry,terminal});if(live)await binding.activate({kind:'ssh-terminal',profileId:profile.id,profileVersion:1,sessionId});
 const profiles={...registry,save(request){events.push('profile-save');return registry.save(request);}};
 const sshService={peek:()=>structuredClone(service),assertProfileEnvironmentUpdate(){if(mainPending)throw Error('compute_profile_environment_in_use');},profileEnvironmentUpdated(previous,saved){assert.equal(previous.id,saved.id);events.push('service-retire');if(service.profileId===previous.id&&service.profileVersion===previous.version&&service.status==='failed'&&service.terminalAccess==='available')service={status:'disconnected',workflowReady:false};}};
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const request={id:profile.id,expectedVersion:1,...content,serviceEnvironment:{python:'/fixture/venv/bin/python',activation:'source /fixture/venv/bin/activate'}};
 return {catalog,registry,profiles,profile,terminal,binding,sshService,events,sessionId,request,save:requestValue=>saveComputeProfileWithEnvironment({profiles,terminal,resource:binding,sshService,assertIdle:()=>{}},requestValue||request),setGate:value=>gate=value,setPrepareError:value=>prepareError=value,setMainPending:value=>mainPending=value,get knownVersion(){return knownVersion;}};
}

test('explicit environment save retains the selected authenticated terminal reference without reconnecting or granting readiness',async t=>{
 const f=await fixture(t),before=f.binding.peek(),oldTicket=f.binding.capture(),saved=await f.save();assert.equal(saved.version,2);assert.deepEqual(saved.serviceEnvironment,f.request.serviceEnvironment);assert.equal(f.knownVersion,2);assert.deepEqual(f.binding.peek(),{...before,profileVersion:2});assert.throws(()=>f.binding.assertCurrent(oldTicket),/selection_changed/);
 const current=await f.binding.status({});assert.equal(current.sessionId,f.sessionId);assert.equal(current.operator,'human');assert.equal(current.agentReady,false);assert.equal(current.managedRuns,false);assert.equal(current.authentication,'not_observed');assert.deepEqual(f.events,['prepare','profile-save','terminal-commit','service-retire']);
});

for(const status of ['connecting','connected','disconnecting','unknown'])test('environment save refuses an existing '+status+' service before changing a profile or terminal',async t=>{
 const f=await fixture(t);f.sshService.peek=()=>({profileId:f.profile.id,profileVersion:1,status,terminalAccess:status==='unknown'?'unknown':'reserved'});await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.binding.peek().profileVersion,1);assert.equal(f.knownVersion,1);assert.deepEqual(f.events,[]);
});

test('confirmed failed/available service may retire but a still-pending main attempt remains fenced',async t=>{
 const f=await fixture(t);f.sshService.peek=()=>({profileId:f.profile.id,profileVersion:1,status:'failed',terminalAccess:'available'});f.setMainPending(true);await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);f.setMainPending(false);assert.equal((await f.save()).version,2);
});

test('read-only bridge preparation refusal never falls back to saving an unadopted live environment',async t=>{
 const f=await fixture(t);f.setPrepareError('terminal_service_unknown');await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.binding.peek().profileVersion,1);assert.equal(f.knownVersion,1);assert.deepEqual(f.events,['prepare']);
});

test('selection changes during preparation leave environment and terminal proof unchanged',async t=>{
 const f=await fixture(t),gate=deferred();f.setGate(gate.promise);const saving=f.save();await new Promise(resolve=>setImmediate(resolve));f.binding.clear({selectionId:f.binding.peek().selectionId});gate.resolve();await assert.rejects(saving,/terminal_context_changed/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.knownVersion,1);assert.equal(f.binding.peek(),null);assert(!f.events.includes('profile-save'));
});

test('profile edits during preparation keep the newer saved content and reject stale environment adoption',async t=>{
 const f=await fixture(t),gate=deferred();f.setGate(gate.promise);const saving=f.save();await new Promise(resolve=>setImmediate(resolve));f.registry.save({id:f.profile.id,expectedVersion:1,...content,name:'Changed while checking'});gate.resolve();await assert.rejects(saving,/profile_changed/);assert.equal(f.registry.read({id:f.profile.id}).name,'Changed while checking');assert(!f.registry.read({id:f.profile.id}).serviceEnvironment);assert.equal(f.knownVersion,1);assert(!f.events.includes('profile-save'));
});

test('live environment adoption rejects simultaneous host/client metadata changes and missing selected-session proof',async t=>{
 const f=await fixture(t);await assert.rejects(f.save({...f.request,host:'another.invalid'}),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.deepEqual(f.events,[]);
 const original=f.terminal.prepareProfileEnvironmentUpdate;f.terminal.prepareProfileEnvironmentUpdate=async value=>{const receipt=await original(value);return {...receipt,sessionIds:[]};};await assert.rejects(f.save(),/session_mismatch/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.knownVersion,1);
});

test('normalized update preview is side-effect free and preserves an unchanged version',async t=>{
 const f=await fixture(t),next=previewComputeProfileUpdate(f.profile,f.request);assert.equal(next.version,2);assert.deepEqual(next.serviceEnvironment,f.request.serviceEnvironment);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(previewComputeProfileUpdate(f.profile,{id:f.profile.id,expectedVersion:1,...content}).version,1);assert.throws(()=>previewComputeProfileUpdate(f.profile,{...f.request,expectedVersion:2}),/profile_changed/);assert.throws(()=>previewComputeProfileUpdate(f.profile,{...f.request,serviceEnvironment:{python:'python;id',activation:''}}),/invalid_request/);
});
