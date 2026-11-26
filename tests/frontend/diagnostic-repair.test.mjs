import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostic,diagnosticContext} from '../../frontend/features/diagnostics/ui-diagnostics.mjs';
import {diagnosticRepairRequest} from '../../frontend/features/diagnostics/repair-request.mjs';
import {diagnosticComponents} from '../helpers/diagnostic-components.mjs';
import {agentHarness,conversation,deferred,memoryStorage} from '../helpers/agent-hooks.mjs';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';

const task={id:'workflow',provider:'deepseek',threadId:'original',parameterRevision:3,parameters:{engine:'pydyn.md',inputs:{script:'input/run.py'}},deployment:{revision:2,config:{target:'local',targetId:'env',projectId:'project'},prepared:{artifactId:'run'}}};
const record=()=>createDiagnostic('ModuleNotFoundError: sample; api_key=sk-synthetic-secret',diagnosticContext(task,task.deployment.config,'execute','run'));

test('repair draft separates original diagnostic, new input revision and exact matching run without inventing a receipt',()=>{
 const original=record(),current={...task,parameterRevision:4,parameters:{...task.parameters,temperature:325},execution:{artifactId:'run',phase:'unknown'}};
 const request=diagnosticRepairRequest(original,current,{id:'different-run',command:['never-include-other-run']});
 assert.equal(request.provider,'deepseek');assert.equal(request.threadId,'original');assert.equal(request.taskId,'workflow');assert.equal(request.autoSend,undefined);
 assert(!request.text.includes('sk-synthetic-secret'));assert(!request.text.includes('never-include-other-run'));
 const body=JSON.parse(request.text.slice(request.text.indexOf('{')));
 assert.equal(body.diagnostic.context.parameterRevision,3);assert.equal(body.currentDraft.parameterRevision,4);assert.equal(body.diagnostic.context.inputParameters.inputs.script,'input/run.py');assert.equal(body.currentDraft.execution.phase,'unknown');assert.equal(body.runDetailsLoaded,false);assert.equal(body.run,null);
 const exact=diagnosticRepairRequest(original,current,{id:'run',snapshots:[{name:'run.py',sha256:'a'.repeat(64)}],status:'failed',exit:{code:1}});
 assert(exact.text.includes('a'.repeat(64)));assert(exact.text.includes('不重复提交'));
});

test('repair for a definite preflight rejection uses the workflow and available draft',()=>{
 const diagnostic=createDiagnostic(Error('execution_not_started: Review the saved input revision'),diagnosticContext(task,task.deployment.config,'execute','run'));
 const request=diagnosticRepairRequest(diagnostic,task);
 assert.match(request.text,/本次执行未提交作业/);assert.doesNotMatch(request.text,/读取原作业|查询原作业/);
});

test('repair cannot cross workflow or conversation ownership, and retained diagnostic parameters do not mutate',()=>{
 const original=record();const changed=structuredClone(task);changed.parameters.inputs.script='new.py';
 assert.equal(original.context.inputParameters.inputs.script,'input/run.py');
 for(const value of [{...task,id:'other'},{...task,threadId:'other'},{...task,provider:'codex'},{...task,threadId:null}])assert.equal(diagnosticRepairRequest(original,value),null);
 const request=diagnosticRepairRequest({...original,raw:'x'.repeat(100000)},task);assert(request.text.length<30000);assert(request.text.includes('[truncated;'));
});

test('actual diagnostic action only supplies a bound draft when clicked, including persisted unknown attempts',()=>{
 const {DeploymentDiagnostics}=diagnosticComponents(),requests=[];
 const rendered=DeploymentDiagnostics({records:[],task:{...task,execution:{artifactId:'run',phase:'unknown',message:'receipt missing'}},config:task.deployment.config,onRepair:value=>requests.push(value)});
 assert.equal(requests.length,0);
 const notice=rendered.props.children[0];assert.equal(notice.props.phase,'unknown');notice.props.onRepair();
 assert.equal(requests.length,1);assert(requests[0].text.includes('receipt missing'));assert.equal(requests[0].autoSend,undefined);
});

const original={...conversation(task.provider,task.threadId),taskId:task.id};
const neighbor={...conversation('codex','other-chat'),projectId:'other-authorized-project'};
const agentProps=app=>app.find(node=>node.type==='./Agent').props;
const dispatchedSelections=app=>app.calls.filter(call=>call.method==='conversation.select').map(call=>call.data.id);

async function handoffFixture({select=()=>original,replying=false}={}){
 const storage=memoryStorage();
 storage.setItem('studio.section','deployment:'+task.id);
 const app=appWorkerHarness({storage,managedConversations:replying?[{provider:original.provider,threadId:original.threadId,replying:true}]:[],
  override:(method,data,standard)=>{
   if(method==='task.list')return [task];
   if(method==='conversation.list')return [original,neighbor];
   if(method==='conversation.select')return data.id===original.id?select():neighbor;
   return standard(method,data);
  }});
 await app.flush();
 const repair=app.find(node=>node.type==='./DeploymentPanel').props.onRepair;
 async function chooseNeighbor(){
  app.find(node=>node.type==='button'&&node.props?.children?.[0]?.props?.children===neighbor.name).props.onClick();
  await app.flush();
 }
 return {app,storage,repair,chooseNeighbor};
}
test('actual App repair selects the original conversation, clears the other project, and stages a draft without sending',async()=>{
 const {app,storage,repair,chooseNeighbor}=await handoffFixture({replying:true});
 let agent;
 try{
  await chooseNeighbor();
  assert.equal(agentProps(app).projectId,neighbor.projectId);
  const request=diagnosticRepairRequest(record(),task);
  repair({...request,autoSend:true});await app.flush();
  assert.deepEqual(dispatchedSelections(app),[neighbor.id,original.id]);
  const props=agentProps(app);
  assert.deepEqual(props.sessionSelection.conversation,original);
  assert.equal(props.projectId,'');
  assert.equal(props.intent.autoSend,undefined);
  agent=agentHarness({storage,props,override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/read'
   ?{thread:{id:original.threadId,turns:[]},studioSession:{threadId:original.threadId,busy:true,turnId:'existing-reply'}}
   :standard(method,data)});
  await agent.flush();
  assert.equal(agent.textarea().props.value,request.text);
  agent.find(node=>node.props?.['data-testid']==='agent-stop');
  agent.emit({method:'studio/agentTurnState',provider:original.provider,params:{threadId:original.threadId,busy:false,turnId:null}});
  await agent.flush();
  assert.deepEqual([...app.calls,...agent.calls].filter(call=>call.method==='task.execute'||call.method==='agent.rpc'&&call.data.method==='turn/start'),[]);
 }finally{agent?.unmount();app.unmount();}
});
test('late or mismatched conversation selection cannot deliver repair into another chat',async()=>{
 const request=diagnosticRepairRequest(record(),task),late=deferred();
 const h=await handoffFixture({select:()=>late.promise});
 try{
  h.repair(request);await h.app.flush();
  assert.deepEqual(dispatchedSelections(h.app),[original.id]);
  assert.equal(agentProps(h.app).intent,undefined);
  await h.chooseNeighbor();
  late.resolve(original);await h.app.flush();
  assert.deepEqual(agentProps(h.app).sessionSelection.conversation,neighbor);
  assert.equal(agentProps(h.app).intent,undefined);
  assert.equal(h.storage.getItem('studio.conversation'),neighbor.id);
 }finally{h.app.unmount();}
 for(const mismatch of [{id:neighbor.id},{taskId:'other'}]){
  const wrong=await handoffFixture({select:()=>({...original,...mismatch})});
  try{
   wrong.repair(request);await wrong.app.flush();
   assert.deepEqual(dispatchedSelections(wrong.app),[original.id]);
   const toast=wrong.app.notifications.find(notice=>notice.testId==='global-diagnostic-toast');
   assert.equal(toast.severity,'error');
   assert.match(toast.message.props.record.raw,/会话绑定已变化/);
   assert.equal(agentProps(wrong.app).sessionSelection,undefined);
   assert.equal(agentProps(wrong.app).intent,undefined);
   assert.equal(wrong.storage.getItem('studio.conversation'),null);
  }finally{wrong.app.unmount();}
 }
});
