import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {scientificToolReadiness} from "../../agent/tools/scientific-tool-readiness.mjs";
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
import {createPrivateCvAccess} from "../../agent/tools/private-cv-access.mjs";
import {DEFINITION_ONLY_TOOLS,SHARED_TERMINAL_TOOL_NAMES} from "../../agent/tools/definition-scope.mjs";
import {WorkerClient} from "../../agent/tools/worker-client.mjs";
const clone=value=>structuredClone(value),h='a'.repeat(64);
const tool=name=>({name,inputSchema:{type:'object',properties:{}}});
const inventory=names=>({data:[{name:'gpusampling',tools:Object.fromEntries(names.map(name=>[name,tool(name)])),toolsError:null,resources:[],resourceTemplates:[]}],nextCursor:null});
async function fixture({selected='private'}={}){
 let provider='codex',policyCalls=0,probeCalls=0,inventoryCalls=0;
 const hooks={},tasks=new Map(),conversations=new Map(),deleted=new Set(),activeTasks=new Map();
 for(const kind of ['private','public']){
  const task={id:kind+'-task',provider:'codex',threadId:kind+'-thread',projectId:kind+'-project',parameterRevision:2,parameters:{engine:'pygas.build',files:[]},review:{status:'not_run'},authoring:{projectId:kind+'-project',environmentId:'env',inputRoot:'/owned/'+kind},composition:{graph_sha256:h}};
  if(kind==='private')task.customCv={id:'entry',specSha:h,codeSha:h,parametersSha:h,revision:'b'.repeat(32)};
  tasks.set(task.id,task);conversations.set('codex:'+task.threadId,{taskId:task.id,projectId:task.projectId});
 }
 const records={deleted:(p,id)=>deleted.has(p+':'+id),conversation:(p,id)=>clone(conversations.get(p+':'+id)),bound:(p,id)=>{const c=conversations.get(p+':'+id);return c?.taskId?clone(tasks.get(c.taskId)):null;},read:id=>{if(!tasks.has(id))throw Error('Unknown task');return clone(tasks.get(id));}};
 const policy={blocked_project_ids:[],blocked_run_ids:[],blocked_paths:[],bindings:[{workspace_id:'private-task',project_id:'private-project',allowed:true,paths:[]}]};
 const state={response:inventory(DEFINITION_ONLY_TOOLS),probe:{status:'ready',count:57,transport:'fixture',checkedAt:123}};
 const worker={connection:{url:'http://127.0.0.1:19000',tokens:{mcp:'synthetic',admin:'synthetic-admin'}},async probeTools(){probeCalls++;await hooks.probe?.();return clone(state.probe);},async request(method,target,args){assert.equal(method,'POST');assert.equal(target,'/api/custom-cv/access');assert.equal(args.provider,'codex');policyCalls++;await hooks.policy?.(policyCalls);return clone(policy);}};
 const workflowContext=createAgentWorkflowContext({records,activeTasks,selectedProvider:()=>provider});
 const select=async kind=>{const ticket=workflowContext.begin('codex',kind===null?null:kind+'-thread');await workflowContext.synchronize(ticket,async()=>{});};
 if(selected!==undefined)await select(selected);
 const requests=[];
 const codex={async request(...args){inventoryCalls++;requests.push(clone(args));await hooks.inventory?.();return clone(state.response);}};
 const privateAccess=createPrivateCvAccess({records,worker,activeTasks});
 const deps={worker,codex,records,privateAccess,workflowContext,selectedProvider:()=>provider};
 return {deps,worker,workflowContext,records,policy,tasks,conversations,deleted,hooks,state,requests,select,setProvider:value=>provider=value,counts:()=>({policyCalls,probeCalls,inventoryCalls}),run:provider=>scientificToolReadiness(deps,provider||'codex')};
}
const blocked=value=>{assert.equal(value.status,'blocked');assert.equal(value.count,0);};
test('A failed WSL connection exposes the bounded local diagnosis without probing or granting tools',async()=>{
 const f=await fixture({selected:null});f.worker.connection=null;f.worker.connectionFailure={code:'distribution_not_found',message:'未找到所选 WSL 发行版，请在设置的计算连接中更正名称。'};
 const result=await f.run();blocked(result);assert.equal(result.code,'distribution_not_found');assert.equal(result.message,f.worker.connectionFailure.message);assert.deepEqual(f.counts(),{policyCalls:0,probeCalls:0,inventoryCalls:0});
});

test('A trusted private workflow requires the actual seven scoped names, not public present_task or the base count',async()=>{
 const f=await fixture(),before=f.workflowContext.current(),result=await f.run();
 assert.equal(result.status,'ready');assert.equal(result.count,7);assert.equal(result.scope,'definition-only');assert.match(result.message,/七/);assert.deepEqual(f.workflowContext.current(),before);
 assert.deepEqual(f.requests,[['mcpServerStatus/list',{serverName:'gpusampling',detail:'full'},15000]]);
 assert.deepEqual(f.counts(),{policyCalls:2,probeCalls:1,inventoryCalls:1});
});
test('Switching to a public workflow retains the original present_task sentinel and full count',async()=>{
 const f=await fixture();assert.equal((await f.run()).count,7);await f.select('public');assert.equal((await f.run()).warning,true);f.state.response=inventory(['present_task','describe_engine']);
 const result=await f.run();assert.equal(result.status,'ready');assert.equal(result.count,57);assert.equal(result.scope,undefined);assert.equal('threadId' in f.requests.at(-1)[1],false);
});
test('Initial ordinary connection with no selected task remains public and does not query private policy',async()=>{
 const f=await fixture({selected:null});f.workflowContext.clear();f.state.response=inventory(['present_task']);assert.equal((await f.run()).status,'ready');assert.equal(f.counts().policyCalls,0);assert.equal('threadId' in f.requests[0][1],false);
});
test('A caller cannot select the private policy with mode data or a foreign provider',async()=>{
 const f=await fixture({selected:'public'});f.state.response=inventory(DEFINITION_ONLY_TOOLS);blocked(await scientificToolReadiness(f.deps,{provider:'codex',definitionOnly:true}));assert.equal(f.counts().probeCalls,0);assert.equal((await f.run()).warning,true);
 f.setProvider('kimi');blocked(await f.run());assert.equal(f.counts().probeCalls,1);
});
test('Context provider mismatch fails before probing even if the selected provider matches the argument',async()=>{const f=await fixture();f.setProvider('kimi');blocked(await f.run('kimi'));assert.equal(f.counts().probeCalls,0);});
test('A lineage binding also derives definition-only access without a task customCv field',async()=>{const f=await fixture();delete f.tasks.get('private-task').customCv;const result=await f.run();assert.equal(result.status,'ready');assert.equal(result.count,7);});
for(const name of DEFINITION_ONLY_TOOLS)test('Missing private tool '+name+' warns without granting extra tools',async()=>{const f=await fixture();f.state.response=inventory(DEFINITION_ONLY_TOOLS.filter(value=>value!==name));const v=await f.run();assert.equal(v.status,'ready');assert.equal(v.warning,true);assert.equal(v.count,6);assert.equal(v.scope,'definition-only');});
test('tool metadata warning preserves ordinary setup discussion and final authorization checks',async()=>{const f=await fixture({selected:'public'});f.state.probe={status:'warning',count:0};f.state.response=inventory([]);f.state.response.data[0].toolsError='not configured';const v=await f.run();assert.equal(v.status,'ready');assert.equal(v.warning,true);assert.match(v.message,/配置/);assert.equal(f.counts().policyCalls,2);});
for(const name of ['present_task','read_project_input','read_pygas_workflow','submit_run','unclassified_future_tool'])test('Extra private namespace tool '+name+' is never accepted',async()=>{const f=await fixture();f.state.response=inventory([...DEFINITION_ONLY_TOOLS,name]);blocked(await f.run());});
for(const variant of ['outsider-server','duplicate-server','page','tools-array','wrong-tool-name','null-tool','missing-server','resources','templates','missing-resources','missing-templates','malformed-resources','malformed-templates','malformed'])test('Malformed or broader private inventory '+variant+' is blocked',async()=>{
 const f=await fixture(),v=f.state.response,s=v.data[0];
 if(variant==='outsider-server')v.data.push({name:'outsider',tools:{}});
 if(variant==='duplicate-server')v.data.push(clone(s));
 if(variant==='page')v.nextCursor='more';
 if(variant==='tools-array')s.tools=[];
 if(variant==='wrong-tool-name')s.tools.read_custom_cv.name='read_project_input';
 if(variant==='null-tool')s.tools.read_custom_cv=null;
 if(variant==='missing-server')s.name='other';
 if(variant==='error')s.toolsError='unavailable';
 if(variant==='resources')s.resources=[{uri:'file:///not-allowed'}];
 if(variant==='templates')s.resourceTemplates=[{uriTemplate:'file:///{path}'}];
 if(variant==='missing-resources')delete s.resources;
 if(variant==='missing-templates')delete s.resourceTemplates;
 if(variant==='malformed-resources')s.resources={};
 if(variant==='malformed-templates')s.resourceTemplates=null;
 if(variant==='malformed')v.data=null;
 blocked(await f.run());
});
for(const stage of ['probe','inventory','initial-policy','final-policy'])test('Late selected-provider change during '+stage+' cannot return ready',async()=>{
 const f=await fixture();if(stage.includes('policy'))f.hooks.policy=count=>{if(count===(stage==='initial-policy'?1:2))f.setProvider('deepseek');};else f.hooks[stage]=()=>f.setProvider('deepseek');blocked(await f.run());
});
for(const stage of ['probe','inventory','initial-policy','final-policy'])test('Same-owner reselection serial during '+stage+' invalidates the old readiness result',async()=>{
 const f=await fixture();const change=()=>f.select('private');if(stage.includes('policy'))f.hooks.policy=count=>count===(stage==='initial-policy'?1:2)?change():undefined;else f.hooks[stage]=change;blocked(await f.run());
});
for(const stage of ['probe','inventory'])test('A conversation switch during '+stage+' cannot reuse private readiness for a public workflow',async()=>{const f=await fixture();f.hooks[stage]=()=>f.select('public');blocked(await f.run());});
const mutations={parameterRevision:t=>t.parameterRevision++,parameters:t=>t.parameters.files.push('/new-input'),review:t=>t.review.status='ready',composition:t=>t.composition.graph_sha256='c'.repeat(64),customCv:t=>t.customCv.parametersSha='d'.repeat(64),environment:t=>t.authoring.environmentId='new-env',inputRoot:t=>t.authoring.inputRoot='/changed',deployment:t=>t.deployment={config:{projectId:'changed'}}};
for(const [name,change]of Object.entries(mutations))test('A late full task '+name+' change invalidates readiness even with the same task ID',async()=>{const f=await fixture();f.hooks.inventory=()=>change(f.tasks.get('private-task'));blocked(await f.run());});
test('Final policy await also checks the latest complete task record',async()=>{const f=await fixture();f.hooks.policy=count=>{if(count===2)f.tasks.get('private-task').parameterRevision++;};blocked(await f.run());});
test('A deleted or rebound task cannot report ready after the native inventory returns',async()=>{for(const kind of ['deleted','rebound']){const f=await fixture();f.hooks.inventory=()=>{if(kind==='deleted')f.deleted.add('codex:private-thread');else f.conversations.get('codex:private-thread').taskId='public-task';};blocked(await f.run());}});
for(const stage of ['probe','inventory','final-policy'])test('Sharing revoked during '+stage+' is rechecked before readiness returns',async()=>{
 const f=await fixture(),revoke=()=>f.policy.bindings[0].allowed=false;if(stage==='final-policy')f.hooks.policy=count=>{if(count===2)revoke();};else f.hooks[stage]=revoke;blocked(await f.run());
});
test('A policy scope transition with otherwise unchanged task data is blocked',async()=>{const f=await fixture();delete f.tasks.get('private-task').customCv;f.hooks.inventory=()=>f.policy.bindings=[];blocked(await f.run());});
for(const variant of ['replace','mutate','disconnect'])test('Worker '+variant+' during discovery cannot produce stale readiness',async()=>{const f=await fixture();f.hooks.probe=()=>{if(variant==='replace')f.worker.connection=clone(f.worker.connection);if(variant==='mutate')f.worker.connection.url='http://127.0.0.1:19001';if(variant==='disconnect')f.worker.connection=null;};blocked(await f.run());assert.equal(f.counts().inventoryCalls,0);});
test('A disconnected worker and a failed base probe remain blocked',async()=>{const f=await fixture();f.worker.connection=null;blocked(await f.run());assert.equal(f.counts().probeCalls,0);const g=await fixture();g.state.probe={status:'blocked',count:0,message:'bounded fixture failure'};blocked(await g.run());assert.equal(g.counts().inventoryCalls,0);});
test('An access-policy failure is not converted to public readiness',async()=>{const f=await fixture();f.deps.privateAccess={assertTask:async()=>{throw Error('Permission unavailable');}};blocked(await f.run());assert.equal(f.counts().probeCalls,0);});
test('Malformed access policy cannot be interpreted as a caller-selected mode',async()=>{const f=await fixture();f.deps.privateAccess={assertTask:async()=>({definitionOnly:'true'})};blocked(await f.run());assert.equal(f.counts().probeCalls,0);});
test('Public non-Codex readiness retains its original base-tool behavior',async()=>{const f=await fixture({selected:null});f.workflowContext.clear();f.setProvider('kimi');assert.equal((await f.run('kimi')).status,'ready');assert.equal(f.counts().inventoryCalls,0);});

test('Real WorkerClient base probe and scoped proxy expose different correct inventories to this readiness helper',async t=>{
 const f=await fixture();let toolCalls=0;
 const upstream=http.createServer(async(req,res)=>{
  assert.equal(req.url,'/mcp');assert.equal(req.headers.authorization,'Bearer local-mcp');const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));if(body.method==='tools/call')toolCalls++;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools:[tool('present_task'),tool('read_project_input')]}}));
 });await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const worker=new WorkerClient();worker.upstream='http://127.0.0.1:'+upstream.address().port;worker.connection={tokens:{mcp:'local-mcp',admin:'local-admin'},transport:'loopback-only'};
 worker.setScopedTools(DEFINITION_ONLY_TOOLS.map(tool),()=>{throw Error('Readiness must never call a tool');});
 const guard=createPrivateCvAccess({records:f.records,activeTasks:new Map([['codex','private-task']]),worker:{connection:{},request:async()=>clone(f.policy)}});worker.setAuthoringGuard(guard);await worker.exposeTools({});
 worker.bindProviderContext('codex',{threadId:'private-thread',taskId:'private-task',projectId:'private-project',environmentId:'env',inputRoot:'/owned/private'});
 t.after(async()=>{worker.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 const nativeInventory={async request(method,params){assert.equal(method,'mcpServerStatus/list');assert.equal('threadId' in params,false);const c=worker.providerConnection('codex'),r=await fetch(c.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+c.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});assert.equal(r.status,200);const value=await r.json();return inventory(value.result.tools.map(value=>value.name));}};
 const deps={...f.deps,worker,codex:nativeInventory,privateAccess:guard};
 const base=await worker.probeTools();assert.equal(base.count,2);const scoped=await scientificToolReadiness(deps,'codex');assert.equal(scoped.status,'ready');assert.equal(scoped.count,7);assert.equal(toolCalls,0);
});

test('Main uses only the trusted dependency adapter and has no private-mode caller argument',()=>{const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),body=source.slice(source.indexOf('async function scientificTools(provider){'),source.indexOf("handle('agent.connect'"));assert.match(body,/scientificToolReadiness\(\{worker,codex,workflowContext,records:taskRecords,privateAccess,selectedProvider:\(\)=>agents\.active\},provider\)/);assert.doesNotMatch(body,/definitionOnly|present_task|mode/);});

for(const variant of ['process','lifecycle'])test('Native bridge '+variant+' change invalidates a pending readiness result',async()=>{const f=await fixture();f.hooks.inventory=()=>{if(variant==='process')f.deps.codex.process={pid:123};else f.deps.codex.lifecycle=1;};blocked(await f.run());});

for(const selected of ['private','public'])test('Readiness precedes native restoration of a stored '+selected+' thread without resuming its history',async()=>{
 const f=await fixture({selected}),before=f.workflowContext.current(),calls=[];
 const response=selected==='private'?inventory(DEFINITION_ONLY_TOOLS):inventory(['present_task']);
 f.deps.codex.request=async(method,params)=>{calls.push({method,params:clone(params)});if(params.threadId)throw Error('thread not found: '+params.threadId);assert.equal(method,'mcpServerStatus/list');return response;};
 const result=await f.run();assert.equal(result.status,'ready');assert.equal(calls.length,1);assert.deepEqual(calls[0].params,{serverName:'gpusampling',detail:'full'});assert.deepEqual(f.workflowContext.current(),before);assert.equal(calls.some(call=>['thread/start','thread/resume','turn/start'].includes(call.method)),false);
});

test('Actual server-level shape permits five disabled zero-capability rows beside the exact private namespace',async()=>{
 const f=await fixture();f.state.response.data.push(...Array.from({length:5},(_,i)=>({name:'disabled-fixture-'+i,tools:{},toolsError:null,resources:[],resourceTemplates:[]})));
 const value=await f.run();assert.equal(value.status,'ready');assert.equal(value.count,7);assert.equal(value.scope,'definition-only');assert.equal(f.requests[0][1].threadId,undefined);
});
for(const variant of ['tool','resource','template','missing-tools','array-tools','missing-resources','missing-templates','malformed-resources','malformed-templates','null-row'])test('A disabled ambient row with '+variant+' cannot silently broaden private readiness',async()=>{
 const f=await fixture(),row={name:'disabled-fixture',tools:{},resources:[],resourceTemplates:[]};f.state.response.data.push(row);
 if(variant==='tool')row.tools.outside=tool('outside');if(variant==='resource')row.resources.push({uri:'synthetic:private'});if(variant==='template')row.resourceTemplates.push({uriTemplate:'synthetic:{id}'});
 if(variant==='missing-tools')delete row.tools;if(variant==='array-tools')row.tools=[];if(variant==='missing-resources')delete row.resources;if(variant==='missing-templates')delete row.resourceTemplates;
 if(variant==='malformed-resources')row.resources={};if(variant==='malformed-templates')row.resourceTemplates=null;if(variant==='null-row')f.state.response.data[1]=null;blocked(await f.run());
});


test('definition-only readiness permits independent terminal tools while retaining exactly seven scientific capabilities',async()=>{const f=await fixture(),before=f.workflowContext.current();f.state.response=inventory([...DEFINITION_ONLY_TOOLS,...SHARED_TERMINAL_TOOL_NAMES]);const value=await f.run();assert.equal(value.status,'ready');assert.equal(value.count,7);assert.equal(value.scope,'definition-only');assert.equal(DEFINITION_ONLY_TOOLS.length,7);assert.deepEqual(f.workflowContext.current(),before);assert.deepEqual(f.counts(),{policyCalls:2,probeCalls:1,inventoryCalls:1});});
test('definition-only readiness accepts optional terminal subset but rejects malformed terminal definitions',async()=>{const f=await fixture();f.state.response=inventory([...DEFINITION_ONLY_TOOLS,'read_shared_terminal']);assert.equal((await f.run()).status,'ready');f.state.response.data[0].tools.read_shared_terminal.name='read_project_input';blocked(await f.run());});
test('terminal tools retain setup access while missing scientific capabilities remain explicitly unverified',async()=>{for(const names of [SHARED_TERMINAL_TOOL_NAMES,[...DEFINITION_ONLY_TOOLS.slice(1),...SHARED_TERMINAL_TOOL_NAMES]]){const f=await fixture();f.state.response=inventory(names);const v=await f.run();assert.equal(v.status,'ready');assert.equal(v.warning,true);assert.equal(v.count,names.filter(n=>DEFINITION_ONLY_TOOLS.includes(n)).length);assert.match(v.message,/尚未验证/);}});
