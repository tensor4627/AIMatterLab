import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {managedToolReadiness,scientificToolReadiness} from '../../agent/tools/scientific-tool-readiness.mjs';
import {taskWorkerSource} from '../../contracts/compute/task-worker-binding.mjs';
import {agentHarness,conversation,deferred} from '../helpers/agent-hooks.mjs';

const provider='deepseek', threadId='existing-chat';
const names=['list_compute_resources','acquire_compute_resource','inspect_compute_service'];
const receipt=tools=>({status:'verified',nativeTools:0,tools:tools.map(name=>'mcp__gpusampling__'+name)});
const localBlocked={status:'blocked',count:0,message:'作业服务未连接'};
const ready={status:'ready',count:3};
const hostedStatus=(managedTools=ready,extra={})=>({...localBlocked,managedCompute:true,managedTools,...extra});
const isTestId=id=>node=>node.props?.['data-testid']===id;

const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const registrations=[];
function visit(node){
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='scientificTools')registrations.push(node.getText(ast));
 if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='handle'&&
    ['agent.connect','agent.tools'].includes(node.expression.arguments[0]?.text))registrations.push(node.getText(ast));
 ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(registrations.length,3);

async function mainFixture(t){
 const entries=new Map(),calls=[],handlers=new Map();
 let selected=threadId, busy=false, task=null;
 const native={process:{},info:{studioIsolation:receipt(names)}};
 const session={id:'deepseek-hosted-fixture',provider,threadId};
 const terminalMcp=new TerminalMcp({terminal:{tools:()=>[]},desktopTools:{
  tools:()=>names.map(name=>({name,inputSchema:{type:'object'}})),
  call:()=>assert.fail('Readiness cannot acquire, inspect or modify a compute resource'),
 }});
 await terminalMcp.start();t.after(()=>terminalMcp.close());
 terminalMcp.bindProviderContext(provider,{threadId},{sessionId:session.id});
 const connection=terminalMcp.providerConnection(provider,session.id);
 entries.set(threadId,{session,native,connection});
 const entry=(p,id)=>p===provider?entries.get(id??selected):null;
 const agents={active:provider,sessionIdentity:(p,id)=>entry(p,id)?.session,bridge:(p,id)=>entry(p,id)?.native,
  toolConnection:(p,id)=>entry(p,id)?.connection,isBusy:()=>busy,
  disconnect:(p,id)=>calls.push(['disconnect',p,id]),connect:async(p,{threadId:id,assertCurrent})=>{assertCurrent();calls.push(['connect',p,id]);return {};}};
 const owner=()=>({provider,threadId:selected,taskId:task?.id??null,serial:1});
 const worker={connection:null,providerConnection:()=>null,probeTools:()=>assert.fail('No foreground worker check'),connect:()=>assert.fail('No worker setup')};
 const context={providerId:value=>assert.equal(value,provider),managedResources:{},resourceRouting:{readiness:async()=>null,capture:()=>({selection:null,assertCurrent(){}})},managedToolReadiness,scientificToolReadiness,terminalMcp,agents,taskWorkerSource,worker,codex:null,
  privateAccess:{assertTask:()=>assert.fail('An unrelated or offline worker cannot supply workflow authorization')},sharedTerminal:null,
  workflowContext:{current:owner,selectedOwner:()=>({...owner(),revision:1})},taskRecords:{bound:()=>task,deleted:()=>false,read:()=>task},
  agentConnectAttempts:new Map(),settings:{},catalog:{put:(_kind,_id,value)=>value},
  readWorkerStatus:()=>assert.fail('Hosted tool repair cannot check or start a foreground worker'),
  emit:(_channel,event)=>calls.push(event),handle:(name,handler)=>handlers.set(name,handler),
 };
 for(const registration of registrations)vm.runInNewContext(registration,context);
 return {invoke:(method,data={provider,threadId})=>handlers.get(method)(data),terminalMcp,connection,session,native,calls,worker,
  select:id=>{selected=id;},setBusy:value=>{busy=value;},bindTask:value=>{task=value;}};
}

test('actual Agent IPC sees a scoped hosted tool inventory with no foreground worker',async t=>{
 const f=await mainFixture(t);
 const status=await f.invoke('agent.tools');
 assert.equal(status.threadId,threadId);
 assert.equal(status.status,'blocked');
 assert.equal(status.workflowBound,false);
 assert.deepEqual(status.managedTools,ready);
 assert(!JSON.stringify(status).includes(f.connection.tokens.mcp));
 const connected=await f.invoke('agent.connect');
 assert.deepEqual(connected.tools.managedTools,ready);
 assert.deepEqual(f.calls.at(-1).params.managedTools,ready);
});

test('an incomplete native inventory or revoked MCP token does not appear as ready',async t=>{
 const f=await mainFixture(t);
 f.native.info.studioIsolation=receipt([...names.slice(0,2),'unrelated_capability']);
 const incomplete=(await f.invoke('agent.tools')).managedTools;
 assert.equal(incomplete.status,'blocked');assert.equal(incomplete.count,2);assert.match(incomplete.message,/不完整/);
 f.native.info.studioIsolation=receipt(names);
 f.terminalMcp.revokeProvider(provider,f.session.id);
 const unavailable=(await f.invoke('agent.tools')).managedTools;
 assert.equal(unavailable.status,'blocked');assert.equal(unavailable.count,0);assert.match(unavailable.message,/无法读取/);
});

test('the hosted tool repair owns its conversation and does not touch compute',async t=>{
 const f=await mainFixture(t);
 const repair=(id=threadId)=>f.invoke('agent.connect',{provider,threadId:id,repairTools:'managed'});
 await assert.rejects(repair('foreign-chat'),/原对话/);
 await assert.rejects(f.invoke('agent.tools',{provider,threadId:'foreign-chat'}),/Select the conversation/);
 f.setBusy(true);await assert.rejects(repair(),/Conversation in progress/);assert.deepEqual(f.calls,[]);
 f.setBusy(false);
 assert.deepEqual((await repair()).tools.managedTools,ready);
 assert.deepEqual(f.calls.slice(0,2),[['disconnect',provider,threadId],['connect',provider,threadId]]);
});

test('a hosted tool receipt does not verify a workflow against an unrelated foreground worker',async t=>{
 const f=await mainFixture(t);
 f.bindTask({id:'workflow',provider,threadId,authoring:{workerBinding:{distribution:'Original',root:'/original',port:8767}}});
 Object.assign(f.worker,{connection:{},identity:{distribution:'Other',root:'/other'},connectionTarget:{port:8767}});
 const status=await f.invoke('agent.tools');
 assert.deepEqual(status.managedTools,ready);
 assert.equal(status.workflowBound,true);
 assert.equal(status.status,'blocked');
 assert.match(status.message,/恢复原服务/);
});

async function restoredAgent(t,tools,override){
 const propCalls=[];
 const h=agentHarness({props:{computeConnected:false,sessionSelection:{nonce:'first',conversation:conversation(provider,threadId)},
  onConnectCompute:()=>propCalls.push('compute'),onReviewWorker:()=>propCalls.push('workflow')},override:(method,data,standard)=>{
  if(method==='agent.connect')return {tools:typeof tools==='function'?tools(data):tools};
  return override?override(method,data,standard):standard(method,data);
 }});
 t.after(()=>h.unmount());await h.flush();h.click('agent-options');await h.flush();
 return {h,propCalls};
}

test('ordinary hosted chat presents the verified tool channel with no reconnect CTA for WSL',async t=>{
 const {h,propCalls}=await restoredAgent(t,hostedStatus());
 const status=h.find(isTestId('agent-tools-status')).props;
 assert.equal(status['data-status'],'ready');assert.equal(status['data-scope'],'managed');
 assert.throws(()=>h.find(isTestId('agent-tool-repair')));assert.throws(()=>h.find(isTestId('agent-managed-tools-notice')));
 h.type('继续查询同一资源');h.send();await h.flush();
 assert(h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 assert.deepEqual(propCalls,[]);
});

test('actual tool failure keeps the draft and invokes the exact hosted repair',async t=>{
 const {h,propCalls}=await restoredAgent(t,data=>hostedStatus(data.repairTools==='managed'?ready:{status:'blocked',count:2,message:'当前对话的托管计算工具清单不完整。'}));
 assert.match(JSON.stringify(h.find(isTestId('agent-managed-tools-notice'))),/工具清单不完整/);
 h.type('保持草稿');h.click('agent-managed-tools-repair');await h.flush();
 assert.deepEqual(h.calls.filter(call=>call.method==='agent.connect').at(-1).data,{provider,threadId,repairTools:'managed'});
 assert.equal(h.textarea().props.value,'保持草稿');assert.deepEqual(propCalls,[]);
 assert.throws(()=>h.find(isTestId('agent-managed-tools-notice')));
 assert(!h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
});

test('blocked original workflow authority remains visible on its own status line',async t=>{
 const {h}=await restoredAgent(t,hostedStatus(ready,{workflowBound:true,message:'Private CV sharing is required'}));
 assert.equal(h.find(isTestId('agent-tools-status')).props['data-status'],'ready');
 const workflow=h.find(isTestId('agent-workflow-tools-status')).props;
 assert.equal(workflow['data-status'],'blocked');assert.match(JSON.stringify(workflow.children),/Private CV sharing is required/);
});

test('a delayed poll belongs to its displayed conversation and cannot replace a newer status',async t=>{
 const poll=deferred();
 const {h}=await restoredAgent(t,hostedStatus(),(method,data,standard)=>method==='agent.tools'?poll.promise:standard(method,data));
 h.tick();await h.flush();
 assert.deepEqual(h.calls.filter(call=>call.method==='agent.tools').at(-1).data,{provider,threadId});
 h.render({sessionSelection:{nonce:'second',conversation:conversation(provider,'next-chat')}});await h.flush();
 poll.resolve(hostedStatus({status:'blocked',count:0}));await h.flush();
 assert.equal(h.find(isTestId('agent-tools-status')).props['data-status'],'ready');
 assert.throws(()=>h.find(isTestId('agent-managed-tools-notice')));
});
