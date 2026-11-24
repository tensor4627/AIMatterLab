import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
import {selectConversation} from "../../agent/sessions/conversation-selection.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {conversationTitle} from "../../contracts/agent/conversation-title.mjs";
import {providerAccountState} from "../../frontend/features/conversations/provider-account.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {AgentHub} from "../../agent/providers/agent-hub.mjs";
import {definitionOnlyScope, definitionReply, definitionToolResult} from "../../agent/tools/definition-scope.mjs";
import {currentPrivateTurn} from "../../agent/context/private-task-context.mjs";
import {EventEmitter} from "node:events";
import {definitionContextMatches, ensureDefinitionContext, rebindDefinitionContext} from "../../agent/sessions/private-conversation-context.mjs";

await __describe("agent-workflow-context", async () => {
const test = __node_test;
function fixture(){let provider='codex';const tasks=new Map(),conversations=new Map(),activeTasks=new Map(),records={deleted:()=>false,conversation:(p,id)=>conversations.get(p+':'+id),bound:(p,id)=>{const c=conversations.get(p+':'+id);return c?.taskId?tasks.get(c.taskId):null;},read:id=>structuredClone(tasks.get(id))};for(const id of ['a','b']){const task={id:'task-'+id,provider:'codex',threadId:id,projectId:'project-'+id,authoring:{projectId:'project-'+id,environmentId:'environment-'+id,inputRoot:'/inputs/'+id}};tasks.set(task.id,task);conversations.set('codex:'+id,{taskId:task.id,projectId:task.projectId});}const api=createAgentWorkflowContext({records,activeTasks,selectedProvider:()=>provider});return {api,records,activeTasks,tasks,conversations,setProvider:p=>provider=p};}
const bind=async()=>{};
test('desktop observations survive a same-thread message but distinguish A to B to A and a new blank chat',()=>{
 const {api,tasks}=fixture();const first=api.begin('codex','a'),original=api.selectedOwner();
 api.begin('codex','a');assert.throws(()=>api.assert(first));assert.deepEqual(api.selectedOwner(),original);
 api.begin('codex','b');api.begin('codex','a');const back=api.selectedOwner();
 assert.deepEqual(back.context,original.context);assert.notEqual(back.revision,original.revision);
 tasks.get('task-a').authoring.inputRoot='/new';assert.notDeepEqual(api.selectedOwner(),back);
 api.clear();api.begin('codex',null);const blank=api.selectedOwner();
 api.clear();const ticket=api.begin('codex',null);assert.notDeepEqual(api.selectedOwner(),blank);
 api.started(ticket,'fresh');assert.equal(api.selectedOwner().context.threadId,'fresh');
});
test('a fresh thread has the selected project before its first save, without inheriting history',async()=>{
 const f=fixture();
 f.api.begin('codex','a');
 const ticket=f.api.begin('codex',null,'chosen-project');
 assert.equal(f.api.current().projectId,null);
 f.api.started(ticket,'fresh');
 const first=await f.api.synchronize(ticket,bind);
 assert.deepEqual(first,{threadId:'fresh',projectId:'chosen-project',taskId:null,environmentId:null,inputRoot:null});
 f.conversations.set('codex:fresh',{projectId:'chosen-project'});
 assert.deepEqual(await f.api.synchronize(f.api.begin('codex','fresh'),bind),first);
 f.conversations.set('codex:fresh',{projectId:null});
 assert.equal(f.api.current().projectId,null);
 assert.equal(f.api.begin('codex','a').provider,'codex');
 assert.equal(f.api.current().projectId,'project-a');
 assert.throws(()=>f.api.begin('codex','a','other-project'));
 assert.throws(()=>f.api.begin('codex',null,{}));
});
function lease(context,extra={}){return {provider:'codex',...context,epoch:'synthetic-epoch',checkCurrent:()=>true,...extra};}
test('Actual owned workflow context includes its selected environment and input root',async()=>{const f=fixture(),ticket=f.api.begin('codex','a'),context=await f.api.synchronize(ticket,bind);assert.equal(f.api.assertScope(lease(context)).id,'task-a');for(const key of ['threadId','taskId','projectId','environmentId','inputRoot'])assert.throws(()=>f.api.assertScope(lease(context,{[key]:'foreign'})),/another workflow/);assert.throws(()=>f.api.assertScope(lease(context,{checkCurrent:()=>false})),/no longer current/);assert.throws(()=>f.api.assertScope({provider:'codex',...context}),/lease/);});
test('A late preparation cannot reselect an older conversation after an awaited bind',async()=>{const f=fixture();let release;const first=f.api.begin('codex','a'),pending=f.api.synchronize(first,()=>new Promise(resolve=>release=resolve));const second=f.api.begin('codex','b'),current=await f.api.synchronize(second,bind);release();await assert.rejects(pending,/Selected conversation changed/);assert.equal(f.activeTasks.get('codex'),'task-b');assert.equal(f.api.assertScope(lease(current)).id,'task-b');assert.throws(()=>f.api.assert(first),/Selected conversation changed/);});
test('Ownership and runtime rebinding during await fail without replacing the active map',async()=>{const f=fixture(),ticket=f.api.begin('codex','a');await assert.rejects(f.api.synchronize(ticket,async()=>{f.tasks.get('task-a').authoring.environmentId='changed';}),/ownership changed/);assert.equal(f.activeTasks.has('codex'),false);});
test('A first real thread identity binds once without inventing a workflow',async()=>{const f=fixture(),ticket=f.api.begin('codex',null);const context=await f.api.synchronize(ticket,bind);assert.equal(context.threadId,null);assert.throws(()=>f.api.assertScope(lease(context)),/selected conversation/);const actual=f.api.started(ticket,'fresh');assert.equal(actual.threadId,'fresh');assert.equal(actual.taskId,null);await f.api.synchronize(ticket,bind);assert.throws(()=>f.api.started(ticket,'another'),/Only a newly started/);});
test('Deletion, foreign provider, stale active mapping and changed owner are denied',async()=>{const f=fixture(),ticket=f.api.begin('codex','a'),context=await f.api.synchronize(ticket,bind);f.setProvider('deepseek');assert.throws(()=>f.api.assertScope(lease(context)),/selected conversation/);f.setProvider('codex');f.activeTasks.set('codex','task-b');assert.throws(()=>f.api.assertScope(lease(context)),/another workflow/);f.api.clear('codex');assert.throws(()=>f.api.assert(ticket),/Selected conversation changed/);assert.equal(f.activeTasks.has('codex'),false);f.tasks.get('task-a').provider='qwen';assert.throws(()=>f.api.begin('codex','a'),/another conversation/);});
});

await __describe("conversation-fresh-selection", async () => {
const test = __node_test;
function fixture(){const task={id:'old-task',provider:'codex',threadId:'old',authoring:{projectId:'old-project',environmentId:'old-env',inputRoot:'/old/inputs',workerBinding:{distribution:'Old Ubuntu',root:'/old/worker',port:8888}}},conversation={id:'codex:old',provider:'codex',threadId:'old',taskId:task.id},activeTasks=new Map(),records={deleted:()=>false,conversation:(_p,id)=>id==='old'?conversation:null,bound:(_p,id)=>id==='old'?task:null,read:()=>structuredClone(task)},workflowContext=createAgentWorkflowContext({records,activeTasks,selectedProvider:()=>agents.active}),calls=[],agents={active:'codex',selectContext:async(provider,context)=>{calls.push({provider,context});},disconnect:()=>{throw Error('unexpected provider switch');}},dependencies={records,workflowContext,agents,catalog:{get:(_kind,id)=>id===conversation.id?conversation:null},assertIdle:()=>{}};return {dependencies,workflowContext,activeTasks,task,conversation,calls,agents};}
test('explicit fresh desktop selection clears actual owner/lease and restores original on reselect without touching data',async()=>{const f=fixture(),before=structuredClone(f.task);await selectConversation(f.dependencies,{id:f.conversation.id});const old=f.workflowContext.current();assert.equal(f.activeTasks.get('codex'),'old-task');const pending=selectConversation(f.dependencies,{new:true});assert.equal(f.workflowContext.current().threadId,null);assert.equal(f.activeTasks.size,0);assert.throws(()=>f.workflowContext.assertScope({...old,checkCurrent:()=>true}),/selected conversation/);assert.deepEqual(await pending,{fresh:true});assert.deepEqual(f.calls.at(-1).context,{threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null});assert.deepEqual(f.task,before);const restored=await selectConversation(f.dependencies,{id:f.conversation.id});assert.equal(restored.task.authoring.workerBinding.root,'/old/worker');assert.equal(f.workflowContext.current().taskId,'old-task');assert.deepEqual(f.task,before);});
test('late original bind cannot replace acknowledged fresh owner',async()=>{const f=fixture();let release;f.agents.selectContext=async(_p,context)=>{if(context.threadId==='old')await new Promise(r=>release=r);};const stale=selectConversation(f.dependencies,{id:f.conversation.id});await selectConversation(f.dependencies,{new:true});release();await assert.rejects(stale,/Selected conversation changed/);assert.equal(f.workflowContext.current().taskId,null);assert.equal(f.activeTasks.size,0);});
test('late fresh acknowledgement cannot override a subsequently selected saved owner',async()=>{const f=fixture();let release;f.agents.selectContext=async(_p,context)=>{if(context.threadId===null)await new Promise(r=>release=r);};const stale=selectConversation(f.dependencies,{new:true});await selectConversation(f.dependencies,{id:f.conversation.id});release();await assert.rejects(stale,/Selected conversation changed/);assert.equal(f.workflowContext.current().taskId,'old-task');});
test('fresh action exact shape and main idle guard are mandatory',async()=>{const f=fixture();await selectConversation(f.dependencies,{id:f.conversation.id});for(const value of [{new:true,id:f.conversation.id},{new:true,provider:'other'},{new:false},{new:true,taskId:null},{id:f.conversation.id,extra:true},null])await assert.rejects(selectConversation(f.dependencies,value));assert.equal(f.workflowContext.current().taskId,'old-task');f.dependencies.assertIdle=()=>{throw Error('turn active');};await assert.rejects(selectConversation(f.dependencies,{new:true}),/turn active/);assert.equal(f.workflowContext.current().taskId,'old-task');});

test('fresh bind failure remains unbound until ordinary select has actually rebound the old task',async()=>{
 const f=fixture();await selectConversation(f.dependencies,{id:f.conversation.id});f.agents.selectContext=async(_provider,context)=>{if(context.threadId===null)throw Error('fresh bind unavailable');};await assert.rejects(selectConversation(f.dependencies,{new:true}),/fresh bind unavailable/);assert.equal(f.workflowContext.current().threadId,null);assert.equal(f.activeTasks.size,0);assert.equal((await selectConversation(f.dependencies,{id:f.conversation.id})).task.id,'old-task');assert.equal(f.workflowContext.current().taskId,'old-task');assert.equal(f.activeTasks.get('codex'),'old-task');
});
});

await __describe("conversation-organization", async () => {
const test = __node_test;
function store(){const data=new Map();return {get:(kind,id)=>structuredClone(data.get(kind+':'+id)),put:(kind,id,v)=>data.set(kind+':'+id,structuredClone(v)),list:kind=>[...data.entries()].filter(([k])=>k.startsWith(kind+':')).map(([,v])=>structuredClone(v))};}
test('pinning and organizational projects persist without changing compute bindings, workflow identity or recency',()=>{const catalog=store(),r=new TaskRecords(catalog,()=>{}),group=r.createGroup({name:'Transport'});r.remember({provider:'codex',threadId:'chat',projectId:'compute-real',groupId:group.id,intent:'MD test'});const task=r.create({planningMode:true,workflowVersion:2,provider:'codex',threadId:'chat',request:'MD test'}),before=r.conversation('codex','chat');r.organize({id:before.id,pinned:true,groupId:group.id});const restored=new TaskRecords(catalog,()=>{}),c=restored.conversations()[0];assert.equal(c.projectId,'compute-real');assert.equal(c.taskId,task.id);assert.equal(c.updatedAt,before.updatedAt);assert.equal(c.pinned,true);assert.equal(restored.groups()[0].id,group.id);restored.remember({provider:'codex',threadId:'chat',groupId:null,intent:'next message'});assert.equal(restored.conversations()[0].groupId,group.id);restored.organize({id:c.id,pinned:true,groupId:null});assert.equal(restored.conversations()[0].groupId,null);assert.equal(restored.read(task.id).id,task.id);});
test('organization rejects unknown groups and unexpected privileged fields without modifying a conversation',()=>{const catalog=store(),r=new TaskRecords(catalog,()=>{}),c=r.remember({provider:'deepseek',threadId:'chat',intent:'hello'});for(const value of [{id:c.id,pinned:true,groupId:'missing'},{id:c.id,pinned:true,groupId:null,projectId:'grant'},{id:c.id,pinned:'yes',groupId:null}])assert.throws(()=>r.organize(value));assert.deepEqual(r.conversation('deepseek','chat'),c);assert.throws(()=>r.createGroup({name:'bad',policy:{engines:['gpumd.md']}}));});
});

await __describe("conversation-titles", async () => {
const test = __node_test;
test('scientific chat titles summarize the system and method instead of storing the request sentence',()=>{
 const request='我希望用 PyDyn 为 Cu 做一个分子动力学模拟，温度300K，请帮我把整个流程设计好';
 assert.equal(conversationTitle(request),'Cu · PyDyn · 分子动力学');
 assert.equal(conversationTitle(request,{name:'Cu 扩散对比'}),'Cu 扩散对比');
 assert.equal(conversationTitle('你好，我想聊聊'),'日常交流');
 assert(conversationTitle('请帮我做LLZO的NEB能垒测试，并给我很详细的计算流程').length<=36);
});
test('manual names survive future model proposals and preserve workflow identity and recency',()=>{
 const rows=new Map(),events=[],catalog={get:(k,id)=>structuredClone(rows.get(k+id)),put:(k,id,v)=>rows.set(k+id,structuredClone(v)),list:k=>[...rows.entries()].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v))};const records=new TaskRecords(catalog,e=>events.push(e));
 const task=records.create({planningMode:true,workflowVersion:2,provider:'deepseek',threadId:'same-thread',request:'请为 Cu 做分子动力学'});const original=records.conversation('deepseek','same-thread');
 const changed=records.rename({id:original.id,name:'Cu 生产前检查'});assert.equal(changed.updatedAt,original.updatedAt);assert.equal(changed.taskId,task.id);
 records.event({provider:'deepseek',method:'item/completed',params:{threadId:'same-thread',item:{result:{kind:'task-parameters',id:task.id,name:'AI 自动重命名',steps:[],parameters:{temperature:300},missing_fields:[]}}}});
 assert.equal(records.conversation('deepseek','same-thread').name,'Cu 生产前检查');assert.equal(new TaskRecords(catalog,()=>{}).conversations()[0].name,'Cu 生产前检查');
 for(const name of ['','\n','bad\nname','a'.repeat(61)])assert.throws(()=>records.rename({id:original.id,name}));
});
test('global account presence is independent of conversation execution or model access claims',()=>{
 assert.equal(providerAccountState('codex',{account:null,requiresOpenaiAuth:true}),'missing');
 assert.equal(providerAccountState('codex',{account:{type:'chatgpt'},modelAccess:'not_run'}),'configured');
 assert.equal(providerAccountState('compatible',{credentialStored:true,modelAccess:'not_run'}),'configured');
 assert.equal(providerAccountState('deepseek',{credentialStored:false}),'missing');
 assert.equal(providerAccountState('kimi',{}),'unknown');
});
});

await __describe("history-activity-cost", async () => {
const test = __node_test;
test('native activity uses metadata without decoding covered history and keeps a recoverable legacy fallback',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-history-cost-')),catalog=new Catalog(root);
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 catalog.put('agent-thread','codex:known',{id:'known',provider:'codex',name:'Metadata',updatedAt:5});
 catalog.put('thread','known',{id:'known',turns:[{items:[{text:'large transcript '.repeat(10000)}]}]});
 catalog.put('thread','legacy',{id:'legacy',name:'Legacy kept',turns:[{items:[{text:'private body'}]}]});
 catalog.put('thread','deleted',{id:'deleted',turns:[]});catalog.put('deleted-conversation','codex:deleted',{id:'codex:deleted'});
 catalog.db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread','damaged','{invalid');
 const decoded=[],decode=catalog.decode.bind(catalog);catalog.decode=(kind,id,data)=>{if(kind==='thread')decoded.push(id);return decode(kind,id,data);};
 const receiver={catalog,deleted:AgentHub.prototype.deleted};
 const result=AgentHub.prototype.threads.call(receiver,'codex');
 assert.deepEqual(result.map(value=>value.id),['known','legacy']);assert.equal(result[0].name,'Metadata');assert.equal(result[1].name,'Legacy kept');
 assert(result.every(value=>!Object.hasOwn(value,'turns')));assert(!decoded.includes('known'));assert(!decoded.includes('deleted'));assert(decoded.includes('legacy'));assert(decoded.includes('damaged'));assert.equal(catalog.recovery().length,1);
});
});

await __describe("private-definition-scope", async () => {
const test = __node_test;
const h='a'.repeat(64),task={id:'task',projectId:'project',customCv:{id:'entry',specSha:h,codeSha:h,parametersSha:h,revision:'b'.repeat(32)}};
function body(){const expected={spec_sha256:h,code_sha256:h,parameters_sha256:h,revision:'b'.repeat(32)};return {status:'passed',allowed:true,id:'entry',expected,entry:{id:'entry',workspace_id:'task',project_id:'project',spec:{name:'Private'},parameter_values:{ell:.2},code:'primitive-source',...expected,expected,numerical:{secret:'never-return'},sharing:{codex:true},runtime:{secret:'never-return'},git:{secret:'never-return'},approval:{secret:'never-return'}}};}
const rpc=value=>({content:[{type:'text',text:JSON.stringify(value)}],isError:false});
test('definition reply drops numerical, references, approvals, Git and future unknown fields',()=>{const original=body(),value=definitionReply(original,task);assert.equal(Object.keys(value.entry).length,11);assert.doesNotMatch(JSON.stringify(value),/never-return|numerical|runtime|sharing|approval|git/);assert.equal(original.entry.numerical.secret,'never-return');value.entry.spec.name='Changed';assert.equal(original.entry.spec.name,'Private');});
for(const key of ['spec_sha256','code_sha256','parameters_sha256','revision'])test('mismatched current CAS cannot return '+key,()=>{const value=body();value.entry.expected[key]='changed';assert.throws(()=>definitionReply(value,task),/changed/);});
for(const key of ['id','workspace_id','project_id'])test('foreign definition identity '+key+' is rejected',()=>{const value=body();value.entry[key]='other';assert.throws(()=>definitionReply(value,task),/identity/);});
for(const variant of ['extra-block','structuredContent','annotation','resource'])test('non-definition hidden result '+variant+' is rejected',()=>{const value=rpc(body());if(variant==='extra-block')value.content.push({type:'text',text:'secret'});if(variant==='structuredContent')value.structuredContent={secret:1};if(variant==='annotation')value.content[0].annotations={secret:1};if(variant==='resource')value.content[0]={type:'resource',resource:{text:'secret'}};assert.throws(()=>definitionToolResult('read_custom_cv',{},value,task),/hidden data/);});

test('private lineage through either authoring, task or deployment project always narrows scope',()=>{const policy={bindings:[{workspace_id:'parent',project_id:'private-project',allowed:true}]};for(const value of [{id:'task',projectId:'private-project',authoring:{projectId:'other'}},{id:'task',authoring:{projectId:'private-project'}},{id:'task',deployment:{config:{projectId:'private-project'}}}])assert.equal(definitionOnlyScope(value,policy),true);});
test('a definition-only tool cannot replace a whole workflow it was not allowed to read',()=>{assert.throws(()=>definitionToolResult('present_task',{task_id:'task'},rpc({id:'task',parameters:{ell:.2}}),task),/cannot replace/);});
});

await __describe("private-task-context", async () => {
const test = __node_test;
const task={id:'owned',projectId:'project',authoring:{environmentId:'PRIVATE_RUNTIME',inputRoot:'/PRIVATE_FILES',imports:[{source:'PRIVATE_IMPORT'}]},parameters:{old:'PRIVATE_PARAMETER'},inputBinding:{parameters:{old:'PRIVATE_BINDING'}},artifacts:[{id:'PRIVATE_RUN'}],customCv:{id:'entry',specSha:'a'.repeat(64),codeSha:'b'.repeat(64),parametersSha:'c'.repeat(64),revision:'d'.repeat(32)},composition:{graphPath:'/PRIVATE_GRAPH/workflow.json',expected:{files:{'workflow.json':'a'.repeat(64)}}}};
test('definition turn sends only human text and current identifiers, not automatic file/history/runtime context',()=>{const params={threadId:'fresh-thread',model:'chosen',input:[{type:'text',text:'Please discuss the current definition'},{type:'text',text:'[Studio workspace context] PRIVATE_CONTEXT'},{type:'text',text:'[Studio interaction mode: workflow] PRIVATE_CONTEXT'},{type:'text',text:'Unverified extra PRIVATE_TEXT'}]};const before=structuredClone(params),result=currentPrivateTurn(params,task),text=JSON.stringify(result);assert(!text.includes('PRIVATE_'));assert.equal(result.input.length,2);assert.equal(result.input[0].text,params.input[0].text);assert(text.includes(task.customCv.specSha));assert(!text.includes('read_pygas_workflow'));assert(text.includes('read_custom_cv'));assert.equal(result.model,'chosen');assert.deepEqual(params,before);});
for(const type of ['skill','localImage','image','file','mention'])test('definition turn rejects ungranted '+type+' before any file reader',()=>{assert.throws(()=>currentPrivateTurn({threadId:'fresh',input:[{type:'text',text:'Discuss'},{type,path:'/PRIVATE'}]},task),/text messages only/);});
for(const extra of ['toolOutput','cwd','config','baseInstructions','outputSchema'])test('definition turn rejects hidden protocol context '+extra,()=>{assert.throws(()=>currentPrivateTurn({threadId:'fresh',input:[{type:'text',text:'Discuss'}],[extra]:{private:'body'}},task),/separate scope/);});
test('unknown text metadata cannot carry a hidden file annotation',()=>{assert.throws(()=>currentPrivateTurn({threadId:'fresh',input:[{type:'text',text:'Discuss',text_elements:[{path:'/PRIVATE'}]}]},task),/text messages only/);});
test('definition review instruction never upgrades to full-workflow review',()=>{assert.match(currentPrivateTurn({threadId:'fresh',input:[{type:'text',text:'Check definition'}]},task,{review:true}).input[1].text,/cannot establish complete workflow readiness/);});
});

await __describe("private-conversation-context", async () => {
const test = __node_test;
function fixture(){
 const rows=new Map(),events=[],catalog={get:(k,id)=>structuredClone(rows.get(k+':'+id)||null),put:(k,id,v)=>{rows.set(k+':'+id,structuredClone(v));return v;},remove:(k,id)=>rows.delete(k+':'+id),list:k=>[...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v)),transaction:work=>{const old=structuredClone(rows);try{return work();}catch(error){rows.clear();for(const [k,v]of old)rows.set(k,v);throw error;}}};
 const records=new TaskRecords(catalog,event=>events.push(event));let task=records.create({planningMode:true,provider:'codex',threadId:'old',request:'Old private request',projectId:'project'});
 task.authoring={projectId:'project',environmentId:'env',inputRoot:'/inputs/project'};task.composition={expected:{graphSha:'graph',sourceSha:'source'}};task.customCv={id:'entry',specSha:'a'.repeat(64),codeSha:'b'.repeat(64),parametersSha:'c'.repeat(64),revision:'d'.repeat(32),numericalStatus:'passed'};task.artifacts=[{id:'run',kind:'run'}];task=records.save(task);catalog.put('thread','old',{id:'old',turns:[{text:'old model history'}]});
 const activeTasks=new Map(),workflowContext=createAgentWorkflowContext({records,activeTasks,selectedProvider:()=> 'codex'}),calls=[],contexts=[];
 const agents={selectContext:async(provider,context)=>{contexts.push(structuredClone(context));},rpc:async(provider,method,params)=>{calls.push({provider,method,params});return {thread:{id:'fresh',turns:[]}};},forget:()=>{}};
 return {records,catalog,task,events,workflowContext,activeTasks,agents,calls,contexts,run:async()=>{const current=records.read(task.id),ticket=workflowContext.begin('codex',current.threadId);return (await ensureDefinitionContext({records,workflowContext,agents,task:current,ticket,model:'test-model'})).task;}};
}
test('a genuine zero-turn native start keeps the exact task, files, entry, approval and numerical evidence locally',async()=>{
 const f=fixture(),before=f.records.read(f.task.id),after=await f.run();assert.equal(after.threadId,'fresh');assert.equal(after.id,before.id);
 for(const key of ['projectId','authoring','composition','customCv','artifacts','parameters','parameterRevision','review'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(f.calls,[{provider:'codex',method:'thread/start',params:{model:'test-model'}}]);assert.deepEqual(f.contexts[0],{threadId:null,taskId:before.id,projectId:'project',environmentId:'env',inputRoot:'/inputs/project'});assert.equal(f.contexts.at(-1).threadId,'fresh');
 assert.equal(f.records.conversations().length,1);assert.equal(f.records.conversations()[0].taskId,before.id);assert.equal(f.records.deleted('codex','old'),true);assert.equal(f.catalog.get('conversation-context-history','codex:old').thread.turns[0].text,'old model history');assert.equal(f.catalog.get('thread','old'),null);
 assert.equal(f.events.filter(e=>e.method==='studio/conversationContextChanged').length,1);assert.equal(definitionContextMatches(after),true);
});
test('same content sharing OFF/ON revisions preserve clean thread; changed content cannot reuse it',async()=>{const f=fixture();let task=await f.run();task.customCv.revision='e'.repeat(32);assert.equal(definitionContextMatches(task),true);for(const key of ['specSha','parametersSha','codeSha']){const changed=structuredClone(task);changed.customCv[key]='f'.repeat(64);assert.equal(definitionContextMatches(changed),false);}for(const key of ['threadId','id','provider']){const changed=structuredClone(task);changed[key]='foreign';assert.equal(definitionContextMatches(changed),false);}task.customCv.id='other';assert.equal(definitionContextMatches(task),false);});
test('restart reads the durable marker and never recreates or resumes old history',async()=>{const f=fixture(),task=await f.run(),reopened=new TaskRecords(f.catalog,()=>{});assert.equal(definitionContextMatches(reopened.read(task.id)),true);f.calls.length=0;await f.run();assert.equal(f.calls.length,0);assert.throws(()=>f.workflowContext.begin('codex','old'),/deleted/);assert.throws(()=>reopened.prepareTurn('codex',{threadId:'old',input:[]}),/deleted/);});
for(const response of [null,{thread:{id:'fresh'}},{thread:{id:'fresh',turns:[{id:'history'}]}},{thread:{id:'old',turns:[]}}])test('unverified or old native context never rebinds '+JSON.stringify(response),async()=>{const f=fixture();f.agents.rpc=async()=>response;await assert.rejects(f.run());assert.equal(f.records.read(f.task.id).threadId,'old');assert.equal(f.records.deleted('codex','old'),false);assert.equal(f.events.filter(e=>e.method==='studio/conversationContextChanged').length,0);});
for(const key of ['parameters','authoring','composition','customCv','review','execution'])test('concurrent '+key+' changes invalidate the start without overwriting the newer workflow',async()=>{const f=fixture();f.agents.rpc=async()=>{const current=f.records.read(f.task.id);current[key]={changed:true};f.records.save(current);return {thread:{id:'fresh',turns:[]}};};await assert.rejects(f.run(),/changed/);assert.equal(f.records.read(f.task.id).threadId,'old');assert.deepEqual(f.records.read(f.task.id)[key],{changed:true});assert.equal(f.records.deleted('codex','old'),false);});
test('late older native start cannot clear a newer selected context',async()=>{const f=fixture();f.agents.rpc=async()=>{f.workflowContext.begin('codex','another');return {thread:{id:'fresh',turns:[]}};};await assert.rejects(f.run(),/changed/);assert.equal(f.workflowContext.current().threadId,'another');assert.equal(f.contexts.length,1);assert.equal(f.records.read(f.task.id).threadId,'old');});
test('failed native start makes no replacement, no data turn and no resubmission',async()=>{const f=fixture();let count=0;f.agents.rpc=async()=>{count++;throw Error('native start failed');};await assert.rejects(f.run(),/native start failed/);assert.equal(count,1);assert.equal(f.records.read(f.task.id).threadId,'old');assert.equal(f.workflowContext.current(),null);assert.equal(f.contexts.at(-1).taskId,null);});
test('retired IDs are rejected by the actual Hub before read, resume, dispatch or remembering',async()=>{const f=fixture();await f.run();const codex=new EventEmitter();codex.process={};let calls=0;codex.request=async()=>{calls++;return {};};const hub=new AgentHub({codex,catalog:f.catalog,settings:()=>({}),worker:()=>null});for(const method of ['thread/read','thread/resume','turn/start'])await assert.rejects(hub.rpc('codex',method,{threadId:'old'}),/deleted/);hub.remember('codex',{id:'old'});assert.equal(f.catalog.get('agent-thread','codex:old'),null);assert.equal(calls,0);assert.equal(hub.threads('codex').some(t=>t.id==='old'),false);});
test('transaction failure keeps original conversation and task intact',()=>{const f=fixture(),put=f.catalog.put;f.catalog.put=(kind,...args)=>{if(kind==='retired-conversation-context')throw Error('simulated disk failure');return put(kind,...args);};assert.throws(()=>rebindDefinitionContext(f.records,f.records.read(f.task.id),'fresh'),/disk failure/);assert.equal(f.records.read(f.task.id).threadId,'old');assert.equal(f.records.conversations()[0].threadId,'old');assert.equal(f.catalog.get('conversation-context-history','codex:old'),null);});

test('an old preflight ticket cannot reclaim a newer selection after a delayed privacy check',async()=>{const f=fixture(),old=f.workflowContext.begin('codex','old');f.workflowContext.begin('codex','newer');await assert.rejects(ensureDefinitionContext({records:f.records,workflowContext:f.workflowContext,agents:f.agents,task:f.task,ticket:old}),/changed/);assert.equal(f.contexts.length,0);assert.equal(f.calls.length,0);assert.equal(f.workflowContext.current().threadId,'newer');});
test('caller receives the actual replacement ticket and a later selection invalidates it',async()=>{const f=fixture(),ticket=f.workflowContext.begin('codex','old'),result=await ensureDefinitionContext({records:f.records,workflowContext:f.workflowContext,agents:f.agents,task:f.task,ticket});assert.notEqual(result.ticket.serial,ticket.serial);f.workflowContext.assert(result.ticket);f.workflowContext.begin('codex','newer');assert.throws(()=>f.workflowContext.assert(result.ticket),/changed/);});

for(const provider of ['deepseek','kimi'])test('private definition isolation creates an isolated context on '+provider+' without touching codex legacy history',async()=>{
 const rows=new Map(),events=[],catalog={get:(k,id)=>structuredClone(rows.get(k+':'+id)||null),put:(k,id,v)=>{rows.set(k+':'+id,structuredClone(v));return v;},remove:(k,id)=>rows.delete(k+':'+id),list:k=>[...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v)),transaction:work=>{const old=structuredClone(rows);try{return work();}catch(error){rows.clear();for(const [k,v]of old)rows.set(k,v);throw error;}}};
 const records=new TaskRecords(catalog,event=>events.push(event));
 let task=records.create({planningMode:true,provider,threadId:'old',request:'Private CV',projectId:'project'});
 task.customCv={id:'entry',specSha:'a'.repeat(64),codeSha:'b'.repeat(64),parametersSha:'c'.repeat(64),revision:'d'.repeat(32),numericalStatus:'passed'};
 task=records.save(task);
 catalog.put('thread','old',{id:'old',turns:[{text:'unrelated codex thread'}]});
 const workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>provider}),calls=[];
 const agents={selectContext:async()=>{},rpc:async(p,method,params)=>{calls.push({provider:p,method,params});return {thread:{id:'fresh-'+p,turns:[]}};},forget:()=>{}};
 const ticket=workflowContext.begin(provider,'old');
 const {task:after}=await ensureDefinitionContext({records,workflowContext,agents,task,ticket,model:'provider-model'});
 assert.equal(after.threadId,'fresh-'+provider);
 assert.equal(definitionContextMatches(after),true);
 assert.equal(records.deleted(provider,'old'),true);
 assert.deepEqual(catalog.get('thread','old'),{id:'old',turns:[{text:'unrelated codex thread'}]});
 assert.deepEqual(calls[0],{provider,method:'thread/start',params:{model:'provider-model',...(provider==='kimi'?{excludeThreadId:'old'}:{})}});
});
});
