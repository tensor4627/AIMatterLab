import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceWorkspace} from '../../backend/main/workspace/resource-workspace.mjs';
import {assertWorkerRoute,assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';
import {classifyWorkspaceCommand,createWorkspaceTerminalAuthorization} from '../../backend/main/compute/workspace-terminal-authorization.mjs';

const ref={connectionId:'connection',profileId:'profile',profileVersion:1};
const host={hostname:'login1',uid:1000,machineId:'machine'};
const scope={provider:'codex',threadId:'conversation',checkCurrent:()=>true};
const realDate=new Date(2026,10,20,23,59).getTime();

test('remote workspace registration and allocation use the typed desktop channel',()=>{
 for(const operation of ['register','session','allocate']){
  const route='/api/resource-workspace/'+operation;
  assert.doesNotThrow(()=>assertWorkerRoute('POST',route));
  assert.throws(()=>assertRendererWorkerRoute('POST',route),/typed resource workspace/);
 }
});

function fixture(){
 const rows=new Map(), calls=[], profile={kind:'ssh',id:ref.profileId,version:ref.profileVersion,name:'Cluster',host:'cluster.example',username:'user1',port:22};
 let identity={...host,account:'user1'}, current={provider:scope.provider,threadId:scope.threadId}, epoch=0, date=realDate, online=true;
 const ready=new Set();
 const catalog={get:(kind,id)=>rows.get(kind+':'+id),put:(kind,id,value)=>rows.set(kind+':'+id,value),list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([key,value])=>({id:key.slice(kind.length+1),...value}))};
 const worker={identity:{kind:'ssh',profileId:ref.profileId,hostIdentity:host},connection:{}, async request(method,route,args){
  calls.push({method,route,args});
  if(!online)throw Error('offline');
  if(route.endsWith('/register'))return {id:args.workspace_id,...args};
  if(route.endsWith('/allocate')){
   const saved=catalog.get('resource-workspace-registration',args.workspace_id);
   worker.receipt={...args,root:saved.root,path:saved.root+'/workfile/'+args.date+'/task-1',task_number:1,checked_at:realDate};
  }
  return worker.receipt;
 }};
 const workspace=createResourceWorkspace({catalog,profiles:{read:()=>({...profile})},connections:{async workspace(value){
  calls.push(value);
  const root=value.directory||'/home/user1/AIMatterLab';
  if(value.mode==='confirm'){
   assert.deepEqual(value.expected,identity);
   ready.add(root);
  }
  return {root,identity:{...identity},home:'/home/user1',ready:ready.has(root)};
 }},worker,resource:{capture:()=>epoch,assertCurrent:value=>{if(epoch!==value)throw Error('selection changed');},peek:()=>ref},current:()=>current,now:()=>date});
 return {workspace,calls,profile,changeOwner:()=>epoch++,changeAccount:()=>{identity={...identity,account:'user2'};},tomorrow:()=>date+=120000,offline:()=>{online=false;},online:()=>{online=true;}};
}

test('confirmed workspace is the only handoff path; cancellation, account change and selection change fence it',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.workspace.assertHandoff(ref),/confirmation_required/);
 const preview=await f.workspace.preview(ref);
 assert.equal(preview.status,'confirmation_required');
 assert.deepEqual(preview.directories,['/home/user1/AIMatterLab/workfile','/home/user1/AIMatterLab/software']);
 assert.deepEqual(f.workspace.cancel({...ref,confirmationId:preview.confirmationId}),{cancelled:true});
 await assert.rejects(()=>f.workspace.confirm({...ref,confirmationId:preview.confirmationId}),/changed/);
 assert.equal(f.calls.filter(row=>row.mode==='confirm').length,0);
 const current=await f.workspace.preview({...ref,directory:'/projects/team/user1'});
 await f.workspace.confirm({...ref,confirmationId:current.confirmationId});
 const saved=await f.workspace.assertHandoff(ref);
 assert.equal(saved.root,'/projects/team/user1');
 assert.equal((await f.workspace.preview(ref)).status,'confirmed');
 f.changeAccount();
 const changed=await f.workspace.preview(ref);
 assert.equal(changed.status,'confirmation_required');
 assert.equal(changed.account,'user2');
 f.changeOwner();
 await assert.rejects(()=>f.workspace.confirm({...ref,confirmationId:changed.confirmationId}),/selection changed/);
});

test('allocation starts only on execution and keeps first path and local date after a root change or lost response',async()=>{
 const f=fixture(), initial=await f.workspace.preview(ref);
 await f.workspace.confirm({...ref,confirmationId:initial.confirmationId});
 assert.deepEqual(await f.workspace.forSession({}),{status:'unassigned'});
 f.offline();
 await assert.rejects(()=>f.workspace.forExecution({task:scope,requestId:'first'}),/offline/);
 f.online();f.tomorrow();
 const newRoot=await f.workspace.preview({...ref,directory:'/other/workspace'});
 await f.workspace.confirm({...ref,confirmationId:newRoot.confirmationId});
 const receipt=await f.workspace.forExecution({task:scope,requestId:'first'});
 assert.equal(receipt.path,initial.root+'/workfile/2026-11-20/task-1');
 assert.equal((await f.workspace.forSession({})).status,'verified');
 f.offline();
 assert.equal((await f.workspace.forSession({})).status,'last_confirmed');
});

test('drafting finds the existing session directory and a later workflow reuses it',async()=>{
 const f=fixture(), initial=await f.workspace.preview(ref);
 await f.workspace.confirm({...ref,confirmationId:initial.confirmationId});
 const first=await f.workspace.forExecution({task:{...scope,id:'first-workflow'},requestId:'first'});
 f.tomorrow();
 const planning={...scope,taskId:'later-workflow',projectId:'existing-project'};
 const find=await f.workspace.callSessionTool({profile_id:ref.profileId},planning);
 assert.equal(find.path,initial.root+'/workfile/2026-11-20/task-1');
 assert.equal(find.path,first.path);
 assert.equal(f.workspace.knownForExecution(planning).path,first.path);
 assert.equal(f.workspace.forTerminal(ref,planning).path,first.path);
 assert.equal(f.calls.filter(({route})=>route?.endsWith('/allocate')).length,1);
 await assert.rejects(f.workspace.callSessionTool({profile_id:ref.profileId},{...planning,checkCurrent:()=>false}),/workspace_changed/);
 const next=await f.workspace.forExecution({task:{...scope,id:planning.taskId},requestId:'later'});
 assert.equal(next.path,first.path);
 assert.equal(next.workspace_id,first.workspace_id);
});

test('read-only preinstalled binaries and workspace effects classify by destination',()=>{
 assert.equal(classifyWorkspaceCommand('/usr/bin/squeue -u user1','/work','/work').mode,'read');
 assert.equal(classifyWorkspaceCommand('cp /project/input.xyz "results/my input.xyz"','/work','/work').mode,'copy');
 assert.equal(classifyWorkspaceCommand('cp ./input.xyz /other/input.xyz','/work','/work').mode,'copy_target');
 assert.equal(classifyWorkspaceCommand('cp input.xyz /work/input.xyz','/work','/project').mode,'copy_target');
 assert.equal(classifyWorkspaceCommand('cd /shared','/work','/work').mode,'cwd');
 assert.equal(classifyWorkspaceCommand('find /shared -type f -name "*.xyz" | head -n 20','/work','/shared').mode,'read_pipeline');
 assert.equal(classifyWorkspaceCommand('find /shared -delete','/work','/work').reason,'destructive');
 assert.notEqual(classifyWorkspaceCommand('find /shared -fprint results.txt','/work','/work').mode,'read');
 assert.notEqual(classifyWorkspaceCommand('find /shared -exec mkdir {} \\; | head','/work','/work').mode,'read_pipeline');
 assert.notEqual(classifyWorkspaceCommand('file -C -m /shared/types','/work','/work').mode,'read');
 assert.equal(classifyWorkspaceCommand('python3 script.py','/work','/shared').reason,'outside_workspace');
 assert.equal(classifyWorkspaceCommand('/opt/tool/bin/program data.xyz','/work','/work').reason,'unverified_effects');
 assert.equal(classifyWorkspaceCommand('rm results.txt','/work','/work').reason,'destructive');
 assert.deepEqual(classifyWorkspaceCommand("cat > sbatch.sh <<'EOF'\n#!/bin/sh\necho ready\nEOF",'/work','/work').args,['sbatch.sh','#!/bin/sh\necho ready\n']);
});

test('outside navigation and bounded inspection preserve ordinary access while copies require a canonical destination receipt',async()=>{
 let review, pendingConfirmations=0;const calls=[];
 const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>({workspaceId:'w',root:'/work',path:'/work',identity:{...host,account:'user1'}})},
  connections:{async runWorkspaceCommand(value,guard){
   guard();calls.push(value);
   if(value.mode==='cwd')return {status:'result',code:0,output:'/shared\n'};
   if(value.mode==='read_pipeline')return {status:'result',code:0,output:'source.xyz\n'};
   if(value.mode==='copy_target')return value.args[1]==='/elsewhere/output.xyz'?{status:'outside',code:1,output:'/elsewhere/output.xyz\n'}:
      {status:'result',code:0,output:'/shared/source.xyz\n/work/new.xyz\n'};
   if(value.mode==='copy'){assert.deepEqual(value.args,['/shared/source.xyz','/work/new.xyz']);return {status:'result',code:0,output:''};}
   assert.fail('Unauthorized command dispatch');
  }},current:()=>scope,emit:()=>{pendingConfirmations++;review?.();}});
 let request=0;
 const send=async command=>{
  const run=data=>controller.input({scope,ref:{...ref,resourceName:'Cluster'},sessionId:'shell',ownerEpoch:1,input:{data,requestId:String(++request)},assertCurrent:()=>{}});
  await run(command);return run('\r');
 };
 assert.equal((await send('cd /shared')).cwd,'/shared');
 assert.equal((await send('find . -name "*.xyz" | head -n 3')).output,'source.xyz\n');
 assert.equal((await send('cp source.xyz /shared/project-link/new.xyz')).execution_status,'completed');
 assert.deepEqual(calls.map(value=>value.mode),['cwd','read_pipeline','copy_target','copy']);
 assert.equal(pendingConfirmations,0);
 const displayed=new Promise(resolve=>{review=resolve;});
 const denied=send('cp source.xyz /elsewhere/output.xyz');await displayed;
 assert.equal(controller.pending({}).reason,'outside_workspace');
 assert.deepEqual(controller.pending({}).paths,['/elsewhere/output.xyz']);
 controller.decide({approvalId:controller.pending({}).approvalId,decision:'deny'});
 assert.equal((await denied).execution_status,'denied');
 assert.deepEqual(calls.map(value=>value.mode),['cwd','read_pipeline','copy_target','copy','copy_target']);
});

test('both terminal callers can wait for exact protected approval, denying or revoking without dispatch',async()=>{
 const calls=[];
 let revision=0, valid=true, review;
 const requests=()=>new Promise(resolve=>{review=resolve;});
 const workspace={forTerminal:()=>({workspaceId:'w',root:'/work',path:'/work/day/task-1',identity:{...host,account:'user1'}})};
 const controller=createWorkspaceTerminalAuthorization({workspace,connections:{async runWorkspaceCommand(value){calls.push(value);return {status:'result',code:0,output:'done'};}},
  current:()=>({provider:scope.provider,threadId:scope.threadId,revision}),emit:()=>review?.()});
 const send=(data,requestId)=>controller.input({scope,ref:{...ref,resourceName:'Cluster'},sessionId:'shell',ownerEpoch:1,input:{data,requestId},assertCurrent:()=>{if(!valid)throw Error('expired lease');}});
 await send('rm external.dat','type');
 assert.equal(calls.length,0);
 const requested=requests(),enter=send('\r','enter');await requested;
 const pending=controller.pending({});
 assert.equal(pending.reason,'destructive');
 assert.deepEqual(pending.commands,['rm external.dat']);
 assert.deepEqual(controller.decide({approvalId:pending.approvalId,decision:'deny'}),{status:'denied'});
 assert.equal((await enter).execution_status,'denied');assert.equal(calls.length,0);

 await send('mkdir /elsewhere','type2');
 const second=requests(),queued=send('\r','enter2');await second;
 const changed=controller.pending({});valid=false;revision++;
 assert.throws(()=>controller.decide({approvalId:changed.approvalId,decision:'approve'}),/changed/);
 assert.equal((await queued).execution_status,'denied');assert.equal(calls.length,0);

 valid=true;
 await send('mkdir /elsewhere','type3');
 const third=requests(),approved=send('\r','enter3');await third;
 assert.deepEqual(controller.decide({approvalId:controller.pending({}).approvalId,decision:'approve'}),{status:'approved'});
 assert.equal((await approved).execution_status,'completed');
 assert.equal((await send('\r','enter3')).execution_status,'completed');
 assert.equal(calls.length,1);assert.equal(calls[0].cwd,'/work/day/task-1');
});

test('one review freezes all opaque steps on a host without a sandbox; usable confinement runs without prompting',async()=>{
 let supported=false, opened, steps=[];
 const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>({workspaceId:'w',root:'/work',path:'/work',identity:{...host,account:'user1'}})},
  connections:{async runWorkspaceCommand(value,guard){
   guard();steps.push(value);
   if(value.mode==='confined')return supported?{status:'result',code:0,output:'created',confinement:'landlock'}:{status:'unavailable',code:125,output:'host'};
   return {status:'result',code:0,output:'created'};
  }},current:()=>scope,emit:()=>opened?.()});
 const send=(data,requestId)=>controller.input({scope,ref:{...ref,resourceName:'Cluster'},sessionId:'shell',ownerEpoch:1,input:{data,requestId},assertCurrent:()=>{}});
 const grouped='python3 prepare.py\npython3 analyze.py';
 await send(grouped,'prepare');
 const review=new Promise(resolve=>{opened=resolve;});
 const command=send('\r','execute');
 await review;
 assert.deepEqual(steps.map(step=>step.mode),['confined']);
 const pending=controller.pending({});
 assert.deepEqual(pending.commands,[grouped]);
 controller.decide({approvalId:pending.approvalId,decision:'approve'});
 assert.equal((await command).execution_status,'completed');
 assert.deepEqual(steps.map(step=>[step.mode,step.args]),[['confined',[grouped]],['approved',[grouped]]]);
 supported=true;
 await send('python3 work.py','stage2');
 assert.equal((await send('\r','execute2')).confinement,'landlock');
 assert.equal(controller.pending({}),null);
});
