import test from 'node:test';import assert from 'node:assert/strict';
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
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
