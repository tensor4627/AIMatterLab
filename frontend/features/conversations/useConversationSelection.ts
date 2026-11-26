import {useRef,useState,type MutableRefObject} from 'react';
import type {AgentProvider,Conversation} from '../../../contracts/dto/agent';
import {API_PROVIDER_GROUPS} from '../../../contracts/agent/model-profiles.mjs';
import type {invoke as Invoke} from '../../api/studio';
import {storedConversation,storeConversation} from './selection-preference';
export {storedConversation,storeConversation} from './selection-preference';

import type {AgentIntent} from './agent-types';

export interface SessionSelection{nonce:string;conversation?:Conversation;new?:boolean;pending?:boolean;error?:string;initialPrompt?:string;initialGuide?:AgentIntent['skill'];provider?:AgentProvider;adoptedDraftId?:string}
interface FreshSelection{sequence:number;promise:Promise<unknown>;failed?:boolean;planning:boolean;initialPrompt?:string;initialGuide?:AgentIntent['skill'];provider?:AgentProvider}
export interface ConversationSelectionPorts{
 invoke:typeof Invoke;
 mounted:MutableRefObject<boolean>;
 settingsReady:MutableRefObject<Promise<void>|null>;
 editorDirty:boolean;
 confirmReplace:()=>Promise<boolean>|boolean;
 language?:string;
 beforeSelection:()=>void;
 clearIntent:()=>void;
 beginWorkerGate:()=>unknown;
 observeWorker:(taskId?:string|null)=>Promise<boolean>;
 onSelected:(conversation:Conversation)=>void;
 onFreshSelected:()=>void;
 onSelectionError:(error:unknown)=>void;
 onError:(error:unknown)=>void;
}

/** Coordinates acknowledged conversation ownership; draft contents remain Agent-owned. */
export function useConversationSelection(ports:ConversationSelectionPorts){
 const {invoke,mounted,settingsReady,editorDirty,confirmReplace,language,beforeSelection,clearIntent,beginWorkerGate,observeWorker,onSelected,onFreshSelected,onSelectionError,onError}=ports;
 const [conversations,setConversations]=useState<Conversation[]>([]);
 const [selectedConversationId,setSelectedConversationId]=useState<string|null>(storedConversation());
 const [sessionSelection,setSessionSelection]=useState<SessionSelection>();
 const [agentBusy,setAgentBusy]=useState(false);
 const [planningMode,setPlanningMode]=useState(false);
 const selectedConversationRef=useRef<Conversation|null>(null),conversationSelectionSeq=useRef(0);
 const freshSelectionPending=useRef<FreshSelection|null>(null);
 const sessionSelectionNonceRef=useRef<string|undefined>(undefined);sessionSelectionNonceRef.current=sessionSelection?.nonce;
 const awaitingEditor=useRef(false);

 async function approveEditorReplacement(){
  if(awaitingEditor.current)return false;
  const sequence=conversationSelectionSeq.current,owner=selectedConversationRef.current?.id,nonce=sessionSelectionNonceRef.current;
  awaitingEditor.current=true;
  try{
   return await confirmReplace()&&mounted.current&&sequence===conversationSelectionSeq.current&&owner===selectedConversationRef.current?.id&&nonce===sessionSelectionNonceRef.current;
  }finally{awaitingEditor.current=false;}
 }

 function conversationChanged(value:Conversation|null){storeConversation(value?.id||null);selectedConversationRef.current=value;setSelectedConversationId(value?.id||null);if(value)setConversations(old=>[value,...old.filter(c=>c.id!==value.id)]);}
 function acceptAgentConversation(value:Conversation|null,nonce?:string){
  if(nonce!==sessionSelectionNonceRef.current||freshSelectionPending.current?.sequence===conversationSelectionSeq.current)return;
  conversationChanged(value);
 }
 async function chooseConversation(conversation:Conversation){
  if(awaitingEditor.current||editorDirty&&!await approveEditorReplacement())return;
  beforeSelection();const seq=++conversationSelectionSeq.current;clearIntent();beginWorkerGate();
  try{
   await settingsReady.current;if(seq!==conversationSelectionSeq.current||!mounted.current)return;
   const selected=await invoke<Conversation>('conversation.select',{id:conversation.id});if(seq!==conversationSelectionSeq.current||!mounted.current)return;
   conversationChanged(selected);onSelected(selected);
   const localHistory=API_PROVIDER_GROUPS.includes(selected.provider);
   if(localHistory)setSessionSelection({nonce:crypto.randomUUID(),conversation:selected});
   if(!await observeWorker(selected.taskId)||selectedConversationRef.current?.id!==selected.id||!mounted.current)return;
   if(!localHistory)setSessionSelection({nonce:crypto.randomUUID(),conversation:selected});
  }catch(error){if(seq===conversationSelectionSeq.current&&mounted.current)onSelectionError(error);}
 }
 async function newConversation(planning=false,initialPrompt?:string,provider?:AgentProvider,initialGuide?:AgentIntent['skill']){
  if(awaitingEditor.current||editorDirty&&!await approveEditorReplacement())return;
  const previous=selectedConversationRef.current;beforeSelection();const sequence=++conversationSelectionSeq.current;beginWorkerGate();clearIntent();
  const promise=invoke('conversation.select',{new:true,...provider?{provider}:{}});freshSelectionPending.current={sequence,promise,planning,initialPrompt,provider,initialGuide};setSessionSelection({nonce:crypto.randomUUID(),new:true,pending:true});
  try{
   await promise;if(sequence!==conversationSelectionSeq.current||!mounted.current)return;
   freshSelectionPending.current=null;conversationChanged(null);setPlanningMode(planning);onFreshSelected();
   setSessionSelection({nonce:crypto.randomUUID(),new:true,...initialPrompt!==undefined?{initialPrompt}:{},...initialGuide?{initialGuide}:{},...provider?{provider}:{}});void observeWorker();return true;
  }catch(error){
   if(sequence!==conversationSelectionSeq.current||!mounted.current)return;onError(error);
   if(previous)try{
    const restored=await invoke<Conversation>('conversation.select',{id:previous.id});if(sequence!==conversationSelectionSeq.current||!mounted.current)return;
    freshSelectionPending.current=null;conversationChanged(restored);setSessionSelection({nonce:crypto.randomUUID(),conversation:restored});void observeWorker(restored.taskId);return;
   }catch(restoreError){if(sequence!==conversationSelectionSeq.current||!mounted.current)return;onError(restoreError);}
   if(freshSelectionPending.current?.sequence===sequence)freshSelectionPending.current.failed=true;
   setSessionSelection({nonce:crypto.randomUUID(),new:true,pending:true,error:language==='en'?'The new chat is not ready. Try again.':'新对话尚未准备好，请重试。'});
  }
 }
 const retryNewConversation=()=>newConversation(freshSelectionPending.current?.planning||false,freshSelectionPending.current?.initialPrompt,freshSelectionPending.current?.provider,freshSelectionPending.current?.initialGuide);
 return {conversations,setConversations,selectedConversationId,setSelectedConversationId,selectedConversationRef,conversationSelectionSeq,sessionSelection,setSessionSelection,freshSelectionPending,agentBusy,setAgentBusy,planningMode,setPlanningMode,conversationChanged,acceptAgentConversation,chooseConversation,newConversation,retryNewConversation};
}
