import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {MaterialsProject} from '../../backend/main/tools/materials-project.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';

const material={material_id:'mp-1',structure:{lattice:{matrix:[[1,0,0],[0,1,0],[0,0,1]]},sites:[{species:[{element:'Li',occu:1}],abc:[0,0,0]}]}};
const context=x=>({threadId:'thread-'+x,taskId:'task-'+x,projectId:'project-'+x,environmentId:'env-'+x,inputRoot:'/fixture/project-'+x+'/inputs'});

async function fixture(t){
 const worker=new WorkerClient(),writes=[];
 worker.connection={url:'http://127.0.0.1:1',tokens:{mcp:'SYNTHETIC_MCP',admin:'SYNTHETIC_ADMIN'},transport:'fixture'};
 worker.identity={distribution:'fixture',root:'/fixture/worker-a'};
 worker.connectionTarget={distribution:'fixture',root:'/fixture/worker-a',port:8767};
 const tasks=new Map(['a','b'].map(x=>['task-'+x,{id:'task-'+x,provider:'codex',threadId:'thread-'+x,projectId:'project-'+x,authoring:{projectId:'project-'+x,environmentId:'env-'+x,inputRoot:'/fixture/project-'+x+'/inputs'},parameters:{files:[]}}]));
 const activeTasks=new Map([['codex','task-a']]);
 worker.request=async(method,target,data)=>{
  if(target==='/api/custom-cv/access')return {blocked_project_ids:[],blocked_run_ids:[],bindings:[],blocked_paths:[]};
  assert.equal(method,'POST');assert.equal(target,'/api/structures/import-material');writes.push(data);return {path:'/fixture/project-a/inputs/material.xyz',sha256:'a'.repeat(64)};
 };
 const records={read:id=>structuredClone(tasks.get(id)),bound:(provider,threadId)=>[...tasks.values()].find(task=>task.provider===provider&&task.threadId===threadId),deleted:()=>false,save:()=>{}};
 worker.setAuthoringGuard(createPrivateCvAccess({records,worker,activeTasks}));
 let release,started;const waiting=new Promise(resolve=>release=resolve),fetchStarted=new Promise(resolve=>started=resolve);
 const materials=new MaterialsProject({root:path.resolve('.studio','nonexistent-mp-scope-test'),encryption:{},worker,fetchApi:async()=>{started();await waiting;return new Response(JSON.stringify({data:[material]}));}});
 materials.key=()=> 'SYNTHETIC_MP';
 worker.setLocalTools(materials.tools(),(name,args,scope)=>materials.call(name,args,scope));
 await worker.exposeTools({});worker.bindProviderContext('codex',context('a'));
 t.after(()=>{release();worker.close();});
 const connection=worker.providerConnection('codex');
 const send=()=>fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'import_materials_project',arguments:{project_id:'project-a',environment_id:'env-a',material_id:'mp-1'}}})});
 return {worker,materials,writes,send,fetchStarted,release,switchContext(){activeTasks.set('codex','task-b');worker.bindProviderContext('codex',context('b'));}};
}

test('current provider import succeeds once through the authenticated proxy and private guard',async t=>{
 const f=await fixture(t),pending=f.send();await f.fetchStarted;f.release();const response=await pending,body=await response.json();
 assert.equal(response.status,200);assert.equal(body.result.isError,false);assert.equal(f.writes.length,1);assert.equal(f.writes[0].project_id,'project-a');assert.equal(f.writes[0].external_provenance.material_id,'mp-1');
});

for(const mode of ['provider-revoked','context-changed','worker-replaced','worker-epoch-changed','worker-identity-changed','worker-target-changed'])test('pending material lookup cannot write after '+mode,async t=>{
 const f=await fixture(t),pending=f.send();await f.fetchStarted;
 if(mode==='provider-revoked')f.worker.revokeProvider('codex');
 else if(mode==='context-changed')f.switchContext();
 else if(mode==='worker-replaced')f.worker.connection={...f.worker.connection};
 else if(mode==='worker-epoch-changed')f.worker.connectionEpoch++;
 else if(mode==='worker-identity-changed')f.worker.identity.root='/fixture/worker-b';
 else f.worker.connectionTarget.port=8768;
 f.release();const response=await pending;
 if(mode==='provider-revoked'||mode==='context-changed')assert.equal(response.status,403);
 else{assert.equal(response.status,200);assert.equal((await response.json()).result.isError,true);}
 assert.deepEqual(f.writes,[]);
});

test('material MCP import refuses an absent or invalid provider scope before external lookup',async t=>{
 const f=await fixture(t);for(const scope of [undefined,{}, {localReaders:true,checkCurrent:()=>false},{localReaders:false,checkCurrent:()=>true}])await assert.rejects(()=>f.materials.call('import_materials_project',{project_id:'project-a',environment_id:'env-a',material_id:'mp-1'},scope),/current provider conversation/);assert.deepEqual(f.writes,[]);
});

test('human material import retains its API but rejects a worker switch during lookup',async t=>{
 const f=await fixture(t),pending=f.materials.import({project_id:'project-a',environment_id:'env-a',material_id:'mp-1'});await f.fetchStarted;f.worker.connectionEpoch++;f.release();await assert.rejects(pending,/worker changed/);assert.deepEqual(f.writes,[]);
});

test('an import whose lease changes during the worker write cannot report success',async t=>{
 const f=await fixture(t);let live=true,releaseWrite,writeStarted;const waiting=new Promise(resolve=>releaseWrite=resolve),started=new Promise(resolve=>writeStarted=resolve);
 f.worker.request=async()=>{writeStarted();await waiting;return {path:'already-dispatched.xyz'};};
 const pending=f.materials.call('import_materials_project',{project_id:'project-a',environment_id:'env-a',material_id:'mp-1'},{localReaders:true,checkCurrent:()=>live});await f.fetchStarted;f.release();await started;live=false;releaseWrite();await assert.rejects(pending,/conversation changed/);
});
