import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {createStructureWithAuthoringContext} from '../desktop/structure-authoring.mjs';
import {assertRendererWorkerRoute} from '../desktop/security.mjs';
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({execution=false,workspace=true,match=true,registered=true}={}){
 let selected={serial:1,provider:'codex',threadId:'real-empty',taskId:'owned'};
 const binding={distribution:'Fixture',root:'/fixture/worker',port:19026};
 const task={id:'owned',name:'Owned fixture',provider:'codex',threadId:'real-empty',authoring:{projectId:'owned-project',inputRoot:'/fixture/worker/projects/owned-project/inputs',environmentId:'canonical-old',workerBinding:binding},...(workspace?{workspace:{id:'owned-project'}}:{})};
 const project={id:'owned-project',authoring_only:!execution,...workspace?{studio_workspace:{schema_version:1,asset_mode:'copy'}}:{authoring_task_id:'owned'},policy:{environments:['canonical-old'],engines:execution?['gpumd.md']:[],clusters:[],input_roots:[task.authoring.inputRoot],max_seconds:60}};
 const body={project_id:match?'owned-project':'other-project',environment_id:'new-registered',recipe:{kind:'bulk',name:'Ag',crystalstructure:'fcc',a:4.09,repeat:[2,2,2]}};
 const reply={path:'/fixture/owned/generated.xyz',n_atoms:32};const calls=[];let override;
 const worker={connection:{health:{root:binding.root}},connectionEpoch:1,identity:{distribution:binding.distribution,root:binding.root},connectionTarget:{port:19026},async request(method,path,data){calls.push({method,path,data});const result=override?.(path,data);if(result!==undefined)return await result;if(path==='/api/projects')return [structuredClone(project)];if(path==='/api/environments')return registered?[{id:'new-registered',executables:{python:'/registered/python'}}]:[];if(path==='/api/authoring/context'){project.policy.environments.push('new-registered');return {project:structuredClone(project),input_root:task.authoring.inputRoot,environment_id:'different-first-candidate'};}if(path==='/api/structures/create'){if(body.project_id!=='owned-project'||!project.policy.environments.includes(body.environment_id))throw Error('Environment is not authorized');return reply;}throw Error('Unexpected route');}};
 const records={read:()=>structuredClone(task),bound:()=>({id:task.id}),deleted:()=>false};
 return {worker,records,task,project,body,reply,calls,deps:{records,worker,selection:()=>selected},switchOwner(){selected={...selected,serial:2,taskId:'other'};},override(fn){override=fn;}};
}
for(const workspace of [true,false])test('own stale '+(workspace?'workspace':'draft')+' refreshes registered Python only, preserving canonical task/body/response',async()=>{
 const f=fixture({workspace}),before=structuredClone(f.task),policy=structuredClone(f.project.policy);
 const result=await createStructureWithAuthoringContext(f.deps,f.body);
 assert.equal(result,f.reply);assert.deepEqual(f.task,before);assert.equal(f.calls.at(-1).data,f.body);
 assert.deepEqual(f.calls.find(c=>c.path==='/api/authoring/context').data,{workspace_id:'owned',project_id:'owned-project',name:'Owned fixture',structure_paths:[],selected_paths:[]});
 assert.deepEqual(f.project.policy.engines,policy.engines);assert.deepEqual(f.project.policy.clusters,policy.clusters);assert.equal(f.task.authoring.environmentId,'canonical-old');
});
for(const options of [{execution:true},{match:false},{registered:false}])test('ordinary/other-project/unregistered retains original authorization gate '+JSON.stringify(options),async()=>{
 const f=fixture(options),before=structuredClone(f.project);await assert.rejects(createStructureWithAuthoringContext(f.deps,f.body),/Environment is not authorized/);
 assert(!f.calls.some(c=>c.path==='/api/authoring/context'));assert.deepEqual(f.project,before);
});
for(const point of ['/api/projects','/api/authoring/context'])for(const swap of ['owner','worker'])test('late '+point+' after '+swap+' swap never dispatches structure creation',async()=>{
 const f=fixture(),wait=defer();f.override(path=>path===point?wait.promise:undefined);
 const pending=createStructureWithAuthoringContext(f.deps,f.body);pending.catch(()=>{});await new Promise(r=>setImmediate(r));
 if(swap==='owner')f.switchOwner();else{f.worker.connection={health:{root:'/other'}};f.worker.connectionEpoch++;}
 wait.resolve(point==='/api/projects'?[f.project]:{project:f.project,input_root:f.task.authoring.inputRoot});
 await assert.rejects(pending,/context changed/);assert(!f.calls.some(c=>c.path==='/api/structures/create'));
});
test('a project claimed by another task cannot acquire authoring refresh',async()=>{
 const f=fixture({workspace:false});f.project.authoring_task_id='another-task';await assert.rejects(createStructureWithAuthoringContext(f.deps,f.body),/Environment is not authorized/);assert(!f.calls.some(c=>c.path==='/api/authoring/context'));
});
for(const change of ['missing','different'])test('deployment source cannot mask '+change+' original authoring binding',async()=>{
 const f=fixture();f.task.deployment={workerBinding:structuredClone(f.task.authoring.workerBinding)};
 if(change==='missing')delete f.task.authoring.workerBinding;else f.task.authoring.workerBinding={...f.task.authoring.workerBinding,root:'/other-authoring-root'};
 await assert.rejects(createStructureWithAuthoringContext(f.deps,f.body),/original authoring source/);
 assert.equal(f.calls.length,0);
});
test('actual main renderer handler routes only structures/create through selected-context helper',async()=>{
 const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true);let registration;
 function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='handle'&&n.arguments[0]?.text==='worker.request')registration=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);
 let handler,received;const worker={request:async()=>({actual:'ordinary'})},records={},selection={taskId:'main-selected'};
 vm.runInNewContext(registration,{handle:(_name,fn)=>handler=fn,assertRendererWorkerRoute,URL,worker,taskRecords:records,workflowContext:{current:()=>selection},createStructureWithAuthoringContext:async(deps,data)=>{received={deps,data};return {actual:'owned-structure'};}});
 const body={project_id:'owned-project',environment_id:'registered',recipe:{kind:'bulk'}};
 assert.deepEqual(await handler({method:'POST',target:'/api/structures/create',data:body}),{actual:'owned-structure'});assert.equal(received.deps.worker,worker);assert.equal(received.deps.records,records);assert.equal(received.deps.selection(),selection);assert.equal(received.data,body);
 assert.deepEqual(await handler({method:'POST',target:'/api/inspect',data:{}}),{actual:'ordinary'});
});
