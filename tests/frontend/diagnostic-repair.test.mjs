import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createDiagnostic,diagnosticContext} from '../../frontend/features/diagnostics/ui-diagnostics.mjs';
import {diagnosticRepairRequest} from '../../frontend/features/diagnostics/repair-request.mjs';
import {diagnosticComponents} from '../helpers/diagnostic-components.mjs';

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

function handoffFixture(select){
 const source=fs.readFileSync(new URL('../../frontend/app/App.tsx',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function repairWorkflow('),source.indexOf(' function askAgent('));
 const javascript=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const intents=[],selections=[],errors=[],seq={current:0},mounted={current:true};
 const values={agentBusy:false,agentTasks:[task],conversationSelectionSeq:seq,setAgentIntent:value=>intents.push(value),settingsReady:{current:Promise.resolve()},mounted,invoke:select,selectedConversationRef:{current:{id:'other-chat'}},beginWorkerGate(){},setSkill(){},conversationChanged(){},setProjectId(){},setSessionSelection:value=>selections.push(value),observeWorker:async()=>true,setAgentVisible(){},setPrimaryPanel(){},onError:error=>errors.push(error),t:value=>value,crypto};
 const run=new Function(...Object.keys(values),javascript+'\nreturn repairWorkflow;')(...Object.values(values));
 return {run,intents,selections,errors,seq,mounted};
}
test('actual App handoff selects exact original conversation and stages a draft without sending',async()=>{
 const calls=[],h=handoffFixture(async(method,data)=>{calls.push({method,data});return {id:'deepseek:original',provider:'deepseek',threadId:'original',taskId:'workflow'};});
 await h.run(diagnosticRepairRequest(record(),task));assert.deepEqual(calls,[{method:'conversation.select',data:{id:'deepseek:original'}}]);
 assert.equal(h.selections.length,1);assert.equal(h.intents.at(-1).threadId,'original');assert.equal(h.intents.at(-1).autoSend,undefined);assert.deepEqual(h.errors,[]);
});
test('late or mismatched conversation selection cannot deliver repair into another chat',async()=>{
 let resolve;const h=handoffFixture(()=>new Promise(value=>resolve=value)),promise=h.run(diagnosticRepairRequest(record(),task));await Promise.resolve();h.seq.current++;
 resolve({id:'deepseek:original',provider:'deepseek',threadId:'original',taskId:'workflow'});await promise;assert.equal(h.selections.length,0);assert(h.intents.every(value=>value===undefined));
 const wrong=handoffFixture(async()=>({id:'deepseek:original',provider:'deepseek',threadId:'original',taskId:'other'}));await wrong.run(diagnosticRepairRequest(record(),task));assert.equal(wrong.errors.length,1);assert.equal(wrong.selections.length,0);assert(wrong.intents.every(value=>value===undefined));
});
