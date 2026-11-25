import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {saveDeployment,prepareDeployment} from '../../backend/main/workspace/task-deployment.mjs';
import {saveDeploymentDraft} from '../../backend/main/workspace/deployment-state.mjs';
import {executeTask} from '../../backend/main/workspace/task-execution.mjs';

const config={target:'local',targetId:'env',projectId:'compute',inputSource:'local',maxSeconds:30,directoryName:'attempt',gpu:0,resources:{cpus:1,gpus:0,memory_mb:512,queue:'',account:''}};
function fixture(){
 const data=new Map(),catalog={get:(k,id)=>structuredClone(data.get(k+id)),put:(k,id,v)=>{data.set(k+id,structuredClone(v));return v;},list:k=>[...data.entries()].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v))};
 const records=new TaskRecords(catalog,()=>{}),task=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'thread',request:'authorized exploration',projectId:'compute'});
 task.parameters={engine:'pydyn.md',files:['/fixture/run.py']};task.review={status:'not_run'};task.steps=[];records.save(task);
 const runs=new Map(),keys=[],calls=[],hooks={};
 const worker={connection:{id:'fixture'},identity:{kind:'wsl',distribution:'fixture',root:'/worker'},connectionEpoch:1,async request(method,route,args){
  calls.push(route);
  if(route==='/api/projects')return [{id:'compute',policy:{engines:['pydyn.md'],environments:['env'],gpus:[0],max_seconds:30,max_concurrent:2}}];
  if(route.endsWith('/prepare')){keys.push(args.spec.idempotency_key);const run={...structuredClone(args.spec),id:'run-'+keys.length,status:'draft',validation:{status:'not_run'},snapshots:[{name:'run.py',sha256:'a'.repeat(64),size:4}]};runs.set(run.id,run);return structuredClone(run);}
  const run=runs.get(args.run_id);
  if(route.endsWith('/status'))return structuredClone(run);
  if(route.endsWith('/validate')){await hooks.validate?.();run.validation={status:'failed',message:'scientific finding'};return structuredClone(run);}
  if(route.endsWith('/submit')){await hooks.submit?.();run.status='queued';return structuredClone(run);}
  throw Error(route);
 }};
 saveDeployment(records,{taskId:task.id,value:config},undefined,worker);
 return {records,task,worker,runs,keys,calls,hooks,prepare:()=>prepareDeployment(records,worker,{taskId:task.id}),execute:(run,{runChecks=false}={})=>executeTask(records,worker,{taskId:task.id,artifactId:run.id,inputReceipt:records.read(task.id).deployment.prepared.inputIdentity,runChecks})};
}

test('unreviewed and stale review states execute while findings remain failed',async()=>{
 for(const status of ['not_run','needs-information','failed']){
  const f=fixture(),task=f.records.read(f.task.id);task.review={status,parameterRevision:-1};f.records.save(task);
  const run=await f.prepare();f.runs.get(run.id).validation={status:'failed',message:'existing scientific finding'};const result=await f.execute(run);
  assert.equal(result.status,'queued');assert.equal(result.validation.status,'failed');assert.equal(f.records.read(task.id).review.status,status);assert(!f.calls.some(route=>route.endsWith('/validate')));
 }
});
test('editing during validation preserves next draft and original execution snapshot',async()=>{
 const f=fixture(),run=await f.prepare(),revision=f.records.read(f.task.id).parameterRevision;
 f.hooks.validate=()=>{f.records.edit({id:f.task.id,changes:{temperature:310}});saveDeploymentDraft(f.records,f.worker,{taskId:f.task.id,value:{...config,maxSeconds:20},expectedRevision:0,mutationId:'next-draft-1'});};
 await f.execute(run,{runChecks:true});
 const task=f.records.read(f.task.id);assert.equal(task.parameters.temperature,310);assert.equal(task.deploymentDraft.config.maxSeconds,20);assert.equal(task.execution.parameterRevision,revision);assert.equal(f.runs.get(run.id).parameters.temperature,undefined);
});
test('explicit optional checks can fail while the authorized attempt still submits truthfully',async()=>{const f=fixture(),run=await f.prepare(),result=await f.execute(run,{runChecks:true});assert.equal(result.status,'queued');assert.equal(result.validation.status,'failed');assert.equal(f.calls.filter(route=>route.endsWith('/validate')).length,1);});
test('persisted failed execution evidence does not replace a fresh worker submission check',async()=>{const f=fixture(),run=await f.prepare();f.runs.get(run.id).execution_check={status:'failed',required:true,message:'previous target failure'};const result=await f.execute(run);assert.equal(result.status,'queued');assert.equal(f.calls.filter(route=>route.endsWith('/submit')).length,1);});
test('changed controls with unchanged actual files produce a warning without fabricated checks',async()=>{
 const f=fixture();await f.prepare();f.records.edit({id:f.task.id,changes:{temperature:310}});await f.prepare();
 const task=f.records.read(f.task.id);assert.equal(task.inputBinding.findings[0].code,'declared_controls_changed_with_identical_inputs');assert.equal(task.inputBinding.semanticStatus,'not_run');assert.equal(task.review.status,'not_run');
});
test('known terminal attempts can be intentionally retried with new immutable run identity',async()=>{
 const f=fixture(),first=await f.prepare();f.runs.get(first.id).status='failed';const second=await f.prepare();
 assert.notEqual(first.id,second.id);assert.notEqual(f.keys[0],f.keys[1]);assert.equal(f.records.read(f.task.id).artifacts.length,2);
});
test('unknown submission keeps drafts editable and prevents replacement preparation',async()=>{
 const f=fixture(),run=await f.prepare();f.hooks.submit=()=>{throw Error('response lost');};
 await assert.rejects(f.execute(run),/response lost/);const original=structuredClone(f.records.read(f.task.id).execution);f.records.edit({id:f.task.id,changes:{temperature:315}});
 f.records.linkRun(f.task.id,run);assert.deepEqual(f.records.read(f.task.id).execution,original);
 await assert.rejects(f.prepare(),/原提交/);await assert.rejects(f.execute(run),/current input revision|pending/);assert.equal(f.calls.filter(route=>route.endsWith('/submit')).length,1);assert.equal(f.keys.length,1);assert.deepEqual(f.records.read(f.task.id).execution,original);
});
test('execution rejected before the worker request identifies no submitted job',async()=>{
 const f=fixture(),run=await f.prepare(),calls=f.calls.length;
 await assert.rejects(executeTask(f.records,f.worker,{taskId:f.task.id,artifactId:run.id,inputReceipt:'stale'}),/execution_not_started: Review the actual input snapshots/);
 assert.equal(f.calls.length,calls);assert.equal(f.records.read(f.task.id).execution,undefined);
});
test('a confirmed worker preflight rejection leaves the same draft available for an explicit retry',async()=>{
 const f=fixture(),run=await f.prepare();
 f.hooks.submit=()=>{throw Object.assign(Error('Required runtime unavailable'),{operationNotStarted:true});};
 await assert.rejects(f.execute(run),/execution_not_started: Required runtime unavailable/);
 const saved=f.records.read(f.task.id).execution;assert.equal(saved.phase,'blocked');assert.equal(saved.notSubmitted,true);assert.equal(saved.artifactId,run.id);
 assert.equal(f.runs.get(run.id).status,'draft');assert.equal(f.calls.filter(route=>route.endsWith('/submit')).length,1);
 f.hooks.submit=null;const result=await f.execute(run);assert.equal(result.id,run.id);assert.equal(result.status,'queued');assert.equal(f.calls.filter(route=>route.endsWith('/submit')).length,2);
});
test('corrupt catalog rows are isolated and their original bytes remain recoverable',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-catalog-')),catalog=new Catalog(root);t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 catalog.put('thread','valid',{id:'valid',name:'working'});catalog.db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread','damaged','{bad json');
 assert.deepEqual(catalog.list('thread').map(x=>x.id),['valid']);assert.throws(()=>catalog.get('thread','damaged'),{code:'catalog_record_corrupt'});assert.equal(catalog.recovery().length,1);assert.equal(catalog.db.prepare('SELECT data FROM record_recovery').get().data,'{bad json');
});
test('transcript sanitation migrates history while preserving credentials and run metadata',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-sanitize-')),catalog=new Catalog(root);t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 for(const kind of ['compatible-history','compatible-codex-thread','deepseek-dsh-history','api-dsh-history','thread','agent-thread','conversation-context-history']){
  catalog.db.prepare('INSERT INTO records VALUES(?,?,?)').run(kind,'id',JSON.stringify({id:'id',turns:[{text:'Bearer private-token sk-sensitive-value'}]}));
  assert(!JSON.stringify(catalog.get(kind,'id')).includes('private-token'));assert(!catalog.db.prepare('SELECT data FROM records WHERE kind=?').get(kind).data.includes('sk-sensitive-value'));
 }
 for(const kind of ['settings','ssh-connection','project','run']){catalog.put(kind,'id',{apiKey:'sk-real-config'});assert.equal(catalog.get(kind,'id').apiKey,'sk-real-config');}
});
