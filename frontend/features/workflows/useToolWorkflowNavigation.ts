import {useRef,useState,type MutableRefObject} from 'react';
import type {Conversation} from '../../../contracts/dto/agent';
import type {ToolWorkflowLocation} from '../../../contracts/dto/tool-workflows';
import {toolWorkflows} from '../../api/tool-workflows';

export interface ToolWorkflowFocus {task_id:string;execution_id:string;step_id:string;nonce:string;roadmap?:boolean}
interface NavigationPorts {
 mounted:MutableRefObject<boolean>;
 selected:MutableRefObject<Conversation|null>;
 selectionSequence:MutableRefObject<number>;
 navigationSequence:MutableRefObject<number>;
 busy:boolean;
 conversations:Conversation[];
 chooseConversation:(value:Conversation)=>Promise<unknown>;
 onOpen:(value:ToolWorkflowLocation)=>void;
 onError:(error:unknown)=>void;
 locateRun?:(id:string)=>Promise<ToolWorkflowLocation>;
}

/** Return to the original reviewed step through normal acknowledged conversation selection. */
export function useToolWorkflowNavigation(ports:NavigationPorts){
 const latest=useRef(ports);latest.current=ports;const operation=useRef(0),[focus,setFocus]=useState<ToolWorkflowFocus>();
 async function open(runId:string){
  const start=latest.current;if(start.busy||!start.mounted.current)return;const ticket=++operation.current,selection=start.selectionSequence.current,navigation=++start.navigationSequence.current;
  const current=(selected:number,opened:number)=>{const value=latest.current;return value.mounted.current&&!value.busy&&ticket===operation.current&&value.selectionSequence.current===selected&&value.navigationSequence.current===opened;};
  let selected=selection,opened=navigation;
  try{
   const location=await (start.locateRun||toolWorkflows.locateRun)(runId);if(!current(selection,navigation))return;
   const conversation=latest.current.conversations.find(value=>value.id===location.conversation_id&&value.provider===location.provider&&value.threadId===location.thread_id&&value.taskId===location.task_id);if(!conversation)throw Error('The original workflow conversation is no longer available; retain the run and restore its original binding');
   if(latest.current.selected.current?.id!==conversation.id){selected++;opened++;await latest.current.chooseConversation(conversation);}
   if(!current(selected,opened))return;const acknowledged=latest.current.selected.current;
   if(!latest.current.conversations.some(value=>value.id===location.conversation_id&&value.provider===location.provider&&value.threadId===location.thread_id&&value.taskId===location.task_id))return;
   if(acknowledged?.id!==conversation.id||acknowledged.taskId!==location.task_id||acknowledged.provider!==location.provider||acknowledged.threadId!==location.thread_id)return;
   setFocus({task_id:location.task_id,execution_id:location.execution_id,step_id:location.step_id,nonce:crypto.randomUUID(),...(location.roadmap?{roadmap:true}:{})});latest.current.onOpen(location);
  }catch(error){if(current(selected,opened))latest.current.onError(error);}
 }
 return {focus,open};
}
