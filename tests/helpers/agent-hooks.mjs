// Deterministic source-level Agent hook harness. No browser, desktop or model service.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import * as account from '../../shared/provider-account.mjs';
import * as drafts from '../../shared/composer-drafts.mjs';
import * as effort from '../../shared/resume-effort.mjs';
import * as activity from '../../shared/tool-activity.mjs';
import * as fields from '../../shared/task-fields.mjs';
import {conversationSelectionHarness} from './conversation-selection-hooks.mjs';

const source=fs.readFileSync(process.env.STUDIO_AGENT_SOURCE?path.resolve(process.env.STUDIO_AGENT_SOURCE):new URL('../../src/Agent.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export function memoryStorage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
export function conversation(provider,threadId){return {id:provider+':'+threadId,provider,threadId,name:threadId,projectId:null,taskId:null};}
export function appConversationRecorder(storage){
 const h=conversationSelectionHarness({storage}),selectedConversationRef=h.current().selectedConversationRef,selections=[],rows=[];
 const onConversation=value=>{h.current().conversationChanged(value);h.render();selections.push(h.current().selectedConversationId);rows.splice(0,rows.length,...h.current().conversations);};
 return {onConversation,selectedConversationRef,selections,rows};
}
export function agentHarness({storage=memoryStorage(),props={},override}={}){
 const hooks=[],pending=[],events=[],calls=[],errors=[],conversations=[];let cursor=0,dirty=false,tree,currentProps,disposed=false;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,previous=hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){const record={deps,cleanup:previous?.cleanup};hooks[index]=record;pending.push(()=>{record.cleanup?.();record.cleanup=fn();});}};
 const standard=async(method,data)=>{
  if(method==='state')return {settings:{agentProvider:'codex'}};
  if(['settings','agent.disconnect'].includes(method))return {};
  if(method==='agent.connect')return {tools:{status:'ready',count:1}};
  if(method==='agent.account')return {account:{type:'chatgpt'},credentialStored:true};
  if(method==='conversation.list')return [];
  if(method==='conversation.remember')return conversation(data.provider,data.threadId);
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
  if(name==='react')return {useState,useRef,useEffect};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
  if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
  if(name==='../shared/provider-account.mjs')return account;
  if(name==='../shared/composer-drafts.mjs')return drafts;
  if(name==='../shared/resume-effort.mjs')return effort;
  if(name==='../shared/tool-activity.mjs')return activity;
  if(name==='../shared/task-fields.mjs')return fields;
  if(name==='./types')return {invoke,recoverConversation:data=>invoke('agent.recover',data)};
  if(name==='./i18n')return {t:value=>value,tr:value=>value};
  return {default:name};
 };
 const module={exports:{}};
 new Function('require','module','exports','localStorage','window','crypto','setInterval','clearInterval',compiled)(require,module,module.exports,storage,{studio:{onEvent:fn=>{events.push(fn);return()=>events.splice(events.indexOf(fn),1);}}},{randomUUID},()=>1,()=>{});
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
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,flush,type,click,send,emit,unmount,find,textarea,storage,calls,errors,conversations};
}
