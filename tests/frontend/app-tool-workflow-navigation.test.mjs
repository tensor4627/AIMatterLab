// Actual App + conversation/workflow navigation hooks and typed client; controlled transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {memoryStorage} from "../helpers/agent-hooks.mjs";
import {RunReviewDraft} from '../../frontend/features/runs/run-review-draft.mjs';
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const original={id:'codex:original',provider:'codex',threadId:'original',name:'CPU reference flow',projectId:'workspace',taskId:'original-task',updatedAt:1},ordinary={id:'codex:ordinary',provider:'codex',threadId:'ordinary',name:'Ordinary chat',projectId:null,taskId:null,updatedAt:1};
const task={id:original.taskId,provider:'codex',threadId:'original',name:'CPU reference flow',workflowVersion:2,projectId:'workspace',parameters:{},steps:[],artifacts:[],workspaceChoice:'workspace',workspace:{id:'workspace',root:'/worker/projects/workspace/inputs',workerBinding:{distribution:'Fixture',root:'/worker',port:8888}}};
const binding={schema_version:1,workflow_id:'workflow',execution_id:'execution',step_id:'first',snapshot_sha256:'a'.repeat(64),group_id:'group',group_version:'b'.repeat(64),configuration_id:'configuration',execution_skill_id:'skill',execution_skill_sha256:'c'.repeat(64)};
const run={id:'bound-run',name:'First step',engine:'installation.check',status:'draft',project_id:'compute',environment_id:'env',directory:'/worker/owned-step',inputs:{'run.py':'/worker/private/run.py'},command:['/python','run.py'],validation:{status:'not_run'},gpu:0,max_seconds:30,created_at:1,updated_at:1,studio_workflow_binding:binding};
const location={task_id:task.id,provider:'codex',thread_id:'original',conversation_id:original.id,workspace_id:'workspace',workflow_id:'workflow',execution_id:'execution',step_id:'first',run_id:run.id};
function fixture({locate=()=>location,select=value=>value,legacy=false}={}){
 const storage=memoryStorage();storage.setItem('studio.conversation',ordinary.id);storage.setItem('studio.section','home');const record=legacy?{...run,id:'legacy-run',engine:'pydyn.md',studio_workflow_binding:undefined}:run;
 const h=appWorkerHarness({storage,override:(method,data,standard)=>{if(method==='conversation.list')return [original,ordinary];if(method==='task.list')return [task];if(method==='conversation.select')return data.id===original.id?select(original):ordinary;if(method==='tools.workflows.locateRun'){assert.equal(data.run_id,record.id);return locate();}if(method==='worker.request'&&data.target==='/api/run/status')return record;if(method==='worker.request'&&data.target==='/api/runs')return [record];return standard(method,data);}});
 return {...h,record,clickJob:()=>h.find(node=>node.type==='./JobsPage').props.onOpen({location:'local',run:record})};
}
const privileged=h=>h.calls.filter(call=>call.method==='worker.request'&&/\/api\/run\/(?:submit|validate|revise|resume)|\/api\/runs\/prepare/.test(call.data.target)||call.method.startsWith('tools.workflows.')&&!['tools.workflows.locateRun'].includes(call.method));

test('actual Jobs→bound run waits for original conversation ACK before publishing the exact step focus',async()=>{
 const ack=defer(),h=fixture({select:()=>ack.promise});await h.flush();h.clickJob();await h.flush();assert.equal(h.calls.filter(call=>call.method==='tools.workflows.locateRun').length,1);assert.throws(()=>h.find(node=>node.type==='./RunReview'));
 ack.resolve(original);await h.flush();const page=h.find(node=>node.type==='./AgentTaskPage'&&node.props.task.id===task.id);assert.deepEqual({...page.props.toolWorkflowFocus,nonce:'fresh'},{task_id:task.id,execution_id:'execution',step_id:'first',nonce:'fresh'});assert.equal(h.storage.getItem('studio.section'),'agent-task:'+task.id);assert.deepEqual(privileged(h),[]);h.unmount();
});

test('failed or superseded typed location cannot fall back to the generic execution page',async()=>{
 for(const superseded of [false,true]){const pending=defer(),h=fixture({locate:()=>pending.promise});await h.flush();h.clickJob();await h.flush();if(superseded)h.find(node=>node.props?.['data-testid']==='navigate-skills').props.onClick();if(superseded)pending.resolve(location);else pending.reject(Error('Original owner unavailable'));await h.flush();assert.throws(()=>h.find(node=>node.type==='./RunReview'));assert(!h.calls.some(call=>call.method==='conversation.select'&&call.data.id===original.id));assert.deepEqual(privileged(h),[]);h.unmount();}
});

test('legacy jobs still open the original review route without querying tool-workflow ownership',async()=>{
 const h=fixture({legacy:true});await h.flush();h.clickJob();await h.flush();assert.equal(h.find(node=>node.type==='./RunReview').props.run.id,h.record.id);assert.equal(h.storage.getItem('studio.section'),'task:'+h.record.id);assert(!h.calls.some(call=>call.method==='tools.workflows.locateRun'));assert.deepEqual(privileged(h),[]);h.unmount();
});

test('late task metadata cannot change the actual App Review draft scope or lose an edit',async()=>{
 const pendingTasks=defer(),storage=memoryStorage();storage.setItem('studio.conversation',original.id);const record={...run,id:'legacy-late-task',engine:'pydyn.md',studio_workflow_binding:undefined};
 const h=appWorkerHarness({storage,override:(method,data,standard)=>{if(method==='task.list')return pendingTasks.promise;if(method==='conversation.list')return [original];if(method==='conversation.select')return original;if(method==='worker.request'&&['/api/run/status','/api/runs'].includes(data.target))return data.target==='/api/runs'?[record]:record;return standard(method,data);}});
 try{await h.flush();h.find(node=>node.type==='./JobsPage').props.onOpen({location:'local',run:record});await h.flush();const before=h.find(node=>node.type==='./RunReview').props;assert.deepEqual(JSON.parse(before.draftScope),['task-source',original.provider,original.id,original.taskId]);const draft=new RunReviewDraft(before.draftScope,before.run,storage);draft.stage({name:'Edit before task list returns'});
 pendingTasks.resolve([task]);await h.flush();const after=h.find(node=>node.type==='./RunReview').props;assert.equal(after.draftScope,before.draftScope);assert.equal(new RunReviewDraft(after.draftScope,after.run,storage).values.name,'Edit before task list returns');assert.deepEqual(privileged(h),[]);
 }finally{h.unmount();}
});
