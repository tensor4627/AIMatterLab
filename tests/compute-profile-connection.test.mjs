import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputeConnection} from '../desktop/compute-connection.mjs';
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({selectedTask=true,intent='existing',present=true,inventoryWait}={}){
 let profile={id:'profile-one',version:2,kind:'wsl',name:'Saved test service',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent},epoch=1,selected=selectedTask?{provider:'codex',threadId:'fixture-thread',taskId:'fixture-task'}:null,config={distribution:'Default',workerRoot:'/default',workerPort:8767,autoDiscoverCompute:false},runtime={path:'/fixture/runtime'},last=null;
 const task={id:'fixture-task',provider:'codex',threadId:'fixture-thread',name:'Original task',authoring:{workerBinding:{distribution:'Original Linux',root:'/original',port:9081}}},original=structuredClone(task),calls=[];
 const worker={connection:null,connectionEpoch:0,bindingIntent:0,matchesTarget:t=>!!worker.connection&&worker.identity.root===t.workerRoot&&worker.identity.distribution===t.distribution&&worker.connectionTarget.port===t.workerPort,close(){calls.push('close');this.connection=null;this.connectionEpoch++;},readExisting:async()=>({status:'connected'}),async restore(t){calls.push('restore');if(present){this.identity={root:t.workerRoot,distribution:t.distribution};this.connectionTarget={port:t.workerPort};this.connection={};return {status:'connected'};}return {status:'disconnected'};},async connect(t){calls.push('start');this.bindingIntent++;this.connectionEpoch++;this.identity={root:t.workerRoot,distribution:t.distribution};this.connectionTarget={port:t.workerPort};this.connection={};},async request(){calls.push('discovery');return {identity:'fixture',entries:[]};}};
 const api=createComputeConnection({worker,profiles:{read:({id})=>{assert.equal(id,profile?.id||'profile-one');return structuredClone(profile);}},records:{read:()=>structuredClone(task)},catalog:{get:kind=>kind==='worker-binding'?last:null,put(){throw Error('Task binding must not change');}},settings:()=>config,selection:()=>selected,selectionEpoch:()=>epoch,source:()=>runtime,inventory:async()=>{if(inventoryWait)await inventoryWait;return ['Fixture Linux','Original Linux'];},readStatus:async(w,t)=>({status:w.matchesTarget(t())?'connected':'unknown',serviceVersion:'current'}),inspectDataRoot:async()=>({status:'available'}),beforeSwitch:()=>calls.push('switch'),saveSettings:t=>{calls.push('saveSettings');config={...t};},remember:(t,r)=>{calls.push('remember');last={target:t,intent:r.intent};},onConnected:()=>calls.push('connected'),bindFreshSources:()=>calls.push('bindSources')});
 return {api,worker,calls,task,original,get profile(){return profile;},setProfile:p=>profile=p,setOwner:()=>{selected=null;epoch++;},setSource:()=>runtime={path:'/changed'},get config(){return config;}};
}
const plan=f=>f.api.plan({profileId:f.profile.id,profileVersion:f.profile.version});
const connect=(f,p)=>f.api.connect({planId:p.planId,requestId:'fixture-request'});
test('explicit saved profile is a global target while selected task and its source remain unchanged',async()=>{
 const f=fixture(),p=await plan(f);assert.equal(p.scope,'saved-profile');assert.equal(p.profileId,'profile-one');assert.equal(p.profileVersion,2);assert.equal(p.profileName,'Saved test service');assert.equal(p.taskId,null);assert.deepEqual(p.target,{distribution:'Fixture Linux',root:'/fixture/service',port:9080});assert.equal(p.intent,'existing');assert.equal(p.locked,true);
 const result=await connect(f,p);assert.equal(result.connection,'connected');assert.deepEqual(f.task,f.original);assert.equal(f.config.workerRoot,'/fixture/service');assert.deepEqual(f.calls.filter(x=>['saveSettings','remember','connected'].includes(x)),['saveSettings','remember','connected']);assert(!f.calls.includes('bindSources'));assert(!f.calls.includes('discovery'));
});
test('profile renderer input cannot replace registry target or combine task restoration',async()=>{
 const f=fixture();for(const extra of [{taskId:'fixture-task'},{distribution:'Other'},{advanced:{root:'/other',port:9000}},{newSource:true},{intent:'standard'},{legacyPort:{planId:'x',port:9000}},{root:'/other'}])await assert.rejects(f.api.plan({profileId:'profile-one',profileVersion:2,...extra}));
 for(const value of [{profileId:'profile-one'},{profileVersion:2},{profileId:'profile-one',profileVersion:1},{profileId:'other',profileVersion:2}])await assert.rejects(f.api.plan(value));assert.deepEqual(f.calls,[]);
});
for(const change of ['version','target','removed','owner','source','task'])test('stale saved profile plan rejects before first connection side effect: '+change,async()=>{
 const f=fixture(),p=await plan(f);if(change==='version')f.setProfile({...f.profile,version:3});if(change==='target')f.setProfile({...f.profile,root:'/different'});if(change==='removed')f.setProfile(null);if(change==='task')f.task.authoring.workerBinding.root='/changed-task';if(change==='owner')f.setOwner();if(change==='source')f.setSource();await assert.rejects(connect(f,p));assert.deepEqual(f.calls,[]);assert.equal(f.api.status({planId:p.planId}).status,'superseded');
});
test('profile change during read-only restore rejects late result and prevents startup/settings/remember',async()=>{
 const f=fixture(),gate=defer();f.worker.readExisting=()=>gate.promise;const p=await plan(f),pending=connect(f,p);await Promise.resolve();f.setProfile({...f.profile,version:3});gate.resolve({status:'disconnected'});assert.equal((await pending).status,'superseded');assert(!f.calls.some(x=>['restore','start','saveSettings','remember','connected'].includes(x)));
});
test('cancelled profile plan has no side effects; duplicate connect request is idempotent',async()=>{
 const f=fixture(),p=await plan(f);f.api.cancel({planId:p.planId});await assert.rejects(connect(f,p));assert.deepEqual(f.calls,[]);
 const g=fixture(),q=await plan(g);await Promise.all([connect(g,q),connect(g,q)]);assert.equal(g.calls.filter(x=>x==='restore').length,1);assert.equal(g.calls.filter(x=>x==='remember').length,1);
});
test('saved profile standard startup remains explicit and cannot rewrite selected workflow transport',async()=>{
 const f=fixture({intent:'standard',present:false}),p=await plan(f);assert.equal((await connect(f,p)).mode,'started');assert.equal(f.calls.filter(x=>x==='start').length,1);assert(!f.calls.includes('bindSources'));assert.deepEqual(f.task,f.original);
});
test('invalid saved profiles fail closed without running inventory/worker operations',async()=>{
 for(const patch of [{kind:'ssh'},{version:0},{root:'/'},{port:22},{distribution:'bad;command'},{intent:'other'}]){const f=fixture();f.setProfile({...f.profile,...patch});await assert.rejects(plan(f));assert.deepEqual(f.calls,[]);}
});

test('profile removed while inventory is pending returns superseded without a target attempt',async()=>{const gate=defer(),f=fixture({inventoryWait:gate.promise}),pending=plan(f);f.setProfile(null);gate.resolve();const result=await pending;assert.equal(result.status,'superseded');assert.equal(result.planId,null);assert.deepEqual(f.calls,[]);});
