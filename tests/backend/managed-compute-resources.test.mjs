import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {createManagedComputeAliases,resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {requestsComputeName} from '../../backend/main/compute/managed-compute-intent.mjs';
import {createManagedComputeServices,managedWorkerProject} from '../../backend/main/compute/managed-compute-services.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {taskForRecordIndex} from '../../backend/main/compute/worker-service-version.mjs';
import {assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';
import {developerComputeAccess} from '../../backend/main/compute/developer-compute-access.mjs';
import {toolFailure} from '../../agent/tools/tool-failure.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';

const profile=(id,name)=>({id,kind:'ssh',version:1,name,host:'private-'+id+'.invalid',username:'private-user',port:22,
 ssh_client:'/usr/bin/ssh',distribution:'Private WSL',mode:'interactive',identity_file:'/secret/key',proxy_jump:[],via:[]});
const verified=(connectionId,profile)=>({connectionId,profileId:profile.id,profileVersion:profile.version,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}});
const fixtureScope=(provider,threadId,projectId='project')=>({provider,threadId,projectId,taskId:'task-'+threadId,checkCurrent:()=>true});

test('developer tests use only the selected hosted workspace, and switching it off retires the test lease',async t=>{
 let selected=null,human=true,denied=false;
 const ids={A:'a'.repeat(64),B:'b'.repeat(64)};
 const access=developerComputeAccess({workspaceId:()=>selected,userTurn:()=>human});
 const options={developerCompute:access,authorizeTerminal:()=>denied?'denied':false,
  resourceWorkspace:{assertHandoff:async ref=>({workspaceId:ids[ref.profileId]}),publicWorkspace:value=>value},
  terminalAuthorization:{input:async()=>({accepted:true})}};
 const f=fixture(t,options),owner=f.owner;
 await f.publish('A');await f.publish('B');
 f.turn(owner,'测试当前工具');
 assert.throws(()=>access.verifyChange(null,'c'.repeat(64),f.manager.snapshot()),/hosted SSH/);
 access.verifyChange(null,ids.A,f.manager.snapshot());selected=ids.A;access.changed(null,selected);
 const inventory=await f.manager.list(owner);
 assert.deepEqual(inventory.resources.map(r=>[r.resourceId,r.canAcquire,r.developerWorkspace]),[['ssh:A',true,true],['ssh:B',false,undefined]]);
 const lease=await f.manager.acquire(owner,{profileId:'A'});
 assert.equal(lease.status,'acquired');
 const input={session_id:lease.terminal.sessionId,request_id:'probe',action:'type',data:'pwd'};
 assert.equal((await f.manager.callTerminalTool('write_compute_terminal',input,owner)).accepted,true);
 human=false;
 await assert.rejects(f.manager.callTerminalTool('write_compute_terminal',input,owner),/grant_required/);
 human=true;denied=true;
 await assert.rejects(f.manager.callTerminalTool('write_compute_terminal',input,owner),/grant_required/);
 denied=false;const previous=selected;selected=null;access.changed(previous,null);f.manager.endDeveloperAccess(previous);
 await assert.rejects(f.manager.callTerminalTool('write_compute_terminal',input,owner),/lease|grant/);
 assert.equal((await f.manager.list(owner)).resources.some(row=>row.developerWorkspace),false);
});

test('an unreadable project catalog is distinct from an observed absence of authority',async()=>{
 const check=response=>managedWorkerProject({projectId:'p'},{kind:'wsl'},{forward:async()=>response},()=>{});
 assert.equal(await check({status:200,data:[]}),null);
 for(const response of [{status:401},{status:403,data:{error:'MCP credential is restricted to /mcp'}}])
  await assert.rejects(check(response),/managed_compute_project_authentication_failed/);
 for(const response of [{status:403},{status:500}])
  await assert.rejects(check(response),/managed_compute_project_observation_failed/);
 await assert.rejects(check({status:200,data:{}}),/managed_compute_project_receipt_invalid/);
});
function deferred(){let resolve;const promise=new Promise(ack=>resolve=ack);return {promise,resolve};}

function fixture(t,options={}){
 const stored=new Map([['A',profile('A','材料中心')],['B',profile('B','图形中心')]]),states=new Map(),shells=new Map(),calls=[],acquisitions=[];
 for(const item of stored.values())states.set('conn-'+item.id,verified('conn-'+item.id,item));
 const profiles={read:({id})=>structuredClone(stored.get(id))};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'managed-aliases-'));
 const owner=fixtureScope('codex','chat');
 const projectSkills=new ProjectSkills({root:directory,current:()=>owner});
 const aliases=createManagedComputeAliases({projectSkills});
 let now=30000,serial=0,openGate;
 const connections={state:async({connectionId})=>structuredClone(states.get(connectionId)),async managedShell(op,ref){
  calls.push({op,ref});
  if(op==='open'){
   const result={sessionId:'pty-'+(++serial),ownerEpoch:2,alive:true,expiresAt:now+3600000};
   shells.set(ref.leaseId,result);
   if(openGate){const gate=openGate;openGate=null;await gate.promise;}
   return result;
  }
  if(op==='close'){shells.delete(ref.leaseId);return {closed:true};}
  const value=shells.get(ref.leaseId);
  if(!value)throw Error('terminal_session_exited');
  if(op==='state')return value;
  if(op==='input')return {accepted:true,requestId:ref.requestId};
  return {output:value.sessionId,cursor:0,dropped:false};
 }};
 const make=(more={})=>createManagedComputeResources({terminal:{connections},profiles,aliases,authorizeTerminal:scope=>scope.projectId==='project',
  onAcquired:(scope,resource)=>acquisitions.push([scope.threadId,resource.resourceId]),now:()=>now,...options,...more});
 const manager=make();
 const publish=async(id,connectionId='conn-'+id,target=manager)=>{
  const current=states.get(connectionId);
  return target.publish({connectionId,profileId:id,profileVersion:current.profileVersion});
 };
 function turn(scope,text,turnId='turn-'+(++serial),target=manager){target.recordUserTurn({...scope,text,turnId});}
 t.after(async()=>{await manager.stop();fs.rmSync(directory,{recursive:true,force:true});});
 return {manager,make,owner,stored,states,profiles,connections,projectSkills,aliases,calls,shells,acquisitions,publish,turn,
  pauseOpen(){openGate=deferred();return openGate;},time:value=>{now=value;}};
}

test('a missing SSH capability grant is confirmed in the conversation before opening a scoped shell',async t=>{
 const requested=deferred(),decision=deferred();let denied=false;
 const workspace={resourceId:'fixed-resource',workspaceId:'fixed-workspace',root:'/work',account:'fixture',hostIdentity:{hostname:'fixture'}};
 const f=fixture(t,{authorizeTerminal:()=>denied?'denied':false,
  terminalAuthorization:{input:async()=>({accepted:true})},resourceWorkspace:{assertHandoff:async()=>workspace,
   publicWorkspace:value=>value,resolveHostedResourceWorkspace:()=>workspace},
  requestTerminalApproval(scope,resource,access){requested.resolve({scope,resource,access});return decision.promise;}});
 await f.publish('A');
 f.turn(f.owner,'使用材料中心');
 const operation=f.manager.acquire(f.owner,{resourceId:'ssh:A',access:'terminal'});
 const {scope,resource,access}=await requested.promise;
 assert.equal(scope.threadId,f.owner.threadId);assert.equal(resource.resourceId,'ssh:A');assert.equal(resource.workspace.root,'/work');
 assert.equal(access,'terminal');assert.equal(f.calls.length,0);
 decision.resolve(true);
 assert.equal((await operation).status,'acquired');
 assert.equal(f.calls.filter(call=>call.op==='open').length,1);
 denied=true;
 await assert.rejects(f.manager.acquire(f.owner,{resourceId:'ssh:A',access:'terminal'}),/grant_required/);
 assert.equal(f.calls.filter(call=>call.op==='open').length,1);
});

test('publication retains independent hosts and grants exactly one distinct PTY per provider, conversation and resource',async t=>{
 const f=fixture(t),{manager,owner}=f;
 f.states.get('conn-A').authentication='pending';
 await assert.rejects(f.publish('A'),/authentication_required/);
 f.states.get('conn-A').authentication='verified';
 await Promise.all([f.publish('A'),f.publish('B')]);
 const foreign=fixtureScope('codex','chat-2','other-project');
 const inventory=await manager.list(foreign);
 assert.deepEqual(inventory.resources.map(row=>[row.kind,row.canAcquire]),[['ssh',false],['ssh',false]]);
 assert.doesNotMatch(JSON.stringify(inventory),/private|conn-A|secret|targetFingerprint/);
 f.turn(foreign,'用材料中心');
 await assert.rejects(manager.acquire(foreign,{resourceId:'ssh:A'}),/project_grant_required/);
 f.turn(owner,'用材料中心和图形中心分别跑');
 const [a,b]=await Promise.all([manager.acquire(owner,{resourceId:'ssh:A'}),manager.acquire(owner,{resourceId:'ssh:B'})]);
 assert.notEqual(a.terminal.sessionId,b.terminal.sessionId);
 const other=fixtureScope('deepseek','chat');
 f.turn(other,'用材料中心');
 const otherA=await manager.acquire(other,{resourceId:'ssh:A'});
 assert.notEqual(otherA.terminal.sessionId,a.terminal.sessionId);
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',{session_id:a.terminal.sessionId,request_id:'other',data:'fixture'},other),/lease_required/);
 f.turn(owner,'继续');
 assert.deepEqual((await manager.acquire(owner,{resourceId:'ssh:A'})).terminal,a.terminal);
 assert.equal(f.calls.filter(row=>row.op==='open').length,3);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},owner)).sessions.map(s=>s.resourceId),['ssh:A','ssh:B']);
 const released=await manager.release(owner,{resourceId:'ssh:A'});
 assert.equal(released.terminalClosed,true);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},owner)).sessions.map(s=>s.resourceId),['ssh:B']);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},other)).sessions.length,1);
});

test('adding a workflow retains the original chat channel and inspection without granting a new resource or project',async t=>{
 const entries=new Map(),revocation=new Map(),observed=[];
 const catalog={get:(kind,id)=>entries.get(kind+id),put:(kind,id,value)=>entries.set(kind+id,value),remove:(kind,id)=>entries.delete(kind+id),list:()=>[]};
 const policy=managedProjectAccess({catalog});
 const services={ssh:async resource=>({
  id:'service-'+resource.profileId,verify:async()=>({}),
  async forward(_method,target,_payload,_mcp,_timeout,assertCurrent){
   if(target==='/api/projects'){
    await revocation.get(resource.profileId)?.promise;
    assertCurrent?.();
    return {status:200,data:[]};
   }
   observed.push(target);
   throw Error('Unexpected scheduler action');
  },
 })};
 const f=fixture(t,{services,selectionCatalog:catalog,authorizeTerminal:policy.terminalDecision,terminalPolicyRevision:policy.terminalRevision});
 const {manager}=f;
 await Promise.all([f.publish('A'),f.publish('B')]);
 const ordinary={...f.owner,taskId:null};
 f.turn(ordinary,'检查材料中心的队列');
 const original=await manager.acquire(ordinary,{resourceId:'ssh:A'});
 await manager.acquire(ordinary,{resourceId:'ssh:A',access:'service'});
 assert.equal((await manager.inspectService(ordinary,'ssh:A')).project_access,'project_missing');
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},ordinary)).sessions,[original.terminal]);
 const planning={...ordinary,taskId:'the-workflow'};
 f.turn(planning,'继续制定流程，先不提交计算');
 assert.equal((await manager.acquire(planning,{resourceId:'ssh:A'})).reused,true);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},planning)).sessions,[original.terminal]);
 const write={session_id:original.terminal.sessionId,request_id:'fixture-write',action:'type',data:'pwd'};
 assert.equal((await manager.callTerminalTool('write_compute_terminal',write,planning)).accepted,true);
 assert.equal((await manager.inspectService(planning,'ssh:A')).project_access,'project_missing');
 await assert.rejects(manager.resolveService(planning,'ssh:A'),/project_grant_required/);
 assert.equal(f.calls.filter(({op})=>op==='open').length,1);
 const other={...planning,threadId:'other-chat'};
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',write,other),/lease_required/);
 await assert.rejects(manager.inspectService({...planning,projectId:'different-project'},'ssh:A'),/lease_required/);
 f.turn(planning,'请用图形中心');
 await assert.rejects(manager.acquire(planning,{resourceId:'ssh:B'}),/project_grant_required/);
 f.turn(planning,'改用图形中心');
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',write,planning),/user_instruction_required/);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},planning)).sessions,[]);
 assert.equal((await manager.list(planning)).resources.length,2);
 f.turn(planning,'不要用 ssh:A');
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',write,planning),/user_instruction_required/);
 f.turn(planning,'继续核对材料中心');
 const pending=deferred();
 revocation.set('A',pending);
 const inspecting=manager.inspectService(planning,'ssh:A');
 // The service's project read can arrive after the human withdraws the
 // original project capability. It cannot revive that lease.
 const a=f.stored.get('A');
 policy.set(ordinary.projectId,{...a,profileId:a.id,targetFingerprint:resourceFingerprint(a)},false);
 pending.resolve();
 await assert.rejects(inspecting,/project_grant_required/);
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',write,planning),/project_grant_required/);
 assert.equal(f.calls.filter(({op})=>op==='input').length,1);
 assert.deepEqual(observed,[]);
});

test('a project-free chat keeps only its acquired service inspection after planning starts',async t=>{
 const catalog={get:()=>null};
 const services={ssh:async resource=>({id:'service-'+resource.profileId,verify:async()=>({})})};
 const f=fixture(t,{services,authorizeTerminal:managedProjectAccess({catalog}).terminalDecision});
 await f.publish('A');
 const ordinary={...f.owner,taskId:null,projectId:null},planning={...ordinary,taskId:'draft'};
 f.turn(ordinary,'检查材料中心的队列');
 await f.manager.acquire(ordinary,{resourceId:'ssh:A',access:'service'});
 f.turn(planning,'继续写流程');
 const access=await f.manager.inspectService(planning,'ssh:A');
 assert.equal(access.project_access,'no_project');
 assert.equal(access.terminal_available,false);
 const terminal=await f.manager.acquire(planning,{resourceId:'ssh:A',access:'terminal'});
 assert.equal(terminal.status,'terminal_unavailable');
 assert.equal(terminal.code,'managed_compute_project_grant_required');
 await assert.rejects(f.manager.resolveService(planning,'ssh:A'),/project_grant_required/);
 assert.equal(f.calls.filter(({op})=>op==='open').length,0);
});

test('a project change identifies the old conversation channel and leaves the SSH resource available after releasing it',async t=>{
 const f=fixture(t,{services:{ssh:async resource=>({id:'service-'+resource.profileId,verify:async()=>({})})}});
 const {manager,owner}=f;
 const ordinary={...owner,taskId:null,projectId:null};
 await f.publish('A');
 f.turn(ordinary,'检查材料中心');
 assert.equal((await manager.acquire(ordinary,{resourceId:'ssh:A',access:'service'})).status,'acquired');
 f.turn(owner,'请用「材料中心」核对当前项目');
 await assert.rejects(manager.acquire(owner,{resourceId:'ssh:A',access:'service'}),{
  message:'managed_compute_resource_project_changed',operationNotStarted:true,
 });
 const [old]=manager.consoleEntries().channels;
 assert.equal(old.projectId,null);
 assert.equal((await manager.releaseFromConsole(old)).status,'released');
 f.turn(owner,'请用「材料中心」继续核对当前项目');
 const replacement=await manager.acquire(owner,{resourceId:'ssh:A',access:'service'});
 assert.equal(replacement.status,'acquired');
 const [current]=manager.consoleEntries().channels;
 assert.equal(current.projectId,owner.projectId);
 assert.equal(current.connectionId,old.connectionId);
 assert.notEqual(current.leaseId,old.leaseId);
});

test('an acquisition already authorized in chat reconciles a late shell under the planning turn',async t=>{
 const f=fixture(t,{authorizeTerminal:managedProjectAccess({catalog:{get:()=>null}}).terminalDecision});
 const {manager}=f;
 await f.publish('A');
 let chatCurrent=true;
 const chat={...f.owner,taskId:null,projectId:null,checkCurrent:()=>chatCurrent};
 const plan={...f.owner,taskId:'workflow',projectId:null};
 f.turn(chat,'请用材料中心');
 const pause=f.pauseOpen();
 const first=assert.rejects(manager.acquire(chat,{resourceId:'ssh:A'}),/context_changed/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.filter(({op})=>op==='open').length,1);
 chatCurrent=false;
 manager.recordUserTurn({...plan,text:'请根据已经讨论的目标制定流程',turnId:'planning',planningMode:true});
 const inventory=await manager.list(plan);
 assert.equal(inventory.resources[0].acquired,false);
 assert.equal(inventory.resources[0].canAcquire,true);
 const after=manager.acquire(plan,{resourceId:'ssh:A'});
 await new Promise(resolve=>setImmediate(resolve));
 pause.resolve();
 await first;
 assert.equal((await after).status,'acquired');
 assert.deepEqual(f.calls.filter(({op})=>['open','close'].includes(op)).map(({op})=>op),['open','close','open']);
 assert.equal(f.shells.size,1);
});

test('reconnect verifies a recorded target and capability, unlike a discovery-only observation',async t=>{
 const rows=new Map(),catalog={get:(kind,id)=>rows.get(kind+id),put:(kind,id,value)=>rows.set(kind+id,value),remove:(kind,id)=>rows.delete(kind+id),list:()=>[]};
 const policy=managedProjectAccess({catalog});
 const f=fixture(t,{selectionCatalog:catalog,authorizeTerminal:policy.terminalDecision,terminalPolicyRevision:policy.terminalRevision});
 const chat={...f.owner,taskId:null},plan={...f.owner,taskId:'workflow'};
 const listed={...chat,threadId:'listed-in-chat'};
 await f.publish('A');
 f.turn(chat,'请用材料中心');
 await f.manager.acquire(chat,{resourceId:'ssh:A'});
 f.turn(listed,'请用材料中心');
 await f.manager.list(listed);
 await f.manager.stop();
 const restarted=f.make();
 t.after(()=>restarted.stop());
 f.states.get('conn-A').authentication='pending';
 await assert.rejects(f.publish('A','conn-A',restarted),/authentication_required/);
 f.states.get('conn-A').authentication='verified';
 await f.publish('A','conn-A',restarted);
 restarted.recordUserTurn({...plan,text:'请根据已有讨论制定流程',turnId:'after-restart',planningMode:true});
 assert.deepEqual((await restarted.list(plan)).resources.map(r=>[r.acquired,r.canAcquire]),[[false,true]]);
 assert.equal((await restarted.acquire(plan,{resourceId:'ssh:A'})).status,'acquired');
 const listedPlan={...listed,taskId:'other-workflow'};
 f.turn(listedPlan,'继续设计',undefined,restarted);
 await assert.rejects(restarted.acquire(listedPlan,{resourceId:'ssh:A'}),/project_grant_required/);
 await assert.rejects(restarted.release({...plan,projectId:'other'}, {resourceId:'ssh:A'}),/lease_required/);
 await restarted.release(plan,{resourceId:'ssh:A'});
 await assert.rejects(restarted.acquire(plan,{resourceId:'ssh:A'}),/project_grant_required/);
 assert.equal(f.calls.filter(({op})=>op==='open').length,2);
});

test('an awaited terminal authorization cannot outlive explicit project revocation',async t=>{
 const rows=new Map(),catalog={get:(kind,id)=>rows.get(kind+id),put:(kind,id,value)=>rows.set(kind+id,value)};
 const policy=managedProjectAccess({catalog}),entered=deferred(),continuePolicy=deferred();
 const f=fixture(t,{authorizeTerminal:async(scope,resource)=>{
  const captured=policy.terminalDecision(scope,resource);
  entered.resolve();await continuePolicy.promise;
  return captured;
 },terminalPolicyRevision:policy.terminalRevision});
 await f.publish('A');
 const a=f.stored.get('A'),concrete={...a,profileId:a.id,targetFingerprint:resourceFingerprint(a)};
 policy.set(f.owner.projectId,concrete,true);
 f.turn(f.owner,'请用材料中心');
 const acquired=f.manager.acquire(f.owner,{resourceId:'ssh:A'});
 await entered.promise;
 policy.set(f.owner.projectId,concrete,false);
 continuePolicy.resolve();
 await assert.rejects(acquired,/project_grant_required/);
 assert.equal(f.calls.filter(({op})=>op==='open').length,0);
});

test('an ambiguous target change still offers eligible candidates without dispatching either',async t=>{
 const f=fixture(t);
 f.stored.get('A').name='同名中心';
 f.stored.get('B').name='同名中心';
 await Promise.all([f.publish('A'),f.publish('B')]);
 f.turn(f.owner,'改用同名中心');
 const result=await f.manager.acquire(f.owner,{alias:'同名中心'});
 assert.equal(result.status,'choice_required');
 assert.deepEqual(new Set(result.candidates.map(row=>row.resourceId)),new Set(['ssh:A','ssh:B']));
 assert.equal(f.calls.filter(({op})=>op==='open').length,0);
});

test('an authenticated terminal lease permits ordinary skill saves for that account without a job service',async t=>{
 const registration=Object.fromEntries(['A','B'].map((id,index)=>[id,{
  profileId:id,resourceId:String(index+1).repeat(64),workspaceId:String(index+4).repeat(64),
  account:'same-name',hostIdentity:{hostname:id,uid:1001,machineId:id},root:'/workspace/'+id,
 }]));
 const f=fixture(t,{resourceWorkspace:{
  assertHandoff:async({profileId})=>registration[profileId],
  publicWorkspace:value=>value,
  resolveHostedResourceWorkspace:(id,{profileId})=>registration[profileId]?.resourceId===id?registration[profileId]:null,
 }});
 const {manager,owner,projectSkills}=f;
 projectSkills.resolveResource=manager.resolveSkillLibrary;
 await Promise.all([f.publish('A'),f.publish('B')]);
 f.turn(owner,'用材料中心');
 await manager.acquire(owner,{resourceId:'ssh:A'});
 const name='tool-handbook',body='---\nname: '+name+'\ndescription: Read this resource handbook.\n---\n\nNotes for this account.';
 const args={scope:'resource',resource_id:'ssh:A',name,body,expected_sha256:null};
 const archived=await projectSkills.call('write_project_skill',args,owner);
 assert.match(archived.path,/resource-[a-f0-9]{64}[/\\]tool-handbook[/\\]SKILL\.md$/);
 await assert.rejects(()=>projectSkills.call('write_project_skill',{...args,resource_id:'ssh:B'},owner),/lease_required/);
 await assert.rejects(()=>projectSkills.call('write_project_skill',args,owner),/Skill revision changed/);
 const changed=await projectSkills.call('write_project_skill',{...args,body:body+'\nMore notes.',expected_sha256:archived.sha256},owner);
 assert.notEqual(changed.sha256,archived.sha256);
 const newRoot=projectSkills.prepareRoot(path.join(path.dirname(projectSkills.root),path.basename(projectSkills.root)+'-migrated'));
 t.after(()=>fs.rmSync(newRoot,{recursive:true,force:true}));
 projectSkills.root=newRoot;
 assert.equal((await projectSkills.call('read_project_skill',{scope:'resource',resource_id:'ssh:A',name},owner)).sha256,changed.sha256);
 f.states.get('conn-A').authentication='lost';
 await assert.rejects(()=>projectSkills.call('write_project_skill',{...args,expected_sha256:changed.sha256},owner),/unavailable/);
});

test('a user-selected alias uses the stable profile after rename and requires confirmation after the target changes',async t=>{
 const f=fixture(t),{manager,owner,aliases}=f;
 await f.publish('A');await f.publish('B');
 f.turn(owner,'用学校集群');
 const selection=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(selection.status,'choice_required');
 assert.equal(selection.candidates.length,2);
 assert.equal(aliases.read('学校集群',()=>true),null);
 assert.deepEqual(await manager.acquire(owner,{resourceId:'ssh:B'}),selection);
 assert.deepEqual(manager.capture(owner.provider,owner.threadId).resources,[]);
 f.turn(owner,'材料中心');
 const chosen=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(chosen.resource.profileId,'A');
 assert.deepEqual(aliases.read('学校集群',()=>true),{alias:'学校集群',profileId:'A',targetFingerprint:resourceFingerprint(f.stored.get('A'))});
 const doc=f.projectSkills.call('read_project_skill',{scope:'user',name:'compute-resource-aliases'},owner);
 assert.doesNotMatch(doc.body,/private-|secret\/key|conn-A/);
 assert.throws(()=>f.projectSkills.call('write_project_skill',{scope:'user',name:'compute-resource-aliases',expected_sha256:doc.sha256,body:doc.body},owner),/human resource choice/);

 await manager.revokeConnection({connectionId:'conn-A'});
 const renamed={...f.stored.get('A'),version:2,name:'材料科学中心'};
 f.stored.set('A',renamed);f.states.set('conn-A2',verified('conn-A2',renamed));
 await f.publish('A','conn-A2');
 const another=fixtureScope('kimi','chat-2');
 f.turn(another,'用学校集群');
 assert.equal((await manager.acquire(another,{alias:'学校集群'})).resource.name,'材料科学中心');
 await manager.revokeConnection({connectionId:'conn-A2'});
 const moved={...renamed,version:3,host:'changed.invalid'};
 f.stored.set('A',moved);f.states.set('conn-A3',verified('conn-A3',moved));
 await f.publish('A','conn-A3');
 f.turn(another,'用学校集群');
 const replacement=await manager.acquire(another,{alias:'学校集群'});
 assert.equal(replacement.status,'choice_required');
 assert.deepEqual(await manager.acquire(another,{resourceId:'ssh:A'}),replacement);
 assert.deepEqual(manager.capture(another.provider,another.threadId).resources,[]);
 f.turn(another,'材料科学中心');
 assert.equal((await manager.acquire(another,{alias:'学校集群'})).resource.profileId,'A');
 assert.equal(aliases.read('学校集群',()=>true).targetFingerprint,resourceFingerprint(moved));
});

test('confirmed alias storage honors the 0.1.12 built-in skill boundary',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'managed-builtin-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const projectSkills=new ProjectSkills({root:directory,bundledRoot:directory,current:()=>null});
 const aliases=createManagedComputeAliases({projectSkills});
 assert.throws(()=>aliases.read('fixture',()=>true),/separate from the built-in/);
 assert.deepEqual(fs.readdirSync(directory),[]);
});

test('generic user choice is temporary and old clarification replies cannot authorize a fresh or unrelated turn',async t=>{
 const f=fixture(t),{manager,owner}=f;
 await f.publish('A');
 f.turn(owner,'用集群');
 assert.equal((await manager.acquire(owner,{alias:'集群'})).resource.profileId,'A');
 assert.equal(f.aliases.read('集群',()=>true),null);
 await manager.release(owner,{resourceId:'ssh:A'});
 await f.publish('B');
 f.turn(owner,'用学校集群','question');
 const pending=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(pending.status,'choice_required');
 f.turn(owner,'材料中心','first-answer');
 f.turn(owner,'这不是资源选择','latest');
 f.turn(owner,'材料中心','first-answer');
 await assert.rejects(manager.acquire(owner,{alias:'学校集群'}),/instruction_required/);
 assert.equal(f.aliases.read('学校集群',()=>true),null);
 f.turn(owner,'如何使用材料中心');
 await assert.rejects(manager.acquire(owner,{resourceId:'ssh:A'}),/instruction_required/);
});

test('release during pending acquisition fences the late shell and never releases another conversation',async t=>{
 const f=fixture(t),{manager,owner}=f;
 await f.publish('A');
 const other=fixtureScope('codex','chat-2');f.turn(other,'用材料中心');
 await manager.acquire(other,{resourceId:'ssh:A'});
 f.turn(owner,'用材料中心');
 const paused=f.pauseOpen(),pending=manager.acquire(owner,{resourceId:'ssh:A'});
 await new Promise(resolve=>setImmediate(resolve));
 const duplicate=manager.acquire(owner,{resourceId:'ssh:A'});
 await new Promise(resolve=>setImmediate(resolve));
 const rejected=Promise.allSettled([pending,duplicate]);
 assert.equal((await manager.release(owner,{resourceId:'ssh:A'})).terminalClosed,true);
 paused.resolve();
 assert.deepEqual((await rejected).map(result=>result.status),['rejected','rejected']);
 assert.equal(f.calls.filter(row=>row.op==='open').length,2);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},other)).sessions.length,1);
 assert.equal(f.shells.size,1);
});

test('capacity and connection loss are isolated per host and idle retirement leaves authenticated resources visible',async t=>{
 const f=fixture(t),{manager}=f;
 await f.publish('A');await f.publish('B');
 const owners=Array.from({length:5},(_,index)=>fixtureScope('compatible','scope-'+index));
 for(const scope of owners)f.turn(scope,'用材料中心和图形中心');
 await Promise.all(owners.slice(0,4).map(scope=>manager.acquire(scope,{resourceId:'ssh:A'})));
 await assert.rejects(manager.acquire(owners[4],{resourceId:'ssh:A'}),/session_limit/);
 await manager.acquire(owners[4],{resourceId:'ssh:B'});
 f.states.get('conn-A').status='unavailable';f.states.get('conn-A').authentication='lost';
 await manager.sweep({idleMs:60000});
 assert.deepEqual(manager.snapshot().map(row=>row.resourceId),['ssh:B']);
 assert.equal(f.shells.size,1);
 f.time(100000);await manager.sweep({idleMs:60000});
 assert.equal(manager.snapshot()[0].terminalAvailable,4);
 assert.equal(f.shells.size,0);
});

test('an uncertain SSH proof leaves a published resource and its existing lease intact',async t=>{
 const f=fixture(t),{manager,owner}=f;
 await Promise.all([f.publish('A'),f.publish('B')]);
 f.turn(owner,'用材料中心');await manager.acquire(owner,{resourceId:'ssh:A'});
 const state=f.connections.state;
 for(const code of ['ssh_control_timeout','ssh_control_unavailable']){
  f.connections.state=async value=>{if(value.connectionId==='conn-A')throw Error(code);return state(value);};
  await manager.sweep({idleMs:60000});
  assert.deepEqual(manager.snapshot().map(value=>value.resourceId),['ssh:A','ssh:B']);
  assert.equal(f.shells.size,1);assert.equal(f.calls.filter(value=>value.op==='close').length,0);
  await assert.rejects(f.publish('A'),new RegExp(code));
 }
 f.connections.state=state;
 assert.equal((await f.publish('A')).connectionId,'conn-A');
});

test('a private service control timeout keeps the original source for the next verified request',async t=>{
 let verificationError=null,attachments=0,forwarded=0,closed=0;
 const health={resource_tool_schema:1};
 async function verify(){
  if(verificationError)throw Error(verificationError);
  return health;
 }
 const services={ssh:async()=>{
  attachments++;
  return {id:'original',generation:'original-channel',health,verify,
   close(){closed++;},
   async forward(_method,_target,_data,_mcp,_timeout,beforeDispatch){
    const observed=await verify();
    beforeDispatch?.(observed);
    forwarded++;
    return {status:200,data:{targets:[]}};
   }};
 }};
 const {manager,publish}=fixture(t,{services});
 await publish('A');
 assert.equal((await manager.refreshService({connectionId:'conn-A'})).id,'original');
 const [source]=manager.listSources();
 const listTools=()=>source.request('POST','/api/resource-tools/list',{});

 verificationError='ssh_control_timeout';
 await assert.rejects(listTools(),/ssh_control_timeout/);
 await assert.rejects(manager.observeConsoleService({resourceId:'ssh:A',generation:source.generation}),/ssh_control_timeout/);
 await manager.sweep({idleMs:60000});
 assert.equal(manager.listSources()[0]?.generation,source.generation);
 assert.equal(await manager.refreshService({connectionId:'conn-A'}),null);
 assert.equal(manager.listSources()[0]?.generation,source.generation);
 assert.equal(attachments,1);
 assert.equal(forwarded,0);
 assert.equal(closed,0);

 verificationError=null;
 assert.equal(await manager.observeConsoleService({resourceId:'ssh:A',generation:source.generation}),true);
 assert.deepEqual(await listTools(),{targets:[]});
 assert.equal(forwarded,1);

 verificationError='managed_compute_service_changed';
 await manager.sweep({idleMs:60000});
 assert.equal(manager.listSources().length,0);
 assert.equal(closed,1);
});

test('failed job-service health retains its first public receipt alongside a working command lease',async t=>{
 let verifyError,attachError,verifyGate,attached=0,commands=0;
 const services={ssh:async()=>{
  if(attachError)throw Error(attachError);
  const generation='channel-'+(++attached);
  return {id:'original',generation,async verify(){if(verifyGate)await verifyGate.promise;if(verifyError)throw Error(verifyError);},
   async forward(){return {status:200,data:[]};}};
 }};
 const f=fixture(t,{services,authorizeTerminal:()=>true,resourceWorkspace:{assertHandoff:async()=>({}),publicWorkspace:value=>value},
  terminalAuthorization:{async execute({assertCurrent,verifyConnection}){
   await verifyConnection();assertCurrent();commands++;return {exit_code:0};
  }}});
 const {manager}=f,scope={...f.owner,taskId:null,projectId:null},resource_id='ssh:A';
 const args={resourceId:resource_id};
 await f.publish('A');
 await manager.refreshService({connectionId:'conn-A'});
 f.turn(scope,'检查材料中心的作业服务');
 await manager.acquire(scope,{...args,access:'service'});
 await manager.acquire(scope,{...args,access:'command'});

 const observedAt=35000;
 f.time(observedAt);verifyError='worker_health_invalid';
 await manager.sweep();
 const diagnosis={channel:'job_service',observed_at:new Date(observedAt).toISOString(),step:'health_check',reason:'worker_health_invalid'};
 const [listed]=(await manager.list(scope)).resources;
 assert.equal(listed.serviceStatus,'unavailable');
 assert.equal(listed.commandAvailable,true);
 assert.equal(listed.acquired,true);
 assert.deepEqual(listed.serviceFailure,diagnosis);
 assert.equal((await manager.acquire(scope,{...args,access:'command'})).reused,true);
 const inspected=await manager.inspectService(scope,resource_id,{probeScheduler:true});
 assert.equal(inspected.command_available,true);
 assert.equal(inspected.terminal_available,false);
 assert.equal(inspected.scheduler.reason,'service_unavailable');
 assert.deepEqual(inspected.service_failure,diagnosis);
 assert.match(inspected.next_step,/original resource.*reacquire/);
 assert.equal((await manager.callTool('run_compute_command',{resource_id,request_id:'read-one',command:'pwd'},scope)).exit_code,0);
 assert.equal(commands,1);

 async function acquisitionFailure(){
  try{await manager.acquire(scope,{...args,access:'service'});}
  catch(error){return error;}
  assert.fail('Expected job-service acquisition to fail');
 }
 attachError='raw remote error with private output';
 f.time(40000);
 assert.equal(await manager.refreshService({connectionId:'conn-A',existingOnly:true}),null);
 const failure=await acquisitionFailure();
 const blocked=JSON.parse(toolFailure(failure,{toolName:'acquire_compute_resource'}).content[0].text);
 assert.equal(blocked.code,'connection_unavailable');
 assert.equal(blocked.operation_state,'not_started');
 assert.deepEqual(blocked.service_failure,diagnosis);
 assert.doesNotMatch(JSON.stringify(blocked),/private output|correct the request/);
 const unknown=JSON.parse(toolFailure(failure,{dispatched:true,toolName:'submit_compute_run'}).content[0].text);
 assert.equal(unknown.operation_state,'unconfirmed');
 assert.equal(unknown.automatic_retry,false);
 assert.match(unknown.next_step,/reconcile the original operation/);
 assert.equal(attached,1);

 verifyError=null;attachError=null;
 await manager.refreshService({connectionId:'conn-A',existingOnly:true});
 const changed=JSON.parse(toolFailure(Error('managed_compute_service_changed')).content[0].text);
 assert.equal(changed.code,'connection_unavailable');
 assert.match(changed.next_step,/original resource.*reacquire/);
 assert.equal((await manager.acquire(scope,{...args,access:'service'})).reused,false);
 assert.equal((await manager.inspectService(scope,resource_id)).service_failure,undefined);

 verifyError='raw remote error with private output';
 await manager.sweep();
 const unclassified=(await manager.inspectService(scope,resource_id)).service_failure;
 assert.equal(unclassified.reason,'service_failure_unclassified');
 assert.doesNotMatch(JSON.stringify(unclassified),/private output/);

 verifyError=null;
 await manager.refreshService({connectionId:'conn-A',existingOnly:true});
 verifyGate=deferred();
 const refresh=manager.refreshService({connectionId:'conn-A',existingOnly:true});
 const attachments=attached;
 await manager.revokeConnection({connectionId:'conn-A'});
 verifyGate.resolve();
 assert.equal(await refresh,null);
 assert.equal(attached,attachments);
});

test('independent command authorization keeps inspection available when the retained worker grant cannot be verified',async t=>{
 const saved=new Map(),catalog={get:(_,id)=>saved.get(id),put:(_,id,row)=>saved.set(id,structuredClone(row)),remove:(_,id)=>saved.delete(id)};
 let desktop=false,observation,projectReads=0,queueReads=0;
 const binding={root:'/fixture',hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture'}};
 const cluster={id:'scheduler',version:1,transport_kind:'ssh-service-local'};
 const service={id:'worker',generation:'generation',binding,schedulerInspection:true,verify:async()=>{},
  async forward(_method,target){
   if(target==='/api/projects'){
    projectReads++;
    if(observation instanceof Error)throw observation;
    return observation??{status:200,data:[{id:'project',policy:{clusters:['scheduler']}}]};
   }
   if(target==='/api/clusters')return {status:200,data:[cluster]};
   if(target==='/api/cluster/profile')return {status:200,data:{...cluster,service_binding:{root:binding.root,...binding.hostIdentity}}};
   assert.equal(target,'/api/ssh-service/inspect-scheduler');
   queueReads++;
   return {status:200,data:{status:'observed',observed_at:100,automatic_retry:false,observations:[
    {scheduler:'slurm',status:'observed',queues:[]},{scheduler:'lsf',status:'not_found',queues:[]},
   ]}};
  }};
 const f=fixture(t,{services:{ssh:async()=>service},selectionCatalog:catalog,authorizeTerminal:()=>desktop,
  resourceWorkspace:{assertHandoff:async()=>({}),publicWorkspace:value=>value},
  terminalAuthorization:{execute:async()=>({exit_code:0})}});
 const {manager,owner}=f,resource_id='ssh:A';
 const gateway=createManagedComputeTools({resources:manager,assertWorkflow:()=>({id:owner.taskId}),authorizeTask:()=>{}});
 await f.publish('A');
 await manager.refreshService({connectionId:'conn-A'});
 f.turn(owner,'检查材料中心的作业服务');
 await gateway.call('acquire_compute_resource',{resource_id,access:'service'},owner);

 observation=Error('private remote path and credential');
 await assert.rejects(gateway.call('acquire_compute_resource',{resource_id,access:'service'},owner),error=>{
  const failure=JSON.parse(toolFailure(error).content[0].text);
  assert.equal(failure.code,'observation_unavailable');
  assert.equal(failure.project_access_step,'project_catalog');
  assert.equal(failure.project_access_http_status,undefined);
  assert.equal(failure.operation_state,'not_started');
  assert.doesNotMatch(JSON.stringify(failure),/private remote/);
  return true;
 });
 desktop=true;
 await gateway.call('acquire_compute_resource',{resource_id,access:'command'},owner);
 observation={status:503};
 const before=projectReads;
 const inspect=()=>gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},owner);
 const receipt=await inspect();
 assert.equal(receipt.project_access,'unobserved');
 assert.equal(receipt.project_access_http_status,503);
 assert.equal(receipt.command_available,true);
 assert.equal(receipt.scheduler.status,'observed');
 assert.equal(projectReads,before+1);
 assert.equal(queueReads,1);
 await assert.rejects(manager.resolveService(owner,resource_id),error=>error.projectObservationHttpStatus===503);
 desktop='denied';
 await assert.rejects(inspect(),/managed_compute_project_observation_failed/);
 assert.equal(queueReads,1);
});

test('inspection distinguishes project HTTP failures from job-service identity loss while retaining the command lease',async t=>{
 let identityChanged=false;
 const services={ssh:async()=>({id:'original',generation:'channel',async verify(){},async forward(_method,target){
  assert.equal(target,'/api/projects');
  if(identityChanged)throw Error('ssh_service_registration_identity_changed');
  return {status:503};
 }})};
 const f=fixture(t,{services,authorizeTerminal:()=>true,resourceWorkspace:{assertHandoff:async()=>({}),publicWorkspace:value=>value},
  terminalAuthorization:{execute:async()=>({exit_code:0})}});
 const {manager}=f,scope={...f.owner,taskId:null},resourceId='ssh:A';
 await f.publish('A');
 await manager.refreshService({connectionId:'conn-A'});
 f.turn(scope,'检查材料中心的作业服务');
 await manager.acquire(scope,{resourceId,access:'command'});
 await manager.acquire(scope,{resourceId,access:'service'});
 const projectFailure=await manager.inspectService(scope,resourceId);
 assert.equal(projectFailure.project_access,'unobserved');
 assert.equal(projectFailure.project_access_reason,'request_failed');
 assert.equal(projectFailure.service_status,'ready');
 assert.equal(projectFailure.service_failure,undefined);

 identityChanged=true;
 const unavailable=await manager.inspectService(scope,resourceId,{probeScheduler:true});
 assert.equal(unavailable.project_access,'unobserved');
 assert.equal(unavailable.project_access_reason,'service_unavailable');
 assert.equal(unavailable.service_status,'unavailable');
 assert.deepEqual(unavailable.service_failure,{channel:'job_service',observed_at:new Date(30000).toISOString(),
  step:'project_observation',reason:'ssh_service_registration_identity_changed'});
 assert.equal(unavailable.command_available,true);
 assert.equal(unavailable.scheduler.reason,'service_unavailable');
 assert.deepEqual((await manager.list(scope)).resources[0].serviceFailure,unavailable.service_failure);
});

test('private services verify exact registration, authorize the selected worker projects and preserve original run provenance',async t=>{
 const f=fixture(t),channels=new Map(),packets=[],starts=[];
 const health=id=>({name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/'+id,port:21000+id.charCodeAt(0),
  runtime:'/owned/'+id+'/runtimes/'+'a'.repeat(20),runtimeId:'a'.repeat(20),hostIdentity:{hostname:'remote-'+id,uid:1001,machineId:'machine-'+id},managed_schedule_schema:1});
 const saved=id=>({...health(id),runtimeManifestSha256:'a'.repeat(64)});
 const registration={validateReuse(profile,observed){if(observed){assert.equal(observed.root,health(profile.id).root);assert.equal(observed.runtimeManifestSha256,'a'.repeat(64));}return saved(profile.id);}};
 Object.assign(f.connections,{
  serviceState:async({connectionId})=>channels.get(connectionId)??{connectionId,profileId:connectionId.at(-1),profileVersion:1,status:'idle',serviceActive:false},
  async openService(ref,data,context){
   starts.push({ref,data,context});
   channels.set(ref.connectionId,{...ref,serviceId:'service-'+ref.profileId,status:'connected',serviceActive:true,channelKind:'private',service:saved(ref.profileId)});
  },
  async privateServiceRequest(packet){
   packets.push(packet);
   const id=packet.connectionId.at(-1),actual=health(id);
   assert.equal(packet.serviceId,'service-'+id);
   const cluster={id:'scheduler-'+id,version:2,transport_kind:'ssh-service-local'};
   let data={fixture:id};
   if(packet.target==='/api/health')data=actual;
   if(packet.target==='/api/projects')data=[{id:'project',policy:{clusters:[cluster.id]}}];
   if(packet.target==='/api/clusters')data=[cluster];
   if(packet.target==='/api/cluster/profile')data={...cluster,service_binding:{...actual.hostIdentity,root:actual.root}};
   return {status:200,data};
  }
 });
 const services=createManagedComputeServices({connections:f.connections,registration,source:'fixture',transportSource:'fixture',
  prepareResources:async(_source,value)=>value});
 const originalRef={connectionId:'conn-A',profileId:'A',profileVersion:1};
 await assert.rejects(services.ssh(originalRef,f.stored.get('A'),()=>{},{existingOnly:true}),/managed_compute_private_service_unavailable/);
 assert.deepEqual(starts,[]);
 const manager=f.make({services,authorizeTerminal:()=>false,authorizeRun:(_scope,run)=>run.resourceId==='ssh:A'&&run.runId==='run-on-A'});
 t.after(()=>manager.stop());
 await f.publish('A','conn-A',manager);await f.publish('B','conn-B',manager);
 await Promise.all(['conn-A','conn-B'].map(connectionId=>manager.refreshService({connectionId})));
 assert.deepEqual(starts.map(start=>start.data.port).sort(),[21065,21066]);
 assert(starts.every(start=>start.data.reuseOnly&&start.context.conversationChannel));
 const original=manager.listSources({scheduleReady:true});
 assert.equal(original.length,2);
 for(const source of original){
  const binding={kind:'ssh',version:2,profileId:source.profileId,profileVersion:1,...health(source.profileId)};
  assert.equal(source.id,taskForRecordIndex({authoring:{workerBinding:binding}}).workerSourceId);
  assert.equal(source.generation,'service-'+source.profileId);
 }
 f.turn(f.owner,'用材料中心和图形中心','both',manager);
 await manager.acquire(f.owner,{resourceId:'ssh:A'});await manager.acquire(f.owner,{resourceId:'ssh:B'});
 assert.deepEqual((await manager.resolveService(f.owner,'ssh:B')).clusterIds,['scheduler-B']);
 const prepare={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'prepare_cluster_run',arguments:{spec:{project_id:'project',cluster_id:'scheduler-B'}}}};
 const selected=await manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:'/mcp',data:prepare,mcp:true});
 assert.equal(selected.data.fixture,'B');
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:A',method:'POST',target:'/mcp',data:prepare,mcp:true}),/project_grant_required/);
 const read={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'cluster_run_status',arguments:{run_id:'run-on-A'}}};
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:'/mcp',data:read,mcp:true}),/run_source_changed/);
 assert.equal((await manager.serviceRequest(f.owner,{resourceId:'ssh:A',method:'POST',target:'/mcp',data:read,mcp:true})).data.fixture,'A');
 const sourceA=original.find(source=>source.profileId==='A'),sourceB=original.find(source=>source.profileId==='B');
 const observeRoute='/api/managed-schedules/observe-once',observe={sourceId:sourceB.id,scheduleId:'fixture-schedule',requestId:'manual-check'};
 assert.throws(()=>assertRendererWorkerRoute('POST',observeRoute));
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:observeRoute,data:observe}),/invalid_request/);
 await assert.rejects(sourceA.request('POST',observeRoute,observe),/invalid_request/);
 assert.equal((await sourceB.request('POST',observeRoute,observe)).fixture,'B');
 assert.deepEqual(packets.filter(packet=>packet.target===observeRoute).map(({connectionId,data,mcp})=>({connectionId,data,mcp})),
  [{connectionId:'conn-B',data:observe,mcp:false}]);
 await manager.revokeConnection({connectionId:'conn-A'});
 await assert.rejects(sourceA.request('GET','/api/health'),/resource_unavailable/);
 assert.equal((await sourceB.request('GET','/api/health')).hostIdentity.hostname,'remote-B');
 assert.equal(packets.filter(packet=>packet.target==='/mcp').length,2);
});

test('WSL is published only after an independent original worker relay verifies its scope and runtime',async t=>{
 const f=fixture(t),runtime='/owned/wsl/runtimes/'+'b'.repeat(20),root='/owned/wsl',distribution='Test Linux',port=9042;
 f.stored.set('WSL',{id:'WSL',kind:'wsl',version:1,name:'Local',distribution,root,port});
 const observed=[],clients=[];
 function newWslClient(){
  const client={
   async restore(config,{current}){assert.equal(current(),true);observed.push(config);this.connection={};return {status:'connected'};},
   matchesTarget(config){return config.distribution===distribution&&config.workerRoot===root&&config.workerPort===port;},
   async forward(_method,target){
    const responses={'/api/health':{name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root,runtime},
     '/api/projects':[{id:'project',policy:{environments:['env']}}],'/api/environments':[{id:'env',secret:'private local environment'}]};
    return {status:200,data:responses[target]};
   },
   close(){this.connection=null;}
  };
  clients.push(client);return client;
 }
 const manager=f.make({services:createManagedComputeServices({newWslClient})});
 t.after(()=>manager.stop());
 const receipt={profileId:'WSL',profileVersion:1,distribution,root,port,runtime};
 assert.deepEqual(manager.snapshot(),[]);
 await assert.rejects(manager.publishWsl({...receipt,runtime:'/different/runtime'}),/private_service_unavailable/);
 const wsl=await manager.publishWsl(receipt);
 assert.equal(wsl.kind,'wsl');assert.equal(wsl.serviceStatus,'ready');
 assert.deepEqual(observed,[{distribution,workerRoot:root,workerPort:port},{distribution,workerRoot:root,workerPort:port}]);
 assert.equal(clients[0].connection,null);
 f.turn(f.owner,'用本地','where',manager);
 const acquired=await manager.acquire(f.owner,{alias:'本地'});
 assert.equal(acquired.terminal,undefined);
 assert.deepEqual((await manager.resolveService(f.owner,acquired.resource.resourceId)).environmentIds,['env']);
 assert.equal(manager.listSources()[0].id,taskForRecordIndex({authoring:{workerBinding:{kind:'wsl',distribution,root,port}}}).workerSourceId);
 assert.equal(manager.listSources({scheduleReady:true}).length,0);
 assert.equal(f.calls.filter(call=>call.op==='open').length,0);
 await manager.stop();assert.equal(clients[1].connection,null);
});

test('human first-use setup opens one private service on its published host without occupying or borrowing a shell',async t=>{
 const f=fixture(t),calls=[],saved=new Map(),channels=new Map();
 const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/fixture/data',port:34567,
  runtime:'/fixture/data/runtimes/'+'c'.repeat(20),runtimeId:'c'.repeat(20),hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture-id'}};
 const registration={
  validateReuse(profile){if(!saved.has(profile.id))throw Error('ssh_service_registration_required');return saved.get(profile.id);},
  read({profileId}){return saved.has(profileId)?{status:'configured',registration:saved.get(profileId)}:{status:'unconfigured'};},
  remember(profile,observed,tools){calls.push({registered:profile.id});assert.equal(observed.root,health.root);assert.equal(tools.count,1);saved.set(profile.id,observed);}
 };
 Object.assign(f.connections,{
  serviceState:async({connectionId})=>channels.get(connectionId)??{connectionId,profileId:connectionId.at(-1),profileVersion:1,status:'idle',serviceActive:false},
  async openService(ref,bootstrap,context){calls.push({ref,bootstrap,context});channels.set(ref.connectionId,{...ref,serviceId:'setup-'+ref.profileId,status:'connected',serviceActive:true,channelKind:'private',service:{...health,runtimeManifestSha256:'c'.repeat(64)}});},
  async privateServiceRequest(packet){return {status:200,data:packet.target==='/api/health'?health:{jsonrpc:'2.0',id:packet.data.id,result:{tools:[{name:'fixture'}]}}};}
 });
 const services=createManagedComputeServices({connections:f.connections,registration,prepareResources:async()=>({payload:{port:health.port,expected_runtime_id:health.runtimeId}})});
 const manager=f.make({services});t.after(()=>manager.stop());
 await f.publish('A','conn-A',manager);await f.publish('B','conn-B',manager);
 await manager.refreshService({connectionId:'conn-A'});
 assert.equal(manager.snapshot().find(row=>row.profileId==='A').serviceStatus,'configuration_required');
 f.turn(f.owner,'用材料中心','independent',manager);
 assert((await manager.acquire(f.owner,{resourceId:'ssh:A'})).terminal?.sessionId);
 await assert.rejects(manager.resolveService(f.owner,'ssh:A'),/ssh_service_registration_required/);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},f.owner)).sessions.length,1);
 const ref={connectionId:'conn-A',profileId:'A',profileVersion:1};
 const views=await Promise.all([manager.configureService(ref),manager.configureService(ref)]);
 assert(views.every(row=>row.serviceStatus==='ready'&&row.connectionId===ref.connectionId&&row.profileVersion===ref.profileVersion));
 assert.equal(calls.filter(call=>call.ref).length,1);
 assert.equal(calls[0].ref.connectionId,'conn-A');assert.equal(calls[0].context.conversationChannel,true);
 assert.equal(calls[0].bootstrap.reuseOnly,undefined);
 assert.equal(calls[1].registered,'A');assert.equal(saved.size,1);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},f.owner)).sessions.length,1);
 assert.equal(manager.owns('configureService'),false);
 await assert.rejects(manager.configureService({...ref,connectionId:'conn-B'}),/resource_unavailable/);
});

test('hosted reuse reports manifest differences before an explicit in-place service update',async t=>{
 const f=fixture(t), ref={connectionId:'conn-A',profileId:'A',profileVersion:1}, calls=[];
 const a='a'.repeat(64),b='b'.repeat(64),hostIdentity={hostname:'fixture',uid:1000,machineId:'fixture-id'};
 const health=hash=>({name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/fixture/data',port:34567,
  runtime:'/fixture/data/runtimes/'+hash.slice(0,20),runtimeId:hash.slice(0,20),runtimeManifestSha256:hash,hostIdentity});
 const channel=(hash,id)=>({...ref,serviceId:id,status:'connected',serviceActive:true,channelKind:'private',service:health(hash)});
 let registered=health(a), observed=channel(a,'service-old');
 const registration={validateReuse(){return registered;},read(){return {status:'configured',registration:registered};},remember(_profile,result){registered=result;}};
 Object.assign(f.connections,{
  serviceState:async()=>observed,
  async closeService(data){assert.equal(data.serviceId,'service-old');calls.push('close');return observed={...ref,status:'disconnected',serviceActive:false};},
  async openService(data,bootstrap){assert.equal(data.connectionId,ref.connectionId);assert.equal(bootstrap.payload.expected_runtime_id,b.slice(0,20));
   calls.push('update');observed=channel(b,'service-new');},
  async privateServiceRequest(value){return {status:200,data:value.target==='/api/health'?observed.service:{jsonrpc:'2.0',id:value.data.id,result:{tools:[{name:'fixture'}]}}};},
 });
 const services=createManagedComputeServices({connections:f.connections,registration,prepareResources:async(_source,options)=>({payload:{port:34567,
  expected_runtime_id:options.expectedRuntimeId||b.slice(0,20),runtime_manifest_sha256:b}})});
 const manager=f.make({services});t.after(()=>manager.stop());
 await manager.publish(ref);await manager.refreshService({connectionId:ref.connectionId});
 const check=await manager.serviceStatus(ref);
 assert.deepEqual(check.runtimeComparison,{status:'different',remoteRuntimeId:a.slice(0,20),remoteManifestSha256:a,bundledRuntimeId:b.slice(0,20),bundledManifestSha256:b});
 assert.deepEqual(calls,[]);
 const request={...ref,expectedRuntimeId:a.slice(0,20),bundledRuntimeId:b.slice(0,20)};
 await assert.rejects(manager.updateService({...request,expectedRuntimeId:'c'.repeat(20)}),/changed/);
 assert.deepEqual(calls,[]);
 await manager.updateService(request);
 assert.deepEqual(calls,['close','update']);
 const updated=await manager.serviceStatus(ref);
 assert.equal(updated.health.root,check.health.root);
 assert.equal(updated.runtimeComparison.status,'current');
});

test('run mutations check exact source, active project grant, user intent and known canonical state before dispatch',async t=>{
 const dispatched=[],runStates=new Map(),f=fixture(t),held=deferred(),entered=deferred();
 let authorized=false,monitorAvailable=true,authenticated=false,approve;
 const workerBinding={kind:'ssh',root:'/fixture/worker',hostIdentity:{hostname:'fixture',uid:100,machineId:'fixture'}};
 const services={async ssh(resource){
  const id=resource.profileId,clusterId='cluster-'+id,cluster={id:clusterId,version:1,transport_kind:'ssh-service-local'};
  const health=id==='A'?{managed_run_action_schema:1,managed_submit_monitor_schema:1}:{};
  return {id:'worker-'+id,binding:workerBinding,health,async verify(){},
   async forward(method,target,data,mcp,_timeout,check){
    const observed=monitorAvailable?health:{...health,managed_submit_monitor_schema:undefined};
    check?.(observed);
    if(target==='/api/projects')return {status:200,data:[{id:'project',policy:{clusters:[clusterId]}}]};
    if(target==='/api/clusters')return {status:200,data:[cluster]};
    if(target==='/api/cluster/profile')return {status:200,data:{...cluster,service_binding:{root:workerBinding.root,...workerBinding.hostIdentity}}};
    if(target==='/api/cluster/observation')return {status:200,data:structuredClone(runStates.get(data.run_id))};
    if(target==='/api/cluster/submit'){
     assert.equal(method,'POST');assert.equal(mcp,false);
     dispatched.push({resource:id,name:'submit_cluster_run',arguments:data});
     if(data.run_id==='run-auth-A'&&!authenticated)return {status:500,data:{status:'needs_human_auth',code:'needs_human_auth',message:'Private authentication required',operation_state:'not_started'}};
     if(['run-confirmed-A','run-auth-A'].includes(data.run_id))return {status:200,data:{...runStates.get(data.run_id),status:'queued',job_id:'456'}};
     entered.resolve();await held.promise;return {status:502,data:{fixture:'lost acknowledgement'}};
    }
    if(target==='/mcp'){
     dispatched.push({resource:id,...data.params});
     assert.notEqual(data.params.name,'submit_cluster_run','Managed submissions must use the trusted worker endpoint');
     return {status:200,data:{fixture:true}};
    }
    assert.fail('Unexpected route '+target);
   }};
 }};
 const manager=f.make({services,authorizeRun:(_scope,ref)=>ref.runId.endsWith(ref.resourceId.at(-1)),authorizeRunAction:()=>authorized,
  requestRunApproval:(scope,ref,run)=>{
   if(!approve)throw Error('managed_compute_run_intent_required');
   return approve(scope,ref,run);
  }});
 t.after(()=>manager.stop());
 await Promise.all(['A','B'].map(id=>f.publish(id,'conn-'+id,manager)));
 await Promise.all(['A','B'].map(id=>manager.refreshService({connectionId:'conn-'+id})));
 f.turn(f.owner,'用材料中心和图形中心','use-both',manager);
 await Promise.all(['A','B'].map(id=>manager.acquire(f.owner,{resourceId:'ssh:'+id})));
 const mutation=(id,name,runId='run-'+id,extra)=>manager.serviceRequest(f.owner,{resourceId:'ssh:'+id,method:'POST',target:'/mcp',mcp:true,
  data:{jsonrpc:'2.0',id:'fixture',method:'tools/call',params:{name,arguments:{run_id:runId,...extra}}}});
 runStates.set('run-A',{id:'run-A',project_id:'project',cluster_id:'cluster-A',status:'draft'});
 await assert.rejects(mutation('A','submit_cluster_run'),/run_intent_required/);
 authorized=true;
 await assert.rejects(mutation('B','submit_cluster_run','run-A'),/run_source_changed/);
 await assert.rejects(mutation('B','submit_cluster_run'),/worker_update_required/);
 await assert.rejects(mutation('A','submit_cluster_run','run-A',{managed_monitor:{sourceId:'worker-B'}}),/invalid_request/);
 runStates.get('run-A').status='unknown';
 await assert.rejects(mutation('A','validate_cluster_run'),/state_unconfirmed/);
 await assert.rejects(mutation('A','cancel_cluster_run'),/state_unconfirmed/);
 await assert.rejects(mutation('B','cancel_cluster_run'),/worker_update_required/);
 runStates.get('run-A').status='draft';
 assert.equal((await mutation('A','validate_cluster_run')).status,200);
 monitorAvailable=false;
 await assert.rejects(mutation('A','submit_cluster_run'),/worker_update_required/);
 monitorAvailable=true;
 const first=mutation('A','submit_cluster_run');
 await Promise.race([first,entered.promise]);
 await assert.rejects(mutation('A','submit_cluster_run'),/run_busy/);
 held.resolve();assert.equal((await first).status,502);
 await assert.rejects(mutation('A','submit_cluster_run'),/action_unconfirmed/);
 runStates.get('run-A').status='running';runStates.get('run-A').job_id='123';
 assert.equal((await mutation('A','cancel_cluster_run')).status,200);
 runStates.set('run-confirmed-A',{id:'run-confirmed-A',project_id:'project',cluster_id:'cluster-A',status:'ready'});
 const confirmed=await mutation('A','submit_cluster_run','run-confirmed-A');
 assert.deepEqual(confirmed,{status:200,data:{jsonrpc:'2.0',id:'fixture',result:{isError:false,content:[{type:'text',text:JSON.stringify({...runStates.get('run-confirmed-A'),status:'queued',job_id:'456'})}]}}});
 runStates.set('run-auth-A',{id:'run-auth-A',project_id:'project',cluster_id:'cluster-A',status:'ready'});
 assert.equal((await mutation('A','submit_cluster_run','run-auth-A')).data.operation_state,'not_started');
 assert.equal(runStates.get('run-auth-A').status,'ready');
 authenticated=true;assert.equal((await mutation('A','submit_cluster_run','run-auth-A')).status,200);
 assert.deepEqual(dispatched.filter(item=>item.name==='submit_cluster_run').map(item=>item.arguments),['run-A','run-confirmed-A','run-auth-A','run-auth-A'].map(runId=>({run_id:runId,
  managed_monitor:{schemaVersion:1,sourceId:'worker-A',scope:{provider:f.owner.provider,threadId:f.owner.threadId,taskId:f.owner.taskId,projectId:f.owner.projectId,runId}}})));
 assert.deepEqual(dispatched.map(({resource,name,arguments:args})=>[resource,name,args.require_known??false]),
  [['A','validate_cluster_run',false],['A','submit_cluster_run',false],['A','cancel_cluster_run',true],['A','submit_cluster_run',false],['A','submit_cluster_run',false],['A','submit_cluster_run',false]]);
 const waiting=deferred(),answer=deferred();
 const run={id:'run-approval-A',project_id:'project',cluster_id:'cluster-A',status:'draft',script:'original'};
 runStates.set(run.id,run);authorized=false;
 approve=(scope,ref,observed)=>{waiting.resolve({scope,ref,observed});return answer.promise;};
 const rejected=assert.rejects(mutation('A','validate_cluster_run',run.id),/state_unconfirmed/);
 const request=await waiting.promise;
 assert.equal(request.scope.threadId,f.owner.threadId);assert.equal(request.ref.sourceId,'worker-A');assert.deepEqual(request.observed,run);
 assert.equal(dispatched.length,6);
 run.script='changed';answer.resolve(()=>true);await rejected;
 assert.equal(dispatched.length,6);
 approve=()=>()=>true;
 assert.equal((await mutation('A','validate_cluster_run',run.id)).status,200);
 assert.equal(dispatched.at(-1).arguments.run_id,run.id);
});
test('a saved display name containing example remains selectable in a concrete queue request',()=>{
 assert.equal(requestsComputeName('查示例甲的队列','示例甲'),true);
 assert.equal(requestsComputeName('不要查示例甲的队列','示例甲'),false);
 assert.equal(requestsComputeName('如果查看示例甲的队列','示例甲'),false);
 assert.equal(requestsComputeName('check queues on example','example'),true);
});

test('configureService repairs maintenance_required or broken cache on matching host and refuses host mismatch',async t=>{
 const entries=new Map();
 const catalog={
  get:(kind,id)=>entries.get(kind+'\0'+id),
  put:(kind,id,value)=>entries.set(kind+'\0'+id,structuredClone(value)),
  remove:(kind,id)=>entries.delete(kind+'\0'+id),
  list:kind=>[...entries.entries()].filter(([key])=>key.startsWith(kind+'\0')).map(([,value])=>structuredClone(value)),
  transaction:fn=>fn(),
 };
 const hostIdentity={hostname:'remote-A',uid:1001,machineId:'machine-A'};
 const oldRuntimeId='a'.repeat(20),repairedRuntimeId='b'.repeat(20),cacheRepairedRuntimeId='c'.repeat(20);
 const manifestFor=runtimeId=>runtimeId+'0'.repeat(44);
 const base={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/A',port:21065,runtime:'/owned/A/runtimes/'+oldRuntimeId,runtimeId:oldRuntimeId,runtimeManifestSha256:manifestFor(oldRuntimeId),hostIdentity,managed_schedule_schema:1};
 let setup={status:'maintenance_required',reason:'runtime_missing',registration:{...base,hostIdentity:{hostname:'other-host',uid:1001,machineId:'machine-other'}}};
 let nextBundledId=repairedRuntimeId,failReuseError=null,healthBroken=false;
 let state={connectionId:'conn-A',profileId:'A',profileVersion:1,status:'idle',serviceActive:false};
 const opens=[];
 const registration={
  read:()=>structuredClone(setup),
  validateReuse(_profile,observed){
   if(setup.status==='maintenance_required')throw Error('ssh_service_maintenance_required');
   if(observed&&observed.runtimeId!==setup.registration.runtimeId)throw Error('managed_compute_service_changed');
   return structuredClone(setup.registration);
  },
  remember(profile,health){
   setup={status:'configured',registration:{...health,configuredAtProfileVersion:profile.version}};
  },
 };
 const f=fixture(t,{selectionCatalog:catalog});
 const account=f.stored.get('A').username;
 const resourceWorkspace={
  assertHandoff:async()=>({workspaceId:'2'.repeat(64),resourceId:'1'.repeat(64),root:'/owned/A',account,hostIdentity}),
  publicWorkspace:row=>({workspaceId:row.workspaceId,root:row.root}),
 };
 Object.assign(f.connections,{
  serviceState:async()=>state,
  async openService(ref,data){
   opens.push({ref,reuseOnly:Boolean(data.reuseOnly),port:data.port});
   if(data.reuseOnly){
    const code=failReuseError||'worker_start_failed';
    throw Error(code);
   }
   const runtimeId=nextBundledId;
   const service={...base,runtime:'/owned/A/runtimes/'+runtimeId,runtimeId,runtimeManifestSha256:manifestFor(runtimeId),port:data.port||base.port};
   healthBroken=false;
   state={connectionId:ref.connectionId,profileId:ref.profileId,profileVersion:ref.profileVersion,serviceId:'service-'+runtimeId.slice(0,4),status:'connected',serviceActive:true,channelKind:'private',service};
   return state;
  },
  async privateServiceRequest(packet){
   if(packet.target==='/api/health'){
    if(healthBroken)throw Error('worker_cache_invalid');
    return {status:200,data:state.service};
   }
   if(packet.target==='/mcp')return {status:200,data:{id:packet.data.id,result:{tools:[{name:'list_runs'}]}}};
   if(packet.target==='/api/projects')return {status:200,data:[]};
   return {status:200,data:[]};
  },
 });
 const services=createManagedComputeServices({connections:f.connections,registration,source:'fixture',transportSource:'fixture',
  prepareResources:async(_source,value)=>({payload:{expected_runtime_id:nextBundledId,port:value?.port??base.port,runtime_manifest_sha256:manifestFor(nextBundledId)}})});
 const manager=f.make({services,serviceRegistration:registration,resourceWorkspace});
 t.after(()=>manager.stop());

 await f.publish('A','conn-A',manager);
 for(let i=0;i<10&&manager.snapshot()[0]?.serviceStatus==='preparing';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(manager.snapshot()[0].serviceStatus,'configuration_required');
 await assert.rejects(manager.configureService({connectionId:'conn-A',profileId:'A',profileVersion:1}),/ssh_service_registration_identity_changed/);
 assert.equal(manager.snapshot()[0].serviceStatus,'configuration_required');

 setup={status:'maintenance_required',reason:'runtime_missing',registration:structuredClone(base)};
 const repaired=await manager.configureService({connectionId:'conn-A',profileId:'A',profileVersion:1});
 assert.equal(repaired.serviceStatus,'ready');
 assert.equal(opens.at(-1).reuseOnly,false);
 assert(catalog.list('managed-ssh-runtime-history').some(row=>row.profileId==='A'));

 nextBundledId=cacheRepairedRuntimeId;
 failReuseError='worker_cache_invalid';
 healthBroken=true;
 state={connectionId:'conn-A',profileId:'A',profileVersion:1,status:'failed',serviceActive:false,error:{code:'worker_cache_invalid'}};
 assert.equal(await manager.refreshService({connectionId:'conn-A'}),null);
 assert.equal(manager.snapshot()[0].serviceStatus,'unavailable');
 const repairedCache=await manager.configureService({connectionId:'conn-A',profileId:'A',profileVersion:1});
 assert.equal(repairedCache.serviceStatus,'ready');
 assert.equal(opens.at(-1).reuseOnly,false);

 assert.notEqual(catalog.get('managed-ssh-hosting','A'),undefined);
 Object.assign(f.states.get('conn-A'),{status:'closed',authentication:'lost',closed:true});
 await manager.sweep();
 assert.equal(manager.snapshot().some(item=>item.profileId==='A'),false);
 assert.notEqual(catalog.get('managed-ssh-hosting','A'),undefined);
 manager.forgetProfile('A');
 assert.equal(catalog.get('managed-ssh-hosting','A'),undefined);
 assert.equal(manager.consoleEntries().entries.some(item=>item.profileId==='A'),false);
});
