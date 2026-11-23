import {isDeepStrictEqual as equal} from 'node:util';
import {randomUUID} from 'node:crypto';

const scopeOf = context => context?.threadId ? Object.fromEntries(
 ['provider','threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,context[key]??null])
) : null;
const keyOf = scope => JSON.stringify([scope.provider,scope.threadId]);
const changed = () => { throw Error('terminal_context_changed'); };

/** A desktop handoff applies to one authenticated connection and provider. Only the
 * main process can allocate a PTY for a real, selected provider conversation. */
export function createConversationTerminals({terminal,service,registration,resource,current,idleMinutes,busy=()=>false,serviceBusy=busy,
 publish=()=>{},conversationName=()=>null,now=Date.now,uuid=randomUUID}){
 const pools=new Map(),parked=new Set();
 let stopped=false;
 function selected(pool){
  if(stopped||pools.get(pool.connectionId)!==pool)return false;
  try{resource.assertCurrent(pool.ticket);return true;}catch{return false;}
 }
 function getPool(provider){
  const ref=resource.peek(),pool=ref?.kind==='ssh-connection'&&pools.get(ref.connectionId);
  return pool&&pool.provider===provider&&selected(pool)?pool:null;
 }
 function live(pool,scope,entry){
  if(!entry||!selected(pool)||!equal(scope,scopeOf(current()))||pool.entries.get(keyOf(scope))!==entry)changed();
 }
 function session(pool,id){
  return [...pool.entries.values()].find(entry=>entry.shell?.sessionId===id||entry.claiming?.sessionId===id);
 }
 function describe(shell){
  const pool=pools.get(shell.connectionId);
  if(!pool)return shell;
  if(pool.available?.sessionId===shell.sessionId)return {...shell,awaitingConversation:true};
  const entry=session(pool,shell.sessionId),scope=scopeOf(current());
  if(entry?.claiming&&!entry.shell)return {...shell,awaitingConversation:true};
  return entry?{...shell,conversationTerminal:true,currentConversation:selected(pool)&&equal(entry.scope,scope),serviceGrantPending:!!entry.deferredService,conversationName:conversationName(entry.scope.provider,entry.scope.threadId)||undefined}:shell;
 }
 async function arm(value,provider){
  const ref=resource.peek(),ticket=resource.capture(),selection=current(),scope=scopeOf(selection);
  if(stopped||ref?.kind!=='ssh-connection'||!provider||(scope&&scope.provider!==provider))changed();
  const state=await terminal.resourceState({sessionId:value.sessionId});
  resource.assertCurrent(ticket);
  if(!equal(scope,scopeOf(current()))||!scope&&selection?.serial!==current()?.serial||state.resource?.connectionId!==ref.connectionId||state.resource.profileId!==ref.profileId||
     state.resource.profileVersion!==ref.profileVersion||state.operator!=='human'||state.ownerEpoch!==value.ownerEpoch||
     !state.alive||state.processStatus!=='running')changed();
  let pool=pools.get(ref.connectionId);
  if(pool&&(pool.provider!==provider||!selected(pool))){detachConnection(ref.connectionId);pool=null;}
  if(!pool){pool={...ref,provider,ticket,entries:new Map(),serviceAllowed:true};pools.set(ref.connectionId,pool);}
  // A second explicit handoff in a bound conversation replaces only its PTY.
  const previous=scope&&pool.entries.get(keyOf(scope));
  if(previous&&previous.shell?.sessionId!==value.sessionId){
   await retire(pool,previous);resource.assertCurrent(ticket);if(!equal(scope,scopeOf(current())))changed();
  }
  pool.enabled=true;pool.serviceAllowed=true;pool.serviceFailure=null;
  pool.available={sessionId:value.sessionId,ownerEpoch:value.ownerEpoch,at:now(),awaitingNewConversation:!scope};
  if(scope){await acquire(provider,scope);const entry=pool.entries.get(keyOf(scope));live(pool,scope,entry);
   publish();return {...describe(entry.shell),service:service.peek({connectionId:pool.connectionId})};}
  publish();
  return {sessionId:value.sessionId,connectionId:ref.connectionId,resource:state.resource,kind:'ssh',name:'SSH terminal',owner:'human',ownerEpoch:value.ownerEpoch,alive:true,awaitingConversation:true};
 }
 async function retire(pool,entry){
  if(entry.retiring)return entry.retiring;
  if(entry.pending){await entry.pending.catch(()=>{});if(entry.retiring)return entry.retiring;}
  if(pool.entries.get(keyOf(entry.scope))!==entry&&entry.released)return;
  const shell=entry.shell;
  const close=async()=>{
   if(shell)await terminal.closeConversationShell({sessionId:shell.sessionId,connectionId:pool.connectionId,ownerEpoch:shell.ownerEpoch});
   if(pool.entries.get(keyOf(entry.scope))===entry)pool.entries.delete(keyOf(entry.scope));
   if(shell&&entry.attemptId)service.reclaimTerminalHandoff({connectionId:pool.connectionId,attemptId:entry.attemptId,sessionId:shell.sessionId});
  };
  const operation=close();entry.retiring=operation;
  try{await operation;}finally{entry.retiring=null;}
 }
 async function bindService(pool,scope,entry){
  if(!pool.serviceAllowed||!terminal.hasCurrentGrant(scope.provider,entry.shell.sessionId))return;
  let state=service.peek({connectionId:pool.connectionId});
  if(!state.workflowReady){
   if(!pool.connecting){
    if(pool.serviceFailure||['unknown','disconnecting','connecting'].includes(state.status))return;
    const saved=registration.read({profileId:pool.profileId,profileVersion:pool.profileVersion});
    const reuse=saved.status==='configured'||saved.status==='maintenance_required'&&saved.reason==='worker_health_invalid';
    if(saved.status==='maintenance_required'&&!reuse&&saved.reason!=='configuration_changed')return;
    const operation=service.connectForConversations({connectionId:pool.connectionId,profileId:pool.profileId,profileVersion:pool.profileVersion,
     requestId:uuid(),mode:reuse?'reuse':'setup'});
    pool.connecting=operation;
    try{state=await operation;if(!state.workflowReady)pool.serviceFailure=true;}
    catch(error){if(selected(pool))pool.serviceFailure=true;throw error;}
    finally{if(pool.connecting===operation)pool.connecting=null;}
   }else state=await pool.connecting;
  }
  grantReadyService(pool,scope,entry,state);
 }
 function grantReadyService(pool,scope,entry,state){
  live(pool,scope,entry);
  if(!pool.serviceAllowed||!state.workflowReady||state.status!=='connected'||state.connectionId!==pool.connectionId||
     state.profileId!==pool.profileId||state.profileVersion!==pool.profileVersion||!terminal.hasCurrentGrant(scope.provider,entry.shell.sessionId))return;
  if(!service.hasCurrentGrant(scope.provider,scope)){
   const ref={connectionId:pool.connectionId,attemptId:state.attemptId};
   if(serviceBusy(scope)){entry.deferredService={attemptId:state.attemptId,serviceId:state.serviceId};return;}
   service.owner({...ref,owner:'agent',scope});
   service.markTerminalHandoff({...ref,sessionId:entry.shell.sessionId});
   publish(scope);
  }
  entry.attemptId=state.attemptId;
 }
 function finishDeferredService(provider,threadId){
  const scope=scopeOf(current()),pool=getPool(provider);
  if(!scope||scope.provider!==provider||scope.threadId!==threadId||!pool||serviceBusy(scope))return;
  const entry=pool.entries.get(keyOf(scope)),pending=entry?.deferredService;
  if(!pending||!equal(scope,entry.scope))return;
  entry.deferredService=null;
  const state=service.peek({connectionId:pool.connectionId});
  if(!entry.retiring&&state.attemptId===pending.attemptId&&state.serviceId===pending.serviceId){
   // A local refusal leaves the verified shell usable. Never retry a remote
   // connection or change the grant of a different service attempt here.
   try{grantReadyService(pool,scope,entry,state);}catch{if(serviceBusy(scope))entry.deferredService=pending;}
  }
  publish();
 }
 function prepareService(pool,scope,entry){
  if(entry.servicePending||!pool.serviceAllowed||pool.serviceFailure||service.hasCurrentGrant(scope.provider,scope))return;
  const pending=bindService(pool,scope,entry).catch(()=>{}).finally(()=>{if(entry.servicePending===pending)entry.servicePending=null;publish();});
  entry.servicePending=pending;
 }
 function pendingForNewConversation(provider){
  const handoff=getPool(provider)?.available;
  return handoff?.awaitingNewConversation&&!scopeOf(current())?handoff:null;
 }
 async function acquire(provider,context,reservedShell=null){
  const scope=scopeOf({...context,provider}),pool=getPool(provider);
  if(!scope||!pool)return;
  const key=keyOf(scope);let entry=pool.entries.get(key);
  if(entry?.retiring){await entry.retiring;if(!equal(scope,scopeOf(current())))changed();entry=pool.entries.get(key);}
  if(reservedShell&&pool.available!==reservedShell)return;
  if(!entry&&(!pool.enabled||pool.available?.awaitingNewConversation&&pool.available!==reservedShell))return;
  if(entry&&!equal(scope,entry.scope))return;
  if(!entry){entry={scope,at:now()};pool.entries.set(key,entry);}
  entry.at=now();
  if(entry.pending)return entry.pending;
  if(entry.shell&&terminal.hasCurrentGrant(provider,entry.shell.sessionId)&&
     (!pool.serviceAllowed||pool.serviceFailure||service.hasCurrentGrant(provider,scope)))return;
  const run=async()=>{
   live(pool,scope,entry);
   if(!entry.shell){
    const seed=pool.available;pool.available=null;entry.claiming=seed;
    let shell=seed,granted=false;
    try{
     if(!shell)shell=await terminal.connections.openShell({connectionId:pool.connectionId,requestId:uuid()});
     live(pool,scope,entry);
     entry.shell=await terminal.owner({sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,owner:'agent'},
      {conversation:true,assertCurrent:()=>live(pool,scope,entry)});
     granted=true;live(pool,scope,entry);
    }finally{
     if(!granted){
      if(seed&&!entry.released&&pool.enabled&&selected(pool)&&!pool.available){
       const actual=await terminal.resourceState({sessionId:seed.sessionId}).catch(()=>null);
       if(actual?.operator==='human'&&actual.ownerEpoch===seed.ownerEpoch&&!entry.released&&pool.enabled&&selected(pool)&&!pool.available)pool.available=seed;
       else if(actual?.operator==='agent'&&actual.ownerEpoch===seed.ownerEpoch+1)await terminal.closeConversationShell({sessionId:seed.sessionId,connectionId:pool.connectionId,ownerEpoch:actual.ownerEpoch});
      }
      else if(shell&&!seed)await terminal.discardConversationShell({sessionId:shell.sessionId,connectionId:pool.connectionId});
      if(pool.entries.get(key)===entry)pool.entries.delete(key);
     }
     entry.claiming=null;
    }
   }
   live(pool,scope,entry);
   if(terminal.hasCurrentGrant(provider,entry.shell.sessionId))prepareService(pool,scope,entry);
  };
  const operation=run();entry.pending=operation;
  try{await operation;}finally{entry.pending=null;entry.at=now();publish();}
 }
 function prepareAuthoringGrant(){
  const before=scopeOf(current()),pool=before&&getPool(before.provider);
  const entry=pool?.entries.get(keyOf(before));
  if(!entry?.shell||entry.retiring||!equal(before,entry.scope))return null;
  const receipt=terminal.prepareConversationGrant(entry.shell.sessionId);
  if(!receipt)return null;
  return allow=>{
   const after=scopeOf(current());
   const stillOwned=allow&&after&&selected(pool)&&pool.entries.get(keyOf(before))===entry&&
    !entry.retiring&&equal(entry.scope,before);
   if(receipt.finish(stillOwned)){entry.scope=after;entry.at=now();}
  };
 }
 function releaseShell(id){
  for(const pool of [...parked,...pools.values()]){
   const entry=session(pool,id);
   if(!entry&&pool.available?.sessionId!==id)continue;
   if(entry){entry.released=true;pool.entries.delete(keyOf(entry.scope));if(entry.attemptId)service.reclaimTerminalHandoff({connectionId:pool.connectionId,attemptId:entry.attemptId,sessionId:id});}
   if(pool.available?.sessionId===id)pool.available=null;pool.enabled=false;if(!pool.entries.size)parked.delete(pool);
  }
 }
 function detachConnection(id){
  const pool=pools.get(id);if(!pool)return;
  pool.enabled=false;pool.available=null;pool.serviceAllowed=false;
  // Detach the allocation policy. Its PTYs stay available to their human owner
  // until explicitly closed or retired at the original idle deadline.
  for(const entry of pool.entries.values())if(entry.shell)terminal.revokeConversationGrant?.(entry.shell.sessionId);
  pools.delete(id);if(pool.entries.size)parked.add(pool);publish();
 }
 function releaseConnection(id){
  const all=[...parked,...pools.values()].filter(pool=>pool.connectionId===id);pools.delete(id);
  for(const pool of all){parked.delete(pool);pool.enabled=false;pool.available=null;for(const entry of pool.entries.values())void retire(pool,entry).catch(()=>{});}
 }
 function serviceOwner(id,owner){const pool=pools.get(id);if(pool){pool.serviceAllowed=owner==='agent';pool.serviceFailure=null;for(const entry of pool.entries.values())entry.deferredService=null;}}
 function touch(provider,threadId){
  if(!threadId)return;
  const entry=getPool(provider)?.entries.get(keyOf({provider,threadId}));if(entry)entry.at=now();
 }
 async function sweep(){
  const scope=scopeOf(current());if(scope)finishDeferredService(scope.provider,scope.threadId);
  const cutoff=now()-(idleMinutes()??60)*60000,closing=[];
  for(const pool of [...parked,...pools.values()]){
   if(pool.available?.at<=cutoff){const shell=pool.available;pool.available=null;
    closing.push(terminal.closeConversationShell({sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,connectionId:pool.connectionId}).catch(()=>{if(!pool.available&&pool.enabled)pool.available=shell;}));}
   for(const entry of pool.entries.values()){
    if(selected(pool)&&busy(entry.scope)){entry.at=now();continue;}
    if(entry.at<=cutoff&&!entry.pending&&!entry.retiring)closing.push(retire(pool,entry));
   }
  }
  await Promise.allSettled(closing);for(const pool of parked)if(!pool.entries.size)parked.delete(pool);if(closing.length)publish();
 }
 function forget(provider,threadId){
  const key=keyOf({provider,threadId});
  for(const pool of [...parked,...pools.values()]){const entry=pool.entries.get(key);if(entry){pool.entries.delete(key);void retire(pool,entry).catch(()=>{});}}
 }
 function canAcquire(provider){
  const pool=getPool(provider),scope=scopeOf(current());
  return !!(pool?.enabled&&(!scope||!pool.available?.awaitingNewConversation&&!pool.entries.has(keyOf(scope))));
 }
 function consoleEntries(){
  return [...parked,...pools.values()].flatMap(pool=>[...pool.entries.values()].map(entry=>({
   connectionId:pool.connectionId,profileId:pool.profileId,profileVersion:pool.profileVersion,
   sessionId:entry.shell?.sessionId??null,provider:entry.scope.provider,threadId:entry.scope.threadId,projectId:entry.scope.projectId,
   status:entry.retiring?'releasing':entry.consoleCloseUnknown?'unknown':!entry.shell?'preparing':parked.has(pool)?'parked':'assigned',busy:busy(entry.scope)
  })));
 }
 async function releaseFromConsole(target){
  const matches=[...parked,...pools.values()].filter(pool=>pool.connectionId===target.connectionId);
  const owners=matches.map(pool=>({pool,entry:pool.entries.get(keyOf(target))})).filter(({entry})=>entry?.shell?.sessionId===target.leaseId);
  if(stopped||owners.length!==1)throw Error('managed_compute_channel_changed');
  const {pool,entry}=owners[0];
  if(entry.pending||busy(entry.scope))throw Error('managed_compute_channel_busy');
  try{const release=retire(pool,entry);publish();await release;return {status:'released'};}
  catch{entry.consoleCloseUnknown=true;return {status:'unconfirmed'};}
  finally{publish();}
 }
 return {arm,acquire,pendingForNewConversation,canAcquire,describe,prepareAuthoringGrant,releaseShell,detachConnection,releaseConnection,serviceOwner,finishDeferredService,touch,sweep,forget,
  consoleEntries,releaseFromConsole,
  stop(){stopped=true;pools.clear();parked.clear();}};
}
