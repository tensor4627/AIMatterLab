/** Selected SSH resource reference; terminal authority and worker facts stay separate. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

const KIND='compute-resource-selection',KEY='active';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
function exact(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))throw Error('compute_resource_invalid_request');}
function reference(value){return object(value)&&value.schemaVersion===1&&id(value.selectionId)&&value.kind==='ssh-terminal'&&id(value.profileId)&&Number.isSafeInteger(value.profileVersion)&&value.profileVersion>0&&id(value.sessionId);}
const empty=()=>({schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false});
const base=value=>({...empty(),selectionId:value.selectionId,kind:value.kind,profileId:value.profileId,profileVersion:value.profileVersion,sessionId:value.sessionId});

export function createComputeResourceBinding({catalog,profiles,terminal,current=()=>null,revision=()=>0,serviceState=()=>null,uuid=randomUUID}){
 let intent=0;
 const selected=()=>{const value=catalog.get(KIND,KEY);if(value==null)return null;if(!reference(value))throw Error('compute_resource_invalid_selection');return structuredClone(value);};
 const capture=()=>({intent,owner:structuredClone(current()),revision:revision()});
 const fresh=context=>{if(context.intent!==intent||context.revision!==revision()||!equal(context.owner,current()))throw Error('compute_resource_context_changed');};
 function checkProfile(value){let profile;try{profile=profiles.read({id:value.profileId,version:value.profileVersion});}catch{throw Error('compute_resource_profile_changed');}if(profile?.id!==value.profileId||profile.version!==value.profileVersion||profile.kind!=='ssh')throw Error('compute_resource_profile_changed');}
 async function observe(value,context){
  const initial=base(value);let facts;
  try{checkProfile(value);facts=await terminal.resourceState({sessionId:value.sessionId});fresh(context);checkProfile(value);}
  catch(error){fresh(context);const stale=['compute_resource_profile_changed','terminal_saved_connection_changed'].includes(error.message);return {...initial,status:stale?'stale':'unavailable',reason:stale?'profile_changed':'terminal_unavailable'};}
  const resource=facts?.resource;
  if(resource?.kind!=='ssh-terminal'||resource.profileId!==value.profileId||resource.profileVersion!==value.profileVersion||facts.sessionId!==value.sessionId)throw Error('compute_resource_session_mismatch');
  if(!['human','agent'].includes(facts.operator)||!['running','exited','expired'].includes(facts.processStatus)||typeof facts.alive!=='boolean'||typeof facts.agentReady!=='boolean'||facts.authentication!=='not_observed'||facts.managedRuns!==false)throw Error('compute_resource_unverified_state');
  const service=serviceState(),sameService=service?.sessionId===value.sessionId&&service.profileId===value.profileId&&service.profileVersion===value.profileVersion;
  const workflowReady=sameService&&service.status==='connected'&&service.workflowReady===true&&facts.alive&&facts.processStatus==='running';
  const ready=workflowReady||facts.agentReady&&facts.operator==='agent'&&facts.alive&&facts.processStatus==='running';
  return {...initial,status:'selected',operator:facts.operator,processStatus:facts.processStatus,alive:facts.alive,agentReady:ready,workflowReady:!!workflowReady,serviceActive:!!sameService&&service.status!=='disconnected',serviceStatus:sameService?service.status:'disconnected',...workflowReady?{managedRuns:true,authentication:'verified'}:{},reason:ready?null:sameService&&service.status==='unknown'?'ssh_service_unavailable':facts.processStatus!=='running'?'terminal_'+facts.processStatus:facts.operator==='human'?'human_owned':'current_conversation_grant_required'};
 }
 async function status(data={}){exact(data,[]);const value=selected();if(!value)return empty();const context=capture(),result=await observe(value,context);fresh(context);if(!equal(value,selected()))throw Error('compute_resource_selection_changed');return result;}
 async function activate(data){
  exact(data,['kind','profileId','profileVersion','sessionId']);if(data.kind!=='ssh-terminal'||!id(data.profileId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1||!id(data.sessionId))throw Error('compute_resource_invalid_request');
  const context={...capture(),intent:++intent},previous=selected(),same=previous&&['kind','profileId','profileVersion','sessionId'].every(key=>previous[key]===data[key]);
  const value=same?previous:{schemaVersion:1,selectionId:uuid(),...data};if(!reference(value))throw Error('compute_resource_invalid_selection');
  const result=await observe(value,context);fresh(context);if(result.status!=='selected'||result.processStatus!=='running')throw Error('compute_resource_not_available');
  if(!equal(previous,selected()))throw Error('compute_resource_selection_changed');catalog.put(KIND,KEY,value);return result;
 }
 function clear(data){exact(data,['selectionId']);if(!id(data.selectionId))throw Error('compute_resource_invalid_request');const value=selected();if(!value||value.selectionId!==data.selectionId)throw Error('compute_resource_selection_changed');intent++;catalog.remove(KIND,KEY);return empty();}
 const ticket=()=>({revision:intent,selection:selected()});
 const assertCurrent=value=>{if(!object(value)||value.revision!==intent||!equal(value.selection,selected()))throw Error('compute_resource_selection_changed');};
 return {activate,status,clear,peek:selected,revision:()=>intent,capture:ticket,assertCurrent};
}
