import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeServices} from '../../backend/main/compute/managed-compute-services.mjs';
import {createSshServiceRegistration} from '../../backend/main/compute/ssh-service-registration.mjs';
import {schedulerInspectionCapability,schedulerInspectionPath} from '../../contracts/compute/scheduler-observation.mjs';

const profile={id:'worker',kind:'ssh',version:1,name:'Fixture worker',host:'fixture.invalid',username:'fixture',port:22,
 ssh_client:'/usr/bin/ssh',mode:'interactive',proxy_jump:[],via:[]};
const ref={connectionId:'connection',profileId:profile.id,profileVersion:profile.version};
const registrationRef={profileId:ref.profileId,profileVersion:ref.profileVersion};
const resourceId='ssh:'+profile.id;
const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/worker',port:21065,
 runtime:'/owned/worker/runtimes/'+'a'.repeat(20),runtimeId:'a'.repeat(20),
 hostIdentity:{hostname:'remote',uid:1001,machineId:'machine'},runtimeManifestSha256:'a'.repeat(64)};
const tools={status:'ready',count:2};

async function fixture(t,{manifest=true,legacy=false}={}){
 const entries=new Map(),requests=[];
 let now=1000,withdrawn=false;
 const catalog={get:(kind,id)=>structuredClone(entries.get(kind+id)),put:(kind,id,value)=>entries.set(kind+id,structuredClone(value))};
 const profiles={read:()=>structuredClone(profile),list:()=>[structuredClone(profile)]};
 const observed={...health};
 if(!manifest)delete observed.runtimeManifestSha256;
 const registration=createSshServiceRegistration({catalog,profiles,now:()=>++now});
 registration.remember(profile,observed,tools);
 if(legacy)delete entries.get('ssh-service-registration'+profile.id).identityGeneration;
 const scheduler={status:'blocked',observed_at:1000,automatic_retry:false,observations:[
  {scheduler:'slurm',status:'not_found',queues:[]},{scheduler:'lsf',status:'not_found',queues:[]},
 ]};
 const connections={
  state:async()=>({...ref,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}}),
  serviceState:async()=>({...ref,status:'connected',serviceActive:true,channelKind:'private',serviceId:'original-channel',
   service:{...observed,bridge_capabilities:[schedulerInspectionCapability]}}),
  async privateServiceRequest({serviceId,target}){
   assert.equal(serviceId,'original-channel');
   requests.push(target);
   if(target==='/api/health')return {status:200,data:observed};
   assert.equal(target,schedulerInspectionPath);
   return {status:200,data:scheduler};
  },
 };
 const services=createManagedComputeServices({connections,registration});
 const resources=createManagedComputeResources({terminal:{connections},profiles,services,
  authorizeTerminal:()=>withdrawn?'denied':false});
 t.after(()=>resources.stop());
 const agent=createManagedComputeTools({resources});
 const scope={provider:'codex',threadId:'chat',projectId:null,taskId:null,checkCurrent:()=>true};
 await resources.publish(ref);
 await resources.refreshService({connectionId:ref.connectionId});
 resources.recordUserTurn({...scope,text:'Please inspect the queues on Fixture worker',turnId:'user-1'});
 assert.equal((await agent.call('acquire_compute_resource',{resource_id:resourceId,access:'service'},scope)).status,'acquired');
 const inspect=()=>agent.call('inspect_compute_service',{resource_id:resourceId,probe_scheduler:true},scope);
 const countProbes=()=>requests.filter(target=>target===schedulerInspectionPath).length;
 assert.equal((await inspect()).scheduler.status,'blocked');
 assert.equal(countProbes(),1);
 return {registration,observed,inspect,countProbes,remove:()=>entries.clear(),revoke:()=>{withdrawn=true;}};
}

test('verified SSH reuse keeps the original conversation lease through evidence refresh',async t=>{
 for(const legacy of [false,true]){
  const f=await fixture(t,{legacy});
  const before=f.registration.read(registrationRef).registration;
  const {registration:after}=f.registration.rememberVerifiedReuse(profile,before,f.observed,tools);
  assert.deepEqual(after,{...before,revision:before.revision+1,checkedAt:before.checkedAt+1});
  assert.equal((await f.inspect()).scheduler.status,'blocked');
  f.registration.remember(profile,f.observed,{status:'warning',count:0});
  assert.equal((await f.inspect()).scheduler.status,'blocked');
  assert.equal(f.countProbes(),3);
 }
});

test('an original conversation lease rejects actual registration replacements before scheduler dispatch',async t=>{
 for(const [name,patch] of Object.entries({
  host:{hostIdentity:{...health.hostIdentity,machineId:'replacement'}},
  root:{root:'/different/worker'},
  runtime:{runtime:'/different/runtime'},
  runtimeId:{runtimeId:'b'.repeat(20),runtimeManifestSha256:'b'.repeat(64)},
  port:{port:21066},
  manifest:{runtimeManifestSha256:health.runtimeManifestSha256},
 })){
  await t.test(name,async t=>{
   const f=await fixture(t,{manifest:name!=='manifest'});
   f.registration.remember(profile,{...f.observed,...patch},tools);
   await assert.rejects(f.inspect,/managed_compute_service_changed/);
   assert.equal(f.countProbes(),1);
  });
 }
});

test('returning to the same registration identity cannot revive an older service client',async t=>{
 for(const [name,replace] of Object.entries({
  port:f=>f.registration.remember(profile,{...f.observed,port:21066},tools),
  deleted:f=>f.remove(),
  maintenance:f=>f.registration.markMaintenance(profile,'worker_health_invalid'),
 })){
  await t.test(name,async t=>{
   const f=await fixture(t,{legacy:name==='port'});
   replace(f);
   f.registration.remember(profile,f.observed,tools);
   await assert.rejects(f.inspect,/managed_compute_service_changed/);
   assert.equal(f.countProbes(),1);
  });
 }
});

test('evidence refresh never bypasses withdrawal of service inspection authorization',async t=>{
 const f=await fixture(t);
 const expected=f.registration.read(registrationRef).registration;
 f.registration.rememberVerifiedReuse(profile,expected,f.observed,tools);
 f.revoke();
 await assert.rejects(f.inspect,/managed_compute_project_grant_required/);
 assert.equal(f.countProbes(),1);
});
