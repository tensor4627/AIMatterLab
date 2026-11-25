import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceWorkspace} from '../../backend/main/workspace/resource-workspace.mjs';
import {assertWorkerRoute,assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';
import {classifyWorkspaceCommand,createWorkspaceTerminalAuthorization} from '../../backend/main/compute/workspace-terminal-authorization.mjs';
import {developerComputeAccess} from '../../backend/main/compute/developer-compute-access.mjs';

const ref={connectionId:'connection',profileId:'profile',profileVersion:1};
const host={hostname:'login1',uid:1000,machineId:'machine'};
const scope={provider:'codex',threadId:'conversation',checkCurrent:()=>true};
const realDate=new Date(2026,10,20,23,59).getTime();

test('developer workspace commands keep outside writes behind a human decision and stop after revocation',async()=>{
 const workspaceId='a'.repeat(64),calls=[];
 let chosen=workspaceId,review;
 const developer=developerComputeAccess({workspaceId:()=>chosen,userTurn:()=>true});
 const workspace={forTerminal:()=>({workspaceId,root:'/work',path:'/work/day/task-1',identity:{...host,account:'user1'}})};
 const controller=createWorkspaceTerminalAuthorization({workspace,developerCompute:developer,current:()=>scope,emit:()=>review?.(),
  connections:{async runWorkspaceCommand(value,guard){
   guard();calls.push(value.mode);
   if(value.mode==='confined')return {status:'result',code:0,output:'ok',confinement:'landlock'};
   if(value.mode==='job_preview')return {status:'result',code:0,output:'/work/day/task-1/test.sh\n'+'b'.repeat(64)+'\n#!/bin/sh\n#SBATCH --time=1\necho fixture'};
   if(value.mode==='job')return {status:'result',code:0,output:'101'};
   assert.fail('Unexpected dispatch');
  }}});
 let seq=0;
 const batch=async command=>{
  const send=data=>controller.input({scope,ref,sessionId:'session',ownerEpoch:1,input:{requestId:String(++seq),data},assertCurrent(){}});
  await send(command);return send('\r');
 };
 assert.equal((await batch('rm result.tmp')).confinement,'landlock');
 assert.equal((await batch('sbatch test.sh')).job_id,'101');
 const prompted=new Promise(resolve=>{review=resolve;});
 const outside=batch('mkdir /other/tmp');await prompted;
 const approval=controller.pending({});assert.equal(approval.reason,'outside_workspace');
 chosen=null;developer.changed(workspaceId,null);
 controller.revalidatePending();
 assert.equal(controller.pending({}),null);
 assert.throws(()=>controller.decide({approvalId:approval.approvalId,decision:'approve'}),/changed/);
 assert.equal((await outside).execution_status,'denied');
 assert.deepEqual(calls,['confined','job_preview','job']);
});

test('automatic approval replaces an exact workspace file but reviews destructive commands and independent jobs',async()=>{
 const files={root:'/work',path:'/work',workspaceId:'workspace',identity:{...host,account:'user1'}};
 const calls=[];
 let opened;
 const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>files},current:()=>scope,
  developerCompute:{approvalMode:()=> 'auto',revision:()=>0},emit:()=>opened?.(),
  connections:{async runWorkspaceCommand(value,guard){
   guard();calls.push([value.mode,value.args]);
   if(value.mode==='write')return {status:'destructive',code:1,output:'/work/draft*\n'};
   if(value.mode==='confined_overwrite')return {status:'result',code:0,output:'',confinement:'landlock'};
   if(value.mode==='job_preview')return {status:'result',code:0,output:'/work/job.sh\n'+'b'.repeat(64)+'\n#!/bin/sh\necho fixture'};
   assert.fail('Unexpected dispatch');
  }}});
 const run=(requestId,command)=>controller.execute({scope,ref:{...ref,resourceId:'remote'},leaseId:'lease',requestId,command,assertCurrent(){}});
 const content="value with 'quotes' and $variable";
 assert.equal((await run('write',"cat > 'draft*' <<'EOF'\n"+content+'\nEOF')).confinement,'landlock');
 assert.equal(controller.pending({}),null);
 assert.deepEqual(calls,[['write',['draft*',content+'\n']],['confined_overwrite',['/work/draft*','write',content+'\n']]]);

 for(const [requestId,command,reason] of [['remove','rm draft','destructive'],['submit','sbatch job.sh','independent_job']]){
  const shown=new Promise(resolve=>{opened=resolve;});
  const pending=run(requestId,command);
  await shown;
  const card=controller.pending({});
  assert.equal(card.reason,reason);
  controller.decide({approvalId:card.approvalId,decision:'deny'});
  assert.equal((await pending).execution_status,'denied');
 }
 assert.deepEqual(calls.map(([mode])=>mode),['write','confined_overwrite','job_preview']);
});

test('a lost SSH write receipt stays unknown and a verified pre-dispatch refusal clears its reservation',async()=>{
 const rows=new Map(),guard=()=>{},files={root:'/work',path:'/work',workspaceId:'workspace',identity:{...host,account:'user1'}};
 const catalog={get:(_kind,id)=>rows.get(id),put:(_kind,id,value)=>rows.set(id,value),remove:(_kind,id)=>rows.delete(id)};
 let calls=0,dispatched=false;
 const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>files},current:()=>scope,catalog,
  connections:{async runWorkspaceCommand(){calls++;throw Object.assign(Error('ssh_control_timeout'),{operationDispatched:dispatched});}}});
 const execute=commands=>commands.execute({scope,ref:{...ref,resourceId:'remote'},leaseId:'lease',requestId:'request',command:'mkdir result',assertCurrent:guard});
 await assert.rejects(execute(controller),{operationDispatched:false});
 assert.equal(rows.size,0);
 dispatched=true;
 await assert.rejects(execute(controller),{operationDispatched:true});
 assert.equal(rows.size,1);
 const reopened=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>files},current:()=>scope,catalog,
  connections:{async runWorkspaceCommand(){assert.fail('unconfirmed command was replayed');}}});
 assert.equal((await execute(reopened)).execution_status,'unconfirmed');
 assert.equal(calls,2);
});

test('an automatic overwrite or submission cannot dispatch after the human turn ends',async()=>{
 const files={root:'/work',path:'/work',workspaceId:'workspace',identity:{...host,account:'user1'}};
 for(const [mode,command,probe] of [['auto',"cat > draft <<'EOF'\nnew\nEOF",'write'],['full','sbatch job.sh','job_preview']]){
  let live=true;
  const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>files},current:()=>scope,
   developerCompute:{approvalMode:()=>live?mode:'manual',revision:()=>0},
   connections:{async runWorkspaceCommand(value){
    assert.equal(value.mode,probe);
    live=false;
    return probe==='write'?{status:'destructive',code:1,output:'/work/draft\n'}:
     {status:'result',code:0,output:'/work/job.sh\n'+'b'.repeat(64)+'\n#!/bin/sh\necho fixture'};
   }}});
  await assert.rejects(controller.execute({scope,ref:{...ref,resourceId:'remote'},leaseId:'lease',requestId:'request',command,assertCurrent(){}}),error=>error.message==='ssh_terminal_approval_changed'&&error.operationNotStarted===true);
 }
});

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
 const declined=await enter;
 assert.equal(declined.execution_status,'denied');assert.equal(declined.approval_status,'denied');assert.equal(calls.length,0);

 await send('mkdir /elsewhere','type2');
 const second=requests(),queued=send('\r','enter2');await second;
 const changed=controller.pending({});valid=false;revision++;
 assert.throws(()=>controller.decide({approvalId:changed.approvalId,decision:'approve'}),/changed/);
 const invalidated=await queued;
 assert.equal(invalidated.execution_status,'denied');assert.equal(invalidated.approval_status,'changed');assert.equal(calls.length,0);

 valid=true;
 await send('mkdir /elsewhere','type3');
 const third=requests(),approved=send('\r','enter3');await third;
 assert.deepEqual(controller.decide({approvalId:controller.pending({}).approvalId,decision:'approve'}),{status:'approved'});
 assert.equal((await approved).execution_status,'completed');
 assert.equal((await send('\r','enter3')).execution_status,'completed');
 assert.equal(calls.length,1);assert.equal(calls[0].cwd,'/work/day/task-1');
});

test('discarding diagnostics uses confinement; a timed-out review preserves the original outcome',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const command='for file in ./one ./two; do wc -c "$file" 2>/dev/null; done';
 assert.equal(classifyWorkspaceCommand(command,'/work','/work').reason,'unverified_effects');
 const workspace={forTerminal:()=>({workspaceId:'w',root:'/work',path:'/work',identity:{...host,account:'user1'}})};
 const stored=new Map(), calls=[];
 const catalog={get:(kind,id)=>stored.get(kind+id),put:(kind,id,row)=>stored.set(kind+id,row)};
 let supported=true, notify;
 const create=()=>createWorkspaceTerminalAuthorization({workspace,catalog,current:()=>scope,emit:()=>notify?.(),
  connections:{async runWorkspaceCommand(value){
   calls.push(value.mode);assert.equal(value.mode,'confined');
   return supported?{status:'result',code:0,output:'sizes',confinement:'landlock'}:{status:'unavailable',code:125,output:''};
  }}});
 const request=(requestId)=>({scope,ref:{...ref,resourceId:'remote',resourceName:'Cluster'},leaseId:'lease',requestId,command,assertCurrent(){}});
 const controller=create(),first=await controller.execute(request('read'));
 assert.equal(first.execution_status,'completed');assert.equal(first.output,'sizes');
 assert.equal(controller.pending({}),null);
 for(const redirect of ['2>/elsewhere/errors','2>/dev/null.log','2>/dev/null > /elsewhere/report']){
  assert.equal(classifyWorkspaceCommand('wc -c ./one '+redirect,'/work','/work').reason,'outside_workspace');
 }
 assert.equal(classifyWorkspaceCommand('cd /dev/null && pwd','/work','/work').reason,'outside_workspace');
 supported=false;
 const shown=new Promise(resolve=>{notify=resolve});
 const pending=controller.execute(request('review'));await shown;
 const card=controller.pending({});assert.equal(card.reason,'unverified_effects');
 t.mock.timers.tick(card.expiresAt-Date.now());
 const timedOut=await pending;
 assert.equal(timedOut.accepted,false);assert.equal(timedOut.execution_status,'denied');assert.equal(timedOut.approval_status,'expired');
 assert.equal(controller.pending({}),null);
 const original=await create().execute(request('review'));
 assert.equal(original.replayed,true);assert.equal(original.approval_status,'expired');
 assert.deepEqual(calls,['confined','confined']);
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

test('forget clears staged terminal input and settles any pending workspace approval for that conversation',async()=>{
 let opened;
 const controller=createWorkspaceTerminalAuthorization({workspace:{forTerminal:()=>({workspaceId:'w',root:'/work',path:'/work',identity:{...host,account:'user1'}})},
  connections:{async runWorkspaceCommand(){return {status:'unavailable',code:125,output:'host'};}},current:()=>scope,emit:()=>opened?.()});
 const send=(data,requestId)=>controller.input({scope,ref:{...ref,resourceName:'Cluster'},sessionId:'shell',ownerEpoch:1,input:{data,requestId},assertCurrent:()=>{}});
 await send('python3 dangerous.py','stage-1');
 const review=new Promise(resolve=>{opened=resolve;});
 const pendingCommand=send('\r','exec-1');
 await review;
 assert.notEqual(controller.pending({}),null);
 controller.forget(scope.provider,scope.threadId);
 const settled=await pendingCommand;
 assert.equal(settled.accepted,false);
 assert.equal(settled.approval_status,'changed');
 assert.equal(controller.pending({}),null);
});
