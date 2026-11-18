import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {memoryStorage,deferred} from '../helpers/agent-hooks.mjs';
import {readSelectedServiceRecords,selectedRecordScope} from '../../frontend/features/runs/selected-service-records.mjs';

const chat={id:'codex:unbound-records',provider:'codex',threadId:'unbound-records',name:'Unbound history',projectId:null,taskId:null};
const resource=id=>({schemaVersion:2,kind:'ssh-connection',selectionId:'selected-'+id,connectionId:'connection-'+id,profileId:'profile-'+id,profileVersion:1,status:'selected',authentication:'verified',alive:true,workflowReady:true,capabilities:{terminal:{status:'ready'},service:{status:'connected',workflowReady:true}}});
const status=id=>({status:'connected',sourceKind:'ssh',connectionId:'connection-'+id,profileId:'profile-'+id,profileVersion:1,sourceId:(id==='A'?'a':'b').repeat(64),serviceVersion:'different',checkedAt:1});
const run=id=>({id:'run-'+id,name:'History '+id,engine:'pydyn.md',project_id:'saved-project',environment_id:'saved-env',directory:'/saved/'+id,status:'draft',parameters:{},validation:{status:'not_run'},command:[],inputs:{},created_at:1});
const noExecutionMutations=h=>assert(!h.calls.some(c=>['worker.connect','compute.sshConnection.open','compute.resource.activate','task.execute','task.deployment.prepare','task.authoring.bindWorker','compute.profiles.save'].includes(c.method)||c.method==='worker.request'&&/\/(submit|cancel|resume|revise|validate|prepare)$/.test(c.data?.target||'')));
function fixture({bound=false}={}){
 const storage=memoryStorage();storage.setItem('studio.conversation',chat.id);storage.setItem('studio.section','runs');
 const currentChat={...chat,projectId:bound?'saved-project':null};
 const state={id:'A',available:true,read:null,failIndex:false};
 const h=appWorkerHarness({storage,override:async(method,data,standard)=>{
  if(method==='conversation.list')return [currentChat];if(method==='conversation.select')return currentChat;
  if(method==='compute.resource.status')return resource(state.id);
  if(method==='worker.restore')return bound?{...status(state.id),conversationId:chat.id}:{status:'disconnected',reason:'project_missing',conversationId:chat.id,checkedAt:1};
  if(method==='worker.status')return state.available?status(state.id):{status:'unknown',checkedAt:1};
  if(method==='worker.request'){
   if(state.read){const value=state.read(data);if(value)return value;}
   if(data.target==='/api/runs'){if(state.failIndex)throw Error('Synthetic index unavailable');return [run(state.id)];}if(data.target==='/api/cluster-runs')return [];
   if(data.target==='/api/run/status')return run(state.id);
  }
  return standard(method,data);
 }});return {h,state,jobs:()=>h.find(n=>n.type==='./JobsPage').props};
}

test('unbound conversation reads legacy SSH service history without enabling task execution or restoring again',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();assert.equal(f.jobs().worker,true);assert.equal(f.jobs().readOnly,true);assert.equal(f.jobs().local[0].id,'run-A');assert.equal(f.jobs().observations.local.sourceId,'a'.repeat(64));assert.equal(h.find(n=>n.type==='./Agent').props.projectId,'');
  const restores=h.calls.filter(c=>c.method==='worker.restore').length,reads=h.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/runs').length;f.jobs().onRefresh();await h.flush();assert.equal(h.calls.filter(c=>c.method==='worker.restore').length,restores);assert(h.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/runs').length>reads);
  f.jobs().onOpen({location:'local',run:run('A'),key:'local:run-A'});await h.flush();const detail=h.find(n=>n.type==='./RunDetail');assert.equal(detail.props.readOnly,true);assert.equal(detail.props.connected,true);assert.equal(detail.props.run.id,'run-A');assert.equal(h.storage.getItem('studio.conversation'),chat.id);noExecutionMutations(h);
 }finally{h.unmount();}
});

test('source switch marks cached rows and late A records cannot replace B records or timestamps',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();const old=f.jobs().onOpen,a=deferred(),b=deferred();let holdA=true,holdB=true;
  f.state.read=data=>['/api/runs','/api/cluster-runs'].includes(data.target)?f.state.id==='A'&&holdA?a.promise:f.state.id==='B'&&holdB?b.promise:undefined:undefined;
  f.jobs().onRefresh();await h.flush();f.state.id='B';h.emit({method:'studio/computeResourceChanged'});await h.flush();assert.equal(f.jobs().worker,false);assert.equal(f.jobs().observations.local.sourceChanged,true);
  holdB=false;b.resolve([run('B')]);await h.flush();assert.equal(f.jobs().local[0].id,'run-B');const at=f.jobs().observations.local.at;holdA=false;a.resolve([run('A')]);await h.flush();assert.equal(f.jobs().local[0].id,'run-B');assert.equal(f.jobs().observations.local.at,at);
  const before=h.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/run/status').length;old({location:'local',run:run('A'),key:'local:run-A'});await h.flush();assert.equal(h.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/run/status').length,before);noExecutionMutations(h);
 }finally{h.unmount();}
});

test('genuinely unavailable service retains stale history, refuses details and permits only read-only recheck',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();f.state.available=false;f.jobs().onRefresh();await h.flush();assert.equal(f.jobs().worker,false);assert.equal(f.jobs().canRefresh,true);assert.equal(f.jobs().servicePhase,'unavailable');assert.equal(f.jobs().local[0].id,'run-A');assert.equal(f.jobs().observations.local.stale,true);const before=h.calls.length;f.jobs().onOpen({location:'local',run:run('A')});await h.flush();assert.equal(h.calls.length,before);noExecutionMutations(h);}finally{h.unmount();}
});

test('switching resources while viewing a run with the same ID returns to the list',async()=>{
 const {h,state,jobs}=fixture();
 try{
  state.read=({target})=>{const row={...run(state.id),id:'shared'};return target==='/api/runs'?[row]:target==='/api/run/status'?row:undefined;};
  await h.flush();jobs().onOpen({location:'local',run:jobs().local[0]});await h.flush();
  assert.equal(h.find(n=>n.type==='./RunDetail').props.run.name,'History A');
  state.id='B';h.emit({method:'studio/computeResourceChanged'});await h.flush();
  assert.equal(jobs().local[0].name,'History B');assert.throws(()=>h.find(n=>n.type==='./RunDetail'));
  assert.equal(h.storage.getItem('studio.section'),'runs');noExecutionMutations(h);
 }finally{h.unmount();}
});

test('same selected profile with an intervening source identity is rejected after the GET responses',async()=>{
 const scope=selectedRecordScope(resource('A'),1);let observations=0;const result=await readSelectedServiceRecords({scope,current:()=>true,readStatus:async()=>++observations===1?status('A'):{...status('A'),sourceId:'c'.repeat(64)},read:async()=>[run('A')]});assert.deepEqual(result,{phase:'unavailable',sourceChanged:true});
});

for(const connectionId of [undefined,'another-connection'])test('missing or foreign SSH connection identity cannot read the selected profile history: '+connectionId,async()=>{
 let reads=0;const result=await readSelectedServiceRecords({scope:selectedRecordScope(resource('A'),1),current:()=>true,readStatus:async()=>({...status('A'),connectionId}),read:async()=>{reads++;return [run('A')];}});assert.deepEqual(result,{phase:'unavailable',sourceChanged:true});assert.equal(reads,0);
});

test('service/tool status event storms do not initiate another record RPC cycle',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();const calls=h.calls.filter(c=>c.method==='worker.status'||c.method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(c.data.target)).length;for(let i=0;i<30;i++){h.emit({method:'studio/sshServiceChanged',params:{status:'connected',workflowReady:true}});h.emit({method:'studio/toolsStatus',params:{status:'ready',count:26}});}await h.flush();assert.equal(h.calls.filter(c=>c.method==='worker.status'||c.method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(c.data.target)).length,calls);assert.equal(f.jobs().worker,true);noExecutionMutations(h);}finally{h.unmount();}
});

test('a stale same-source index remains a warning and fresh exact-run observation can open the record',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();f.state.failIndex=true;f.jobs().onRefresh();await h.flush();assert.equal(f.jobs().worker,true);assert.equal(f.jobs().observations.local.stale,true);assert.equal(f.jobs().observations.local.sourceChanged,false);f.jobs().onOpen({location:'local',run:run('A')});await h.flush();assert.equal(h.find(n=>n.type==='./RunDetail').props.run.id,'run-A');assert.equal(h.find(n=>n.type==='./RunDetail').props.readOnly,true);assert.equal(f.jobs().observations.local.stale,true,'one refreshed run must not fabricate a fresh whole index');assert(h.calls.some(c=>c.method==='worker.request'&&c.data.target==='/api/run/status'));noExecutionMutations(h);}finally{h.unmount();}
});

test('verified older service exposes the existing exact service settings upgrade entry without starting an operation',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();const button=h.find(n=>n.props?.['data-testid']==='worker-service-upgrade');let prevented=0;button.props.onClick({preventDefault(){prevented++;},stopPropagation(){prevented++;}});await h.flush();assert.equal(prevented,2);assert.deepEqual({...h.find(n=>n.type==='./ComputeConnectionChooser').props.initialEdit,nonce:'nonce'},{profileId:'profile-A',profileVersion:1,section:'service',nonce:'nonce'});assert.equal(f.jobs().worker,true);noExecutionMutations(h);}finally{h.unmount();}
});

test('an upgrade entry captured on A cannot silently open settings for newly selected B',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();const old=h.find(n=>n.props?.['data-testid']==='worker-service-upgrade').props.onClick;f.state.id='B';h.emit({method:'studio/computeResourceChanged'});await h.flush();old({preventDefault(){},stopPropagation(){}});await h.flush();assert.throws(()=>h.find(n=>n.type==='./ComputeConnectionChooser'));noExecutionMutations(h);}finally{h.unmount();}
});

test('different worker version does not turn a verified matching execution context into read-only history',async()=>{
 const f=fixture({bound:true}),{h}=f;try{await h.flush();assert.equal(f.jobs().readOnly,false);assert(h.find(n=>n.props?.['data-testid']==='worker-service-upgrade'));f.jobs().onOpen({location:'local',run:run('A')});await h.flush();assert.equal(h.find(n=>n.type==='./RunReview').props.connected,true);assert.throws(()=>h.find(n=>n.type==='./RunDetail'&&n.props.readOnly));noExecutionMutations(h);}finally{h.unmount();}
});
