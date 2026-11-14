import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual as equal} from 'node:util';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {connectionServiceFixture} from '../helpers/ssh-connection-service-fixture.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';
import {createTerminalHandoff} from '../../agent/sessions/terminal-handoff.mjs';
import {createServiceHandoff} from '../../agent/sessions/service-handoff.mjs';
import {createAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {CodexBridge,PROTOCOL_VERSION} from '../../agent/providers/codex.mjs';
import {DshBridge} from '../../agent/providers/dsh.mjs';
import {codexRuntime} from '../../desktop/platform/codex-runtime.mjs';
import {apply as applyDshPolicy} from '../../agent/providers/dsh-policy.mjs';
import {resolveDshRuntime} from '../../desktop/platform/dsh-runtime.mjs';
import {createComposerDrafts} from '../../frontend/features/conversations/composer-drafts.mjs';

const terminalNames=['list_shared_terminals','read_shared_terminal','write_shared_terminal'];
const tool=name=>({name,description:'Inert local capability fixture',inputSchema:{type:'object',properties:{}}});
const clone=value=>structuredClone(value),scope=value=>Object.fromEntries(['provider','threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,value?.[key]??null]));
const threadId='saved-existing-thread',historicalTurn={id:'saved-completed-turn',status:'completed',items:[{type:'userMessage',text:'Earlier inert question'},{type:'agentMessage',text:'Earlier saved reply'}]};
async function rpc(endpoint,method,name){return fetch(endpoint.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+endpoint.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...name?{params:{name,arguments:{}}}:{}})});}
async function inventory(endpoint){const response=await rpc(endpoint,'tools/list');assert.equal(response.status,200);return (await response.json()).result.tools.map(value=>value.name);}

// Real controller, WorkerClient/TerminalMcp HTTP servers, workflow context and
// AgentHub. Only the remote SSH transport and CLI child processes are inert ports.
// Native JSONL adapters remain real; no model turn or real scheduler is executed.
async function fixture(t,provider='codex'){
 let workflowContext,hub,grant=null,preparingEndpoint;
 const f=connectionServiceFixture(t,{current:()=>workflowContext?.current()||null}),rows=new Map(),calls=[],rawCalls=[],inventories=[];
 const catalog={get:(kind,id)=>clone(rows.get(kind+':'+id)),put:(kind,id,value)=>{rows.set(kind+':'+id,clone(value));return clone(value);},list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>clone(value))};
 const records=new TaskRecords(catalog,()=>{});records.remember({provider,threadId,projectId:null,name:'Existing saved chat'});
 workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>hub?.active||provider});workflowContext.begin(provider,threadId);
 const session={sessionId:'shell-A',connectionId:'A',kind:'ssh',owner:'human',ownerEpoch:1,alive:true,expired:false,resource:{kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1}};
 const shared={tools:()=>terminalNames.map(tool),reconcileContext(){if(grant&&!equal(grant,scope(workflowContext.current())))grant=null;},hasCurrentGrant(p,id){return !!(grant&&session.owner==='agent'&&p===grant.provider&&(!id||id===session.sessionId)&&equal(grant,scope(workflowContext.current())));},list:async()=>({sessions:[clone(session)]}),resourceState:async()=>({sessionId:session.sessionId,resource:clone(session.resource),operator:session.owner,ownerEpoch:session.ownerEpoch,alive:true,processStatus:'running'}),owner:async(value,{assertCurrent=()=>{}}={})=>{assertCurrent();assert.equal(value.sessionId,session.sessionId);assert.equal(value.ownerEpoch,session.ownerEpoch);session.owner=value.owner;session.ownerEpoch++;grant=value.owner==='agent'?scope(workflowContext.current()):null;return clone(session);},callTool:async(name,args,caller)=>{assert(shared.hasCurrentGrant(caller.provider),'Actual raw shell use needs its independent grant');assert(equal(grant,scope(caller)));assert.equal(caller.checkCurrent(),true);rawCalls.push(name);return {fixtureOnly:true,name};}};
 const terminal=new TerminalMcp({terminal:shared});await terminal.start();t.after(()=>terminal.close());
 f.worker.setLocalTools(shared.tools(),(name,args,caller)=>shared.callTool(name,args,caller));
 f.worker.setResourceUseGuard((p,caller,name)=>terminalNames.includes(name)?shared.hasCurrentGrant(p)&&equal(grant,scope(caller)):f.service.hasCurrentGrant(p,caller));
 const original=f.connections.serviceRequest;f.connections.serviceRequest=async packet=>{
  if(!packet.mcp)return original(packet);f.calls.push({request:clone(packet)});const body=packet.data;
  return {status:200,data:{jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[tool('list_clusters'),tool('present_task')]}:{content:[{type:'text',text:'[]'}]}}};
 };
 f.resource.status=async()=>({...f.resource.peek(),status:'selected',connectionStatus:'authenticated',authentication:'verified'});
 await f.connect();assert.equal(f.service.peek().status,'connected',JSON.stringify(f.service.peek()));
 const routing=createAgentResourceRouting({worker:f.worker,terminal:()=>terminal,resource:()=>f.resource,sharedTerminal:()=>shared,agents:()=>hub,service:()=>f.service});
 const cwd=path.resolve('.studio/dev15-capability-protocol/inert-workspace'),isolation={cwd,instructions:path.join(cwd,'instructions.md'),config:{},ambientCount:0};
 function child(reply){const value=new EventEmitter();value.stdout=new PassThrough();value.stderr=new PassThrough();value.stdin=new PassThrough();value.kill=()=>{};value.stdin.on('data',raw=>{const message=JSON.parse(raw);calls.push({method:message.method,params:clone(message.params)});assert(!['thread/start','turn/start','session/create','session/prompt'].includes(message.method),'Handoffs must not start a thread, model turn or replay an input');if(message.id!==undefined)void Promise.resolve(reply(message,value)).then(result=>value.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n'));});return value;}
 const codexHost={...codexRuntime,execute:async()=>({stdout:'codex-cli '+PROTOCOL_VERSION}),prepareIsolation:async(_exe,_root,_config,endpoint)=>{preparingEndpoint=endpoint;return isolation;},verifyIsolation:async()=>{inventories.push(await inventory(preparingEndpoint));return {status:'verified'};},spawnProcess:()=>child(message=>message.method==='initialize'?{userAgent:'inert-protocol',codexHome:path.resolve('.studio/dev15-capability-protocol/inert-home'),platformFamily:'windows',platformOs:'windows'}:message.method==='thread/resume'||message.method==='thread/read'?{thread:{id:message.params.threadId,turns:[clone(historicalTurn)]},cwd,instructionSources:[]}:{} )};
 const codex=new CodexBridge({strictIsolation:true,isolationRoot:cwd,host:codexHost});
 const dshHost={resolve:()=>({file:'inert-dsh',args:[],version:'fixture'}),prepare:(_root,_runtime,endpoint)=>{preparingEndpoint=endpoint;return {args:[],cwd,env:{}};},spawn:()=>child(async(message,value)=>{if(message.method==='initialize'){const names=await inventory(preparingEndpoint);inventories.push(names);value.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'studio/dshIsolation',params:{status:'verified',nativeTools:0,tools:names.map(name=>'mcp__gpusampling__'+name),models:[]}})+'\n');return {serverInfo:{name:'deepseek-harness-sdk-runtime'}};}assert.equal(message.method,'session/resume');assert.equal(message.params.sessionId,'saved-native-dsh-thread');return {};})};
 if(provider==='deepseek')catalog.put('deepseek-dsh-history',threadId,{schemaVersion:1,harness:'dsh',id:threadId,nativeId:'saved-native-dsh-thread',nativeStarted:true,name:'Existing saved chat',model:'fixture-model',effort:'off',toolContext:{mode:'chat'},turns:[clone(historicalTurn)],updatedAt:1});
 hub=new AgentHub({codex,root:process.cwd(),catalog,vault:{get:()=>({apiKey:'inert-fixture-api-key'})},settings:()=>({codexPath:'inert-codex',agent:{}}),worker:p=>routing.providerConnection(p),releaseWorker:p=>{f.worker.revokeProvider(p);terminal.revokeProvider(p);},bindWorkerContext:(p,context,options)=>routing.bindWorkerContext(p,context,options),resourceScope:(p,method)=>routing.scope(p,method),fetchApi:async()=>new Response(JSON.stringify({data:[{id:'fixture-model'}]}),{headers:{'Content-Type':'application/json'}}),apiBridgeFactories:{deepseek:options=>new DshBridge({...options,host:dshHost})}});t.after(()=>hub.close());
 const agentRpc=createAgentRequests({runtime:()=>({agents:hub,catalog,taskRecords:records,workflowContext,resourceRouting:routing,worker:f.worker,sharedTerminal:shared,assertIdleAgent(){},emit(){}})});
 const shellHandoff=createTerminalHandoff({terminal:shared,workflowContext,agents:hub,records,resourceRouting:routing,agentRpc,assertIdle(){}}),serviceHandoff=createServiceHandoff({service:f.service,workflowContext,agents:hub,records,resourceRouting:routing,agentRpc,assertIdle(){}});
 const storage=new Map(),drafts=createComposerDrafts(()=>({getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}),()=> 'inert-new-draft');drafts.activate(provider,threadId);drafts.edit('尚未发送的输入；切换能力后保留');
 return {...f,provider,catalog,records,workflowContext,hub,routing,terminal,shared,session,calls,rawCalls,inventories,drafts,storage,agentRpc,shellHandoff,serviceHandoff,serviceIntent:{connectionId:'A',attemptId:'attempt-A',owner:'agent',provider},shellIntent:()=>({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch,owner:'agent',provider})};
}

test('actual MCP and official DSH adapter expose exactly three tools for shell-only use and restore service inventory after its separate grant',async t=>{
 const f=await fixture(t,'deepseek');await f.shellHandoff.owner(f.shellIntent());
 const endpoint=f.routing.providerConnection('deepseek');assert.equal(endpoint.transport,'desktop-terminal');assert.deepEqual(await inventory(endpoint),terminalNames);assert.equal(f.service.hasCurrentGrant('deepseek'),false);
 assert.equal((await rpc(endpoint,'tools/call','read_shared_terminal')).status,200);assert.deepEqual(f.rawCalls,['read_shared_terminal']);
 const denied=await rpc(f.worker.providerConnection('deepseek'),'tools/call','list_clusters');assert.equal(denied.status,403);
 const runtime=resolveDshRuntime(),previous=process.env.GSS_MCP_TOKEN,definitions=[];process.env.GSS_MCP_TOKEN=endpoint.tokens.mcp;t.after(()=>{if(previous===undefined)delete process.env.GSS_MCP_TOKEN;else process.env.GSS_MCP_TOKEN=previous;});
 await applyDshPolicy({tools:{register:def=>definitions.push(def),guard(){},schemas:()=>definitions},systemPrompt:{section(){}},on(){},effect(){}},{workerUrl:endpoint.url+'/mcp',mcpModule:runtime.mcpModule,toolsModule:runtime.toolsModule,workflow:false,instructions:'Inert local engineering fixture',models:[]});
 assert.deepEqual(definitions.map(value=>value.name),terminalNames.map(name=>'mcp__gpusampling__'+name));await definitions.find(value=>value.name.endsWith('read_shared_terminal')).execute({},{signal:new AbortController().signal});
 await f.serviceHandoff.owner(f.serviceIntent);assert.equal(f.service.hasCurrentGrant('deepseek'),true);assert.equal(f.routing.providerConnection('deepseek').transport,'ssh-connection');assert.deepEqual(await inventory(f.routing.providerConnection('deepseek')),['list_clusters','present_task',...terminalNames]);assert.equal((await rpc(f.routing.providerConnection('deepseek'),'tools/call','list_clusters')).status,200);
});

for(const provider of ['codex','deepseek'])test(provider+' actual AgentHub and JSONL adapter preserve one saved conversation and its unsent draft across both capability directions',async t=>{
 const f=await fixture(t,provider),original=f.records.conversation(provider,threadId),draft=clone([...f.storage]);
 await f.shellHandoff.owner(f.shellIntent());assert.equal(f.routing.providerConnection(provider).transport,'desktop-terminal');const shellProcess=f.hub.bridge(provider).process;
 await f.serviceHandoff.owner(f.serviceIntent);assert.equal(f.routing.providerConnection(provider).transport,'ssh-connection');assert.notEqual(f.hub.bridge(provider).process,shellProcess);const serviceProcess=f.hub.bridge(provider).process,serviceEndpoint=f.routing.providerConnection(provider);assert.equal(f.hub.bridgeWorkers.get(provider).tokens.mcp,serviceEndpoint.tokens.mcp,'No post-proof endpoint/token switch');
 await f.serviceHandoff.owner({...f.serviceIntent,owner:'human'});assert.equal(f.shared.hasCurrentGrant(provider),true);assert.equal(f.routing.providerConnection(provider).transport,'desktop-terminal');
 // Returning service use is immediate. The next explicit context read resumes
 // the same saved conversation on its independently granted shell endpoint.
 await f.agentRpc({provider,method:'thread/resume',params:{threadId}});assert.notEqual(f.hub.bridge(provider).process,serviceProcess);assert.equal(f.hub.bridgeWorkers.get(provider).transport,'desktop-terminal');assert.deepEqual(await inventory(f.routing.providerConnection(provider)),terminalNames);
 assert.equal(f.workflowContext.current().threadId,threadId);assert.equal(f.hub.contexts.get(provider).threadId,threadId);assert.deepEqual(f.records.conversation(provider,threadId),original);assert.equal(f.records.conversations().length,1);assert.deepEqual([...f.storage],draft);assert.equal(f.drafts.text(),'尚未发送的输入；切换能力后保留');assert.deepEqual(f.drafts.owner(),{provider,threadId});
 const nativeResumes=f.calls.filter(value=>value.method===(provider==='codex'?'thread/resume':'session/resume'));assert(nativeResumes.length>=3);assert(nativeResumes.every(value=>value.params[provider==='codex'?'threadId':'sessionId']===(provider==='codex'?threadId:'saved-native-dsh-thread')));assert(f.inventories.some(names=>equal(names,terminalNames)));assert(f.inventories.some(names=>names.includes('list_clusters')));assert(!f.calls.some(value=>['thread/start','turn/start','session/create','session/prompt'].includes(value.method)));
});

for(const first of ['service','terminal'])test('a newer '+(first==='service'?'terminal':'service')+' handoff supersedes the old '+first+' transaction without granting it or releasing the newer discovery ticket',async t=>{
 const f=await fixture(t),gates=Array.from({length:2},()=>{let release,entered;return {wait:new Promise(r=>release=r),arrived:new Promise(r=>entered=r),release:()=>release(),enter:()=>entered()};}),select=f.hub.selectContext.bind(f.hub);let selecting=0;
 f.hub.selectContext=async(...args)=>{const index=selecting++;const value=await select(...args);if(index<gates.length){gates[index].enter();await gates[index].wait;}return value;};t.after(()=>gates.forEach(gate=>gate.release()));
 const handoff=capability=>capability==='service'?f.serviceHandoff.owner(f.serviceIntent):f.shellHandoff.owner(f.shellIntent());
 const pending=handoff(first),rejected=assert.rejects(pending,/handoff_changed/);await gates[0].arrived;const second=handoff(first==='service'?'terminal':'service');await gates[1].arrived;gates[0].release();await rejected;
 assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.shared.hasCurrentGrant('codex'),false);assert.equal(f.routing.providerConnection('codex').transport,first==='service'?'desktop-terminal':'ssh-connection');assert.throws(()=>f.routing.scope('codex','turn/start').assertCurrent(),/交接/);assert.equal((await rpc(f.worker.providerConnection('codex'),'tools/call','list_clusters')).status,403);
 gates[1].release();await second;assert.equal(f.service.hasCurrentGrant('codex'),first==='terminal');assert.equal(f.shared.hasCurrentGrant('codex'),first==='service');assert.equal(f.workflowContext.current().threadId,threadId);assert(!f.calls.some(value=>['thread/start','turn/start','session/create','session/prompt'].includes(value.method)));
});

test('late shell owner acknowledgement cannot install its superseded grant or revoke the newer proven service grant',async t=>{
 const f=await fixture(t);let entered,release;const arrived=new Promise(r=>entered=r),wait=new Promise(r=>release=r),owner=f.shared.owner;f.shared.owner=async(value,options)=>{entered();await wait;return owner(value,options);};t.after(()=>release());
 const pending=f.shellHandoff.owner(f.shellIntent()),rejected=assert.rejects(pending,/handoff_changed/);await arrived;
 await f.serviceHandoff.owner(f.serviceIntent);assert.equal(f.service.hasCurrentGrant('codex'),true);const state=clone(f.service.peek());release();await rejected;
 assert.equal(f.shared.hasCurrentGrant('codex'),false);assert.equal(f.service.hasCurrentGrant('codex'),true);assert.deepEqual(f.service.peek(),state);assert.equal(f.routing.providerConnection('codex').transport,'ssh-connection');assert.equal((await rpc(f.routing.providerConnection('codex'),'tools/call','list_clusters')).status,200);assert.equal(f.workflowContext.current().threadId,threadId);
});

test('a superseded post-proof service transaction cannot roll back the already proven service grant retained by the newer shell handoff',async t=>{
 const f=await fixture(t),select=f.hub.selectContext.bind(f.hub);let entered,release,count=0;const arrived=new Promise(r=>entered=r),wait=new Promise(r=>release=r);f.hub.selectContext=async(...args)=>{const index=++count,result=await select(...args);if(index===3){entered();await wait;}return result;};t.after(()=>release());
 const pending=f.serviceHandoff.owner(f.serviceIntent),rejected=assert.rejects(pending,/handoff_changed/);await arrived;assert.equal(f.service.hasCurrentGrant('codex'),true);
 await f.shellHandoff.owner(f.shellIntent());assert.equal(f.shared.hasCurrentGrant('codex'),true);const ready=clone(f.service.peek()),endpoint=f.routing.providerConnection('codex');release();await rejected;
 assert.deepEqual(f.service.peek(),ready);assert.equal(f.service.hasCurrentGrant('codex'),true);assert.equal(f.shared.hasCurrentGrant('codex'),true);assert.equal(f.hub.bridgeWorkers.get('codex').tokens.mcp,endpoint.tokens.mcp);assert.equal((await rpc(endpoint,'tools/call','list_clusters')).status,200);assert.equal(f.workflowContext.current().threadId,threadId);
});
