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
import {createManagedComputeResources} from '../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeServices} from '../backend/main/compute/managed-compute-services.mjs';
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
    const services=createManagedComputeServices({connections,registration,source:path.resolve('backend/worker'),transportSource:path.resolve('desktop/platform/terminal-service/python')});
    resourceDirectory=createManagedComputeResources({terminal:{connections},profiles,services});
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
