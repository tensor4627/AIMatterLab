/** Selected SSH resource reference; terminal authority and worker facts stay separate. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

const KIND='compute-resource-selection',KEY='active';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
function exact(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))throw Error('compute_resource_invalid_request');}
function reference(value){return object(value)&&value.schemaVersion===1&&id(value.selectionId)&&value.kind==='ssh-terminal'&&id(value.profileId)&&Number.isSafeInteger(value.profileVersion)&&value.profileVersion>0&&id(value.sessionId);}
function connectionReference(value){return object(value)&&value.schemaVersion===2&&id(value.selectionId)&&value.kind==='ssh-connection'&&id(value.connectionId)&&id(value.profileId)&&Number.isSafeInteger(value.profileVersion)&&value.profileVersion>0;}
const empty=()=>({schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false});
const base=value=>({...empty(),selectionId:value.selectionId,kind:value.kind,profileId:value.profileId,profileVersion:value.profileVersion,sessionId:value.sessionId});

export function createComputeResourceBinding({catalog,profiles,terminal,connections=terminal?.connections,current=()=>null,revision=()=>0,serviceState=()=>null,uuid=randomUUID}){
 let intent=0;const environmentUpdates=new WeakMap();
 const selected=()=>{const value=catalog.get(KIND,KEY);if(value==null)return null;if(!reference(value)&&!connectionReference(value))throw Error('compute_resource_invalid_selection');return structuredClone(value);};
 const capture=()=>({intent,owner:structuredClone(current()),revision:revision()});
 const fresh=context=>{if(context.intent!==intent||context.revision!==revision()||!equal(context.owner,current()))throw Error('compute_resource_context_changed');};
 function checkProfile(value){let profile;try{profile=profiles.read({id:value.profileId,version:value.profileVersion});}catch{throw Error('compute_resource_profile_changed');}if(profile?.id!==value.profileId||profile.version!==value.profileVersion||profile.kind!=='ssh')throw Error('compute_resource_profile_changed');}
 async function observeConnection(value,context){
  const initial={...base(value),schemaVersion:2,connectionId:value.connectionId,sessionId:null,terminalSessionIds:[]};let actual;
  try{checkProfile(value);actual=await connections?.state({connectionId:value.connectionId});fresh(context);checkProfile(value);}
  catch(error){fresh(context);return {...initial,status:error.message==='compute_resource_profile_changed'?'stale':'unavailable',reason:error.message==='compute_resource_profile_changed'?'profile_changed':'connection_unavailable'};}
  if(!object(actual)||actual.schemaVersion!==2||actual.connectionId!==value.connectionId||actual.profileId!==value.profileId||actual.profileVersion!==value.profileVersion||!['authenticating','authenticated','unavailable','closed','requires_review','unsupported'].includes(actual.status)||!['pending','verified','not_observed','lost'].includes(actual.authentication)||!Array.isArray(actual.terminalSessionIds)||actual.terminalSessionIds.length>32||actual.terminalSessionIds.some(item=>!id(item))||new Set(actual.terminalSessionIds).size!==actual.terminalSessionIds.length||typeof actual.capabilities?.multiplex!=='boolean')throw Error('compute_resource_unverified_state');
  const connected=actual.status==='authenticated'&&actual.authentication==='verified'&&actual.capabilities.multiplex;
  const shells=[];let shellUnknown=false;
  if(connected)for(const sessionId of actual.terminalSessionIds){try{const shell=await terminal.resourceState({sessionId});fresh(context);if((shell.connectionId??shell.resource?.connectionId)!==value.connectionId||shell.sessionId!==sessionId||!['human','agent'].includes(shell.operator)||!['running','exited','expired'].includes(shell.processStatus)||typeof shell.agentReady!=='boolean'||typeof shell.alive!=='boolean')throw Error('compute_resource_unverified_state');shells.push(shell);}catch(error){fresh(context);if(error.message==='compute_resource_unverified_state')throw error;shellUnknown=true;}}
  const service=serviceState(value.connectionId),sameService=service?.connectionId===value.connectionId&&service.profileId===value.profileId&&service.profileVersion===value.profileVersion;
  const workflowReady=!!(connected&&sameService&&service.status==='connected'&&service.workflowReady===true),serviceAgent=workflowReady&&service.operator==='agent';
  const readyShells=shells.filter(shell=>shell.alive&&shell.processStatus==='running'),shellAgent=readyShells.some(shell=>shell.agentReady&&shell.operator==='agent'),shellAgentOwned=readyShells.some(shell=>shell.operator==='agent');
  const agentReady=serviceAgent||shellAgent,operator=serviceAgent||shellAgentOwned?'agent':connected?'human':'unknown',lostBase=actual.status==='unavailable'||actual.authentication==='lost',serviceStatus=sameService&&lostBase&&!(['idle','disconnected'].includes(service.status))?'unknown':sameService?service.status:'disconnected';
  return {...initial,status:connected?'selected':actual.status==='requires_review'?'stale':'unavailable',connectionStatus:actual.status,authentication:actual.authentication,alive:connected?true:actual.status==='closed'?false:null,processStatus:connected?'running':actual.status==='closed'?'exited':'unknown',operator,agentReady,workflowReady,managedRuns:workflowReady,terminalSessionIds:[...actual.terminalSessionIds],serviceActive:!!sameService&&(typeof service.serviceActive==='boolean'?service.serviceActive:!['idle','disconnected','failed'].includes(service.status)),serviceStatus,reason:!connected?actual.status==='requires_review'?'connection_requires_review':'connection_'+actual.status:agentReady?null:workflowReady?'service_human_owned':readyShells.length?'human_owned':'current_conversation_grant_required',capabilities:{terminal:{status:lostBase?'unknown':readyShells.length?'ready':shellUnknown?'unknown':'closed',sessionIds:readyShells.map(shell=>shell.sessionId),operator:shellAgentOwned?'agent':readyShells.length?'human':'unknown',agentReady:shellAgent},service:{status:serviceStatus,operator:workflowReady?service.operator==='agent'?'agent':'human':'unknown',agentReady:serviceAgent,workflowReady},files:{status:workflowReady?'requires_authorized_project':sameService&&(service.status==='unknown'||lostBase)?'unknown':'unavailable',via:workflowReady?'job-service':null}}};
 }
 async function observe(value,context){
  if(connectionReference(value))return observeConnection(value,context);
  const initial=base(value);let facts;
  try{checkProfile(value);facts=await terminal.resourceState({sessionId:value.sessionId});fresh(context);checkProfile(value);}
  catch(error){fresh(context);const stale=['compute_resource_profile_changed','terminal_saved_connection_changed'].includes(error.message);return {...initial,status:stale?'stale':'unavailable',reason:stale?'profile_changed':'terminal_unavailable'};}
  const resource=facts?.resource;
  if(resource?.kind!=='ssh-terminal'||resource.profileId!==value.profileId||resource.profileVersion!==value.profileVersion||facts.sessionId!==value.sessionId)throw Error('compute_resource_session_mismatch');
  if(!['human','agent'].includes(facts.operator)||!['running','exited','expired'].includes(facts.processStatus)||typeof facts.alive!=='boolean'||typeof facts.agentReady!=='boolean'||facts.authentication!=='not_observed'||facts.managedRuns!==false)throw Error('compute_resource_unverified_state');
  const service=serviceState(),sameService=service?.sessionId===value.sessionId&&service.profileId===value.profileId&&service.profileVersion===value.profileVersion,connectedService=sameService&&service.status==='connected';
  const operator=connectedService?service.operator==='agent'?'agent':'human':facts.operator;
  const workflowReady=connectedService&&service.workflowReady===true&&facts.alive&&facts.processStatus==='running';
  const ready=connectedService?workflowReady&&operator==='agent':facts.agentReady&&facts.operator==='agent'&&facts.alive&&facts.processStatus==='running';
  return {...initial,status:'selected',operator,processStatus:facts.processStatus,alive:facts.alive,agentReady:!!ready,workflowReady:!!workflowReady,serviceActive:!!sameService&&service.status!=='disconnected',serviceStatus:sameService?service.status:'disconnected',...workflowReady?{managedRuns:true,authentication:'verified'}:{},reason:ready?null:sameService&&service.status==='unknown'?'ssh_service_unavailable':facts.processStatus!=='running'?'terminal_'+facts.processStatus:workflowReady&&operator==='human'?'service_human_owned':operator==='human'?'human_owned':'current_conversation_grant_required'};
 }
 async function status(data={}){
  exact(data,[]);const value=selected();if(!value)return empty();
  // A status read owns no operation or grant. Conversation initialization can
  // invalidate its observation without changing the authenticated resource.
  // Reobserve once in the current context; never return the old permissions.
  for(let attempt=0;attempt<2;attempt++){
   const context=capture();
   try{const result=await observe(value,context);fresh(context);if(!equal(value,selected()))throw Error('compute_resource_selection_changed');return result;}
   catch(error){if(attempt||error.message!=='compute_resource_context_changed'||context.intent!==intent||!equal(value,selected()))throw error;}
  }
 }
 function validateConnection(data){
  exact(data,['kind','connectionId','profileId','profileVersion']);
  if(data.kind!=='ssh-connection'||!id(data.connectionId)||!id(data.profileId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1)throw Error('compute_resource_invalid_request');
 }
 async function prepareConnectionActivation(data,{reserve=false}={}){
  validateConnection(data);
  const previous=selected(),context=capture(),value={schemaVersion:2,selectionId:uuid(),...data};
  if(reserve)context.intent=++intent;
  const assertCurrent=()=>{fresh(context);if(!equal(previous,selected()))throw Error('compute_resource_selection_changed');checkProfile(value);};
  const result=await observeConnection(value,context);
  if(result.status!=='selected'||result.authentication!=='verified')throw Error('compute_resource_not_available');
  assertCurrent();
  return {assertCurrent,commit(beforeSave=()=>{}){
   assertCurrent();
   const persist=()=>{beforeSave();if(previous)catalog.put('compute-resource-selection-history',previous.selectionId,{schemaVersion:1,fromSchemaVersion:previous.schemaVersion,toSchemaVersion:2,reason:'explicit_connection_selected',previous,at:Date.now()});catalog.put(KIND,KEY,value);};
   if(typeof catalog.transaction==='function')catalog.transaction(persist);else persist();
   if(!reserve)intent++;
   return result;
  }};
 }
 async function activate(data){
  if(data?.kind==='ssh-connection'){
   validateConnection(data);
   const previous=selected(),same=connectionReference(previous)&&['kind','connectionId','profileId','profileVersion'].every(key=>previous[key]===data[key]);
   // Reattaching the current terminal is an observation of the same resource.
   // Keep active message tickets and grants while rechecking its real state.
   if(same){const result=await status();if(result.status!=='selected'||result.authentication!=='verified')throw Error('compute_resource_not_available');return result;}
   return (await prepareConnectionActivation(data,{reserve:true})).commit();
  }
  exact(data,['kind','profileId','profileVersion','sessionId']);if(data.kind!=='ssh-terminal'||!id(data.profileId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1||!id(data.sessionId))throw Error('compute_resource_invalid_request');
  const context={...capture(),intent:++intent},previous=selected(),same=previous&&['kind','profileId','profileVersion','sessionId'].every(key=>previous[key]===data[key]);
  const value=same?previous:{schemaVersion:1,selectionId:uuid(),...data};if(!reference(value))throw Error('compute_resource_invalid_selection');
  const result=await observe(value,context);fresh(context);if(result.status!=='selected'||result.processStatus!=='running')throw Error('compute_resource_not_available');
  if(!equal(previous,selected()))throw Error('compute_resource_selection_changed');catalog.put(KIND,KEY,value);return result;
 }
 function clear(data){exact(data,['selectionId']);if(!id(data.selectionId))throw Error('compute_resource_invalid_request');const value=selected();if(!value||value.selectionId!==data.selectionId)throw Error('compute_resource_selection_changed');intent++;catalog.remove(KIND,KEY);return empty();}
 function clearConnection(connectionId){
  if(!id(connectionId))return false;
  const value=selected();
  if(!connectionReference(value)||value.connectionId!==connectionId)return false;
  intent++;catalog.remove(KIND,KEY);return true;
 }
 function clearProfile(profileId){
  if(!id(profileId))return false;
  const value=selected();
  if(!value||value.profileId!==profileId)return false;
  intent++;catalog.remove(KIND,KEY);return true;
 }
 function clearLegacyTerminal(){
  const value=selected();
  if(!reference(value))return false;
  const persist=()=>{catalog.put('compute-resource-selection-history',value.selectionId,{schemaVersion:1,fromSchemaVersion:1,toSchemaVersion:2,reason:'legacy_terminal_cleared',previous:value,at:Date.now()});catalog.remove(KIND,KEY);};
  if(typeof catalog.transaction==='function')catalog.transaction(persist);else persist();
  intent++;return true;
 }
 function replaceHostedConnection(previous,next){
  const value=selected();
  if(!connectionReference(value)||!['connectionId','profileId','profileVersion'].every(key=>value[key]===previous[key])||
     next.profileId!==previous.profileId||next.profileVersion!==previous.profileVersion||next.connectionId===previous.connectionId||!id(next.connectionId))return false;
  checkProfile(next);
  catalog.put(KIND,KEY,{...value,connectionId:next.connectionId});intent++;return true;
 }
 const ticket=()=>({revision:intent,selection:selected()});
 const assertCurrent=value=>{if(!object(value)||value.revision!==intent||!equal(value.selection,selected()))throw Error('compute_resource_selection_changed');};
 function prepareProfileEnvironmentUpdate({previous,next,sessionIds,connectionIds=[]}){
  if(previous?.kind!=='ssh'||next?.kind!=='ssh'||previous.id!==next.id||next.version!==previous.version+1)throw Error('compute_resource_profile_changed');
  const strip=profile=>{const {version,serviceEnvironment,...body}=profile;return body;};if(!equal(strip(previous),strip(next)))throw Error('compute_resource_profile_changed');
  const context=capture(),selection=selected();checkProfile({profileId:previous.id,profileVersion:previous.version});
  if(selection?.profileId===previous.id&&selection.profileVersion!==previous.version)throw Error('compute_resource_profile_changed');
  if(selection?.profileId===previous.id&&(connectionReference(selection)?!Array.isArray(connectionIds)||!connectionIds.includes(selection.connectionId):!Array.isArray(sessionIds)||!sessionIds.includes(selection.sessionId)))throw Error('compute_resource_session_mismatch');
  const receipt=Object.freeze({});environmentUpdates.set(receipt,{context,selection,previous:structuredClone(previous),next:structuredClone(next)});return receipt;
 }
 function assertProfileEnvironmentUpdate(receipt){const update=environmentUpdates.get(receipt);if(!update)throw Error('compute_resource_context_changed');fresh(update.context);if(!equal(update.selection,selected()))throw Error('compute_resource_selection_changed');return update;}
 function commitProfileEnvironmentUpdate(receipt,saved,{sessionIds,connectionIds=[]}={}){
  const update=assertProfileEnvironmentUpdate(receipt);if(!equal(saved,update.next)||!equal(profiles.read({id:saved.id,version:saved.version}),saved))throw Error('compute_resource_profile_changed');
  const selection=update.selection;if(selection?.profileId===saved.id){if(connectionReference(selection)?!Array.isArray(connectionIds)||!connectionIds.includes(selection.connectionId):!Array.isArray(sessionIds)||!sessionIds.includes(selection.sessionId))throw Error('compute_resource_session_mismatch');catalog.put(KIND,KEY,{...selection,profileVersion:saved.version});intent++;}
  environmentUpdates.delete(receipt);return selected();
 }
 return {activate,prepareConnectionActivation,status,clear,clearConnection,clearProfile,clearLegacyTerminal,replaceHostedConnection,peek:selected,revision:()=>intent,capture:ticket,assertCurrent,prepareProfileEnvironmentUpdate,assertProfileEnvironmentUpdate,commitProfileEnvironmentUpdate};
}
