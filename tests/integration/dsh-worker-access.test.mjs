import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';
import {apply as applyDshPolicy} from '../../agent/providers/dsh-policy.mjs';
import {DshBridge} from '../../agent/providers/dsh.mjs';
import {dshRuntime,resolveDshRuntime} from '../../desktop/platform/dsh-runtime.mjs';

const emptyPolicy=()=>({blocked_project_ids:[],blocked_run_ids:[],bindings:[],blocked_paths:[]});
const discovery=['list_clusters','compute_readiness','list_workflows','list_projects'];
const toolFields={read_project_input:{project_id:{type:'string'},name:{type:'string'}},read_runtime_guide:{environment_id:{type:'string'}},run_status:{run_id:{type:'string'}}};
const tools=[...discovery,...Object.keys(toolFields)].map(name=>({name,description:'Local engineering fixture',inputSchema:{type:'object',properties:toolFields[name]||{}}}));
const content=value=>({content:[{type:'text',text:JSON.stringify(value)}]});

// Execute the actual official MCP tool adapter against the actual WorkerClient
// HTTP proxy and service transport. No model, SSH process or real user state is used.
async function fixture(t,{withTask=false,granted=true}={}){
 const worker=new WorkerClient(),activeTasks=new Map(),calls=[],definitions=[];
 const task={id:'owned-task',provider:'deepseek',threadId:'owned-thread',projectId:'owned-project',parameters:{files:['/fixture/projects/owned-project/inputs/input.xyz']},authoring:{projectId:'owned-project',environmentId:'owned-env',inputRoot:'/fixture/projects/owned-project/inputs'},artifacts:[{kind:'run',id:'owned-run'}]};
 if(withTask)activeTasks.set('deepseek',task.id);
 const records={read:id=>{assert.equal(id,task.id);return task;},deleted:()=>false,bound:(provider,threadId)=>provider===task.provider&&threadId===task.threadId?task:null};
 const state={policy:emptyPolicy(),granted,onTool:null,result:null};
 const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/fixture',runtime:'/fixture/runtime',runtime_id:'a'.repeat(20),port:8767,hostIdentity:{hostname:'fixture-only',uid:1000,machineId:'fixture-machine'}};
 worker.setAuthoringGuard(createPrivateCvAccess({records,worker,activeTasks}));
 worker.setResourceUseGuard((provider,scope)=>state.granted&&provider==='deepseek'&&scope.provider===provider&&scope.threadId===task.threadId&&scope.taskId===(withTask?task.id:null));
 await worker.attachServiceTransport({health,identity:{kind:'ssh',root:health.root,runtimeId:health.runtime_id,hostIdentity:health.hostIdentity},target:{sessionId:'fixture-session'},request:async packet=>{
  if(packet.path==='/api/health')return {status:200,data:health};
  if(packet.path==='/api/custom-cv/access'){assert.equal(packet.mcp,false);return {status:200,data:structuredClone(state.policy)};}
  assert.equal(packet.path,'/mcp');assert.equal(packet.mcp,true);
  const body=packet.data;assert.equal(body.jsonrpc,'2.0');assert(Number.isSafeInteger(body.id));
  if(body.method==='tools/list')return {status:200,data:{jsonrpc:'2.0',id:body.id,result:{tools:structuredClone(tools)}}};
  assert.equal(body.method,'tools/call');calls.push(structuredClone(body.params));await state.onTool?.(body.params);
  return {status:200,data:{jsonrpc:'2.0',id:body.id,result:content(state.result??{fixtureOnly:true,tool:body.params.name})}};
 }});
 worker.bindProviderContext('deepseek',{threadId:task.threadId,taskId:withTask?task.id:null,projectId:withTask?task.projectId:null,environmentId:withTask?task.authoring.environmentId:null,inputRoot:withTask?task.authoring.inputRoot:null});
 const connection=worker.providerConnection('deepseek'),runtime=resolveDshRuntime(),previous=process.env.GSS_MCP_TOKEN;
 process.env.GSS_MCP_TOKEN=connection.tokens.mcp;
 t.after(()=>{if(previous===undefined)delete process.env.GSS_MCP_TOKEN;else process.env.GSS_MCP_TOKEN=previous;worker.close();});
 const context={tools:{register:def=>definitions.push(def),guard(){},schemas:()=>definitions},systemPrompt:{section(){}},on(){},effect(){}};
 await applyDshPolicy(context,{workerUrl:connection.url+'/mcp',mcpModule:runtime.mcpModule,toolsModule:runtime.toolsModule,workflow:withTask,taskId:withTask?task.id:null,instructions:'Local fixture only',models:[]});
 const execute=(name,args={})=>{const definition=definitions.find(def=>def.name==='mcp__gpusampling__'+name);assert(definition,'Actual DSH inventory must include '+name);return definition.execute(args,{signal:new AbortController().signal});};
 return {worker,task,state,calls,definitions,execute,revoke(){state.granted=false;worker.revokeProvider('deepseek');}};
}

test('actual DSH and WorkerClient permit granted SSH discovery before a workflow exists',async t=>{
 const f=await fixture(t);
 for(const name of discovery){const value=await f.execute(name);assert.equal(JSON.parse(value.content[0].text).tool,name);}
 assert.deepEqual(f.calls.map(call=>call.name),discovery);
 assert(f.definitions.every(def=>def.name.startsWith('mcp__gpusampling__')));
});

test('actual DSH discovery needs the current SSH grant and a revoked token cannot regain it',async t=>{
 const f=await fixture(t,{granted:false});
 await assert.rejects(f.execute('list_clusters'),/HTTP 403/);assert.equal(f.calls.length,0);
 f.state.granted=true;await f.execute('list_clusters');assert.equal(f.calls.length,1);
 f.revoke();await assert.rejects(f.execute('compute_readiness'),/HTTP 403/);assert.equal(f.calls.length,1);
});

test('grant revocation during an actual DSH read withholds the old service result without retry',async t=>{
 const f=await fixture(t);let entered,release;
 const arrived=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 t.after(()=>release?.());f.state.onTool=async()=>{entered();await gate;};f.state.result={privateFixture:'must not reach the adapter'};
 const pending=f.execute('list_workflows'),rejected=assert.rejects(pending,/HTTP 403/);
 await arrived;f.revoke();release();await rejected;assert.equal(f.calls.length,1);
});

test('actual DSH global discovery still rejects unshared private projects without a workflow',async t=>{
 const f=await fixture(t);f.state.policy={...emptyPolicy(),blocked_project_ids:['private-project'],blocked_run_ids:['private-run']};
 for(const name of discovery)await assert.rejects(f.execute(name),/unshared private workflow/);
 assert.equal(f.calls.length,0);
});

test('actual DSH keeps selected files, current environment and linked-run ownership',async t=>{
 const f=await fixture(t,{withTask:true});
 await f.execute('read_project_input',{project_id:f.task.projectId,name:'input.xyz'});
 await f.execute('read_runtime_guide',{environment_id:'owned-env'});await f.execute('run_status',{run_id:'owned-run'});
 await assert.rejects(f.execute('read_project_input',{project_id:'other-project',name:'input.xyz'}),/current conversation project/);
 await assert.rejects(f.execute('read_project_input',{project_id:f.task.projectId,name:'unselected.xyz'}),/not selected or generated/);
 await assert.rejects(f.execute('read_project_input',{project_id:f.task.projectId,name:'/home/fixture/.ssh/id_ed25519'}),/private-library, credential or unshared project paths/);
 await assert.rejects(f.execute('read_runtime_guide',{environment_id:'other-env'}),/current workflow environment/);
 await assert.rejects(f.execute('run_status',{run_id:'other-run'}),/runs linked/);
 assert.equal(f.calls.length,3);
});

test('actual DSH cannot read a current private workflow after sharing is withdrawn',async t=>{
 const f=await fixture(t,{withTask:true});
 f.state.policy={...emptyPolicy(),blocked_project_ids:[f.task.projectId],bindings:[{workspace_id:f.task.id,project_id:f.task.projectId,allowed:false,paths:[f.task.authoring.inputRoot+'/private.py']}]};
 for(const name of discovery)await assert.rejects(f.execute(name),/Private CV sharing/);
 await assert.rejects(f.execute('read_project_input',{project_id:f.task.projectId,name:'input.xyz'}),/Private CV sharing/);
 assert.equal(f.calls.length,0);
});

test('official DSH process completes a discovery tool turn through actual granted WorkerClient transport',{timeout:60000},async t=>{
 const f=await fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-worker-access-')),saved=new Map(),children=[];
 let apiCalls=0;
 const server=createServer(async(req,res)=>{
  assert.equal(req.url,'/v1/messages');let text='';for await(const chunk of req)text+=chunk;JSON.parse(text);apiCalls++;
  const tool=apiCalls===1,name='mcp__gpusampling__list_clusters';
  const events=[{type:'message_start',message:{id:'fixture-'+apiCalls,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}},{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:'fixture-tool',name,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:'{}'}:{type:'text_delta',text:'Local discovery complete'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:3}},{type:'message_stop'}];
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const bridge=new DshBridge({root,catalog:{get:(kind,id)=>saved.get(kind+':'+id),put:(kind,id,value)=>saved.set(kind+':'+id,structuredClone(value))},credential:()=>({apiKey:'fixture-local-dsh-key'}),worker:()=>f.worker.providerConnection('deepseek'),fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),host:{...dshRuntime,prepare:(...args)=>{const profile=dshRuntime.prepare(...args);profile.env.DEEPSEEK_BASE_URL=base;return profile;},spawn:(...args)=>{const child=dshRuntime.spawn(...args);children.push(child);return child;}}});
 t.after(async()=>{bridge.close();await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('close',resolve))));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert(path.basename(root).startsWith('studio-dsh-worker-access-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await bridge.start();const started=await bridge.request('thread/start'),firstToken=f.worker.providerConnection('deepseek').tokens.mcp;
 // Bind the actual new DSH conversation before granting it the read. A changed
 // provider lease must reach the subprocess rather than reuse its old token.
 f.task.threadId=started.thread.id;f.worker.bindProviderContext('deepseek',{threadId:started.thread.id});
 assert.notEqual(f.worker.providerConnection('deepseek').tokens.mcp,firstToken);
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local DSH tool turn did not complete')),20000);const listener=event=>{if(event.method==='turn/completed'){clearTimeout(timer);bridge.off('event',listener);resolve(event.params.turn);}};bridge.on('event',listener);t.after(()=>{clearTimeout(timer);bridge.off('event',listener);});});
 await bridge.request('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Read the available synthetic cluster inventory'}]});
 assert.equal((await done).status,'completed');assert.equal(apiCalls,2);assert.deepEqual(f.calls.map(call=>call.name),['list_clusters']);assert.equal(children.length,2);
 const items=bridge.session(started.thread.id).turns[0].items,tool=items.find(item=>item.type==='mcpToolCall');assert.equal(tool.status,'completed');assert.equal(tool.result.isError,false);
});
