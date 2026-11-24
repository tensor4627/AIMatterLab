// Deterministic source-level Agent hook harness. No browser, desktop or model service.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import * as codexVersion from '../../contracts/agent/codex-version.mjs';
import * as transcript from '../../contracts/agent/transcript-sanitizer.mjs';
import * as modelProfiles from '../../contracts/agent/model-profiles.mjs';
import * as accountOwner0 from "../../frontend/features/conversations/provider-account.mjs";
import * as accountOwner1 from "../../contracts/agent/provider-account.mjs";
const account={...accountOwner0,...accountOwner1};

import * as drafts from "../../frontend/features/conversations/composer-drafts.mjs";
import * as followUps from '../../frontend/features/conversations/follow-ups.mjs';
import * as chatAttachments from '../../contracts/agent/chat-attachments.mjs';
import * as messageMapping from '../../frontend/features/conversations/message-mapping.mjs';
import * as readingPositions from '../../frontend/features/conversations/reading-position.mjs';

import * as effort from "../../frontend/features/conversations/resume-effort.mjs";

import * as activityOwner0 from "../../frontend/features/conversations/tool-activity.mjs";
import * as elicitation from '../../frontend/features/conversations/elicitation-input.mjs';
import * as activityOwner1 from "../../contracts/agent/user-message.mjs";
const activity={...activityOwner0,...activityOwner1};

import * as fieldsOwner0 from "../../contracts/workflows/task-fields.mjs";
import * as fieldsOwner1 from "../../frontend/ui/task-fields.mjs";
import * as fieldsOwner2 from "../../frontend/features/conversations/workflow-intent.mjs";
const fields={...fieldsOwner0,...fieldsOwner1,...fieldsOwner2};

import {conversationSelectionHarness} from './conversation-selection-hooks.mjs';

const source=fs.readFileSync(process.env.STUDIO_AGENT_SOURCE?path.resolve(process.env.STUDIO_AGENT_SOURCE):new URL('../../frontend/features/conversations/Agent.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compileView=name=>ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/conversations/'+name+'.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const chatCompiled=compileView('ChatMessage'),messagesCompiled=compileView('ConversationMessages'),composerCompiled=compileView('Composer'),questionsCompiled=compileView('ComposerQuestion');
const fileModules=Object.fromEntries(['read-chat-file.ts','chat-file-text.ts','ChatFiles.tsx'].map(file=>[
 './'+file.replace(/\.tsx?$/,''),ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/conversations/'+file,import.meta.url),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
]));
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export function memoryStorage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
export function conversation(provider,threadId){return {id:provider+':'+threadId,provider,threadId,name:threadId,projectId:null,taskId:null};}
export function appConversationRecorder(storage){
 const h=conversationSelectionHarness({storage}),selectedConversationRef=h.current().selectedConversationRef,selections=[],rows=[];
 const onConversation=value=>{h.current().conversationChanged(value);h.render();selections.push(h.current().selectedConversationId);rows.splice(0,rows.length,...h.current().conversations);};
 return {onConversation,selectedConversationRef,selections,rows};
}
export function agentHarness({storage=memoryStorage(),props={},override}={}){
 const hooks=[],pending=[],events=[],calls=[],errors=[],conversations=[],intervals=new Map();let cursor=0,dirty=false,tree,currentProps,disposed=false,nextInterval=0;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useId=()=>`agent-fixture-${cursor++}`;
 const useEffect=(fn,deps)=>{const index=cursor++,previous=hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){const record={deps,cleanup:previous?.cleanup};hooks[index]=record;pending.push(()=>{record.cleanup?.();record.cleanup=fn();});}};
 const useSyncExternalStore=(subscribe,snapshot)=>{
  const value=snapshot(),rendered=useRef(value);rendered.current=value;
  useEffect(()=>subscribe(()=>{if(!Object.is(rendered.current,snapshot()))dirty=true;}),[subscribe,snapshot]);
  return value;
 };
 const useImperativeHandle=(ref,create,deps)=>useEffect(()=>{ref.current=create();return()=>{ref.current=null;};},deps);
 const standard=async(method,data)=>{
  if(method==='state')return {settings:{agentProvider:'codex'}};
  if(['settings','agent.disconnect'].includes(method))return {};
  if(method==='agent.connect')return {tools:{status:'ready',count:1}};
  if(method==='agent.account')return {account:{type:'chatgpt'},credentialStored:true};
  if(method==='conversation.list')return [];
  if(method==='conversation.select'&&data.new===true)return {fresh:true};
  if(method==='conversation.remember')return conversation(data.provider,data.threadId);
  if(method==='agent.queue'&&data.action==='read')return {queue:{provider:data.provider,threadId:data.threadId,revision:0,items:[],pause:null,after:null}};
  if(method==='agent.rpc'){
   if(data.method==='model/list')return {data:[{model:'fixture-model',isDefault:true,supportedReasoningEfforts:[]}]};
   if(['thread/resume','thread/read'].includes(data.method))return {thread:{id:data.params.threadId,turns:[]},model:'fixture-model'};
   if(data.method==='thread/start')return {thread:{id:'started-thread'}};
   if(data.method==='turn/start')return {turn:{id:'accepted-turn'}};
  }
  throw Error('Unexpected source fixture call '+method+' '+JSON.stringify(data));
 };
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const require=name=>{
  if(name==='react')return {useState,useRef,useEffect,useId,useLayoutEffect:useEffect,useSyncExternalStore,useImperativeHandle,Fragment:'fragment',memo:component=>component};
  if(name==='react/jsx-runtime'){const jsx=(type,props)=>typeof type==='function'?type(props):({type,props});return {jsx,jsxs:jsx,Fragment:'fragment'};}
  if(name==='./ConversationMessages'){const view={exports:{}};new Function('require','module','exports',messagesCompiled)(require,view,view.exports);return view.exports;}
  if(name==='./Composer'){const view={exports:{}};new Function('require','module','exports',composerCompiled)(require,view,view.exports);return view.exports;}
  if(name==='./ComposerQuestion'){const view={exports:{}};new Function('require','module','exports',questionsCompiled)(require,view,view.exports);return view.exports;}
  if(name==='./ChatMessage'){const child={exports:{}};new Function('require','module','exports',chatCompiled)(require,child,child.exports);return {default:props=>({type:'./ChatMessage',props:{...props,children:child.exports.default(props)}})};}
  if(Object.hasOwn(fileModules,name)){const child={exports:{}};new Function('require','module','exports',fileModules[name])(require,child,child.exports);return child.exports;}
  if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
  if(name==='../../ui/Notice'){
   const notice={exports:{}},source=fs.readFileSync(new URL('../../frontend/ui/Notice.tsx',import.meta.url),'utf8');
   const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
   new Function('require','module','exports',compiled)(require,notice,notice.exports);return notice.exports;
  }
  if(name==='../../../contracts/agent/codex-version.mjs')return codexVersion;
  if(name==='../../../contracts/agent/transcript-sanitizer.mjs')return transcript;
  if(name==='../../../contracts/agent/model-profiles.mjs')return modelProfiles;
  if(["./provider-account.mjs","../../../contracts/agent/provider-account.mjs","../conversations/provider-account.mjs"].includes(name))return account;
  if(["./composer-drafts.mjs"].includes(name))return drafts;
  if(name==='./follow-ups.mjs')return followUps;
  if(name==='../../../contracts/agent/chat-attachments.mjs')return chatAttachments;
  if(name==='./message-mapping.mjs')return messageMapping;
  if(name==='./reading-position.mjs')return readingPositions;
  if(["./resume-effort.mjs"].includes(name))return effort;
  if(name==='./elicitation-input.mjs')return elicitation;
  if(["./tool-activity.mjs","../../../contracts/agent/user-message.mjs"].includes(name))return activity;
  if(["./workflow-intent.mjs","../../../contracts/workflows/task-fields.mjs","../../ui/task-fields.mjs"].includes(name))return fields;
  if(["../../api/studio","../../api/agent"].includes(name))return {invoke,recoverConversation:data=>invoke('agent.recover',data)};
  if(name==='../../api/conversation-history')return {hasConversationHistory:()=>false};
  if(name==="../../ui/i18n"||name==='./i18n')return {t:value=>value,tr:value=>value};
  return {default:name};
 };
 const module={exports:{}};
 new Function('require','module','exports','localStorage','window','crypto','setInterval','clearInterval',compiled)(require,module,module.exports,storage,{studio:{onEvent:fn=>{events.push(fn);return()=>events.splice(events.indexOf(fn),1);}}},{randomUUID},fn=>{const id=++nextInterval;intervals.set(id,fn);return id;},id=>intervals.delete(id));
 currentProps={planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:error=>errors.push(String(error)),onConversation:value=>{conversations.push(value);if(value)storage.setItem('studio.conversation',value.id);else storage.removeItem('studio.conversation');},...props};
 function render(changes={}){currentProps={...currentProps,...changes};cursor=0;dirty=false;tree=module.exports.default(currentProps);return tree;}
 async function flush(){for(let i=0;i<18;i++){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function all(node){if(Array.isArray(node))return node.flatMap(value=>all(value));if(!node||typeof node!=='object')return [];return [node,...all(node.props?.children)];}
 const find=predicate=>{const found=all(tree).find(predicate);if(!found)throw Error('Source fixture node not found');return found;};
 const textarea=()=>find(node=>node.type==='textarea');
 function type(text){textarea().props.onChange({target:{value:text}});render();}
 function click(testId){find(node=>node.props?.['data-testid']===testId).props.onClick();}
 function send(){find(node=>node.type==='button'&&node.props?.['aria-label']==='发送').props.onClick();}
 function emit(event){for(const listener of [...events])listener(event);}
 function tick(){for(const callback of [...intervals.values()])callback();}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,flush,type,click,send,emit,tick,unmount,find,textarea,storage,calls,errors,conversations};
}
