import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {DshBridge} from '../../agent/providers/dsh.mjs';
import {dshRuntime} from '../../desktop/platform/dsh-runtime.mjs';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {fileURLToPath} from 'node:url';
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {STUDIO_INSTRUCTIONS,workspaceAgentInstructions} from '../../agent/context/agent-settings.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {createAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {managedToolReadiness} from '../../agent/tools/scientific-tool-readiness.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';

function reply(res,index,step,text){
 const events=[
  {type:'message_start',message:{id:'reply-'+index,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:step?{type:'tool_use',id:'tool-'+index,name:'mcp__gpusampling__'+step[0],input:{}}:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:step?{type:'input_json_delta',partial_json:JSON.stringify(step[1])}:{type:'text_delta',text}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:step?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:3}},
  {type:'message_stop'},
 ];
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
}

test('official DSH creates, reads and updates a personal skill in chat without a project, shell or worker', {timeout:60000}, async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-dsh-local-skill-'));
 const saved = new Map(), children = [];
 let current = {provider:'deepseek',threadId:null,projectId:null};
 const cache = path.join(root,'自定义 $& 缓存');
 const store = new ProjectSkills({root:cache,current:()=>current});
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const scientificSkills=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({}),setupAllowed:()=>false});
 fs.writeFileSync(path.join(root,'AGENTS.md'),'Consult the applicable workspace skill by scope.');
 const instructions=workspaceAgentInstructions({directory:root},store.personalDirectory);
 const endpoint = new TerminalMcp({terminal:{tools:()=>[]},projectSkills:store,scientificSkills});
 await endpoint.start();

 const name = 'studio-compute-workflow';
 const body = '---\nname: studio-compute-workflow\ndescription: Local skills regression\n---\nCheck the selected data.\n';
 const sha256 = value => createHash('sha256').update(value).digest('hex');
 const scope = {scope:'user'};
 const steps = [
  ['project_skill_catalog',scope],
  ['write_project_skill',{...scope,name,body,expected_sha256:null}],
  ['read_project_skill',{...scope,name}],
  ['write_project_skill',{...scope,name,body:body+'Verify.\n',expected_sha256:sha256(body)}],
  ['read_project_skill',{...scope,name}],
  ['scientific_skill_catalog',{}],
  ['read_scientific_skill',{function_id:'environment.probe'}],
 ];
 const packets = [];
 const model = createServer(async (req,res) => {
  let data=''; for await (const chunk of req) data+=chunk;
  const index=packets.length;
  packets.push(JSON.parse(data));
  reply(res,index,steps[index],'Local skill checked');
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const bridge=new DshBridge({
  root,instructions,catalog:{get:(k,id)=>saved.get(k+':'+id),put:(k,id,v)=>saved.set(k+':'+id,structuredClone(v))},
  credential:()=>({apiKey:'local-test'}),worker:()=>endpoint.providerConnection('deepseek'),
  fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),
  host:{...dshRuntime,prepare(...args){
   const profile=dshRuntime.prepare(...args);
   profile.env.DEEPSEEK_BASE_URL='http://127.0.0.1:'+model.address().port;
   return profile;
  },spawn(...args){const child=dshRuntime.spawn(...args);children.push(child);return child;}},
 });
 t.after(async()=>{
  bridge.close();
  await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?null:new Promise(resolve=>child.once('close',resolve))));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));endpoint.close();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 await bridge.start();
 const started=await bridge.request('thread/start');
 current={...current,threadId:started.thread.id};
 endpoint.bindProviderContext('deepseek',{threadId:current.threadId});
 const completion=()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('DSH skill turn timed out')),25000);
  const listener=e=>{if(e.method==='turn/completed'){clearTimeout(timer);bridge.off('event',listener);resolve(e.params.turn);}};
  bridge.on('event',listener);t.after(()=>{clearTimeout(timer);bridge.off('event',listener);});
 });
 const done=completion();
 await bridge.request('turn/start',{threadId:current.threadId,input:[{type:'text',text:'Save the local skill, check its revision, then find the public guide for inspecting my compute environment.'}]});
 assert.equal((await done).status,'completed');
 assert.equal(packets.length,steps.length+1);
 const first=packets[0],system=Array.isArray(first.system)?first.system.map(block=>block.text).join('\n'):first.system;
 assert(system.includes(instructions),'First DeepSeek system packet must carry the packaged core and the workspace index');
 assert.match(system,/写到本机工作区.*scope="user"/);
 assert.ok(system.includes(JSON.stringify(store.personalDirectory)));
 assert.match(system,/For conflicting steps, name both skills and ask the user to choose/);
 const tools=first.tools.map(tool=>tool.name.replace(/^mcp__gpusampling__/, ''));
 for(const name of ['project_skill_catalog','read_project_skill','write_project_skill','scientific_skill_catalog','read_scientific_skill'])assert(tools.includes(name),name);
 assert(!tools.includes('submit_run'));
 const entry='studio-compute-workflow/SKILL.md';
 const heading=fs.readFileSync(path.join(bundledRoot,entry),'utf8').split(/\r?\n/).find(line=>line.startsWith('# '));
 assert(heading);assert(!JSON.stringify(first).includes(heading),'A new chat starts from the index');
 const result=JSON.stringify(packets.at(-1).messages.at(-1));
 assert(result.includes(heading));assert(result.includes(entry));assert(result.includes('passed'));
 const items=bridge.session(current.threadId).turns[0].items.filter(item=>item.type==='mcpToolCall');
 assert.equal(items.length,steps.length);
 for(const item of items){assert.equal(item.status,'completed');assert.equal(item.result.isError,false);}
 for(const [index,expected] of [[2,body],[3,body],[4,body+'Verify.\n'],[5,body+'Verify.\n']]){
  assert(JSON.stringify(packets[index].messages.at(-1)).includes(sha256(expected)));
 }
 const file=path.join(cache,'user',name,'SKILL.md');
 assert.equal(JSON.parse(items[0].result.content[0].text).directory,path.dirname(path.dirname(file)));
 for(const item of items.slice(1,5))assert.equal(JSON.parse(item.result.content[0].text).path,file);
 assert.equal(fs.readFileSync(file,'utf8'),body+'Verify.\n');
 assert.equal(JSON.parse(items[2].result.content[0].text).scope,'user');
 assert.ok(!result.includes('Local skills regression'));
 const previousDirectory=store.personalDirectory,priorChildren=children.length;
 store.root=store.prepareRoot(path.join(root,'relocated'));
 bridge.instructions=workspaceAgentInstructions({directory:root},store.personalDirectory);
 const next=completion();
 await bridge.request('turn/start',{threadId:current.threadId,input:[{type:'text',text:'Check the changed library location.'}]});
 assert.equal((await next).status,'completed');
 assert.equal(children.length,priorChildren+1);
 // The pinned DeepSeek transport preserves the initial system message and appends later system revisions in history.
 const last=packets.at(-1);
 const latestSystem=last.messages.filter(message=>message.role==='system').at(-1)?.content??last.system;
 const refreshed=Array.isArray(latestSystem)?latestSystem.map(block=>block.text).join('\n'):latestSystem;
 assert.ok(refreshed.includes(JSON.stringify(store.personalDirectory)));
 assert.ok(!refreshed.includes(JSON.stringify(previousDirectory)));
});

test('restored official DSH conversation receives current hosted recovery and a service-only queue receipt', {timeout:60000}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-dsh-hosted-recovery-'));
 const saved=new Map(),children=[],packets=[],calls=[];
 const oldAdvice='This historical reply suggested signing in again and handing over a visible terminal.';
 const resource_id='ssh:fixture-host',resource={resourceId:resource_id,name:'Fixture cluster',serviceStatus:'ready',canAcquire:true,terminalAvailable:4};
 const retry={resource_id,access:'service'};
 const steps=[null,['list_compute_resources',{}],['read_scientific_skill',{function_id:'compute.queue'}],
  ['acquire_compute_resource',{resource_id,access:'terminal'}],['acquire_compute_resource',retry],
  ['inspect_compute_service',{resource_id,probe_scheduler:true}]];
 const model=createServer(async(req,res)=>{
  let data='';for await(const bytes of req)data+=bytes;
  const index=packets.length;packets.push(JSON.parse(data));
  reply(res,index,steps[index],index===0?oldAdvice:'Observed the fixture queue through its service.');
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const scientificSkills=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({})});
 const field={type:'string'},schema=properties=>({type:'object',properties,additionalProperties:false});
 const definitions=[
  {name:'list_compute_resources',inputSchema:schema({})},
  {name:'acquire_compute_resource',inputSchema:schema({resource_id:field,access:{enum:['service','terminal']}})},
  {name:'inspect_compute_service',inputSchema:schema({resource_id:field,probe_scheduler:{type:'boolean'}})},
 ];
 const desktopTools={tools:()=>definitions,owns:name=>definitions.some(tool=>tool.name===name),call(name,args){
  calls.push([name,args]);
  if(name==='list_compute_resources')return {resources:[resource]};
  if(name==='acquire_compute_resource'&&args.access==='terminal')
   return {status:'terminal_unavailable',code:'ssh_channel_unavailable',leaseStatus:'none',resource,retry};
  if(name==='acquire_compute_resource')return {status:'acquired',access:'service',resource};
  return {status:'observed',scheduler:'fixture-slurm',rows:1};
 }};
 const endpoint=new TerminalMcp({terminal:{tools:()=>[{name:'list_shared_terminals',inputSchema:schema({})}]},desktopTools,scientificSkills});
 await endpoint.start();
 const sessionId='hosted-recovery-fixture';
 const bridge=new DshBridge({root,instructions:STUDIO_INSTRUCTIONS,
  catalog:{get:(kind,id)=>saved.get(kind+':'+id),put:(kind,id,value)=>saved.set(kind+':'+id,structuredClone(value))},
  credential:()=>({apiKey:'isolated-placeholder'}),worker:()=>endpoint.providerConnection('deepseek',sessionId),
  fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),host:{...dshRuntime,prepare(...args){
   const profile=dshRuntime.prepare(...args);
   profile.env.DEEPSEEK_BASE_URL='http://127.0.0.1:'+model.address().port;
   return profile;
  },spawn(...args){const child=dshRuntime.spawn(...args);children.push(child);return child;}}});
 t.after(async()=>{
  bridge.close();
  await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?null:new Promise(resolve=>child.once('close',resolve))));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));endpoint.close();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 await bridge.start();
 const {thread:{id:threadId}}=await bridge.request('thread/start');
 endpoint.bindProviderContext('deepseek',{threadId},{sessionId,allowInitialFill:true});
 async function send(input){
  const completion=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('DSH hosted fixture timed out')),25000);
   const listener=event=>{if(event.method==='turn/completed'){clearTimeout(timer);bridge.off('event',listener);resolve(event.params.turn);}};
   bridge.on('event',listener);t.after(()=>{clearTimeout(timer);bridge.off('event',listener);});
  });
  await bridge.request('turn/start',{threadId,input:input.map(text=>({type:'text',text}))});
  const turn=await completion;
  assert.equal(turn.status,'completed',turn.error?.message);
  return turn;
 }
 await send(['Open the original engineering chat.']);
 assert(bridge.session(threadId).turns[0].items.some(item=>item.type==='agentMessage'&&item.text===oldAdvice));
 const nativeId=bridge.session(threadId).nativeId;
 const resumed=await bridge.request('thread/resume',{threadId});
 assert.equal(resumed.thread.id,threadId);
 const routing=createAgentResourceRouting({managed:()=>({})});
 await send(['Check queues on the same fixture cluster.',routing.turnContext('deepseek',threadId)]);
 assert.equal(bridge.session(threadId).nativeId,nativeId);
 assert.equal(bridge.session(threadId).turns.length,2);
 assert.equal(children.length,1,'The established Harness and native conversation remain in use');
 const fresh=JSON.stringify(packets[1]),received=JSON.stringify(packets);
 assert(fresh.includes(oldAdvice),'Restored model packet roles: '+JSON.stringify(packets[1].messages?.map(message=>message.role)));
 assert(fresh.includes('supersede historical tool definitions'));
 assert(fresh.includes('Current receipts supersede old handoff advice'));
 assert(fresh.includes('inspect_compute_service'));
 assert.match(fresh,/original saved profile.*live terminal or pending login/);
 assert.match(fresh,/confirmed lost.*sign in again on that profile/);
 assert.match(fresh,/verifies the same remote identity and workspace.*restores eligible conversation leases/);
 assert.match(fresh,/unknown jobs using their original IDs and receipts/);
 assert(!packets[1].tools.some(tool=>tool.name.endsWith('_shared_terminals')));
 assert(received.includes('Only an acquired terminal with its session receipt establishes a shell'));
 assert(received.includes('live SSH terminal restores the same verified channel'));
 assert(received.includes('enter authentication responses only in the private terminal'));
 assert(received.includes('terminal_unavailable')&&received.includes('leaseStatus')&&received.includes('retry'));
 assert.deepEqual(calls,steps.slice(1).filter(step=>step[0]!=='read_scientific_skill'));
 const [failedShell,served]=bridge.session(threadId).turns[1].items.filter(item=>item.tool==='acquire_compute_resource');
 assert.equal(failedShell.result.isError,true);
 assert.equal(served.result.isError,false);
 const capability=JSON.parse(served.result.content[0].text);
 assert.equal(capability.access,'service');
 assert.equal(Object.hasOwn(capability,'terminal'),false);
 assert(JSON.stringify(packets.at(-1)).includes('fixture-slurm'));
});

for(const correctTarget of [true,false])test(
 correctTarget?'official DSH can acquire the listed resource by ID after a short answer in the same chat':
  'official DSH receives the already chosen ID after suggesting another resource',
 {timeout:60000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-dsh-resource-choice-'));
 const saved=new Map(),children=[],packets=[],observations=[],actualRequests=[];
 const catalog={get:(kind,id)=>saved.get(kind+':'+id),put:(kind,id,value)=>saved.set(kind+':'+id,structuredClone(value))};
 const provider='deepseek',sessionId='chat-resource-choice-fixture',resource_id='ssh:chosen-fixture';
 // Use a synthetic label in the portable test. Local audits can pass a display
 // name to replay the exact conversation on this same isolated fixture.
 const displayName=process.env.AIMLAB_DSH_FIXTURE_RESOURCE_NAME||'甲号计算资源';
 const first='探测一下集群队列，我的自有队列哪些空卡？';
 const second='就是'+displayName;
 const asked='我找到了两条托管连接。请在这里告诉我用哪一条。';
 const selection={resource_id,access:'service'};
 const otherSelection=['acquire_compute_resource',{resource_id:'ssh:other-fixture',access:'service'}];
 const steps=[['list_compute_resources',{}],['read_scientific_skill',{function_id:'compute.queue'}],null,
  ...correctTarget?[]:[otherSelection],['acquire_compute_resource',selection],['inspect_compute_service',{resource_id,probe_scheduler:true}]];
 let resources,endpoint,bridge;
 const model=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const index=packets.length;packets.push(JSON.parse(body));
  reply(res,index,steps[index],index===2?asked:'读到了隔离夹具的调度回执。');
 });
 t.after(async()=>{
  bridge?.close();
  await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?null:new Promise(resolve=>child.once('close',resolve))));
  model.closeAllConnections();
  if(model.listening)await new Promise(resolve=>model.close(resolve));
  endpoint?.close();resources?.stop();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const profiles=new Map(),connections=new Map();
 resources=createManagedComputeResources({
  terminal:{connections:{state:async({connectionId})=>connections.get(connectionId),managedShell:()=>assert.fail('Queue inspection cannot open an SSH shell')}},
  profiles:{read:({id})=>profiles.get(id)},
  services:{ssh:async resource=>({id:'service-'+resource.profileId,generation:'generation-'+resource.profileId,schedulerInspection:true,verify:async()=>{},
   async forward(method,target,body,mcp,timeout){
    assert.deepEqual([method,target,body,mcp,timeout],['POST','/api/ssh-service/inspect-scheduler',{},false,15000]);
    observations.push(resource.resourceId);
    return {status:200,data:{status:'observed',observed_at:100,automatic_retry:false,observations:[
     {scheduler:'slurm',status:'observed',queues:[{name:'isolated-fixture',default:true,availability:'up',node_count:1,node_state:'idle',gres:'gpu:1'}]},
     {scheduler:'lsf',status:'not_found',queues:[]},
    ]}};
   }})},
 });
 for(const [id,name] of [['chosen-fixture',displayName],['other-fixture','另一个测试资源']]){
  const ref={connectionId:'connection-'+id,profileId:id,profileVersion:1};
  profiles.set(id,{id,name,kind:'ssh',version:1,host:id+'.invalid',port:22,username:'fixture',ssh_client:'ssh'});
  connections.set(ref.connectionId,{...ref,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}});
  await resources.publish(ref);await resources.refreshService(ref);
 }
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const scientificSkills=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({})});
 const gateway=createManagedComputeTools({resources,assertWorkflow:()=>assert.fail('Queue inspection cannot create or require a workflow')});
 endpoint=new TerminalMcp({terminal:{tools:()=>[]},desktopTools:{...gateway,call(name,args,scope){
  actualRequests.push([name,args]);return gateway.call(name,args,scope);
 }},scientificSkills});
 await endpoint.start();
 bridge=new DshBridge({root,catalog,instructions:STUDIO_INSTRUCTIONS,credential:()=>({apiKey:'isolated-placeholder'}),
  worker:()=>endpoint.providerConnection(provider,sessionId),fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),
  host:{...dshRuntime,prepare(...args){
   const profile=dshRuntime.prepare(...args);profile.env.DEEPSEEK_BASE_URL='http://127.0.0.1:'+model.address().port;return profile;
  },spawn(...args){const child=dshRuntime.spawn(...args);children.push(child);return child;}}});
 const taskRecords=new TaskRecords(catalog,()=>{});
 const workflowContext=createAgentWorkflowContext({records:taskRecords,activeTasks:new Map(),selectedProvider:()=>provider});
 const agents={selectContext:(selected,context)=>endpoint.bindProviderContext(selected,context,{sessionId,allowInitialFill:true}),
  rpc:(_provider,method,params)=>bridge.request(method,params)};
 const routing=createAgentResourceRouting({managed:()=>resources,resource:()=>null});
 const userMessages=[];
 const rpc=createAgentRequests({runtime:()=>({agents,catalog,taskRecords,workflowContext,resourceRouting:routing,scientificSkills,
  assertIdleAgent(){},emit(){},skillGuidanceScope:selected=>({provider:selected,checkCurrent:()=>true}),
  recordUserTurn:({provider,params})=>{
   const text=params.input[0].text;
   userMessages.push(text);
   resources.recordUserTurn({...workflowContext.current(),provider,threadId:params.threadId,text,turnId:params.studioTurnRequestId});
  },
 })});
 await bridge.start();
 const {thread:{id:threadId}}=await rpc({provider,method:'thread/start'});
 async function send(text,turnNumber){
  const done=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('DSH choice fixture timed out')),25000);
   const listener=event=>{if(event.method==='turn/completed'){clearTimeout(timer);bridge.off('event',listener);resolve(event.params.turn);}};
   bridge.on('event',listener);t.after(()=>{clearTimeout(timer);bridge.off('event',listener);});
  });
  await rpc({provider,method:'turn/start',params:{threadId,studioTurnRequestId:'choice-turn-'+turnNumber,input:[{type:'text',text}]}});
  assert.equal((await done).status,'completed');
 }
 await send(first,1);
 assert.deepEqual(actualRequests,[steps[0]],'The first turn only provides the resource list');
 assert.deepEqual(observations,[]);
 const nativeId=bridge.session(threadId).nativeId;
 assert.equal((await rpc({provider,method:'thread/resume',params:{threadId}})).thread.id,threadId);
 await send(second,2);
 assert.equal(bridge.session(threadId).nativeId,nativeId);
 assert.deepEqual(userMessages,[first,second]);
 assert.deepEqual(actualRequests,[steps[0],...steps.slice(3)]);
 const continuation=JSON.stringify(packets[3]);
 assert(continuation.includes(second)&&continuation.includes(asked));
 assert(continuation.includes('requires no desktop panel binding'));
 assert(continuation.includes('Follow its retry and requested access without asking again'));
 const managedItems=bridge.session(threadId).turns[1].items.filter(item=>item.type==='mcpToolCall');
 assert.deepEqual(managedItems.map(item=>item.result.isError),correctTarget?[false,false]:[false,false,false],
  managedItems.map(item=>item.result.content[0]?.text).join('\n'));
 if(!correctTarget){
  const correction=JSON.parse(managedItems[0].result.content[0].text);
  assert.equal(correction.status,'target_selected');
  assert.equal(correction.resource.resourceId,resource_id);
  assert.deepEqual(correction.retry,selection);
  assert(!Object.hasOwn(correction,'terminal'));
 }
 const [acquisitionItem,probeItem]=managedItems.slice(-2);
 const acquisition=JSON.parse(acquisitionItem.result.content[0].text);
 assert.equal(acquisition.status,'acquired');
 assert.equal(acquisition.resource.resourceId,resource_id);
 assert.equal(acquisition.access,'service');
 assert(!Object.hasOwn(acquisition,'terminal'));
 const probe=JSON.parse(probeItem.result.content[0].text);
 assert.equal(probe.project_access,'no_project');
 assert.equal(probe.terminal_available,false);
 assert.equal(probe.scheduler.status,'observed');
 assert.deepEqual(observations,[resource_id]);
 assert(JSON.stringify(packets.at(-1)).includes('isolated-fixture'));

 const connection=endpoint.providerConnection(provider,sessionId);
 const status=await managedToolReadiness({terminalMcp:endpoint,agents:{sessionIdentity:(p,id)=>p===provider&&id===threadId?{id:sessionId,threadId}:null,
  bridge:()=>bridge,toolConnection:()=>connection}},provider,threadId);
 assert.deepEqual(status,{status:'ready',count:3});
 assert.deepEqual(observations,[resource_id], 'Checking the tool channel must not send another scheduler probe');
});
