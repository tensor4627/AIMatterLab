import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {deploymentFixture,deploymentHarness} from './helpers/deployment-diagnostic-hooks.mjs';
import {diagnosticComponents} from './helpers/diagnostic-components.mjs';
import {deferred} from './helpers/agent-hooks.mjs';
import {deploymentOutbox} from '../shared/deployment-draft.mjs';
const raw="Error invoking remote method 'studio:task.execute': Error: Required PyDyn runtime imports failed (pydyn).\nModuleNotFoundError: pydyn\n/fixture/run.py:4";
function html(h){const {DeploymentDiagnostics}=diagnosticComponents();return renderToStaticMarkup(React.createElement(DeploymentDiagnostics,h.diagnosticProps()));}
const executions=h=>h.calls.filter(call=>call.method==='task.execute');

test('execute failure captures original request ownership, full diagnostics, and becomes historical after changing target',async()=>{
 let h;h=deploymentHarness({override:(method,data,standard)=>{if(method==='task.execute'){h.setTask({...h.props.task,execution:{artifactId:data.artifactId,phase:'blocked',message:'validation failed'}});throw Error(raw);}return standard(method,data);}});await h.flush();h.review();h.click('execute-deployment');await h.flush();const record=h.journal.list(h.props.task.id)[0];assert.equal(record.raw,raw);assert.equal(record.context.targetId,'env-A');assert.equal(record.context.targetName,'Research environment A');assert.equal(record.context.operation,'execute');assert.equal(record.context.parameterRevision,3);assert.equal(record.context.runId,'run-workflow-A');assert.equal(h.externalErrors.length,0);assert(!html(h).includes('data-testid="historical-diagnostics"'));h.target('env-B');await h.flush();assert(html(h).includes('data-testid="historical-diagnostics"'));assert(html(h).includes('Research environment A'));assert(!html(h).includes('Research environment B'));assert.equal(executions(h).length,1);h.unmount();
});
test('late rejection for old task is retained only under that task and never attributed to the new task',async()=>{
 const pending=deferred(),h=deploymentHarness({override:(method,data,standard)=>method==='task.execute'?pending.promise:standard(method,data)});await h.flush();h.review();h.click('execute-deployment');await h.flush();const other=deploymentFixture('workflow-B');h.setTask(other.task,other.run);await h.flush();pending.reject(Error(raw));await h.flush();assert.equal(h.diagnosticProps().records.length,0);assert.equal(h.journal.list('workflow-A')[0].context.targetId,'env-A');assert.equal(h.journal.list('workflow-B').length,0);assert.equal(h.props.task.id,'workflow-B');assert.equal(executions(h).length,1);h.unmount();
});
test('late rejection after the same task receives a different target retains the request target instead of blaming the new one',async()=>{
 const pending=deferred(),h=deploymentHarness({override:(method,data,standard)=>method==='task.execute'?pending.promise:standard(method,data)});await h.flush();h.review();h.click('execute-deployment');await h.flush();const original=structuredClone(h.props.task);h.setTask({...original,deployment:{...original.deployment,revision:3,config:{...original.deployment.config,targetId:'env-B'}},execution:{artifactId:original.deployment.prepared.artifactId,phase:'blocked',message:'validation blocked'}});await h.flush();pending.reject(Error(raw));await h.flush();assert.equal(h.journal.list(original.id)[0].context.targetId,'env-A');assert(html(h).includes('data-testid="historical-diagnostics"'));assert(html(h).includes('Research environment A'));assert(!html(h).includes('Research environment B'));assert.equal(executions(h).length,1);h.unmount();
});
for(const resolvedPhase of ['confirmed','blocked'])test('unknown remains pending across navigation, resolves only from changed authoritative execution and never revives for a new artifact: '+resolvedPhase,async()=>{
 let h;h=deploymentHarness({override:(method,data,standard)=>{if(method==='task.execute'){h.setTask({...h.props.task,review:{status:'not_run'},execution:{artifactId:data.artifactId,phase:'unknown',message:'lost submit response'}});throw Error('lost submit response');}return standard(method,data);}});await h.flush();h.review();h.click('execute-deployment');await h.flush();assert(html(h).includes('data-pending="true"'));const unknown=structuredClone(h.props.task);h.setTask({...unknown,updatedAt:999,name:'Renamed but not reconciled'});await h.flush();assert(html(h).includes('data-pending="true"'));h.setTask({...h.props.task,execution:{artifactId:unknown.execution.artifactId,phase:resolvedPhase,status:resolvedPhase==='confirmed'?'succeeded':'draft'}});await h.flush();assert(!html(h).includes('data-pending="true"'));if(resolvedPhase==='confirmed')assert(html(h).includes('原作业状态已核对'));const replacement=deploymentFixture('workflow-A');replacement.task.deployment.prepared.artifactId='new-artifact';h.setTask({...replacement.task,deployment:{...replacement.task.deployment,revision:9},execution:{artifactId:'new-artifact',phase:'confirmed',status:'draft'}});await h.flush();assert(!html(h).includes('data-pending="true"'));assert.equal(executions(h).length,1);assert(!h.calls.some(call=>call.data?.target?.includes('submit')));h.unmount();
});
test('prepare rejection belongs to the actual saved deployment revision and selected target at dispatch',async()=>{
 const h=deploymentHarness({override:(method,data,standard)=>{if(method==='task.deployment.prepare')throw Error('prepare failed after persistence');return standard(method,data);}});await h.flush();h.target('env-B');await h.flush();h.click('prepare-deployment');await h.flush();const record=h.journal.list(h.props.task.id).at(-1);assert.equal(record.context.operation,'prepare');assert.equal(record.context.targetId,'env-B');assert.equal(record.context.deploymentRevision,3);assert.equal(h.props.task.deployment.revision,3);assert(!html(h).includes('data-testid="historical-diagnostics"'));assert.equal(h.calls.filter(call=>call.method==='task.deployment.prepare').length,1);h.unmount();
});
test('same failed prepared result is retained as the same artifact and does not turn presentation into a new attempt',async()=>{
 const fixture=deploymentFixture(),failed={...fixture.run,status:'failed',validation:{status:'failed',message:'prior failed run'}};const h=deploymentHarness({initial:{task:fixture.task,run:failed}});await h.flush();h.click('prepare-deployment');await h.flush();assert.equal(h.props.task.deployment.prepared.artifactId,failed.id);assert.equal(h.calls.filter(call=>call.method==='task.deployment.prepare').length,1);assert.equal(executions(h).length,0);assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,true);h.unmount();
});
for(const outcome of ['success','failure'])test('old task draft save '+outcome+' cannot change the new task or leave its saving indicator stuck',async()=>{
 const pending=deferred();let savedRequest;const h=deploymentHarness({override:(method,data,standard)=>{if(method==='task.deployment.draft'&&data.taskId==='workflow-A'){savedRequest=data;return pending.promise;}return standard(method,data);}});await h.flush();h.target('env-B');await h.flush();assert(h.text(h.find(node=>node.props?.['data-testid']==='deployment-draft-status')).includes('正在保存'));const next=deploymentFixture('workflow-B');h.setTask(next.task,next.run);await h.flush();assert(!h.text(h.find(node=>node.props?.['data-testid']==='deployment-draft-status')).includes('正在保存'));const refreshes=h.refreshes();if(outcome==='success')pending.resolve({...deploymentFixture().task,deploymentDraft:{revision:savedRequest.expectedRevision+1,config:savedRequest.value,lastMutationId:savedRequest.mutationId}});else pending.reject(Error('old A draft failure'));await h.flush();assert.equal(h.props.task.id,'workflow-B');assert.equal(h.refreshes(),refreshes);assert.equal(h.diagnosticProps().records.length,0);assert(!h.text(h.find(node=>node.props?.['data-testid']==='deployment-draft-status')).includes('正在保存'));const box=deploymentOutbox('workflow-A',h.storage);if(outcome==='success'){assert.equal(box.ack.id,'workflow-A');assert.equal(box.pending,null);}else{assert(box.pending);assert.equal(h.journal.list('workflow-A')[0].raw,'old A draft failure');}h.unmount();
});
test('old finally cannot clear a different task still saving, and old rejection cannot replace its newer failure',async()=>{
 const first=deferred(),second=deferred(),h=deploymentHarness({override:(method,data,standard)=>method==='task.deployment.draft'?(data.taskId==='workflow-A'?first.promise:second.promise):standard(method,data)});await h.flush();h.target('env-B');await h.flush();const next=deploymentFixture('workflow-B');h.setTask(next.task,next.run);await h.flush();h.target('env-B');await h.flush();assert(h.text(h.find(node=>node.props?.['data-testid']==='deployment-draft-status')).includes('正在保存'));first.reject(Error('old A rejected'));await h.flush();assert(h.text(h.find(node=>node.props?.['data-testid']==='deployment-draft-status')).includes('正在保存'));second.reject(Error('new B rejected'));await h.flush();assert.equal(h.journal.list('workflow-B')[0].raw,'new B rejected');const notice=h.find(node=>node.props?.['data-testid']==='deployment-draft-error');assert(h.text(notice).includes('本机部署修改已保留'));assert.equal(h.find(node=>node.type==='InlineDiagnostic').props.error,'new B rejected');assert.equal(h.find(node=>node.props?.['data-testid']==='execute-deployment').props.disabled,true);assert.equal(executions(h).length,0);h.unmount();
});

function clusterDeploymentFixture(id='workflow-A'){
 const value=deploymentFixture(id);value.task.deployment.config={...value.task.deployment.config,target:'cluster',targetId:'cluster-A',resources:{...value.task.deployment.config.resources,queue:'fixture'}};value.run={...value.run,kind:'cluster-run',cluster:{id:'cluster-A',name:'Original cluster',version:4,scheduler:'slurm'},job_id:null};return value;
}
function clusterContext(value){return {...value,projects:value.projects.map(project=>({...project,policy:{...project.policy,clusters:['cluster-A','cluster-B']}})),clusters:[{id:'cluster-A',name:'Original cluster',queue:'fixture'},{id:'cluster-B',name:'Other cluster',queue:'fixture'}]};}
const authBanner=h=>h.find(node=>node.props?.['data-testid']==='deployment-auth-action');
function clickConnectionAction(h,label){const node=h.find(node=>node.type==='button'&&h.text(node)===label);assert.equal(node.props.disabled,false);node.props.onClick();}
const unauthorizedAutomaticCalls=h=>h.calls.filter(call=>['task.create','task.deployment.createProject','worker.connect','ssh.auth.start','ssh.auth.input','ssh.auth.plan','conversation.create','agent.rpc'].includes(call.method)||call.method==='worker.request'&&['/api/projects','/api/clusters','/api/cluster/submit','/api/cluster/auth/start'].includes(call.data?.target));
for(const code of ['needs_human_auth','needs_worker_update'])test('recognized execute '+code+' retains full diagnostic and offers navigation only without retry',async()=>{
 const initial=clusterDeploymentFixture(),rawAuth="Error invoking remote method 'studio:task.execute': Error: "+code,counters={connections:0,reconnect:0,sources:[]};const h=deploymentHarness({initial,properties:{onOpenConnections:source=>{counters.connections++;counters.sources.push(source);},onReconnect:async()=>{counters.reconnect++;}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')return structuredClone(initial.run);
  if(method==='task.execute')throw Error(rawAuth);
  return standard(method,data);
 }});await h.flush();const before=structuredClone(h.props.task);h.review();h.click('execute-deployment');await h.flush();const banner=authBanner(h);assert.equal(banner.props.role,'status');assert(!h.text(banner).includes('Error invoking'));assert.equal(h.journal.list(initial.task.id).at(-1).raw,rawAuth);assert.equal(h.journal.list(initial.task.id).at(-1).context.runId,initial.run.id);assert.equal(h.journal.list(initial.task.id).at(-1).context.targetId,'cluster-A');assert.equal(h.externalErrors.length,0);assert.equal(executions(h).length,1);assert.deepEqual(h.props.task,before);assert.equal(counters.connections+counters.reconnect,0);const callsBefore=h.calls.length;
  clickConnectionAction(h,code==='needs_human_auth'?'核对原作业连接':'按原来源更新作业服务');await h.flush();assert.equal(counters.connections,code==='needs_human_auth'?1:0);assert.equal(counters.reconnect,code==='needs_worker_update'?1:0);assert.deepEqual(counters.sources,code==='needs_human_auth'?[{taskId:initial.task.id,runId:initial.run.id,clusterId:'cluster-A'}]:[]);assert.equal(executions(h).length,1);assert.equal(h.calls.filter(call=>call.method==='task.deployment.prepare').length,0);assert.deepEqual(h.props.task,before);assert.equal(unauthorizedAutomaticCalls(h).length,0);assert(h.calls.slice(callsBefore).every(call=>call.method==='task.deployment.context'));h.unmount();
});
for(const code of ['needs_human_auth','needs_worker_update'])test('read-only original cluster load '+code+' stays inline without changing saved run or retrying',async()=>{
 const initial=clusterDeploymentFixture(),counters={connections:0,reconnect:0,sources:[]};const h=deploymentHarness({initial,properties:{onOpenConnections:source=>{counters.connections++;counters.sources.push(source);},onReconnect:async()=>{counters.reconnect++;}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')throw Error(code);
  return standard(method,data);
 }});await h.flush();assert.equal(authBanner(h).props.role,'status');assert.equal(h.externalErrors.length,0);assert.deepEqual(h.props.task,initial.task);assert.equal(executions(h).length,0);assert.equal(h.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/cluster/status').length,1);assert.equal(counters.connections+counters.reconnect,0);clickConnectionAction(h,code==='needs_human_auth'?'核对原作业连接':'按原来源更新作业服务');await h.flush();assert.equal(counters.connections+counters.reconnect,1);assert.deepEqual(counters.sources,code==='needs_human_auth'?[{taskId:initial.task.id,runId:initial.run.id,clusterId:'cluster-A'}]:[]);assert.deepEqual(h.props.task,initial.task);assert.equal(executions(h).length,0);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
test('old task execute auth rejection cannot create or replace the new task connection action',async()=>{
 const initial=clusterDeploymentFixture(),pending=deferred(),next=clusterDeploymentFixture('workflow-B'),h=deploymentHarness({initial,properties:{onOpenConnections:()=>{throw Error('No stale auth navigation');},onReconnect:async()=>{}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status'){if(data.data.run_id===next.run.id)throw Error('needs_worker_update');return structuredClone(initial.run);}
  if(method==='task.execute')return pending.promise;
  return standard(method,data);
 }});await h.flush();h.review();h.click('execute-deployment');await h.flush();h.setTask(next.task,next.run);await h.flush();assert.match(h.text(authBanner(h)),/按原来源更新/);pending.reject(Error('needs_human_auth'));await h.flush();assert.match(h.text(authBanner(h)),/按原来源更新/);assert(!h.text(authBanner(h)).includes('打开集群连接'));assert(!h.text(authBanner(h)).includes('核对原作业连接'));assert.equal(h.journal.list(initial.task.id)[0].raw,'needs_human_auth');assert.equal(h.journal.list(next.task.id).length,0);assert.equal(h.externalErrors.length,0);assert.equal(executions(h).length,1);assert.deepEqual(h.props.task,next.task);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
test('late old read-only auth failure is discarded when another workflow is selected',async()=>{
 const initial=clusterDeploymentFixture(),pending=deferred(),next=clusterDeploymentFixture('workflow-B'),h=deploymentHarness({initial,properties:{onOpenConnections:()=>{throw Error('No stale auth navigation');}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')return data.data.run_id===initial.run.id?pending.promise:structuredClone(next.run);
  return standard(method,data);
 }});await h.flush();h.setTask(next.task,next.run);await h.flush();pending.reject(Error('needs_human_auth'));await h.flush();assert.throws(()=>authBanner(h));assert.equal(h.externalErrors.length,0);assert.deepEqual(h.props.task,next.task);assert.equal(executions(h).length,0);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
test('historical auth action clears on a different task and does not invoke navigation automatically',async()=>{
 const initial=clusterDeploymentFixture(),next=clusterDeploymentFixture('workflow-B');let navigations=0;const h=deploymentHarness({initial,properties:{onOpenConnections:()=>{navigations++;}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status'){if(data.data.run_id===initial.run.id)throw Error('needs_human_auth');return structuredClone(next.run);}
  return standard(method,data);
 }});await h.flush();assert(authBanner(h));h.setTask(next.task,next.run);await h.flush();assert.throws(()=>authBanner(h));assert.equal(navigations,0);assert.deepEqual(h.props.task,next.task);assert.equal(executions(h).length,0);h.unmount();
});
test('late auth failure from a superseded target stays historical rather than offering a new-target auth action',async()=>{
 const initial=clusterDeploymentFixture(),pending=deferred(),h=deploymentHarness({initial,properties:{onOpenConnections:()=>{throw Error('No stale source navigation');}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')return structuredClone(initial.run);
  if(method==='task.execute')return pending.promise;
  return standard(method,data);
 }});await h.flush();h.review();h.click('execute-deployment');await h.flush();const changed={...h.props.task,deployment:{...h.props.task.deployment,revision:3,config:{...h.props.task.deployment.config,targetId:'cluster-B'}}};h.setTask(changed);await h.flush();pending.reject(Error('needs_human_auth'));await h.flush();assert.throws(()=>authBanner(h));assert.equal(h.journal.list(initial.task.id)[0].context.targetId,'cluster-A');assert.equal(h.props.task.deployment.config.targetId,'cluster-B');assert.equal(executions(h).length,1);assert.equal(h.externalErrors.length,0);h.unmount();
});

test('changing the deployment target clears prior auth action when a fresh read succeeds, without reconnecting',async()=>{
 const initial=clusterDeploymentFixture();let connections=0,reads=0;const h=deploymentHarness({initial,properties:{onOpenConnections:()=>{connections++;}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status'){if(++reads===1)throw Error('needs_human_auth');return structuredClone(initial.run);}
  return standard(method,data);
 }});await h.flush();assert(authBanner(h));h.target('cluster-B');await h.flush();assert.throws(()=>authBanner(h));assert.equal(reads,2);assert.equal(connections,0);assert.equal(h.props.task.deploymentDraft.config.targetId,'cluster-B');assert.equal(executions(h).length,0);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});

test('unexpected read-only connection failure keeps existing diagnostic handling instead of inventing authentication',async()=>{
 const initial=clusterDeploymentFixture(),failure=Error('unrecognized transport fixture failure');let navigations=0;const h=deploymentHarness({initial,properties:{onOpenConnections:()=>{navigations++;},onReconnect:async()=>{navigations++;}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')throw failure;
  return standard(method,data);
 }});await h.flush();assert.equal(h.externalErrors.length,1);assert.equal(h.externalErrors[0],failure);assert.throws(()=>authBanner(h));assert.equal(navigations,0);assert.equal(executions(h).length,0);assert.deepEqual(h.props.task,initial.task);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});

test('prepared auth navigation identifies the exact original run even when a different cluster is first in the current catalog',async()=>{
 const initial=clusterDeploymentFixture(),requests=[];initial.run.cluster={...initial.run.cluster,version:2};const h=deploymentHarness({initial,properties:{onOpenConnections:source=>requests.push(structuredClone(source))},override:async(method,data,standard)=>{
  if(method==='task.deployment.context'){const context=clusterContext(await standard(method,data));return {...context,clusters:[{id:'cluster-B',name:'First current profile',version:12,queue:'other'},{id:'cluster-A',name:'Edited current profile',version:99,queue:'fixture'}]};}
  if(method==='worker.request'&&data.target==='/api/cluster/status')throw Error('needs_human_auth');
  return standard(method,data);
 }});await h.flush();const before=structuredClone(h.props.task),calls=h.calls.length;assert.match(h.text(authBanner(h)),/核对原作业连接/);assert.equal(requests.length,0);clickConnectionAction(h,'核对原作业连接');await h.flush();assert.deepEqual(requests,[{taskId:initial.task.id,runId:initial.run.id,clusterId:'cluster-A'}]);assert.deepEqual(Object.keys(requests[0]).sort(),['clusterId','runId','taskId']);assert.equal(requests[0].runId,h.props.task.deployment.prepared.artifactId);assert.equal(h.calls.length,calls);assert.deepEqual(h.props.task,before);assert.equal(executions(h).length,0);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
test('auth navigation without a prepared run passes only its exact selected cluster and task, never a fabricated run',async()=>{
 const initial=clusterDeploymentFixture(),requests=[];delete initial.task.deployment.prepared;initial.task.artifacts=[];const h=deploymentHarness({initial,properties:{onOpenConnections:source=>requests.push(structuredClone(source))},override:async(method,data,standard)=>{
  if(method==='task.deployment.context'){const context=clusterContext(await standard(method,data));return {...context,clusters:[...context.clusters].reverse()};}
  if(method==='task.deployment.prepare')throw Error('needs_human_auth');
  return standard(method,data);
 }});await h.flush();assert.equal(requests.length,0);h.click('prepare-deployment');await h.flush();assert.equal(h.props.task.deployment.prepared,undefined);assert.match(h.text(authBanner(h)),/打开集群连接/);assert(!h.text(authBanner(h)).includes('核对原作业连接'));const before=structuredClone(h.props.task),calls=h.calls.length;assert.equal(h.calls.filter(call=>call.method==='task.deployment.prepare').length,1);assert.equal(executions(h).length,0);clickConnectionAction(h,'打开集群连接');await h.flush();assert.deepEqual(requests,[{taskId:initial.task.id,clusterId:'cluster-A'}]);assert.equal(Object.hasOwn(requests[0],'runId'),false);assert.equal(h.calls.length,calls);assert.deepEqual(h.props.task,before);assert.equal(h.externalErrors.length,0);assert.equal(executions(h).length,0);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
test('a late auth rejection cannot hand off the superseded prepared run after the same task adopts another artifact',async()=>{
 const initial=clusterDeploymentFixture(),pending=deferred(),requests=[],h=deploymentHarness({initial,properties:{onOpenConnections:source=>requests.push(source)},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return clusterContext(await standard(method,data));
  if(method==='worker.request'&&data.target==='/api/cluster/status')return structuredClone(h.runs.get(data.data.run_id));
  if(method==='task.execute')return pending.promise;
  return standard(method,data);
 }});await h.flush();h.review();h.click('execute-deployment');await h.flush();const replacement={...initial.run,id:'replacement-run',cluster:{...initial.run.cluster,version:8}},changed={...h.props.task,deployment:{...h.props.task.deployment,revision:3,prepared:{...h.props.task.deployment.prepared,artifactId:replacement.id,deploymentRevision:3}},artifacts:[{id:replacement.id,kind:'cluster-run'}]};h.setTask(changed,replacement);await h.flush();pending.reject(Error('needs_human_auth'));await h.flush();assert.throws(()=>authBanner(h));assert.equal(requests.length,0);assert.equal(h.props.task.deployment.prepared.artifactId,replacement.id);assert.equal(h.journal.list(initial.task.id).at(-1).context.runId,initial.run.id);assert.equal(executions(h).length,1);assert.equal(unauthorizedAutomaticCalls(h).length,0);h.unmount();
});
