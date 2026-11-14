// Real DeploymentPanel + extracted context hook; only the IPC promises are controlled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentFixture,deploymentHarness} from "../helpers/deployment-diagnostic-hooks.mjs";
import {deferred} from "../helpers/agent-hooks.mjs";

const reads=h=>h.calls.filter(call=>call.method==='task.deployment.context');
const writes=h=>h.calls.filter(call=>['task.deployment.draft','task.deployment.save','task.deployment.prepare','task.execute','worker.connect','compute.connection.connect','agent.rpc'].includes(call.method));
const state=h=>h.find(node=>node.props?.['data-testid']==='deployment-context-state');
const binding=h=>h.text(h.find(node=>node.props?.['data-testid']==='deployment-binding'));
const retry=h=>h.find(node=>node.type==='button'&&h.text(node)==='重新读取');
const execute=h=>h.find(node=>node.props?.['data-testid']==='execute-deployment');

test('human SSH scheduler save event refreshes only the current trusted deployment catalog',async()=>{
 const previous=globalThis.window,listeners=[];globalThis.window={studio:{onEvent:listener=>{listeners.push(listener);return()=>listeners.splice(listeners.indexOf(listener),1);}}};let h;
 try{h=deploymentHarness();await h.flush();const before=reads(h).length,list=()=>[...listeners];for(const listener of list())listener({method:'studio/sshSchedulerChanged',params:{profileId:'inert-scheduler',version:2}});await h.flush();assert.equal(reads(h).length,before+1);assert(reads(h).every(call=>call.data.taskId===h.props.task.id));assert.deepEqual(writes(h),[]);h.update({worker:false,restoring:true});await h.flush();const disconnected=reads(h).length;for(const listener of list())listener({method:'studio/sshSchedulerChanged',params:{}});await h.flush();assert.equal(reads(h).length,disconnected);}finally{h?.unmount();globalThis.window=previous;}
});

test('production context hook keeps wrong-task data out of the active deployment and execution gates',async()=>{
 const h=deploymentHarness({override:async(method,data,standard)=>{const value=await standard(method,data);return method==='task.deployment.context'?{...value,taskId:'wrong-task',projects:value.projects.map(project=>({...project,name:'Wrong-scope project'}))}:value;}});
 await h.flush();assert(h.text(state(h)).includes('正在恢复'));assert(binding(h).includes('Compute project'));assert(!binding(h).includes('Wrong-scope'));assert.equal(execute(h).props.disabled,true);assert.equal(reads(h).length,1);assert.deepEqual(writes(h),[]);assert.deepEqual(h.externalErrors,[]);h.unmount();
});

test('manual context reread supersedes a pending read without a late failure replacing the ready catalog',async()=>{
 const pending=deferred();let count=0;const h=deploymentHarness({override:(method,data,standard)=>method==='task.deployment.context'&&++count===1?pending.promise:standard(method,data)});
 await h.flush();retry(h).props.onClick();await h.flush();assert(binding(h).includes('Compute project'));pending.reject(Error('old context read failed'));await h.flush();assert.throws(()=>state(h),/not found/);assert.equal(reads(h).length,2);assert.deepEqual(writes(h),[]);assert.deepEqual(h.externalErrors,[]);h.unmount();
});

test('late context success after a worker gate closes cannot release deployment controls',async()=>{
 const pending=deferred();let answer;const h=deploymentHarness({override:async(method,data,standard)=>{if(method==='task.deployment.context'){answer=await standard(method,data);return pending.promise;}return standard(method,data);}});
 await h.flush();h.update({worker:false,restoring:true});await h.flush();pending.resolve(answer);await h.flush();assert(h.text(state(h)).includes('正在核对'));assert.equal(execute(h).props.disabled,true);assert.equal(reads(h).length,1);assert.deepEqual(writes(h),[]);h.unmount();
});

test('late old-task context success cannot replace the new task catalog or user science parameters',async()=>{
 const pending=deferred();let old;const h=deploymentHarness({override:async(method,data,standard)=>{const value=await standard(method,data);if(method==='task.deployment.context'&&data.taskId==='workflow-A'){old={...value,projects:value.projects.map(project=>({...project,name:'Obsolete task A project'}))};return pending.promise;}return value;}});
 await h.flush();const next=deploymentFixture('workflow-B');next.task.parameters.md={temperature:310};h.setTask(next.task,next.run);await h.flush();assert(binding(h).includes('Compute project'));pending.resolve(old);await h.flush();assert(!binding(h).includes('Obsolete'));assert.equal(h.props.task.id,'workflow-B');assert.equal(h.props.task.parameters.md.temperature,310);assert.equal(reads(h).length,2);assert.deepEqual(writes(h),[]);assert.deepEqual(h.externalErrors,[]);h.unmount();
});

test('unmount invalidates a pending context and cannot publish a late success or schedule refreshes',async()=>{
 const pending=deferred();let answer;const h=deploymentHarness({override:async(method,data,standard)=>{const value=await standard(method,data);if(method==='task.deployment.context'){answer=value;return pending.promise;}return value;}});
 await h.flush();const before={calls:h.calls.length,refreshes:h.refreshes()};h.unmount();pending.resolve(answer);await h.flush();assert.equal(h.calls.length,before.calls);assert.equal(h.refreshes(),before.refreshes);assert.deepEqual(h.externalErrors,[]);assert.deepEqual(writes(h),[]);
});

test('changed parent executable/repository facts trigger one scoped reread without altering deployment settings',async()=>{
 const h=deploymentHarness();await h.flush();const before=structuredClone(h.props.task.deployment.config);
 h.update({environments:h.props.environments.map(environment=>({...environment,executables:{...environment.executables,python:'/fixture/updated'},repositories:{pydyn:'/fixture/versioned-source'}}))});await h.flush();assert.equal(reads(h).length,2);assert(reads(h).every(call=>call.data.taskId===h.props.task.id));assert.deepEqual(h.props.task.deployment.config,before);assert.deepEqual(writes(h),[]);h.unmount();
});

test('one passive restoration attempt remains separate from an explicit reconnect and catalog recovery',async()=>{
 let automatic=0,explicit=0;const h=deploymentHarness({properties:{worker:false,restoring:true,onAutomaticRestore:()=>{automatic++;},onReconnect:()=>{explicit++;}}});await h.flush();assert.equal(automatic,0);
 h.update({restoring:false});await h.flush();h.update({restoring:true});await h.flush();h.update({restoring:false});await h.flush();assert.equal(automatic,1);assert.equal(explicit,0);assert.equal(reads(h).length,0);
 h.find(node=>node.type==='button'&&h.text(node)==='恢复此流程的连接').props.onClick();await h.flush();assert.equal(explicit,1);assert.equal(reads(h).length,0,'A callback alone does not assert worker readiness');h.update({worker:true});await h.flush();assert.equal(reads(h).length,1);assert(binding(h).includes('Compute project'));assert.deepEqual(writes(h),[]);h.unmount();
});

test('explicit reconnect waits for its acknowledgement before refreshing the actual catalog and prevents duplicate clicks',async()=>{
 const reconnect=deferred();let contexts=0,connections=0;const h=deploymentHarness({properties:{onReconnect:()=>{connections++;return reconnect.promise;}},override:(method,data,standard)=>method==='task.deployment.context'&&++contexts===1?Promise.reject(Error('initial read unavailable')):standard(method,data)});
 await h.flush();h.find(node=>node.type==='button'&&h.text(node)==='恢复此流程的连接').props.onClick();await h.flush();assert.equal(connections,1);assert.equal(reads(h).length,1);assert.equal(h.find(node=>node.type==='button'&&h.text(node)==='正在连接…').props.disabled,true);
 reconnect.resolve();await h.flush();assert.equal(reads(h).length,2);assert.throws(()=>state(h),/not found/);assert.deepEqual(writes(h),[]);h.unmount();
});

test('resource readiness enables the explicit execution action without requiring optional human review or starting implicitly',async()=>{
 const h=deploymentHarness();await h.flush();assert.equal(execute(h).props.disabled,false);assert.deepEqual(writes(h),[]);h.review();await h.flush();assert.equal(execute(h).props.disabled,false);
 h.update({worker:false,restoring:true});await h.flush();assert.equal(execute(h).props.disabled,true);assert.equal(h.props.task.deployment.prepared.artifactId,'run-workflow-A');assert.deepEqual(writes(h),[]);h.unmount();
});
