import {isDeepStrictEqual} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';
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
  owner(provider,threadId){return {provider,...owner(provider,threadId)};},
  begin(provider,threadId,initialProjectId=null){
   if(initialProjectId!==null){if(threadId!==null)throw Error('An initial project belongs to a new conversation');identity(initialProjectId,'projectId');}
   owner(provider,threadId);
   if(!current||current.provider!==provider||current.threadId!==threadId||current.replacement||
      (threadId===null&&current.initialProjectId!==initialProjectId))selectionRevision++;
   current={provider,threadId,serial:++serial,initialProjectId};return Object.freeze({provider,serial});
  },
  beginReplacement(provider,threadId){const replacement=owner(provider,threadId);if(!replacement.taskId)throw Error('A bound workflow is required for a private context');selectionRevision++;current={provider,threadId:null,replacement,serial:++serial};return Object.freeze({provider,serial});},
  beginConversationReplacement(provider,threadId){const replacement=owner(provider,threadId);if(!records.conversation(provider,threadId))throw Error('A saved conversation is required');selectionRevision++;current={provider,threadId:null,replacement,serial:++serial};return Object.freeze({provider,serial});},
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
  forget(provider,threadId){
   if(!threadId||!current||current.provider!==provider||current.threadId!==threadId&&current.replacement?.threadId!==threadId)return false;
   current=null;serial++;selectionRevision++;activeTasks.delete(provider);return true;
  },
  // A message renews its operation ticket. The desktop view follows the selected
  // owner and must still notice a switch away and back to the same conversation.
  selectedOwner(){return {revision:selectionRevision,context:current?{provider:current.provider,...ownedState(current)}:null};},
  revision(){return serial;},
  current(){if(!current)return null;const {initialProjectId,...selection}=current;return {...selection,...ownedState(current)};}
 };
}

/** The view and each transport have separate selection tickets and task bindings. */
export function createParallelAgentWorkflowContext({records,selectedProvider}){
 const storage=new AsyncLocalStorage(),sessions=new Map(),foregroundTasks=new Map();
 const foreground=createAgentWorkflowContext({records,activeTasks:foregroundTasks,selectedProvider});
 const state=()=>storage.getStore();
 const selected=()=>state()?.context||foreground;
 const tasks=()=>state()?.tasks||foregroundTasks;
 const activeTasks={get:provider=>tasks().get(provider),set:(provider,id)=>tasks().set(provider,id),delete:provider=>tasks().delete(provider),clear:()=>tasks().clear()};
 function runInSession(identity,run){
  let entry=sessions.get(identity.id);
  if(!entry){
   const tasks=new Map(),context=createAgentWorkflowContext({records,activeTasks:tasks,selectedProvider:()=>identity.provider});
   context.begin(identity.provider,identity.threadId);
   entry={identity,tasks,context};sessions.set(identity.id,entry);
  }
  if(entry.identity.provider!==identity.provider)throw Error('Agent workflow session belongs to a different provider');
  return storage.run(entry,run);
 }
 function sessionScopeCurrent(scope){
  const entry=sessions.get(scope?.sessionId);
  if(!entry||scope.provider!==entry.identity.provider||scope.checkCurrent?.()!==true)return false;
  const current=entry.context.current();
  return !!current&&keys.every(key=>(current[key]??null)===(scope[key]??null));
 }
 function runForScope(scope,run){
  if(scope?.sessionId===undefined)return run();
  if(!sessionScopeCurrent(scope)){const error=Error('The scientific tool lease no longer owns this conversation');error.staleProviderScope=true;throw error;}
  return storage.run(sessions.get(scope.sessionId),run);
 }
 async function synchronize(ticket,bind){
  const context=selected(),result=await context.synchronize(ticket,bind),entry=state();
  if(entry?.identity.isForeground()&&foreground.current()?.threadId===result.threadId&&foreground.current()?.provider===ticket.provider){
   if(result.taskId)foregroundTasks.set(ticket.provider,result.taskId);else foregroundTasks.delete(ticket.provider);
  }
  return result;
 }
 return {
  runInSession,runForScope,sessionScopeCurrent,activeTasks,
  dropSession:id=>sessions.delete(id),sessionId:()=>state()?.identity.id,
  currentFor:(provider,threadId)=>foreground.owner(provider,threadId),
  current:()=>selected().current(),revision:()=>selected().revision(),selectedOwner:()=>foreground.selectedOwner(),
  begin:(...args)=>selected().begin(...args),beginReplacement:(...args)=>selected().beginReplacement(...args),
  beginConversationReplacement:(...args)=>selected().beginConversationReplacement(...args),assert:ticket=>selected().assert(ticket),
  started(ticket,threadId){
   const entry=state(),result=selected().started(ticket,threadId);
   if(entry?.identity.isForeground())foreground.begin(ticket.provider,threadId);
   return result;
  },
  synchronize,
  assertScope:scope=>runForScope(scope,()=>selected().assertScope(scope)),
  clear:provider=>selected().clear(provider),
  forget(provider,threadId){
   const cleared=foreground.forget(provider,threadId);
   for(const [id,entry] of sessions){
    if(entry.identity.provider!==provider)continue;
    if(entry.context.forget(provider,threadId)||entry.identity.threadId===threadId)sessions.delete(id);
   }
   return cleared;
  }
 };
}
