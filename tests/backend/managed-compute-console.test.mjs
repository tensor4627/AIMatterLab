import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedComputeConsole} from '../../backend/main/compute/managed-compute-console.mjs';

const profile = (id,kind='ssh') => ({id,kind,name:'Resource '+id,version:1,host:id+'.invalid',port:22,mode:'interactive'});
const local = {...profile('L','wsl'),port:8790,distribution:'Fixture',root:'~/fixture-worker'};
const ref = (id,connectionId='conn-'+id) => ({connectionId,profileId:id,profileVersion:1});
const conn = (id,options={}) => ({...ref(id),status:'authenticated',authentication:'verified',multiplex:true,closed:false,verified:true,
  capacity:{total:4,occupied:1},service:{status:'idle',active:false,kind:null,serviceId:null},...options});
const entry = (id,options={}) => ({kind:'ssh',resourceId:'ssh:'+id,name:'Resource '+id,...ref(id),generation:null,serviceStatus:'configuration_required',...options});
const channel = (id,provider,options={}) => ({...entry(id),provider,threadId:'same-thread',projectId:null,leaseId:provider+'-'+id,
  sessionId:'shell-'+provider+'-'+id,status:'assigned',serviceOnly:false,busy:false,expired:false,...options});
const independent = {profileId:'L',profileVersion:1,kind:'wsl',resourceId:'wsl:L',generation:'local-generation',serviceStatus:'ready'};

function fixture(worker) {
  const model = {entries:[entry('A',{generation:'private-1',serviceStatus:'ready'}),entry('B')],
    channels:[channel('A','codex',{projectId:'fixture-project'}),channel('A','deepseek',{serviceOnly:true,sessionId:null}),
      channel('B','codex',{busy:true}),channel('B','qwen',{status:'preparing',sessionId:null})]};
  const current = {profiles:[profile('A'),profile('B'),local],now:120000,
    broker:{complete:true,connections:[conn('A',{service:{status:'connected',active:true,kind:'private',serviceId:'private-1'}}),conn('B')],
      sessions:[{sessionId:'original-human',kind:'ssh',mode:'interactive',owner:'human',connectionId:'conn-A',alive:true,verified:true},
        {sessionId:'handoff-A',kind:'ssh',mode:'key',owner:'agent',connectionId:'conn-A',alive:true,verified:true}]},
    handoff:[{...ref('A'),provider:'kimi',threadId:'same-thread',projectId:null,sessionId:'handoff-A',status:'assigned',busy:false}],
    resourceHealth:new Set(['private-1','local-generation']),shellHealth:new Set(['codex-A','codex-B']),
    failBroker:false,failServiceHealth:false,calls:[]};
  const profileRegistry={list:()=>structuredClone(current.profiles),read({id,version}){
    const match=current.profiles.find(row=>row.id===id&&(version===undefined||version===row.version));
    if (!match) throw Error('compute_profile_unavailable');
    return structuredClone(match);
  }};
  const api=createManagedComputeConsole({profiles:profileRegistry,terminal:{async consoleInventory(){
    current.calls.push(['inventory']);if(current.failBroker)throw Error('terminal_unavailable');return structuredClone(current.broker);
  },connections:{state:async({connectionId})=>structuredClone(current.broker.connections.find(row=>row.connectionId===connectionId))}},
    resources:{consoleEntries:()=>structuredClone(model),observeConsoleLease:async row=>current.shellHealth.has(row.leaseId),
      async observeConsoleService(row){
        if(current.failServiceHealth && row.generation==='private-1') throw Error('terminal_service_unknown');
        return current.resourceHealth.has(row.generation);
      },async releaseFromConsole(target){
        current.calls.push(['release',target]);model.channels=model.channels.filter(row=>row.leaseId!==target.leaseId);return {status:'released'};
      },async publishWsl(target){current.calls.push(['attach',target]);model.entries.push(independent);},async detachLocalFromConsole(target){current.calls.push(['detach',target]);model.entries=model.entries.filter(row=>row.resourceId!==target.resourceId);}},
    conversationTerminals:{consoleEntries:()=>structuredClone(current.handoff),async releaseFromConsole(target){current.calls.push(['handoff',target]);current.handoff=[];return {status:'released'};}},
    records:{conversations:()=>['codex','deepseek','kimi','qwen'].map(provider=>({id:provider+':same-thread',provider,threadId:'same-thread',name:provider+' conversation',projectId:null}))},
    catalog:{list:key=>key==='workspace-index'?[{id:'fixture-project',name:'Original project'}]:[]},registration:{read:()=>({status:'unconfigured'})},worker,
    async closeSsh(target){current.calls.push(['disconnect',target]);return {status:'closed',closed:true};},notify:()=>{},now:()=>current.now,
    async readLocal(target){current.calls.push(['probe local',target]);return {status:'connected',connection:{health:{name:'gpu-sampling-studio',root:'/fixture/worker',runtime:'/fixture/runtime',execution_policy:'desktop-review-v1'}}};}
  });
  return {api,current,model,resource:id=>api.snapshot().resources.find(row=>row.profileId===id)};
}

test('console projects current SSH proofs, named exclusive channels, broker capacity and WSL service contexts separately',async()=>{
  const {api,current,model,resource}=fixture();
  assert.equal(resource('A').master.status,'unknown');
  assert.deepEqual(current.calls,[]);
  model.entries.push(independent);
  model.channels.push({...independent,provider:'qwen',threadId:'same-thread',status:'assigned',leaseId:'local-qwen',serviceOnly:true,sessionId:null,busy:false});
  await Promise.all([api.refresh(),api.refresh()]);
  const a=resource('A'), b=resource('B'), wsl=resource('L');
  assert.equal(a.master.status,'online');
  assert.equal(a.service.status,'online');
  assert.deepEqual(a.capacity,{total:4,occupied:1});
  assert.deepEqual(a.terminals.map(row=>row.sessionId),['original-human']);
  assert.deepEqual(a.channels.map(row=>[row.source,row.provider,row.conversationName,row.status,row.projectName]),[
    ['managed','codex','codex conversation','assigned','Original project'],['managed','deepseek','deepseek conversation','assigned',null],['handoff','kimi','kimi conversation','assigned',null]
  ]);
  assert.equal(b.service.status,'unconfigured');
  assert.equal(b.channels[1].status,'preparing');
  assert.equal(wsl.master,null);
  assert.equal(wsl.service.status,'online');
  assert.deepEqual(wsl.channels.map(row=>[row.source,row.status,row.serviceOnly,row.sessionId]),[['wsl','assigned',true,null]]);
  assert.deepEqual(current.calls,[['inventory']]);
  assert.doesNotMatch(JSON.stringify(api.snapshot()),/worker\/|runtime\/|"pid"|token/i);
});

test('negative or expired evidence does not promote cached transport, channel or worker status',async()=>{
  const {api,current,model,resource}=fixture();
  await api.refresh();
  current.shellHealth.delete('codex-A');
  current.resourceHealth.delete('private-1');
  await api.refresh();
  assert.equal(resource('A').master.status,'online');
  assert.equal(resource('A').service.status,'lost');
  assert.deepEqual(resource('A').channels.slice(0,2).map(row=>row.status),['lost','lost']);
  model.channels.find(row=>row.leaseId==='codex-A').status='releasing';
  assert.equal(resource('A').channels[0].status,'releasing');
  current.resourceHealth.add('private-1');
  await api.refresh();
  assert.equal(resource('A').service.status,'online');
  current.now+=46000;
  assert.equal(resource('A').master.status,'unknown');
  assert.equal(resource('A').service.status,'unknown');
  assert.equal(resource('A').capacity,null);
});

test('unconfirmed SSH inventory leaves dependent channels unknown until the original connection is verified',async()=>{
  const {api,current,model,resource}=fixture();
  const inventory=current.broker, [connected,other]=inventory.connections;
  const unavailable={...connected,status:'unavailable',authentication:'lost',multiplex:false,capacity:null,service:null};
  model.channels.push(channel('A','qwen',{commandContext:true,sessionId:null}));
  await api.refresh();
  assert.deepEqual(resource('A').channels.map(row=>row.status),['assigned','assigned','assigned','assigned']);

  for(const [scenario,broker,failBroker=false,canDisconnect=false] of [
    ['failed inventory',inventory,true],
    ['partial inventory missing the connection',{...inventory,complete:false,connections:[other]}],
    ['complete inventory with an unverified row',{...inventory,connections:[{...connected,verified:false,capacity:null,service:null},other]}],
    ['verified row with unconfirmed close',{...inventory,connections:[{...unavailable,closeUnconfirmed:true},other]},false,true]
  ]){
    current.broker=broker;
    current.failBroker=failBroker;
    await api.refresh();
    const uncertain=resource('A');
    assert.deepEqual([uncertain.connectionId,uncertain.master.status,uncertain.service.status,uncertain.canDisconnect],
      ['conn-A','unknown','unknown',canDisconnect],scenario);
    assert.deepEqual(uncertain.channels.map(row=>row.status),['unknown','unknown','unknown','unknown'],scenario);
    if(!failBroker) assert.equal(resource('B').master.status,'online');
    else {
      assert.equal(api.snapshot().observation,'partial');
      assert.equal(uncertain.terminals[0].status,'unknown');
    }

    current.broker=inventory;
    current.failBroker=false;
    await api.refresh();
    const restored=resource('A');
    assert.deepEqual([restored.connectionId,restored.master.status,restored.service.status],['conn-A','online','online'],scenario);
    assert.deepEqual(restored.channels.map(row=>row.status),['assigned','assigned','assigned','assigned'],scenario);
  }

  for(const [scenario,connections] of [
    ['verified exit',[unavailable,other]],
    ['cached row confirmed missing by its broker',[{...connected,verified:false,missing:true,capacity:null,service:null},other]],
    ['complete inventory omitting the tracked connection',[other]]
  ]){
    current.broker={...inventory,connections};
    await api.refresh();
    const exited=resource('A');
    assert.deepEqual([exited.connectionId,exited.master.status,exited.service.status],['conn-A','lost','lost'],scenario);
    assert.deepEqual(exited.channels.map(row=>row.status),['lost','lost','lost','lost'],scenario);
  }
});

test('a private SSH service health timeout only makes that service and its dependent channel unknown',async()=>{
  const {api,current,model,resource}=fixture();
  const lease=model.channels.find(row=>row.provider==='deepseek');
  lease.serviceGeneration='private-1';
  await api.refresh();
  assert.equal(resource('A').service.status,'online');

  current.failServiceHealth=true;
  await api.refresh();
  const uncertain=resource('A');
  assert.equal(uncertain.master.status,'online');
  assert.equal(uncertain.service.status,'unknown');
  assert.deepEqual(uncertain.channels.map(row=>[row.provider,row.status]),[
    ['codex','assigned'],['deepseek','unknown'],['kimi','assigned']
  ]);

  current.failServiceHealth=false;
  await api.refresh();
  assert.equal(resource('A').service.status,'online');
  const leaseStatus=()=>resource('A').channels.find(row=>row.leaseId===lease.leaseId).status;
  assert.equal(leaseStatus(),'assigned');

  const entry=model.entries.find(row=>row.connectionId==='conn-A');
  entry.generation=null;
  assert.equal(leaseStatus(),'unknown');
  entry.generation='replacement';
  assert.equal(leaseStatus(),'lost');
});

test('release is fenced by exact provider and lease, and refuses closing a master with another busy conversation',async()=>{
  const {api,current,model}=fixture();
  const lease={resourceId:'ssh:A',connectionId:'conn-A',source:'managed',leaseId:'codex-A',provider:'codex',threadId:'same-thread'};
  await assert.rejects(api.release({...lease,provider:'deepseek'}),/managed_compute_channel_changed/);
  await assert.rejects(api.release({...lease,connectionId:'conn-B'}),/managed_compute_channel_changed/);
  await assert.rejects(api.release({...lease,sessionId:'other'}),/invalid_compute_console_request/);
  await assert.rejects(api.disconnectSsh(ref('B')),/managed_compute_channel_busy/);
  await assert.rejects(api.disconnectSsh({...ref('A'),profileVersion:2}),/managed_compute_resource_unavailable/);
  assert.deepEqual(current.calls,[]);
  assert.deepEqual(await api.release(lease),{status:'released'});
  assert.equal(model.channels.some(row=>row.leaseId==='deepseek-A'),true);
  const legacy={...lease,source:'handoff',leaseId:'handoff-A',provider:'kimi'};
  assert.deepEqual(await api.release(legacy),{status:'released'});
  assert.deepEqual(await api.disconnectSsh(ref('A')),{status:'disconnected'});
  assert.deepEqual(current.calls,[['release',lease],['handoff',legacy],['disconnect',ref('A')]]);
});

test('local attach reads the chosen saved profile and detach rejects a stale private relay generation',async()=>{
  const {api,current,resource}=fixture();
  const target={profileId:'L',profileVersion:1};
  await assert.rejects(api.attachLocal({...target,profileVersion:2}),/managed_compute_profile_changed/);
  assert.deepEqual(await api.attachLocal(target),{status:'attached'});
  await api.refresh();
  assert.equal(resource('L').service.status,'online');
  const detach={...target,generation:'local-generation',foregroundEpoch:null};
  await assert.rejects(api.detachLocal({...detach,generation:'previous-generation'}),/managed_compute_resource_unavailable/);
  assert.deepEqual(await api.detachLocal(detach),{status:'disconnected'});
  assert.equal(resource('L').service.status,'offline');
  assert.deepEqual(current.calls,[
    ['probe local',{distribution:'Fixture',workerRoot:'~/fixture-worker',workerPort:8790}],
    ['attach',{...target,distribution:'Fixture',port:8790,root:'/fixture/worker',runtime:'/fixture/runtime'}],['inventory'],
    ['detach',{...detach,resourceId:'wsl:L'}]
  ]);
});

test('an attached workbench WSL service is observable without a saved match and detaches only the confirmed connection epoch',async()=>{
  const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/elsewhere/root',runtime:'/elsewhere/runtime'};
  const worker={identity:{distribution:'Fixture Foreground',root:health.root},connection:{health},connectionTarget:{root:health.root,port:8800},connectionEpoch:10,
    async forward(method,target){assert.deepEqual([method,target],['GET','/api/health']);return {status:200,data:health};},close(){this.connection=null;this.connectionEpoch++;}};
  const {api}=fixture(worker);
  assert.equal(api.snapshot().foregroundLocal.service.status,'unknown');
  await api.refresh();
  assert.equal(api.snapshot().foregroundLocal.service.status,'online');
  const target={profileId:null,profileVersion:null,generation:null,foregroundEpoch:10};
  await assert.rejects(api.detachLocal({...target,foregroundEpoch:9}),/managed_compute_resource_unavailable/);
  assert.equal(worker.connectionEpoch,10);
  assert.deepEqual(await api.detachLocal(target),{status:'disconnected'});
  assert.equal(api.snapshot().foregroundLocal,null);
});
