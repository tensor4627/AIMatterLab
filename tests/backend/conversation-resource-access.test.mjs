import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {toolFailure} from '../../agent/tools/tool-failure.mjs';

function fixture(t) {
 const profiles=new Map(),states=new Map(),shells=new Map(),store=new Map(),calls=[];
 const access=managedProjectAccess({catalog:{get:(k,id)=>store.get(id),put:(k,id,row)=>store.set(id,row),list:()=>[...store.values()]}});
 const manager=createManagedComputeResources({
  terminal:{connections:{state:async({connectionId})=>states.get(connectionId),async managedShell(op,ref) {
   calls.push(op);
   if(op==='open')shells.set(ref.leaseId,{sessionId:randomUUID(),alive:true,ownerEpoch:1,expiresAt:Date.now()+60000});
   if(op==='close'){shells.delete(ref.leaseId);return {closed:true};}
   return shells.get(ref.leaseId);
  }}},
  profiles:{read:({id})=>profiles.get(id)},authorizeTerminal:access.terminalDecision,
  services:{ssh:async(resource)=>({id:'source-'+resource.profileId,binding:{},health:{},schedulerInspection:true,
   async forward(method,target,body,mcp,timeout,check){
    check?.();calls.push(target);
    if(target==='/api/projects')return {status:200,data:[]};
    assert.deepEqual([method,target,body,mcp,timeout],['POST','/api/ssh-service/inspect-scheduler',{},false,15000]);
    return {status:200,data:{status:'observed',observed_at:100,automatic_retry:false,observations:[
     {scheduler:'slurm',status:'observed',queues:[{name:'fixture-only',default:true,availability:'up',node_count:1,node_state:'idle',gres:'gpu:1'}]},
     {scheduler:'lsf',status:'not_found',queues:[]}
    ]}};
   }})}
 });
 t.after(()=>manager.stop());
 const scope={provider:'deepseek',threadId:'chat',taskId:null,projectId:null,checkCurrent:()=>true};
 const gateway=createManagedComputeTools({resources:manager,assertWorkflow:()=>assert.fail('A chat attempted to create or require a workflow')});
 const speak=(text,owner=scope)=>manager.recordUserTurn({...owner,text,turnId:randomUUID()});
 async function host(id,name) {
  const profile={id,name,version:1,kind:'ssh',host:'fixture.invalid',port:22,username:'fixture',ssh_client:'ssh'};
  const ref={connectionId:'connection-'+id,profileId:id,profileVersion:1};
  profiles.set(id,profile);states.set(ref.connectionId,{...ref,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}});
  await manager.publish(ref);await manager.refreshService(ref);return 'ssh:'+id;
 }
 const setAllowed=(project,id,allowed)=>access.set(project,{kind:'ssh',profileId:id,targetFingerprint:resourceFingerprint(profiles.get(id))},allowed);
 return {manager,gateway,scope,speak,host,calls,setAllowed};
}

test('DeepSeek can inspect queues on the only hosted SSH target in an ordinary chat, even with no worker project',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 for(const projectId of [null,'desktop-project']){
  const scope={...f.scope,threadId:'chat-'+(projectId||'none'),projectId};
  f.speak('读取我的个人skill，看看集群有哪些自有队列空着',scope);
  const inventory=await f.gateway.call('list_compute_resources',{},scope);
  assert.equal(inventory.resources[0].canAcquire,true);
  const lease=await f.gateway.call('acquire_compute_resource',{resource_id},scope);
  assert.equal(lease.status,'acquired');assert(lease.terminal.sessionId);
  const probe=await f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},scope);
  assert.equal(probe.terminal_available,true);
  assert.equal(probe.project_access,projectId?'not_granted':'no_project');
  assert.equal(probe.scheduler.observations[0].queues[0].node_state,'idle');
  assert.deepEqual(probe.cluster_ids,[]);
  assert.equal((await f.gateway.call('acquire_compute_resource',{resource_id,alias:'示例甲'},scope)).reused,true);
  await assert.rejects(f.gateway.call('acquire_compute_resource',{profile_id:'b',alias:'示例甲'},scope),/invalid_request/);
 }
 assert.equal(f.calls.filter(call=>call==='open').length,2);
 assert.equal(f.calls.filter(call=>call==='/api/ssh-service/inspect-scheduler').length,2);
});

test('normal conversational affirmation resolves the exact previous resource choice without lending its terminal to another chat',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');await f.host('b','示例乙');
 f.speak('帮我看看集群有哪些空闲队列');
 const choice=await f.gateway.call('acquire_compute_resource',{resource_id},f.scope);
 assert.equal(choice.status,'choice_required');assert.equal(choice.candidates.length,2);assert(!f.calls.includes('open'));
 f.speak('是示例甲');
 const acquired=await f.gateway.call('acquire_compute_resource',{alias:'示例甲'},f.scope);
 assert.equal(acquired.resource.resourceId,resource_id);
 const other={...f.scope,threadId:'unrelated'};
 await assert.rejects(f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},other),error=>{
  const reply=JSON.parse(toolFailure(error,{dispatched:true}).content[0].text);
  return reply.code==='resource_lease_required'&&reply.operation_state==='not_started';
 });
 f.speak('不要查看示例乙的队列',other);
 await assert.rejects(f.gateway.call('acquire_compute_resource',{alias:'示例乙'},other),/instruction_required/);
 assert.equal(f.calls.filter(call=>call==='open').length,1);
});

test('a model clarification after discovery accepts the human reply only in the same project and conversation',async t=>{
 const f=fixture(t);await f.host('a','示例甲');await f.host('b','示例乙');
 f.speak('看看集群的队列');await f.gateway.call('list_compute_resources',{},f.scope);
 const different={...f.scope,projectId:'different'};
 f.speak('是示例乙',different);
 await assert.rejects(f.gateway.call('acquire_compute_resource',{alias:'示例乙'},different),/instruction_required/);
 f.speak('看看集群的队列');await f.gateway.call('list_compute_resources',{},f.scope);
 f.speak('是示例乙');assert.equal((await f.gateway.call('acquire_compute_resource',{alias:'示例乙'},f.scope)).status,'acquired');
});

test('an explicit project refusal revokes ordinary terminal use without changing a different chat’s project access',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 const own={...f.scope,projectId:'project-a'},other={...f.scope,threadId:'peer',projectId:'project-b'};
 const lease=async scope=>{f.speak('请使用示例甲',scope);return (await f.gateway.call('acquire_compute_resource',{resource_id},scope)).terminal;};
 const one=await lease(own),two=await lease(other);
 f.setAllowed(own.projectId,'a',false);
 await assert.rejects(f.gateway.call('read_compute_terminal',{session_id:one.sessionId},own),/project_grant_required/);
 assert.deepEqual((await f.gateway.call('list_compute_terminals',{},own)).sessions,[]);
 assert.equal((await f.gateway.call('list_compute_terminals',{},other)).sessions[0].sessionId,two.sessionId);
 f.setAllowed(own.projectId,'a',true);
 assert.equal((await f.gateway.call('list_compute_terminals',{},own)).sessions[0].sessionId,one.sessionId);
});
