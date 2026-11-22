import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {createAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {formatPreparedTaskTurn} from '../../agent/context/task-turn-context.mjs';
import {currentPrivateTurn} from '../../agent/context/private-task-context.mjs';
import {terminalOnlyTurn} from '../../agent/sessions/terminal-turn.mjs';
import {visibleUserText} from '../../contracts/agent/user-message.mjs';
import {constrainedRequest} from '../../desktop/platform/codex-isolation.mjs';
import {MCP_CONTEXT_KEYS} from '../../agent/tools/provider-scope.mjs';
import {TerminalMcp,workerToolBridge} from '../../agent/tools/terminal-mcp.mjs';
import {createConversationDraftTool} from '../../backend/main/workspace/workflow-draft-tool.mjs';
import {dshToolAllowed} from '../../agent/providers/dsh-policy.mjs';

const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const human='Continue our calculation design without executing anything';
function fixture({terminal=false,offlineTerminal=false,definition=false,managed=false}={}){
 const rows=new Map(),sent=[],workerCalls=[],effects=[],selection={kind:'ssh-terminal',selectionId:'selected-terminal',sessionId:'session',profileId:'saved-profile',profileVersion:1};
 const catalog={get:(kind,id)=>clone(rows.get(kind+':'+id)),put:(kind,id,value)=>{rows.set(kind+':'+id,clone(value));return value;},list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>clone(value))};
 let ready=true,gate;
 const runtime={catalog,emit:()=>{},root:process.cwd(),app:{isPackaged:false},openUrl:()=>{},assertIdleAgent:()=>{},privateAccess:{assertTask:async()=>({definitionOnly:definition})},
  agents:{threadReady:()=>ready,selectContext:async()=>{effects.push('synchronize');if(gate){const current=gate;gate=null;current.entered.resolve();await current.release.promise;}},rpc:async(provider,method,params)=>{sent.push({provider,method,params:clone(params)});if(method==='thread/resume'){ready=true;return {thread:{id:params.threadId,turns:[{items:[{type:'userMessage',text:'Old chat said planning was disabled'}]}]}};}return {turn:{id:'acknowledged-'+sent.length}};}},
  worker:{connection:{health:{root:'/fixture/worker'}},identity:{distribution:'Fixture',root:'/fixture/worker'},connectionTarget:{port:8767},connectionEpoch:1,providerConnection:()=>offlineTerminal?null:({}),request:async(method,path,value)=>{workerCalls.push({method,path,value});assert.equal(path,'/api/authoring/context');return {project:{id:'owned-authoring',authoring_only:true},input_root:'/fixture/inputs',environment_id:'authoring',imports:[]};}},
  sharedTerminal:{hasCurrentGrant:()=>terminal||offlineTerminal},resourceRouting:{capture:()=>({selection:terminal?selection:null,...managed?{resources:[]}:{},assertCurrent(){}}),readiness:async()=>{effects.push('terminal-readiness');return {status:'ready',resource:selection};}},
  scientificSkills:{router:{routes:new Map()},resolvePolicy:async()=>({}),sourcesForPolicy:()=>[],context:{prepare:async()=>({attach:false,status:'not_run'}),accept:()=>assert.fail('No guidance delivery expected')}},setupInstructions:{},skillGuidanceScope:()=>({}),studioSkillRoots:()=>[],managedSkillRoots:()=>[],managedSkillEntries:()=>[],managedSkillRecords:()=>[],bundledSkillRoot:process.cwd()
 };
 const restore=()=>{runtime.taskRecords=new TaskRecords(catalog,()=>{});runtime.workflowContext=createAgentWorkflowContext({records:runtime.taskRecords,activeTasks:new Map(),selectedProvider:()=> 'codex'});ready=false;};
 restore();ready=true;
 const request=createAgentRequests({runtime:()=>runtime});
 const send=(planningMode,extra={})=>request({provider:'codex',method:'turn/start',params:{threadId:'thread',planningMode,input:[{type:'text',text:human}],...extra}});
 const create=()=>runtime.taskRecords.create({provider:'codex',threadId:'thread',planningMode:true,workflowVersion:2,request:human});
 return {runtime,rows,sent,workerCalls,effects,request,send,create,restore,get records(){return runtime.taskRecords;},delayContext:()=>{const entered=deferred(),release=deferred();gate={entered,release};return {entered:entered.promise,release:release.resolve};}};
}
const lastTurn=f=>f.sent.filter(call=>call.method==='turn/start'||call.method==='turn/steer').at(-1).params;
function assertMode(turn,value){
 const text=turn.input.filter(block=>block.type==='text').map(block=>block.text).join('\n');
 assert(text.includes('planningMode='+value));assert(text.includes('supersedes earlier messages'));
 if(value)assert(text.includes('Task planning is already enabled'));
 for(const key of ['planningMode','reviewMode','studioTaskId'])assert(!Object.hasOwn(turn,key));
 assert.equal(visibleUserText(turn.input),human);
 return text;
}

test('actual request path changes chat to planning to existing workflow without a second task or execution',async()=>{
 const f=fixture();await f.send(false);assertMode(lastTurn(f),false);assert.equal(f.records.tasks().length,0);assert.equal(f.workerCalls.length,0);
 const task=f.create();await f.send(true,{studioTaskId:task.id});assert.match(assertMode(lastTurn(f),true),/mode: planning/);
 await f.send(false,{studioTaskId:task.id});assert.match(assertMode(lastTurn(f),false),/mode: workflow/);
 assert.deepEqual(f.records.tasks().map(value=>value.id),[task.id]);assert(f.workerCalls.every(call=>call.method==='POST'&&call.path==='/api/authoring/context'));
 assert.equal(f.records.read(task.id).execution,undefined);assert.equal(f.records.read(task.id).artifacts.length,0);
});

test('the managed desktop MCP saves a real workflow in the original project conversation before any run',async t=>{
 const f=fixture({managed:true}),sessionId='planning-session';
 f.records.remember({provider:'codex',threadId:'thread',projectId:'original-project'});
 await f.send(false);
 assert.equal(f.runtime.workflowContext.current().projectId,'original-project');
 assert.equal(f.records.tasks().length,0);
 const task=f.records.create({provider:'codex',threadId:'thread',planningMode:true,workflowVersion:2,projectId:'unrelated-workbench-project',request:human});
 assert.equal(task.projectId,'original-project');
 await f.send(true,{studioTaskId:task.id});
 assert.match(assertMode(lastTurn(f),true),/Call present_task/);
 const conversationDraft=createConversationDraftTool({records:f.records,assertScope:f.runtime.workflowContext.assertScope});
 const endpoint=new TerminalMcp({terminal:{tools:()=>[]},workerTools:workerToolBridge({
  connection:()=>null,fetchApi:()=>assert.fail('A planning draft requires no scientific worker call'),conversationDraft
 })});
 await endpoint.start();t.after(()=>endpoint.close());
 const context=Object.fromEntries(MCP_CONTEXT_KEYS.map(k=>[k,f.runtime.workflowContext.current()[k]]));
 endpoint.bindProviderContext('codex',context,{sessionId});
 const connection=endpoint.providerConnection('codex',sessionId);
 const call=async(method,params={})=>{
  const response=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  return response.status===200?(await response.json()).result:response.status;
 };
 assert.deepEqual((await call('tools/list')).tools.map(tool=>tool.name),['present_task']);
 const runArgs={task_id:task.id,name:'Saved plan',steps:[{id:'inputs',title:'Inputs',fields:[{key:'temperature',label:'Temperature',type:'number',required:true}]}],parameters:{temperature:310},missing_fields:[],
  roadmap:{schema_version:1,resources:[{id:'trajectory',label:'Trajectory'}],inputs:[],outputs:['trajectory'],
   steps:[{id:'md',tool:'gpumd.md',label:'MD',inputs:[],outputs:[{port:'trajectory',resource:'trajectory'}]}]}};
 const save=args=>call('tools/call',{name:'present_task',arguments:args});
 assert.equal((await save({...runArgs,task_id:'different-draft'})).isError,true);
 assert.equal((await save({...runArgs,roadmap:{...runArgs.roadmap,outputs:['missing']}})).isError,true);
 assert.equal(f.records.read(task.id).roadmap,undefined);
 assert.match((await save(runArgs)).content[0].text,/"has_roadmap":true/);
 assert.deepEqual(f.records.read(task.id).roadmap,runArgs.roadmap);
 assert.equal(f.records.read(task.id).phase,'review');
 assert.equal(f.records.read(task.id).execution,undefined);
 assert.deepEqual(f.workerCalls,[]);
 assert.equal(dshToolAllowed('read_session_workspace',false),true);
 assert.equal(dshToolAllowed('read_session_workspace',true),true);
 endpoint.revokeProvider('codex',sessionId);
 assert.equal(await save(runArgs),403);
 f.restore();
 await f.send(false);
 const restored=assertMode(lastTurn(f),false);
 assert.match(restored,/Current roadmap/);
 assert.match(restored,/Saved plan|Trajectory/);
 assert.equal(f.records.bound('codex','thread').id,task.id);
});

test('restored native history receives the current checkbox state on every subsequent send',async()=>{
 const f=fixture(),task=f.create();await f.send(false);f.restore();await f.send(true,{studioTaskId:task.id});
 const resume=f.sent.findLastIndex(call=>call.method==='thread/resume');assert(resume>=0);assert.equal(f.sent[resume+1].method,'turn/start');assertMode(lastTurn(f),true);
 await f.send(false);assertMode(lastTurn(f),false);assert.deepEqual(f.records.tasks().map(value=>value.id),[task.id]);
});

test('a turn waiting for context preparation retains its explicit current state and next turn can switch it',async()=>{
 const f=fixture(),task=f.create(),gate=f.delayContext(),pending=f.send(true,{studioTaskId:task.id});await gate.entered;
 assert.equal(f.sent.length,0);gate.release();await pending;assertMode(lastTurn(f),true);await f.send(false);assertMode(lastTurn(f),false);
});

test('selected SSH planning acknowledges enabled then disabled without worker authoring or task creation',async()=>{
 const f=fixture({terminal:true});for(const enabled of [false,true,false]){await f.send(enabled);const turn=lastTurn(f),text=assertMode(turn,enabled);assert.match(text,/Current capability scope: terminal/);assert.match(text,enabled?/mode: planning/:/mode: chat/);assert.match(text,/Workflow files and scientific execution tools are unavailable in this turn/);assert.match(text,/A different project, resource or capability requires its own verification/);assert.doesNotThrow(()=>constrainedRequest('turn/start',turn,{cwd:process.cwd()}));}
 assert.equal(f.records.tasks().length,0);assert.deepEqual(f.workerCalls,[]);
});

test('terminal steering carries current planning but preserves the restricted provider protocol',async()=>{
 const f=fixture({terminal:true});for(const planningMode of [true,false]){await f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',expectedTurnId:'active-turn',planningMode,input:[{type:'text',text:human}]}});const turn=lastTurn(f);assertMode(turn,planningMode);assert.doesNotThrow(()=>constrainedRequest('turn/steer',turn,{cwd:process.cwd()}));}
 assert.deepEqual(f.workerCalls,[]);assert.equal(f.records.tasks().length,0);
});

test('offline local terminal steering strips unrelated private attachments and rechecks the current grant',async()=>{
 const f=fixture({offlineTerminal:true});
 await f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',expectedTurnId:'active-turn',planningMode:true,input:[{type:'text',text:human},{type:'text',text:'UNSHARED_LOCAL_TERMINAL_CONTEXT'},{type:'skill',path:'UNSHARED_LOCAL_TERMINAL_SKILL'}]}});
 const turn=lastTurn(f),text=assertMode(turn,true);assert.match(text,/Current capability scope: terminal/);assert(!JSON.stringify(turn).includes('UNSHARED_LOCAL'));assert.doesNotThrow(()=>constrainedRequest('turn/steer',turn,{cwd:process.cwd()}));assert.deepEqual(f.workerCalls,[]);
 const original=f.runtime.sharedTerminal.hasCurrentGrant;let checks=0;f.runtime.sharedTerminal.hasCurrentGrant=()=>++checks===1&&original();
 const before=f.sent.length;await assert.rejects(f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',planningMode:true,input:[{type:'text',text:human}]}}),/交接所属会话已变化/);assert.equal(f.sent.length,before);
});

test('workflow steering updates current intent without starting a new review or changing stored workflow',async()=>{
 const f=fixture(),task=f.create();await f.send(true);const rows=clone(f.rows),turns=clone(f.records.turns),workerCount=f.workerCalls.length;
 await f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',studioTaskId:task.id,planningMode:false,expectedTurnId:'active-turn',input:[{type:'text',text:human}]}});
 const turn=lastTurn(f);assert.match(assertMode(turn,false),/mode: workflow/);assert.doesNotThrow(()=>constrainedRequest('turn/steer',turn,{cwd:process.cwd()}));assert.deepEqual(f.rows,rows);assert.deepEqual(f.records.turns,turns);assert.equal(f.workerCalls.length,workerCount);
 await assert.rejects(f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',studioTaskId:'other-task',planningMode:true,input:[{type:'text',text:human}]}}),/not bound/);
 await assert.rejects(f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',reviewMode:true,input:[{type:'text',text:human}]}}),/new workflow turn/);
});

test('private definition turns preserve current planning while excluding broader saved workflow context',async()=>{
 const f=fixture({definition:true}),task=f.create();task.customCv={id:'shared-entry',specSha:'a'.repeat(64),parametersSha:'b'.repeat(64),codeSha:null,revision:'c'.repeat(32)};task.parameters={secret:'UNSHARED_WORKFLOW_SECRET'};task.privateDefinitionContext={provider:'codex',threadId:'thread',taskId:task.id,entryId:task.customCv.id,specSha:task.customCv.specSha,parametersSha:task.customCv.parametersSha,codeSha:null};f.records.save(task);
 for(const planningMode of [true,false]){await f.send(planningMode);const turn=lastTurn(f),text=assertMode(turn,planningMode);assert.match(text,/Current capability scope: private-definition/);assert.match(text,planningMode?/mode: planning/:/mode: chat/);assert(!JSON.stringify(turn).includes('UNSHARED_WORKFLOW_SECRET'));assert.match(text,/Do not call present_task/);assert.doesNotThrow(()=>constrainedRequest('turn/start',turn,{cwd:process.cwd()}));}
 assert.deepEqual(f.workerCalls,[]);
});

test('steering the exact private definition uses text and its existing isolation, without workspace context',async()=>{
 const f=fixture({definition:true}),task=f.create();
 const specSha='a'.repeat(64),parametersSha='b'.repeat(64),codeSha=null;
 task.customCv={id:'shared-entry',specSha,parametersSha,codeSha,revision:'c'.repeat(32)};
 task.privateDefinitionContext={provider:'codex',threadId:'thread',taskId:task.id,entryId:'shared-entry',specSha,parametersSha,codeSha};
 f.records.save(task);
 f.runtime.resourceRouting.turnContext=()=>{assert.fail('Private steer must not read generic resource context');};
 const send=()=>f.request({provider:'codex',method:'turn/steer',params:{threadId:'thread',expectedTurnId:'active-turn',planningMode:true,
  input:[{type:'text',text:human},{type:'text',text:'UNSHARED_WORKSPACE_CONTEXT'}]}});
 await send();
 const turn=lastTurn(f),text=assertMode(turn,true);
 assert.equal(turn.expectedTurnId,'active-turn');
 assert.match(text,/Current capability scope: private-definition/);
 assert.doesNotMatch(text,/UNSHARED_WORKSPACE_CONTEXT/);
 assert.doesNotThrow(()=>constrainedRequest('turn/steer',turn,{cwd:process.cwd()}));
 assert.deepEqual(f.workerCalls,[]);
 task.customCv.parametersSha='d'.repeat(64);f.records.save(task);
 await assert.rejects(send,/establish its isolated context/);
 assert.equal(f.sent.length,1);
});

test('Kimi steering stays unavailable and ordinary resource intent updates after an exact steer receipt',async()=>{
 const f=fixture(),records=[];
 f.runtime.recordUserTurn=value=>records.push(value);
 f.runtime.agents.rpc=async(_provider,_method,params)=>({turnId:params.input[0].text==='accepted'?params.expectedTurnId:'a-different-turn'});
 const params={threadId:'thread',expectedTurnId:'active-turn',input:[{type:'text',text:'rejected'}]};
 await assert.rejects(f.request({provider:'kimi',method:'turn/steer',params}),/queued follow-ups/);
 await f.request({provider:'codex',method:'turn/steer',params});
 assert.deepEqual(records,[]);
 await f.request({provider:'codex',method:'turn/steer',params:{...params,input:[{type:'text',text:'accepted'}]}});
 assert.equal(records.length,1);
 assert.equal(records[0].params.input[0].text,'accepted');
});

test('invalid mode values fail before context, terminal readiness, provider or worker effects',async()=>{
 for(const terminal of [false,true])for(const method of ['turn/start','turn/steer'])for(const bad of [{planningMode:'true'},{planningMode:1},{planningMode:null},{reviewMode:'false'}]){
  const f=fixture({terminal});await assert.rejects(f.request({provider:'codex',method,params:{threadId:'thread',input:[{type:'text',text:human}],...bad}}),/Invalid interaction mode/);assert.deepEqual(f.effects,[]);assert.deepEqual(f.sent,[]);assert.deepEqual(f.workerCalls,[]);assert.equal(f.rows.size,0);
 }
});

test('pure restricted formatters reject invalid booleans and enabled unbound text has no contradictory enable instruction',()=>{
 for(const bad of ['true',1,null]){assert.throws(()=>terminalOnlyTurn({planningMode:bad,input:[{type:'text',text:human}]}),/Invalid interaction mode/);assert.throws(()=>currentPrivateTurn({input:[{type:'text',text:human}]},{},{planningMode:bad}),/Invalid interaction mode/);}
 const turn=formatPreparedTaskTurn({params:{input:[{type:'text',text:human}]},interaction:{planningMode:true,reviewMode:false,workflow:null}});const text=assertMode(turn,true);assert(!text.includes('Enable task planning'));assert.match(text,/Current capability scope: chat/);assert.match(text,/explicitly delegated independent jobs/);assert.doesNotMatch(text,/Call present_task/);
});
