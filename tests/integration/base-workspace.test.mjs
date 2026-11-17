import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseWorkspace,baseWorkspaceTool} from '../../backend/main/workspace/base-workspace.mjs';
import {ensureTaskAuthoring} from '../../backend/main/workspace/task-authoring.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {restoreTaskWorker} from '../../backend/main/compute/worker-restore.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';
import {dshToolAllowed} from '../../agent/providers/dsh-policy.mjs';
import {selectScientificFunctions} from '../../agent/skills/scientific-context.mjs';

function fixture(){
 const rows=new Map(),calls=[],workspaces=new Map(),projects=new Map();
 const catalog={get:(k,id)=>structuredClone(rows.get(k+':'+id)),put:(k,id,v)=>{rows.set(k+':'+id,structuredClone(v));return v;},list:k=>[...rows].filter(([id])=>id.startsWith(k+':')).map(([,v])=>structuredClone(v))};
 const records=new TaskRecords(catalog,()=>{}),task=records.create({provider:'codex',threadId:'thread',workflowVersion:2,planningMode:true,request:'Workspace setup'});
 records.save({...task,workspaceChoice:'pending'});
 const identity={kind:'ssh',version:3,connectionId:'connection',profileId:'profile',profileVersion:1,root:'/worker',runtime:'/worker/runtimes/test',runtimeId:'test',hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture'}};
 const health={name:'gpu-sampling-studio',root:identity.root,runtime:identity.runtime,runtimeId:identity.runtimeId,hostIdentity:identity.hostIdentity,execution_policy:'desktop-review-v1',ssh_service:true};
 let selection={kind:'ssh-connection',connectionId:identity.connectionId,profileId:identity.profileId,profileVersion:identity.profileVersion};
 const worker={identity,connection:{health,transport:'ssh-connection'},connectionEpoch:1,connectionTarget:{kind:'ssh',version:3,connectionId:'connection',serviceId:'service',port:8767},request:async(method,target,data)=>{
  calls.push({method,target,data});
  if(target==='/api/health')return health;
  if(target==='/api/projects')return [...projects.values()];
  if(target==='/api/custom-cv/access')return {blocked_project_ids:[],blocked_run_ids:[],blocked_paths:[],bindings:[]};
  if(target==='/api/studio-workspace/create'){
   if(!workspaces.has(data.id)){
    workspaces.set(data.id,{id:data.id,name:data.name,root:'/worker/projects/'+data.id+'/inputs',directories:['assets/structures','assets/models'],asset_mode:data.asset_mode,assets:[]});
    projects.set(data.id,{id:data.id,authoring_only:true,studio_workspace:{asset_mode:data.asset_mode},policy:{engines:[],input_roots:[workspaces.get(data.id).root]}});
   }
   return structuredClone(workspaces.get(data.id));
  }
  if(target==='/api/studio-workspace/read')return structuredClone(workspaces.get(data.project_id));
  if(target==='/api/authoring/context')return {project:projects.get(data.project_id),input_root:workspaces.get(data.project_id).root,environment_id:null,imports:[]};
  throw Error('Unexpected request '+target);
 }};
 const current=()=>({serial:1,provider:'codex',threadId:'thread',taskId:task.id});
 const resource={peek:()=>structuredClone(selection),capture:()=>structuredClone(selection),assertCurrent:value=>assert.deepEqual(value,selection)};
 const service={peek:()=>({...selection,status:'connected',workflowReady:true,attemptId:'attempt'}),hasCurrentGrant:()=>true};
 const dependencies={catalog,worker,resource,service,current};
 const scope={provider:'codex',threadId:'thread',checkCurrent:()=>true};
 return {base:createBaseWorkspace(dependencies),dependencies,calls,worker,records,task,scope,current,resource,projects,rows,switchResource:()=>{selection={...selection,connectionId:'other'};}};
}

test('ordinary conversation initializes and reuses one verified base workspace across desktop controllers',async()=>{
 const f=fixture();assert.equal((await f.base.call({action:'inspect'},f.scope)).status,'unconfigured');assert.equal(f.calls.length,0);
 const value=await f.base.call({action:'ensure'},f.scope);assert.equal(value.status,'ready');assert.equal(value.workspace.root,'/worker/projects/workspace-base/inputs');
 assert.deepEqual(f.projects.get('workspace-base').policy.engines,[]);
 assert.deepEqual(await createBaseWorkspace(f.dependencies).call({action:'ensure'},f.scope),value);assert.equal(f.projects.size,1);
 assert.equal(dshToolAllowed(baseWorkspaceTool.name,false),true);
 const privacy=createPrivateCvAccess({records:f.records,worker:f.worker,activeTasks:new Map()});
 for(const provider of ['codex','deepseek','compatible'])await privacy.before(baseWorkspaceTool.name,{action:'ensure'},provider,{...f.scope,provider});
});

test('base workspace setup rejects stale handoffs, profile substitutions and in-flight connection switches',async()=>{
 const f=fixture();await assert.rejects(f.base.call({action:'ensure'},{...f.scope,checkCurrent:()=>false}));
 await assert.rejects(f.base.manual({action:'ensure',connectionId:'wrong',profileId:'profile',profileVersion:1}));
 await assert.rejects(f.base.manual({action:'ensure',connectionId:'connection',profileId:'profile',profileVersion:1,name:'Test',directory:123}));
 assert.equal(f.calls.length,0);
 const original=f.worker.request;f.worker.request=async(...args)=>{const result=await original(...args);f.switchResource();return result;};
 await assert.rejects(f.base.call({action:'ensure'},f.scope));
 assert.equal([...f.rows.keys()].some(key=>key.startsWith('cluster-base-workspace:')),false);
});

test('first SSH workflow binds the managed workspace and repeated turns preserve its files and identity',async()=>{
 const f=fixture(),options={provider:'codex',threadId:'thread',taskId:f.task.id,baseWorkspace:f.base};
 await ensureTaskAuthoring(f.records,f.worker,options);
 const first=f.records.read(f.task.id);assert.equal(first.workspaceChoice,'workspace');assert.equal(first.projectId,'workspace-base');assert.equal(first.authoring.inputRoot,first.workspace.root);
 const creations=f.calls.filter(c=>c.target==='/api/studio-workspace/create').length;
 await ensureTaskAuthoring(f.records,f.worker,options);
 assert.equal(f.calls.filter(c=>c.target==='/api/studio-workspace/create').length,creations);
 assert.equal(f.records.read(f.task.id).authoring.projectId,first.projectId);
});

test('a new unbound workflow can read current verified SSH health before choosing its first workspace',async()=>{
 const f=fixture(),options={records:f.records,worker:f.worker,settings:()=>({}),selection:f.current,selectionEpoch:()=>1,selectedResource:f.resource.peek};
 const result=await restoreTaskWorker(options,{taskId:f.task.id});assert.equal(result.status,'connected');
 assert.deepEqual(f.calls.map(c=>c.target),['/api/health']);assert.equal(f.records.read(f.task.id).authoring,undefined);
 assert.equal((await restoreTaskWorker(options,{conversationId:'codex:thread'})).status,'connected');
 f.records.save({...f.records.read(f.task.id),authoring:{projectId:'old',inputRoot:'/old'}});
 assert.equal((await restoreTaskWorker(options,{taskId:f.task.id})).reason,'binding_missing');assert.equal(f.calls.length,2);
});

test('workspace questions select the bundled setup skill ahead of the previous scientific route',()=>{
 for(const text of ['首次登录后设置基础工作区','选择工作区的按钮是灰的','initialize the default workspace'])
  assert.deepEqual(selectScientificFunctions({text,parameters:{engine:'pydyn.md'}}),['cluster.workspace-setup']);
});
