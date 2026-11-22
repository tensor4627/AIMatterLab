import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createResourceWorkspace} from '../../backend/main/workspace/resource-workspace.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createConversationActivity} from '../../backend/main/compute/conversation-activity.mjs';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {registerSshConnectionRoutes} from '../../backend/main/compute/ssh-connection-ipc.mjs';
import {createSshServiceRegistration} from '../../backend/main/compute/ssh-service-registration.mjs';
import {createManagedWorkbench} from '../../desktop/platform/managed-workbench.mjs';
import {developerComputeAccess} from '../../backend/main/compute/developer-compute-access.mjs';
import {createWorkspaceTerminalAuthorization} from '../../backend/main/compute/workspace-terminal-authorization.mjs';

const root='/scratch/fixture-workspace';
const profile=id=>({id,kind:'ssh',version:1,name:'材料中心',host:id+'.invalid',port:22,username:'fixture-user',mode:'interactive',ssh_client:'/usr/bin/ssh'});
const identity=id=>({hostname:id+'.fixture.invalid',uid:1000,machineId:'fixture-machine-'+id});
const runtimeId='1'.repeat(20),workerRoot='/scratch/fixture-service';
const health=id=>({name:'gpu-sampling-studio',version:'fixture',execution_policy:'desktop-review-v1',port:22101,root:workerRoot,
 runtime:workerRoot+'/runtimes/'+runtimeId,runtimeId,hostIdentity:identity(id)});
const ref=({connectionId,profileId,profileVersion})=>({connectionId,profileId,profileVersion});
const ownerKey=({provider,threadId})=>JSON.stringify([provider,threadId]);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,{developerCompute,commandResult}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-ssh-relogin-'));
 const catalog=new Catalog(directory);
 const policies=managedProjectAccess({catalog}),activity=createConversationActivity({catalog});
 const saved=new Map(['main','other'].map(id=>[id,profile(id)])),owners=new Map(),phases=new Map(),shells=new Map(),workerProjects=new Set();
 const profiles={read:({id,version})=>{
  const target=saved.get(id);
  if(!target||version!==undefined&&version!==target.version)throw Error('compute_profile_changed');
  return structuredClone(target);
 },list:()=>[...saved.values()].map(value=>structuredClone(value))};
 const registration=createSshServiceRegistration({catalog,profiles});
 for(const item of saved.values())registration.remember(item,health(item.id),{status:'ready',count:1});
 let selected=null,serial=0,dropNextOpen=null;
 const calls=[],connections={
  async open({profileId,profileVersion,requestId}){
   const connectionId='conn-'+profileId+'-'+(++serial),holder={connectionId,profileId,profileVersion,loginRequestId:requestId,mode:'authenticating',
    account:saved.get(profileId).username,hostIdentity:identity(profileId)};
   phases.set(connectionId,holder);
   return connections.state({connectionId});
  },
  async completeLogin({connectionId,requestId}){
   const entry=phases.get(connectionId);
   assert.equal(entry.loginRequestId,requestId);
   if(entry.mode==='authenticating')entry.mode='authenticated';
   return connections.loginStatus({connectionId,requestId});
  },
  async loginStatus({connectionId,requestId}){
   const entry=phases.get(connectionId);
   assert.equal(entry.loginRequestId,requestId);
   if(entry.stale)return {connection:{...entry.stale},login:{status:'complete'}};
   const connection=await connections.state({connectionId});
   return {connection,login:{status:connection.status==='authenticated'?'complete':'failed'}};
  },
  async state({connectionId}){
   const entry=phases.get(connectionId);
   if(!entry||entry.mode==='missing')throw Error('ssh_connection_not_found');
   if(entry.mode==='timeout')throw Error('ssh_control_timeout');
   const status=entry.mode==='lost'?'unavailable':entry.mode;
   return {schemaVersion:2,...ref(entry),loginRequestId:entry.loginRequestId,status,
    authentication:status==='authenticated'?'verified':status==='authenticating'?'pending':'lost',
    capabilities:{multiplex:status==='authenticated'},terminalSessionIds:[],serviceIds:[],revision:1,
    ...status==='closed'?{closed:true}:{}};
  },
  async close({connectionId}){
   phases.get(connectionId).mode='closed';
   return connections.state({connectionId});
  },
  async workspace(value,check){
   check();
   const entry=phases.get(value.connectionId);
   if(entry.mode!=='authenticated')throw Error('ssh_workspace_unconfirmed');
   return {root:value.directory||root,identity:{...entry.hostIdentity,account:entry.account},ready:true};
  },
  async runWorkspaceCommand(value,check){
   check();
   calls.push({operation:'command',...value});
   return commandResult(value);
  },
  async managedShell(operation,value){
   calls.push({operation,...value});
   const key=JSON.stringify([value.connectionId,value.leaseId]);
   if(operation==='close'){shells.delete(key);return {closed:true};}
   if(phases.get(value.connectionId)?.mode!=='authenticated')throw Error('ssh_authentication_unconfirmed');
   if(operation==='open'){
    if(dropNextOpen?.(value)){dropNextOpen=null;throw Error('ssh_channel_unavailable');}
    const state={sessionId:'pty-'+(++serial),ownerEpoch:2,alive:true,expiresAt:Date.now()+3600000};
    shells.set(key,state);return state;
   }
   if(!shells.has(key))throw Error('terminal_session_exited');
   if(operation==='input')return {accepted:true};
   return shells.get(key);
  },
  async serviceState(value){
   const entry=phases.get(value.connectionId);
   assert.equal(entry.mode,'authenticated');
   return {...ref(entry),status:'connected',serviceActive:true,serviceId:'service-'+entry.connectionId,channelKind:'private',service:health(entry.profileId)};
  },
  async privateServiceRequest(value){
   const entry=phases.get(value.connectionId);
   assert.equal(entry.mode,'authenticated');
   assert.equal(value.serviceId,'service-'+entry.connectionId);
   calls.push({operation:'service',connectionId:value.connectionId,target:value.target});
   if(value.method==='GET'&&value.target==='/api/health')return {status:200,data:health(entry.profileId)};
   if(value.method==='GET'&&value.target==='/api/projects')return {status:200,
    data:[...workerProjects].map(id=>({id,policy:{clusters:['fixture-cluster']}}))};
   const cluster={id:'fixture-cluster',version:1,transport_kind:'ssh-service-local'};
   if(value.method==='GET'&&value.target==='/api/clusters')return {status:200,data:[cluster]};
   if(value.method==='POST'&&value.target==='/api/cluster/profile')return {status:200,
    data:{...cluster,service_binding:{root:workerRoot,...identity(entry.profileId)}}};
   throw Error('Unexpected service operation');
  },
 };
 const resource=createComputeResourceBinding({catalog,profiles,connections,uuid:()=> 'selected-ssh'});
 const workspace=createResourceWorkspace({catalog,profiles,connections,resource,current:()=>selected,registration});
 const workbenches=[];
 function start(){
  const handlers=new Map(),restorations=[];
  const handle=(name,method)=>handlers.set(name,method),invoke=(name,data={})=>handlers.get(name)(data);
  const workflow={currentFor:(provider,threadId)=>owners.get(ownerKey({provider,threadId}))};
  const records={deleted:()=>false,bound:()=>null,conversation:(provider,threadId)=>workflow.currentFor(provider,threadId),
   conversations:()=>[...owners.values()],tasks:()=>[]};
  const terminalAuthorization=commandResult?createWorkspaceTerminalAuthorization({workspace,connections,catalog,current:()=>selected}):
   developerCompute?{input:async()=>({accepted:true})}:undefined;
  const app=createManagedWorkbench({catalog,profiles,registration,terminal:{connections},resourceWorkspace:workspace,projectAccess:policies,
   developerCompute,terminalAuthorization,
   resourceActivity:activity,records,workflow,agents:{isBusy:()=>false,turnStates:()=>[],turnOrigin:()=>null},
   handle,notify:()=>{},dispatch:()=>{},onConnectionReplaced:(before,next)=>resource.replaceHostedConnection(before,next)});
  registerSshConnectionRoutes({handle,connections,onOpening:app.resources.noteLogin,
   onAuthenticated:(next,requestId)=>{const outcome=app.resources.restoreHosted(next,requestId);restorations.push(outcome);return outcome;},
   onClosing:connectionId=>app.resources.revokeConnection({connectionId}),onClosed:app.resources.confirmConnectionClosed});
  async function settle(){
   await turn();await Promise.allSettled(restorations.splice(0));
   await app.resources.sweep();
  }
  const value={...app,invoke,settle};
  workbenches.push(value);return value;
 }
 const app=start();
 async function open(profileId,appInstance=app){
  const requestId='login-'+(++serial);
  const connection=await appInstance.invoke('compute.sshConnection.open',{profileId,profileVersion:1,requestId});
  return {connection,requestId};
 }
 async function login(attempt,appInstance=app,method='completeLogin'){
  const {connection,requestId}=attempt;
  return appInstance.invoke('compute.sshConnection.'+method,{connectionId:connection.connectionId,requestId});
 }
 async function publish(attempt,appInstance=app){
  const target=ref(attempt.connection),preview=await workspace.preview(target);
  if(preview.confirmationId)await workspace.confirm({...target,confirmationId:preview.confirmationId});
  const result=await appInstance.invoke('compute.managed.publish',target);
  await appInstance.resources.refreshService(target);
  return result;
 }
 function owner(provider,threadId,projectId=null,taskId=null){
  const value={provider,threadId,projectId,taskId,environmentId:null,inputRoot:null};
  owners.set(ownerKey(value),value);
  return {...value,checkCurrent:()=>true};
 }
 function message(scope,text,appInstance=app){
  appInstance.userMessage({provider:scope.provider,method:'turn/start',params:{threadId:scope.threadId,studioTurnRequestId:'message-'+(++serial),input:[{type:'text',text}]}});
 }
 async function talk(scope,name,args={},using=app){return using.resources.callTool(name,args,scope);}
 function lose(attempt,mode='lost'){phases.get(attempt.connection.connectionId).mode=mode;}
 function opens(attempt){return calls.filter(row=>row.operation==='open'&&row.connectionId===attempt.connection.connectionId);}
 t.after(async()=>{await Promise.all(workbenches.map(entry=>entry.resources.stop()));catalog.db.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {app,start,catalog,resource,workspace,phases,profiles,policies,workerProjects,activity,calls,open,login,publish,owner,message,talk,lose,opens,
  failNextOpen(predicate){dropNextOpen=predicate;}};
}

test('command leases isolate directories and recover on the original target without opening a PTY or replaying a lost mutation',async t=>{
 const f=fixture(t,{commandResult:({mode,cwd,args})=>{
  if(mode==='mkdir'){
   if(args[0]==='partial')throw Error('ssh_workspace_unconfirmed');
   return {status:'result',code:0,output:''};
  }
  return {status:'result',code:0,output:mode==='cwd'?String(args[0]):cwd};
 }});
 const chat=f.owner('codex','same-thread'),other=f.owner('deepseek','same-thread','project','workflow');
 const prior=await f.open('main');await f.login(prior);await f.publish(prior);
 const grant={kind:'ssh',profileId:'main',targetFingerprint:resourceFingerprint(f.profiles.read({id:'main'}))};
 f.policies.set('project',grant,true);
 f.message(chat,'用 ssh:main');f.message(other,'用 ssh:main');
 const acquire=scope=>f.talk(scope,'acquire_compute_resource',{resource_id:'ssh:main'});
 const acquired=await Promise.all([acquire(chat),acquire(other)]);
 assert(acquired.every(value=>value.status==='acquired'&&value.access==='command'&&!value.terminal));
 assert(f.app.desktopTools.tools().some(definition=>definition.name==='run_compute_command'));
 const run=(scope,request_id,command,app=f.app)=>app.desktopTools.call('run_compute_command',{resource_id:'ssh:main',request_id,command},scope);
 const unleased=f.owner('codex','unleased');
 await assert.rejects(run(unleased,'read','pwd'),/lease_required/);
 await Promise.all([run(chat,'nav','cd '+root+'/a'),run(other,'nav','cd '+root+'/b')]);
 const pair=await Promise.all([run(chat,'read','pwd'),run(other,'read','pwd')]);
 assert.deepEqual(pair.map(({output})=>output),[root+'/a',root+'/b']);
 assert.deepEqual(await f.talk(chat,'list_compute_terminals'),{sessions:[]});
 assert.equal(f.opens(prior).length,0);
 await assert.rejects(run(chat,'write-lost','mkdir partial'),/workspace_unconfirmed/);
 assert.equal((await run(chat,'write-ok','mkdir complete')).execution_status,'completed');
 f.policies.set('project',grant,false);
 await assert.rejects(run(other,'blocked','pwd'),/grant_required/);
 f.lose(prior);await f.app.settle();
 const restarted=f.start(),next=await f.open('main',restarted);await f.login(next,restarted);await restarted.settle();
 assert.equal((await run(chat,'write-lost','mkdir partial',restarted)).execution_status,'unconfirmed');
 assert.equal((await run(chat,'write-ok','mkdir complete',restarted)).replayed,true);
 await assert.rejects(run(chat,'write-ok','mkdir another',restarted),/invalid_request/);
 assert.equal((await run(chat,'after-login','pwd',restarted)).output,root);
 assert.equal(f.calls.filter(row=>row.operation==='command'&&row.mode==='mkdir').length,2);
 assert.equal(f.opens(next).length,0);
 await assert.rejects(run(other,'after-login','pwd',restarted),/lease_required|grant_required/);
});

test('a temporary developer terminal is not restored as an ordinary session grant after relogin',async t=>{
 let selected=null;
 const developer=developerComputeAccess({workspaceId:()=>selected,userTurn:()=>true});
 const f=fixture(t,{developerCompute:developer}),owner=f.owner('deepseek','test-chat',null,'test-workflow');
 const old=await f.open('main');await f.login(old);const published=await f.publish(old);await f.app.settle();
 selected=published.workspace.workspaceId;developer.changed(null,selected);
 f.message(owner,'检查测试工具');
 assert.equal((await f.talk(owner,'acquire_compute_resource',{resource_id:'ssh:main'})).status,'acquired');
 assert.equal((await f.talk(owner,'list_compute_terminals')).sessions.length,1);
 const before=selected;selected=null;developer.changed(before,null);f.app.resources.endDeveloperAccess(before);
 await f.app.settle();f.lose(old);await f.app.settle();
 const replacement=await f.open('main');await f.login(replacement);await f.app.settle();
 assert.equal(f.opens(replacement).length,0);
 assert.deepEqual((await f.talk(owner,'list_compute_terminals')).sessions,[]);
});

test('verified normal login replaces only the lost master and restores every originally assigned capability',async t=>{
 const f=fixture(t),a=f.owner('codex','same-thread'),b=f.owner('deepseek','same-thread'),denied=f.owner('codex','restricted','project','workflow');
 const old=await f.open('main'),other=await f.open('other');
 await f.login(old);await f.app.settle();
 assert.deepEqual((await f.app.invoke('compute.managed.snapshot')).resources,[]);
 await f.publish(old);
 await f.login(other);await f.publish(other);
 const previous=await f.resource.activate({kind:'ssh-connection',...ref(old.connection)});
 const selectedTicket=f.resource.capture();
 f.policies.set('project',{kind:'ssh',profileId:'main',targetFingerprint:resourceFingerprint(f.profiles.read({id:'main'}))},true);
 f.message(a,'用 ssh:main 和 ssh:other');f.message(b,'用 ssh:main');f.message(denied,'用 ssh:main');
 const terminal=await f.talk(a,'acquire_compute_resource',{resource_id:'ssh:main'});
 const unaffected=await f.talk(a,'acquire_compute_resource',{resource_id:'ssh:other'});
 await f.talk(b,'acquire_compute_resource',{profile_id:'main',access:'service'});
 await f.talk(denied,'acquire_compute_resource',{resource_id:'ssh:main'});
 await f.talk(a,'write_compute_terminal',{session_id:terminal.terminal.sessionId,request_id:'example',action:'type',data:'fixture'});
 const planned=f.owner('codex','same-thread',null,'unbound-workflow');
 f.message(planned,'继续制定计划');
 const registeredWorkspace=f.catalog.get('resource-workspace-default','main');
 f.lose(old);
 await f.app.settle();
 assert.deepEqual((await f.talk(planned,'list_compute_terminals')).sessions,[unaffected.terminal]);
 f.policies.set('project',{kind:'ssh',profileId:'main',targetFingerprint:resourceFingerprint(f.profiles.read({id:'main'}))},false);
 const next=await f.open('main');await f.login(next);await f.app.settle();
 const restored=(await f.app.invoke('compute.managed.snapshot')).resources.find(row=>row.profileId==='main');
 assert.equal(restored.connectionId,next.connection.connectionId);
 assert.equal(f.resource.peek().selectionId,previous.selectionId);
 assert.equal(f.resource.peek().connectionId,next.connection.connectionId);
 assert.throws(()=>f.resource.assertCurrent(selectedTicket),/selection_changed/);
 const after=(await f.talk(planned,'list_compute_terminals')).sessions;
 const recovered=after.find(row=>row.resourceId==='ssh:main');
 assert(recovered);
 assert.notEqual(recovered.sessionId,terminal.terminal.sessionId);
 assert(after.some(row=>row.sessionId===unaffected.terminal.sessionId));
 assert.deepEqual((await f.talk(b,'list_compute_terminals')).sessions,[]);
 assert.deepEqual((await f.talk(denied,'list_compute_terminals')).sessions,[]);
 const bList=await f.talk(b,'list_compute_resources');
 assert.equal(bList.resources.find(row=>row.resourceId==='ssh:main').acquired,true);
 assert.equal(f.opens(next).length,1);
 await assert.rejects(f.talk(b,'read_compute_terminal',{session_id:recovered.sessionId}),/lease_required/);
 await assert.rejects(f.talk(planned,'write_compute_terminal',{session_id:terminal.terminal.sessionId,request_id:'example',action:'enter'}),/lease_required/);
 assert.equal(f.calls.filter(row=>row.operation==='input').length,1);
 assert.deepEqual(f.catalog.get('resource-workspace-default','main'),registeredWorkspace);
});

test('a timeout preserves the previous binding, concurrent logins adopt exactly one replacement and ignore late receipts',async t=>{
 const f=fixture(t),a=f.owner('codex','chat');
 const old=await f.open('main');await f.login(old);await f.publish(old);
 f.message(a,'用 ssh:main');await f.talk(a,'acquire_compute_resource',{resource_id:'ssh:main'});
 f.lose(old,'timeout');
 const first=await f.open('main'),second=await f.open('main');
 await Promise.all([f.login(first),f.login(second)]);await f.app.settle();
 assert.equal(f.app.resources.consoleEntries().entries.find(row=>row.profileId==='main').connectionId,old.connection.connectionId);
 assert.equal(f.opens(first).length+f.opens(second).length,0);
 f.lose(old);await f.app.settle();await f.app.settle();
 const online=f.app.resources.snapshot()[0],chosen=[first,second].find(login=>login.connection.connectionId===online.connectionId);
 const late=chosen===first?second:first;
 assert.equal(f.opens(chosen).length,1);
 assert.equal(f.opens(late).length,0);
 await f.login(late,f.app,'loginStatus');await f.app.settle();
 assert.equal(f.app.resources.snapshot()[0].connectionId,online.connectionId);
 assert.equal(f.opens(chosen).length,1);
});

test('released scopes, explicit disconnect and different SSH identities do not inherit old assignments',async t=>{
 const f=fixture(t),a=f.owner('codex','chat'),r=f.owner('codex','released');
 const old=await f.open('main');await f.login(old);await f.publish(old);
 for(const scope of [a,r]){f.message(scope,'用 ssh:main');await f.talk(scope,'acquire_compute_resource',{resource_id:'ssh:main'});}
 f.lose(old);await f.app.settle();
 await f.talk(r,'release_compute_resource',{resource_id:'ssh:main'});
 const sameName=await f.open('other');await f.login(sameName);await f.app.settle();
 assert.equal(f.app.resources.snapshot().length,0);
 for(const key of ['account','hostIdentity']){
  const foreign=await f.open('main'),phase=f.phases.get(foreign.connection.connectionId);
  phase[key]=key==='account'?'different-account':identity('different-host');
  await f.login(foreign);await f.app.settle();
  assert.equal(f.opens(foreign).length,0);
  assert.equal(f.app.resources.snapshot().length,0);
 }
 const next=await f.open('main');f.failNextOpen(value=>value.connectionId===next.connection.connectionId);
 await f.login(next);await f.app.settle();await f.app.settle();
 assert.equal(f.opens(next).length,2);
 assert.deepEqual(f.opens(next).map(row=>row.scope.threadId),['chat','chat']);
 await f.app.invoke('compute.sshConnection.close',{connectionId:next.connection.connectionId});
 const afterClose=await f.open('main');await f.login(afterClose);await f.app.settle();
 assert.equal(f.opens(afterClose).length,0);
 assert.equal(f.app.resources.snapshot().length,0);
});

test('a restarted desktop reobserves the exact retained PTY, then recovers from a missing broker record',async t=>{
 const f=fixture(t),a=f.owner('codex','chat');
 const old=await f.open('main');await f.login(old);await f.publish(old);
 f.message(a,'用 ssh:main');
 const before=await f.talk(a,'acquire_compute_resource',{resource_id:'ssh:main'});
 const restart=f.start();
 await restart.resources.restorePublished();await restart.settle();
 assert.equal(f.opens(old).length,1);
 assert.deepEqual((await f.talk(a,'list_compute_terminals',{},restart)).sessions,[before.terminal]);
 f.lose(old,'missing');await restart.settle();
 const next=await f.open('main',restart);await f.login(next,restart);await restart.settle();
 assert.equal(f.opens(next).length,1);
 const sessions=(await f.talk(a,'list_compute_terminals',{},restart)).sessions;
 assert.equal(sessions.length,1);assert.notEqual(sessions[0].sessionId,before.terminal.sessionId);
});

test('recovery uses current worker project policy and keeps a lost capability pending for the original project',async t=>{
 const f=fixture(t),a=f.owner('codex','chat','project','task');
 f.workerProjects.add(a.projectId);
 const old=await f.open('main');await f.login(old);await f.publish(old);
 f.message(a,'用 ssh:main');
 await f.talk(a,'acquire_compute_resource',{resource_id:'ssh:main',access:'service'});
 assert.deepEqual((await f.app.resources.resolveService(a,'ssh:main')).clusterIds,['fixture-cluster']);
 f.lose(old);await f.app.settle();f.workerProjects.delete(a.projectId);
 const next=await f.open('main');await f.login(next);await f.app.settle();
 assert.equal((await f.talk(a,'list_compute_resources')).resources[0].acquired,false);
 await assert.rejects(f.app.resources.resolveService(a,'ssh:main'),/lease_required/);
 assert.equal(f.opens(next).length,0);
 f.workerProjects.add(a.projectId);await f.app.settle();
 assert.deepEqual((await f.app.resources.resolveService(a,'ssh:main')).clusterIds,['fixture-cluster']);
 assert.equal(f.opens(next).length,0);
});

test('confirming a different total workspace prevents inheritance across roots on the same account',async t=>{
 const f=fixture(t),a=f.owner('codex','chat');
 const old=await f.open('main');await f.login(old);await f.publish(old);
 f.message(a,'用 ssh:main');await f.talk(a,'acquire_compute_resource',{profile_id:'main'});
 const previous=f.catalog.get('resource-workspace-default','main');
 const target=ref(old.connection),preview=await f.workspace.preview({...target,directory:'/scratch/fixture-workspace-new'});
 await f.workspace.confirm({...target,confirmationId:preview.confirmationId});
 assert.notEqual(f.catalog.get('resource-workspace-default','main').workspaceId,previous.workspaceId);
 f.lose(old);await f.app.settle();
 const next=await f.open('main');await f.login(next);await f.app.settle();
 assert.deepEqual(f.app.resources.snapshot(),[]);
 await f.publish(next);
 assert.deepEqual((await f.talk(a,'list_compute_terminals')).sessions,[]);
 assert.equal(f.opens(next).length,0);
 assert.equal(f.catalog.get('resource-workspace-registration',previous.workspaceId).root,root);
});

test('default chat honors a real historical target when the user renews the lease without repeating its name',async t=>{
 const f=fixture(t),original=f.owner('codex','previous-chat'),other=f.owner('codex','selection-only',null,'other-task');
 const historic={resourceId:'ssh:main',profileId:'main',kind:'ssh',name:'材料中心',targetFingerprint:resourceFingerprint(f.profiles.read({id:'main'}))};
 for(const scope of [original,other])f.catalog.put('conversation-compute-choice',ownerKey(scope),{projectId:null,taskId:null,targets:[historic]});
 f.activity.acquired(original,historic);
 const planned=f.owner('codex','previous-chat',null,'unbound-task');
 const connection=await f.open('main');await f.login(connection);await f.publish(connection);
 const sameName=await f.open('other');await f.login(sameName);await f.publish(sameName);
 const entry=async scope=>(await f.talk(scope,'list_compute_resources')).resources.find(row=>row.profileId==='main');
 assert.equal((await entry(planned)).canAcquire,false);
 f.message(other,'你重新申请租约');
 assert.equal((await entry(other)).canAcquire,false);
 await assert.rejects(f.talk(other,'acquire_compute_resource',{resource_id:'ssh:main'}),/project_grant_required/);
 f.message(planned,'你重新申请租约');
 assert.equal((await entry(planned)).canAcquire,true);
 const correct=await f.talk(planned,'acquire_compute_resource',{profile_id:'other'});
 assert.equal(correct.status,'target_selected');assert.equal(correct.resource.profileId,'main');
 const first=await f.talk(planned,'acquire_compute_resource',{resource_id:'ssh:main'});
 const repeated=await f.talk(planned,'acquire_compute_resource',{profile_id:'main'});
 assert.equal(first.status,'acquired');assert.deepEqual(first.terminal,repeated.terminal);
 assert.equal(f.opens(sameName).length,0);
 await assert.rejects(f.app.resources.resolveService(planned,'ssh:main'),/project_grant_required/);
});
