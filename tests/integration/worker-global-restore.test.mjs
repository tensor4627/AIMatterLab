import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {WorkerClient} from "../../agent/tools/worker-client.mjs";
import {restoreTaskWorker} from "../../backend/main/compute/worker-restore.mjs";
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {ensureTaskAuthoring} from "../../backend/main/workspace/task-authoring.mjs";

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const settings={distribution:'Fixture Ubuntu',workerRoot:'~/selected',workerPort:8767};
const health=root=>({name:'gpu-sampling-studio',root,runtime:'/fixture/prior-runtime',execution_policy:'desktop-review-v1'});
const descriptor=root=>({status:'connected',connection:{url:'http://127.0.0.1:8767',tokens:{admin:'synthetic-admin',mcp:'synthetic-mcp'},health:health(root)}});
function fixture(){
 let owner=null,serial=0,config={...settings},bound={version:1,distribution:settings.distribution,root:'/fixture/worker',port:8767,settingsSignature:[settings.distribution,settings.workerRoot,8767],checkedAt:1};
 const calls=[],tasks=new Map(),conversations=new Map();let read=async target=>descriptor(target.workerRoot),attach;
 const worker=new WorkerClient({readExisting:async target=>{calls.push({read:{...target}});return read(target);}});
 worker.attachExistingTransport=async(target,_health,check)=>{calls.push({attach:target.workerRoot});if(attach)await attach();check();};
 worker.open=async()=>{throw Error('Automatic install/bootstrap forbidden');};
 worker.request=async(method,target)=>{calls.push({method,target});assert.equal(method,'GET');assert.equal(target,'/api/health');return {...worker.connection.health};};
 const records={read:id=>{if(!tasks.has(id))throw Error('Deleted task');return tasks.get(id);},conversation:(p,t)=>conversations.get(p+':'+t)||null,deleted:()=>false};
 const catalog={get:(kind,id)=>kind==='worker-binding'&&id==='last-explicit'?structuredClone(bound):null};
 const context={records,catalog,worker,settings:()=>config,selection:()=>owner,selectionEpoch:()=>serial};
 return{worker,calls,tasks,conversations,context,read:fn=>read=fn,attach:fn=>attach=fn,owner:value=>{owner=value;serial++;},settings:value=>config=value,binding:value=>bound=value,restore:()=>restoreTaskWorker(context,{scope:'global'}),close:()=>worker.close()};
}

test('no-owner desktop restores only its verified last-explicit existing service, including a healthy prior runtime',async()=>{
 const f=fixture();try{const result=await f.restore();assert.equal(result.status,'connected');assert.deepEqual(Object.keys(result).sort(),['checkedAt','reason','scope','sourceId','status']);assert.match(result.sourceId,/^[a-f0-9]{64}$/);assert.equal(result.scope,'global');assert.deepEqual(f.calls.map(v=>v.attach||v.read?.workerRoot),['/fixture/worker','/fixture/worker']);assert.equal(f.calls[0].read.workerPort,8767);assert(!/synthetic|tokens|url|runtime|root|distribution/.test(JSON.stringify(result)));assert.equal(f.worker.connection.health.runtime,'/fixture/prior-runtime');}finally{f.close();}
});

for(const mode of ['missing','different-root-setting','different-port-setting','different-distribution','malformed-binding'])test('no-owner global recovery refuses an unverified target: '+mode,async()=>{
 const f=fixture();if(mode==='missing')f.binding(null);if(mode==='different-root-setting')f.settings({...settings,workerRoot:'/new'});if(mode==='different-port-setting')f.settings({...settings,workerPort:8768});if(mode==='different-distribution')f.settings({...settings,distribution:'Another'});if(mode==='malformed-binding')f.binding({version:1,root:'/fixture/worker',port:8767});assert.equal((await f.restore()).status,'disconnected');assert.deepEqual(f.calls,[]);assert(!f.worker.connection);f.close();
});
for(const status of ['unknown','disconnected'])test('existing unavailable stays '+status+' without any installer or run operation',async()=>{const f=fixture();f.read(async()=>({status}));assert.equal((await f.restore()).status,status);assert.equal(f.calls.length,1);assert(!f.worker.connection);f.close();});

for(const owner of [{provider:'codex',threadId:'saved',taskId:null},{provider:'codex',threadId:'saved',taskId:'task'},{provider:'codex',threadId:null,taskId:'task'},{provider:'codex',threadId:null,taskId:null,projectId:'saved-project'},{provider:'codex',threadId:null,replacement:{threadId:'saved'}}])test('saved owner cannot use global restoration '+JSON.stringify(owner),async()=>{const f=fixture();f.owner(owner);assert.equal((await f.restore()).status,'unknown');assert.deepEqual(f.calls,[]);f.close();});

test('empty provider context is still no saved owner, with its exact revision guarded',async()=>{const f=fixture();f.owner({provider:'codex',serial:1,threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null});assert.equal((await f.restore()).status,'connected');f.close();});

for(const args of [{scope:'other'},{scope:'global',root:'/other'},{scope:'global',port:8767},{scope:'global',taskId:'task'},{scope:'global',conversationId:'codex:saved'},{scope:'global',bundledRuntimeId:'a'.repeat(20)},{scope:'global',serviceVersion:'current'},['global'],null])test('typed global route rejects endpoint or mixed-owner injection '+JSON.stringify(args),async()=>{const f=fixture();await assert.rejects(restoreTaskWorker(f.context,args),/Invalid typed/);assert.deepEqual(f.calls,[]);f.close();});

for(const mode of ['task','saved-chat','owner-ABA','settings','settings-ABA','binding','close'])test('late global descriptor cannot attach to changed main ownership: '+mode,async()=>{
 const f=fixture(),pending=deferred();f.read(()=>pending.promise);const result=f.restore();
 if(mode==='task')f.owner({serial:1,provider:'codex',threadId:'other',taskId:'task-B'});
 if(mode==='saved-chat')f.owner({serial:1,provider:'kimi',threadId:'other',taskId:null});
 if(mode==='owner-ABA'){f.owner({provider:'codex',threadId:'other',taskId:'task-B'});f.owner(null);}
 if(mode==='settings')f.settings({...settings,workerRoot:'/new'});
 if(mode==='settings-ABA'){f.settings({...settings,workerRoot:'/new'});f.settings({...settings});}
 if(mode==='binding')f.binding(null);if(mode==='close')f.close();
 pending.resolve(descriptor('/fixture/worker'));assert.equal((await result).status,'unknown');assert(!f.worker.connection);assert(!f.calls.some(call=>call.attach));f.close();
});

test('late global transport cannot leave an attached bridge after ownership changes during verification',async()=>{
 const f=fixture(),pending=deferred();f.attach(()=>pending.promise);const result=f.restore();await new Promise(resolve=>setImmediate(resolve));assert(f.worker.connection);f.owner({provider:'codex',threadId:'task-B',taskId:'task-B'});pending.resolve();assert.equal((await result).status,'unknown');assert(!f.worker.connection);f.close();
});

test('newer task restoration wins in the real WorkerClient, not just in ignored React state',async()=>{
 const f=fixture(),pending=deferred();let reads=0;f.read(target=>++reads===1?pending.promise:Promise.resolve(descriptor(target.workerRoot)));const global=f.restore();
 f.owner({serial:1,provider:'codex',threadId:'thread-B',taskId:'task-B'});f.tasks.set('task-B',{id:'task-B',provider:'codex',threadId:'thread-B',authoring:{workerBinding:{distribution:settings.distribution,root:'/fixture/task-B',port:8767}}});
 const task=restoreTaskWorker(f.context,{taskId:'task-B'});pending.resolve(descriptor('/fixture/worker'));assert.equal((await global).status,'unknown');assert.equal((await task).status,'connected');assert.equal(f.worker.identity.root,'/fixture/task-B');assert.deepEqual(f.calls.filter(v=>v.attach),[{attach:'/fixture/task-B'}]);f.close();
});

test('explicit Connect supersedes pending global restore before it can attach or close the newer bridge',async()=>{
 const f=fixture(),pending=deferred();f.read(()=>pending.promise);const global=f.restore();f.worker.open=async target=>{f.calls.push({explicit:target.workerRoot});f.worker.connection=descriptor(target.workerRoot).connection;f.worker.identity={distribution:target.distribution,root:target.workerRoot};return health(target.workerRoot);};const explicit=f.worker.connect({...settings,workerRoot:'/fixture/explicit'},'/synthetic-source');pending.resolve(descriptor('/fixture/worker'));assert.equal((await global).status,'unknown');await explicit;assert.equal(f.worker.identity.root,'/fixture/explicit');assert(!f.calls.some(v=>v.attach));f.close();
});

for(const kind of ['task','chat'])test('failed saved '+kind+' restoration never falls back to global last-explicit',async()=>{
 const f=fixture(),owner={provider:'codex',threadId:'saved',taskId:kind==='task'?'task':null,serial:1};f.owner(owner);if(kind==='task')f.tasks.set('task',{id:'task',provider:'codex',threadId:'saved'});else f.conversations.set('codex:saved',{id:'codex:saved',provider:'codex',threadId:'saved',projectId:null,taskId:null});
 assert.equal((await restoreTaskWorker(f.context,kind==='task'?{taskId:'task'}:{conversationId:'codex:saved'})).status,'disconnected');assert.deepEqual(f.calls,[]);assert.equal((await f.restore()).status,'unknown');assert.deepEqual(f.calls,[]);f.close();
});

test('workflow context revision detects no-owner ABA even though current() is null again',()=>{
 const context=createAgentWorkflowContext({records:{deleted:()=>false,bound:()=>null,conversation:()=>null},activeTasks:new Map(),selectedProvider:()=> 'codex'});const initial=context.revision();context.begin('codex',null);context.clear('codex');assert.equal(context.current(),null);assert(context.revision()>initial);
});

for(const mode of ['settings','settings-ABA','owner-ABA','task-B'])test('actual main restore registration rejects late global attachment after '+mode,async()=>{
 const file=process.env.STUDIO_GLOBAL_MAIN_SOURCE||new URL("../../desktop/main.mjs",import.meta.url),source=fs.readFileSync(file,'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let registration;const visit=n=>{if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(parsed)==='handle'&&n.expression.arguments[0]?.text==='worker.restore')registration=n;n.forEachChild(visit);};visit(parsed);assert(registration);
 const f=fixture(),handlers=new Map(),pending=deferred();f.read(()=>pending.promise);const setSettings=new Function('handle','restoreTaskWorker','taskRecords','catalog','worker','settings','workflowContext',registration.getText(parsed)+';return value=>settings=value;')((name,fn)=>handlers.set(name,fn),restoreTaskWorker,f.context.records,f.context.catalog,f.worker,{...settings},{current:f.context.selection,revision:f.context.selectionEpoch});const result=handlers.get('worker.restore')({scope:'global'});
 if(mode==='settings')setSettings({...settings,workerRoot:'/new'});if(mode==='settings-ABA'){setSettings({...settings,workerRoot:'/new'});setSettings({...settings});}if(mode==='owner-ABA'){f.owner({provider:'codex',threadId:'saved',taskId:null});f.owner(null);}if(mode==='task-B')f.owner({provider:'codex',threadId:'task-B',taskId:'task-B'});pending.resolve(descriptor('/fixture/worker'));assert.equal((await result).status,'unknown');assert(!f.worker.connection);assert(!f.calls.some(v=>v.attach));f.close();
});

test('global restoration neither closes nor rebinds a different existing active service',async()=>{const f=fixture();f.worker.connection=descriptor('/another-service').connection;f.worker.identity={distribution:settings.distribution,root:'/another-service'};const current=f.worker.connection;assert.equal((await f.restore()).status,'unknown');assert.equal(f.worker.connection,current);assert.deepEqual(f.calls,[]);f.close();});

test('actual sender-validated main registration and unchanged preload whitelist handle only typed safe global requests',async()=>{
 const file=process.env.STUDIO_GLOBAL_MAIN_SOURCE||new URL("../../desktop/main.mjs",import.meta.url),source=fs.readFileSync(file,'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const funcs=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&['trusted','handle'].includes(n.name?.text)).map(n=>n.getText(parsed));let statement;const visit=n=>{if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(parsed)==='handle'&&n.expression.arguments[0]?.text==='worker.restore')statement=n;n.forEachChild(visit);};visit(parsed);assert(statement);
 const f=fixture(),handlers=new Map(),window={isDestroyed:()=>false,webContents:{id:7,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}},sender={id:7,isDestroyed:()=>false};
 new Function('ipcMain','window','shuttingDown','restoreTaskWorker','taskRecords','catalog','worker','settings','workflowContext',funcs.join('\n')+'\n'+statement.getText(parsed))({handle:(name,fn)=>handlers.set(name,fn)},window,false,restoreTaskWorker,f.context.records,f.context.catalog,f.worker,settings,{current:f.context.selection,revision:f.context.selectionEpoch});
 const handle=handlers.get('studio:worker.restore'),event={sender,senderFrame:{url:window.webContents.getURL()}};
 for(const invalid of [{...event,sender:{...sender,id:8}},{...event,senderFrame:{url:'https://invalid.example'}},{...event,senderFrame:{url:window.webContents.getURL(),parent:{}}}])await assert.rejects(handle(invalid,{scope:'global'}),/Untrusted/);
 await assert.rejects(handle(event,{scope:'global',root:'/arbitrary'}),/Invalid typed/);assert.deepEqual(f.calls,[]);assert.equal((await handle(event,{scope:'global'})).status,'connected');f.close();
});

for(const mode of ['ordinary-chat-first-target','new-planning'])test('unassigned '+mode+' still bootstraps its own authoring context without selecting a formal project',async()=>{
 const saved=new Map(),catalog={get:(kind,id)=>structuredClone(saved.get(kind+':'+id)),put:(kind,id,value)=>{saved.set(kind+':'+id,structuredClone(value));return value;},list:kind=>[...saved.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value)),remove:(kind,id)=>saved.delete(kind+':'+id)},records=new TaskRecords(catalog,()=>{}),f=fixture();
 const unrelated={id:'formal-project',policy:{engines:['pydyn.md'],environments:['registered-env']}};catalog.put('projects',unrelated.id,unrelated);
 if(mode==='ordinary-chat-first-target'){records.remember({provider:'codex',threadId:'fresh',projectId:null,intent:'Ordinary chat'});assert.equal(await ensureTaskAuthoring(records,f.worker,{provider:'codex',threadId:'fresh'}),null);assert.deepEqual(f.calls,[]);}
 const task=records.create({provider:'codex',threadId:'fresh',projectId:null,planningMode:true,workflowVersion:2,request:'First explicitly requested scientific authoring target'});assert.equal(task.projectId,null);assert.equal(records.conversation('codex','fresh').projectId,null);
 await f.restore();const authoringCalls=[];f.worker.request=async(method,target,value)=>{authoringCalls.push({method,target,value});assert.equal(method,'POST');assert.equal(target,'/api/authoring/context');assert(!value.project_id);return {project:{id:'draft-'+task.id,authoring_only:true,authoring_task_id:task.id,policy:{engines:[],clusters:[],environments:['registered-env']}},environment_id:'registered-env',input_root:'/fixture/worker/projects/draft-'+task.id+'/inputs',imports:[],execution_authorized:false};};
 const result=await ensureTaskAuthoring(records,f.worker,{provider:'codex',threadId:'fresh',taskId:task.id,text:'Author inputs only'}),current=records.read(task.id),conversation=records.conversation('codex','fresh');
 assert.equal(current.projectId,'draft-'+task.id);assert.equal(conversation.projectId,current.projectId);assert.equal(current.authoring.environmentId,'registered-env');assert.equal(current.authoring.authoringOnly,true);assert.equal(result.context.execution_authorized,false);assert.deepEqual(result.context.project.policy.engines,[]);assert.deepEqual(result.context.project.policy.clusters,[]);assert(result.text.includes('write_project_input'));assert(result.text.includes('project_id='+current.projectId));assert.deepEqual(catalog.get('projects',unrelated.id),unrelated);assert.equal(authoringCalls.length,1);assert(!current.execution);assert(!current.deployment?.prepared);assert.deepEqual(current.authoring.workerBinding,{distribution:settings.distribution,root:'/fixture/worker',port:8767});f.close();
});
