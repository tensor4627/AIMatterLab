// Explicit opt-in acceptance. One native and one WSL SSH master, two test servers, three leased PTYs.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {createInterface} from 'node:readline';
import pty from '@lydell/node-pty';
import {createSshConnections,createMultiplexHost} from '../desktop/platform/terminal-service/ssh-connection.mjs';
import {createManagedWorkbench} from '../desktop/platform/managed-workbench.mjs';
import {createConversationActivity} from '../backend/main/compute/conversation-activity.mjs';
import {managedProjectAccess} from '../backend/main/compute/managed-project-access.mjs';
import {createSshServiceRegistration} from '../backend/main/compute/ssh-service-registration.mjs';

if(process.platform!=='win32')throw Error('Run this check on the Windows desktop with a WSL distribution');
const options=process.argv.slice(2),withServices=options.includes('--services');
const [distribution,server,library]=options.filter(value=>value!=='--services');
if(!distribution)throw Error('Supply the local WSL test distribution and optionally an isolated sshd binary and its library directory');
const temp=await mkdtemp(path.join(os.tmpdir(),'aimatter-managed-'));
const windowsKey=path.join(temp,'client'),nativeHosts=path.join(temp,'known_hosts');
const programs=path.join(process.env.SystemRoot,'System32','OpenSSH');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let fixture,reader,lines,resourceDirectory;
const managers=[];
try {
  execFileSync(path.join(programs,'ssh-keygen.exe'),['-q','-t','ed25519','-N','','-f',windowsKey],{windowsHide:true});
  const location=path.resolve('tests/fixtures/managed-ssh-server.py');
  const linuxPath=file=>'/mnt/'+file[0].toLowerCase()+'/'+file.slice(3).replaceAll('\\','/');
  fixture=spawn('wsl.exe',['-d',distribution,'--exec','/usr/bin/python3','-B',linuxPath(location)],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  reader=createInterface({input:fixture.stdout});lines=reader[Symbol.asyncIterator]();
  fixture.stdin.write(JSON.stringify({publicKey:await readFile(windowsKey+'.pub','utf8'),server,library,...withServices?{workerSource:linuxPath(path.resolve('backend/worker'))}:{}})+'\n');
  const first=await lines.next();assert(!first.done,'SSH fixture stopped before reporting its endpoints');
  const {targets,identity,known,local}=JSON.parse(first.value);
  await writeFile(nativeHosts,targets.map(t=>t.known).join(''),{mode:0o600});
  // WSL's Windows localhost relay can appear after sshd's Linux socket is already ready.
  let reachable=false;
  for(let attempt=0;attempt<40&&!reachable;attempt++){
    reachable=await new Promise(resolve=>{
      const socket=net.connect({host:'127.0.0.1',port:targets[0].port}),done=value=>{socket.destroy();resolve(value);};
      socket.setTimeout(800,()=>done(false));socket.once('error',()=>done(false));socket.once('data',data=>done(data.toString().startsWith('SSH-')));
    });
    if(!reachable)await delay(200);
  }
  assert.equal(reachable,true,'Windows localhost did not receive the isolated WSL SSH banner');
  for(const [index,target] of targets.entries()){
    const native=index===0,host=createMultiplexHost({knownHostsFile:native?nativeHosts:known});
    const manager=createSshConnections({pty,sessions:new Map(),host});managers.push(manager);
    const requestId=randomUUID(),id=randomUUID();
    const profile={id,version:1,kind:'ssh',name:native?'Fixture native':'Fixture WSL',mode:'key',ssh_client:native?path.join(programs,'ssh.exe'):'/usr/bin/ssh',
      distribution,username:target.username,port:target.port,host:'127.0.0.1',identity_file:native?windowsKey:identity,proxy_jump:[],via:[]};
    const opened=await manager.open({profileId:id,profileVersion:1,requestId,profile});
    let result,authCursor=0,diagnostic='';
    for(let attempt=0;attempt<100;attempt++){
      const auth=manager.authRead({connectionId:opened.connectionId,cursor:authCursor});
      authCursor=auth.cursor;diagnostic=(diagnostic+auth.output).slice(-4000);
      result=await manager.completeLogin({connectionId:opened.connectionId,requestId});
      if(result.login.status==='complete'||result.login.status==='failed')break;
      await delay(200);
    }
    const fault=diagnostic.match(/Permission denied|Host key verification failed|UNPROTECTED PRIVATE KEY FILE|Connection refused|Connection reset|No such file|Bad owner or permissions|timed out|not accessible/i)?.[0];
    assert.equal(result.login.status,'complete',JSON.stringify({route:native?'native':'wsl',...result.login,fault}));
    target.connectionId=opened.connectionId;
    target.profile=profile;
  }
  const profileRef=target=>({connectionId:target.connectionId,profileId:target.profile.id,profileVersion:target.profile.version});
  const session=(index,threadId)=>({...profileRef(targets[index]),leaseId:randomUUID(),scope:{provider:'codex',threadId}});
  const alpha=session(0,'managed-alpha'),beta=session(0,'managed-beta'),other=session(1,'managed-alpha');
  const [a,b,c]=await Promise.all([managers[0].managedShell(alpha,'open'),managers[0].managedShell(beta,'open'),managers[1].managedShell(other,'open')]);
  assert.equal((await managers[0].managedShell(alpha,'open')).sessionId,a.sessionId);
  assert.notEqual(a.sessionId,b.sessionId);assert.notEqual(a.sessionId,c.sessionId);
  const markup=randomUUID().replaceAll('-','');
  async function command(manager,ref,script,expected){
    let cursor=0,output='';
    await manager.managedShell({...ref,requestId:randomUUID(),data:script+'\r'},'input');
    for(let attempt=0;attempt<50;attempt++){
      const read=await manager.managedShell({...ref,cursor,maxBytes:65536},'read');
      cursor=read.cursor;output+=read.chunks.map(chunk=>chunk.data).join('');
      if(output.includes(expected))return;
      await delay(100);
    }
    throw Error('Expected remote command receipt was absent');
  }
  await Promise.all([
    command(managers[0],alpha,`AIMTEST=${markup}; cd /; printf 'A_%s_%s\\n' "$AIMTEST" "$PWD"`,'A_'+markup+'_/'),
    command(managers[0],beta,"printf 'B_%s_%s\\n' untouched \"\${AIMTEST:-empty}\"",'B_untouched_empty'),
    command(managers[1],other,"printf 'C_%s_%s\\n' independent \"\${AIMTEST:-empty}\"",'C_independent_empty')
  ]);
  await assert.rejects(()=>managers[0].managedShell({...alpha,scope:beta.scope},'read'));
  const extra=[session(0,'capacity-first'),session(0,'capacity-second')];
  await Promise.all(extra.map(ref=>managers[0].managedShell(ref,'open')));
  await assert.rejects(()=>managers[0].managedShell(session(0,'capacity-exceeded'),'open'),/session_limit/);
  const peer=session(1,'capacity-independent');
  assert.equal((await managers[1].managedShell(peer,'open')).alive,true);
  await Promise.all([...extra.map(ref=>managers[0].managedShell(ref,'close')),managers[1].managedShell(peer,'close')]);
  if(withServices){
    for(const target of targets)assert.match(target.home,/\/\.aimatter-test-sshd-[^/]+\/[ab]\/home$/);
    await Promise.all([command(managers[0],alpha,"printf 'HOME_%s\\n' \"$HOME\"",'HOME_'+targets[0].home),
      command(managers[1],other,"printf 'HOME_%s\\n' \"$HOME\"",'HOME_'+targets[1].home)]);
    const routes=new Map(targets.map((target,i)=>[target.connectionId,managers[i]])),rows=new Map();
    const localProfile={id:randomUUID(),version:1,kind:'wsl',name:'Fixture local worker',distribution,root:local.root,port:local.port};
    const savedProfiles=[...targets.map(item=>item.profile),localProfile];
    const profiles={read:({id})=>structuredClone(savedProfiles.find(profile=>profile.id===id)),list:()=>savedProfiles};
    const registration=createSshServiceRegistration({catalog:{get:(kind,id)=>rows.get(kind+':'+id),put:(kind,id,row)=>rows.set(kind+':'+id,row)},profiles});
    const connections=Object.fromEntries(['state','serviceState','privateServiceRequest'].map(name=>[name,value=>routes.get(value.connectionId)[name](value)]));
    connections.openService=(ref,bootstrap,context)=>routes.get(ref.connectionId).openService({...ref,bootstrap,interactiveService:context.conversationChannel===true});
    connections.managedShell=async(op,{sessionId,ownerEpoch,...ref})=>{
      const result=await routes.get(ref.connectionId).managedShell(ref,op);
      if(op==='input'){
        assert.equal(result.id,sessionId);assert.equal(result.ownerEpoch,ownerEpoch);assert.equal(result.requestId,ref.requestId);
      }else if(op==='read'){
        assert.equal(result.state.id,sessionId);assert.equal(result.state.ownerEpoch,ownerEpoch);assert.deepEqual(result.state.scope,ref.scope);
        return {...result,output:result.chunks.map(chunk=>chunk.data).join('')};
      }
      return result;
    };
    const data=new Map(),bucket=kind=>{if(!data.has(kind))data.set(kind,new Map());return data.get(kind);};
    const catalog={get:(kind,id)=>bucket(kind).get(id),put:(kind,id,value)=>{bucket(kind).set(id,structuredClone(value));return value;},
     list:kind=>[...bucket(kind).values()],remove:(kind,id)=>bucket(kind).delete(id)};
    const scope={provider:'deepseek',threadId:'fixture-chat',taskId:null,projectId:null,checkCurrent:()=>true};
    const bench=createManagedWorkbench({catalog,profiles,registration,terminal:{connections},projectSkills:{confirmedComputeAliases:()=>null},
     resourceActivity:createConversationActivity({catalog}),projectAccess:managedProjectAccess({catalog}),
     records:{bound:()=>null,tasks:()=>[],conversations:()=>[],conversation:()=>({projectId:scope.projectId})},
     workflow:{currentFor:()=>scope,assertScope:()=>assert.fail('Chat created a workflow')},agents:{isBusy:()=>false,turnOrigin:()=>'user',turnStates:()=>[]},
     workerSource:path.resolve('backend/worker'),sshTransportSource:path.resolve('desktop/platform/terminal-service/python'),handle(){},notify(){}});
    const say=text=>bench.userMessage({provider:scope.provider,method:'turn/start',params:{threadId:scope.threadId,input:[{type:'text',text}]}});
    const call=(name,args)=>bench.desktopTools.call(name,args,scope);
    resourceDirectory=bench.resources;
    for(const target of targets){
      const reference=profileRef(target);
      const receipts=await Promise.all([resourceDirectory.publish(reference),resourceDirectory.publish(reference)]);
      receipts.push(await resourceDirectory.publish(reference));
      for(const receipt of receipts){
        assert.equal(receipt.kind,'ssh');
        assert.equal(receipt.connectionId,reference.connectionId);
        assert.equal(receipt.profileId,reference.profileId);
        assert.equal(receipt.profileVersion,reference.profileVersion);
        assert.equal(receipt.resourceId,'ssh:'+reference.profileId);
      }
    }
    assert.equal((await resourceDirectory.publishWsl({profileId:localProfile.id,profileVersion:1,distribution,...local})).serviceStatus,'ready');
    const configured=await Promise.all(targets.map(target=>resourceDirectory.configureService(profileRef(target)).catch(async error=>{
      const state=await connections.serviceState({connectionId:target.connectionId}).catch(()=>null);
      throw Error(JSON.stringify({target:target.profile.name,error:error.message,status:state?.status,phase:state?.servicePhase,code:state?.error?.code}));
    })));
    assert(configured.every(row=>row.serviceStatus==='ready'));
    const sources=resourceDirectory.listSources();assert.equal(sources.length,3);
    for(const [index,target] of targets.entries()){
      const source=sources.find(item=>item.profileId===target.profile.id);
      assert(source.health.root.startsWith(target.home+'/.local/state/gpu-sampling-studio/ssh-services/'));
      assert.match(source.health.runtimeManifestSha256,/^[a-f0-9]{64}$/);
      assert.equal(source.health.managed_schedule_schema,1);
      await source.request('POST','/api/projects',{id:'fixture-project-'+index,name:target.profile.name,policy:{input_roots:[target.home],engines:[]}});
    }
    const observed=await Promise.all(targets.map(target=>sources.find(item=>item.profileId===target.profile.id).request('GET','/api/projects')));
    assert.deepEqual(observed.map(items=>items.map(project=>project.id)),[['fixture-project-0'],['fixture-project-1']]);
    const localSource=sources.find(item=>item.profileId===localProfile.id);
    assert.deepEqual(await localSource.request('GET','/api/projects'),[]);
    const resource_id='ssh:'+targets[0].profile.id;
    say('探测一下集群队列，我的自有队列哪些空卡？');
    const listed=await call('list_compute_resources',{});
    assert.equal(listed.resources.filter(item=>item.kind==='ssh').length,2);
    say('就是'+targets[0].profile.name);
    const corrected=await call('acquire_compute_resource',{resource_id:'ssh:'+targets[1].profile.id,access:'service'});
    assert.equal(corrected.status,'target_selected');
    assert.deepEqual(corrected.retry,{resource_id,access:'service'});
    const serviceLease=await call('acquire_compute_resource',{resource_id,access:'service'});
    assert.equal(serviceLease.status,'acquired');assert.equal(serviceLease.access,'service');assert.equal(serviceLease.terminal,undefined);
    const serviceQueue=await call('inspect_compute_service',{resource_id,probe_scheduler:true});
    assert.equal(serviceQueue.terminal_available,false);
    assert.equal(serviceQueue.scheduler.observations[0].queues[0].name,'fixture-only');
    const channel=(await call('acquire_compute_resource',{resource_id,access:'terminal'})).terminal.sessionId;
    assert(channel);
    await call('write_compute_terminal',{session_id:channel,request_id:randomUUID(),action:'type',data:"export AIM_FIXTURE_ENV=ordinary; printf 'CHAT_ENV_%s\\n' \"$AIM_FIXTURE_ENV\""});
    await call('write_compute_terminal',{session_id:channel,request_id:randomUUID(),action:'enter'});
    let offset=0,text='';
    for(let i=0;i<40&&!text.includes('CHAT_ENV_ordinary');i++){
      const part=await call('read_compute_terminal',{session_id:channel,cursor:offset});
      text+=part.output;offset=part.cursor;await delay(100);
    }
    assert(text.includes('CHAT_ENV_ordinary'));
    const queue=await call('inspect_compute_service',{resource_id,probe_scheduler:true});
    assert.equal(queue.project_access,'no_project');
    assert.equal(queue.scheduler.observations[0].queues[0].name,'fixture-only');
    assert.equal(queue.scheduler.observations[0].queues[0].node_state,'idle');
    await call('release_compute_resource',{resource_id});
    console.log('PASS ordinary DeepSeek-scoped chat: two real SSH targets, human choice, owned terminal and fixed private-service queue observation without project or workflow');

    const target=targets[0],original=sources.find(item=>item.profileId===target.profile.id);
    const cluster=await original.request('POST','/api/ssh-service/scheduler',{name:'Fixture standalone Slurm',scheduler:'slurm',queue:'fixture-only',
     environment:{executables:{python:'/usr/bin/python3'}},limits:{cpus:2,gpus:0,memory_mb:2048},remote_root:target.home+'/jobs',read_roots:[target.home]});
    scope.projectId='fixture-standalone';
    await original.request('POST','/api/projects',{id:scope.projectId,name:'Independent fixture',policy:{input_roots:[target.home],engines:['pydyn.md'],clusters:[cluster.id]}});
    say('使用 '+target.profile.name+' 准备独立作业');await call('acquire_compute_resource',{resource_id});
    const draft=await call('prepare_compute_run',{resource_id,kind:'cluster-run',spec:{name:'Standalone fixture',engine:'pydyn.md',cluster_id:cluster.id,
     idempotency_key:'one-standalone',max_seconds:30,inputs:{'run.py':target.home+'/run.py'},parameters:{},resources:{queue:'fixture-only',cpus:1,gpus:0,memory_mb:512}}});
    const args={resource_id,run_id:draft.id};
    await assert.rejects(call('submit_compute_run',args),/instruction_required/);
    say('请提交这个独立作业');
    assert.equal((await call('validate_compute_run',args)).status,'ready');
    const submitted=await call('submit_compute_run',args);
    assert.equal(submitted.job_id,'4242');
    await assert.rejects(call('submit_compute_run',args),/unconfirmed/);
    await command(managers[0],alpha,"printf 'FIXTURE_SUBMITS_%s\\n' \"$(wc -l < \"$HOME/submissions\")\"",'FIXTURE_SUBMITS_1');
    const monitor=await original.request('POST','/api/managed-schedules/snapshot',{sourceId:original.id});
    assert(monitor.schedules.some(row=>row.scope.runId===draft.id&&row.scope.threadId===scope.threadId&&row.maxRuns===48));
    await call('release_compute_resource',{resource_id});
    console.log('PASS ordinary chat prepared, validated and explicitly submitted exactly one independent job to the fixture scheduler and attached a finite monitor without a workflow');
    await resourceDirectory.revokeConnection({connectionId:alpha.connectionId});
    assert.equal(resourceDirectory.listSources().length,2);
    assert.equal((await localSource.request('GET','/api/health')).root,local.root);
    console.log('PASS two isolated first-use private SSH workers and one verified local WSL worker, independent project registries and local survival');
  }
  await managers[0].close({connectionId:alpha.connectionId});
  await command(managers[1],other,"printf 'SURVIVE_%s\\n' ok",'SURVIVE_ok');
  for(const manager of managers)await manager.closeAll();
  fixture.stdin.end('stop\n');
  const final=await lines.next();
  const receipt=JSON.parse(final.value);
  assert.deepEqual(receipt.authentications,[1,1]);
  if(withServices){assert.deepEqual(receipt.workersStopped,[1,1]);assert.equal(receipt.localWorkerStopped,true);}
  console.log('PASS two SSH servers, native and WSL, one authentication per server, exclusive terminals, stable reacquisition, per-connection capacity, isolated shell state and peer survival');
} finally {
  await resourceDirectory?.stop();
  await Promise.allSettled(managers.map(manager=>manager.closeAll()));
  if(fixture&&!fixture.stdin.destroyed){fixture.stdin.end();const summary=await lines?.next();if(summary?.value)console.log('Fixture diagnostics',summary.value);}
  reader?.close();
  if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('aimatter-managed-'))throw Error('Unexpected fixture workspace');
  await rm(temp,{recursive:true,force:true});
}
