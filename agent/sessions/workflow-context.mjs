import {isDeepStrictEqual} from 'node:util';
const providers=new Set(['codex','kimi','qwen','deepseek','compatible']);
const keys=['threadId','taskId','projectId','environmentId','inputRoot'];
function identity(value,label,nullable=false){if(value===null&&nullable)return null;if(typeof value!=='string'||!value||value.length>(label==='inputRoot'?4096:200)||value.includes('\0'))throw Error('Invalid '+label);return value;}
/** Selection tickets are created only by the sender-validated main process. */
export function createAgentWorkflowContext({records,activeTasks,selectedProvider}){
 let serial=0,selectionRevision=0,current=null;
 function owner(provider,threadId,initialProjectId=null){
  if(!providers.has(provider))throw Error('Invalid provider');
  identity(threadId,'threadId',true);
  if(threadId===null)return {threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null};
  if(records.deleted(provider,threadId))throw Error('Conversation was deleted');
  const task=records.bound(provider,threadId),conversation=records.conversation(provider,threadId);
  if(task&&(task.provider!==provider||task.threadId!==threadId))throw Error('Stored workflow belongs to another conversation');
  // The first send already has a desktop project selection while the provider
  // is creating the thread. Once a record exists, its scope is authoritative.
  const projectId=task?.authoring?.projectId||task?.projectId||conversation?.projectId||(!conversation&&!task?initialProjectId:null);
  return {threadId,taskId:task?identity(task.id,'taskId'):null,projectId:identity(projectId,'projectId',true),environmentId:identity(task?.authoring?.environmentId||null,'environmentId',true),inputRoot:identity(task?.authoring?.inputRoot||null,'inputRoot',true)};
 }
 function ownedState(state){if(!state.replacement)return owner(state.provider,state.threadId,state.initialProjectId);const actual=owner(state.provider,state.replacement.threadId);if(!isDeepStrictEqual(actual,state.replacement))throw Error('Workflow ownership changed during private context preparation');return {...actual,threadId:null};}
 function assert(ticket){if(!current||!ticket||ticket.serial!==current.serial||ticket.provider!==current.provider)throw Error('Selected conversation changed during preparation');return current;}
 return {
  begin(provider,threadId,initialProjectId=null){
   if(initialProjectId!==null){if(threadId!==null)throw Error('An initial project belongs to a new conversation');identity(initialProjectId,'projectId');}
   owner(provider,threadId);
   if(!current||current.provider!==provider||current.threadId!==threadId||current.replacement||
      (threadId===null&&current.initialProjectId!==initialProjectId))selectionRevision++;
   current={provider,threadId,serial:++serial,initialProjectId};return Object.freeze({provider,serial});
  },
  beginReplacement(provider,threadId){const replacement=owner(provider,threadId);if(!replacement.taskId)throw Error('A bound workflow is required for a private context');selectionRevision++;current={provider,threadId:null,replacement,serial:++serial};return Object.freeze({provider,serial});},
  beginConversationReplacement(provider,threadId){const replacement=owner(provider,threadId);if(provider!=='codex'||!records.conversation(provider,threadId))throw Error('A saved Codex conversation is required');selectionRevision++;current={provider,threadId:null,replacement,serial:++serial};return Object.freeze({provider,serial});},
  assert,
  started(ticket,threadId){const state=assert(ticket);if(state.threadId!==null)throw Error('Only a newly started conversation can receive its real identity');identity(threadId,'threadId');const actual=owner(state.provider,threadId,state.initialProjectId);if(state.replacement&&actual.taskId!==state.replacement.taskId)throw Error('The new context must retain its original workflow');selectionRevision++;current={provider:state.provider,serial:state.serial,threadId,initialProjectId:state.initialProjectId};return actual;},
  async synchronize(ticket,bind){const state=assert(ticket),context=ownedState(state);await bind(state.provider,context);assert(ticket);if(!isDeepStrictEqual(context,ownedState(state)))throw Error('Workflow ownership changed during context binding');if(context.taskId)activeTasks.set(state.provider,context.taskId);else activeTasks.delete(state.provider);return context;},
  assertScope(scope){
   if(!scope||typeof scope.checkCurrent!=='function'||scope.checkCurrent()!==true)throw Error('The scientific tool lease is no longer current');
   if(!current||scope.provider!==current.provider||scope.provider!==selectedProvider()||!current.threadId)throw Error('A trusted selected conversation is required');
   const context=owner(current.provider,current.threadId);
   if(!context.taskId||activeTasks.get(scope.provider)!==context.taskId||keys.some(key=>scope[key]!==context[key]))throw Error('The scientific tool lease belongs to another workflow or environment');
   if(scope.checkCurrent()!==true)throw Error('The scientific tool lease changed during its ownership check');
   return records.read(context.taskId);
  },
  clear(provider){if(current&&(!provider||provider===current.provider)){current=null;serial++;selectionRevision++;}if(provider)activeTasks.delete(provider);else activeTasks.clear();},
  // A message renews its operation ticket. The desktop view follows the selected
  // owner and must still notice a switch away and back to the same conversation.
  selectedOwner(){return {revision:selectionRevision,context:current?{provider:current.provider,...ownedState(current)}:null};},
  revision(){return serial;},
  current(){if(!current)return null;const {initialProjectId,...selection}=current;return {...selection,...ownedState(current)};}
 };
}
