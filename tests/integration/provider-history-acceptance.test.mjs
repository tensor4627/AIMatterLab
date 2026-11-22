import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {selectConversation} from '../../agent/sessions/conversation-selection.mjs';
import {createParallelAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {registerModelProfileRoutes} from '../../desktop/platform/model-profile-routes.mjs';

test('actual SQLite namespaced provider index preserves native routing and history sanitation across reopening',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studio-provider-history-'));let catalog=new Catalog(directory);t.after(()=>{catalog.db.close();fs.rmSync(directory,{recursive:true,force:true});});
 const codex=new EventEmitter();codex.close=()=>{};const makeHub=()=>new AgentHub({codex,root:directory,catalog,vault:{get:()=>null},settings:()=>({}),worker:()=>null}),hub=makeHub(),id='sk-native-opaque';
 hub.remember('compatible',{id,provider:'compatible',name:'Opaque conversation',turns:[]});catalog.put('compatible-codex-thread',id,{schemaVersion:1,id,nativeId:id,nativeTurns:[{id:'sk-turn-opaque',items:[{id:'sk-item-opaque',type:'mcpToolCall',arguments:{id:'sk-synthetic-secret',temperature_K:300},result:{content:[{type:'text',text:'energy_eV=-123.456789'}]}}]}],legacyTurns:[]});
 assert.equal(hub.threads('compatible')[0].id,id);hub.close();catalog.db.close();catalog=new Catalog(directory);assert.equal(makeHub().threads('compatible')[0].id,id);
 const restored=catalog.get('compatible-codex-thread',id),serialized=JSON.stringify(restored);assert.equal(restored.id,id);assert.equal(restored.nativeId,id);assert.equal(restored.nativeTurns[0].id,'sk-turn-opaque');assert.equal(restored.nativeTurns[0].items[0].id,'sk-item-opaque');assert.equal(restored.nativeTurns[0].items[0].arguments.id,'[redacted]');assert.equal(restored.nativeTurns[0].items[0].arguments.temperature_K,300);assert.match(serialized,/-123\.456789/);assert(!serialized.includes('sk-synthetic-secret'));
});

function historyFixture(t,provider){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-offline-api-')),keys=new Map(),calls=[];
 let catalog=new Catalog(root),agents,offline=false;
 t.after(()=>{agents?.close();catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const forbidden=kind=>{calls.push(kind);throw Error('Unexpected '+kind);};
 const vault={get:id=>offline?forbidden('credential read'):keys.get(id),put:(id,value)=>keys.set(id,value),remove:id=>keys.delete(id)};
 function initialize(){
  const records=new TaskRecords(catalog,()=>{}),authCodex=new EventEmitter();authCodex.close=()=>{};
  const workflowContext=createParallelAgentWorkflowContext({records,selectedProvider:()=>agents.active});
  agents=new ConversationAgentHub({root,catalog,vault,settings:()=>({}),authCodex,initialProvider:provider,createCodex:()=>forbidden('Codex transport'),
   worker:()=>forbidden('worker connection'),fetchApi:()=>forbidden('provider network'),
   runSession:workflowContext.runInSession,dropSession:workflowContext.dropSession,bindWorkerContext:()=>({rotated:false})});
  const dispatch=createAgentRequests({runtime:()=>({agents,catalog,taskRecords:records,workflowContext,
   resourceRouting:{capture:()=>{if(offline)forbidden('resource discovery');return null;}},
   scientificSkills:{clearManagedSelection(){},resolvePolicy:()=>forbidden('guidance assembly')},emit(){}})});
  const routes=new Map();registerModelProfileRoutes({agents,handle:(name,fn)=>routes.set(name,fn),assertIdle:()=>agents.assertContextIdle(),emit(){}});
  return {records,dispatch,routes,select:id=>selectConversation({catalog,records,workflowContext,agents},{id})};
 }
 const profile={id:'original',provider,name:'Original fixture',baseUrl:'https://source.invalid/v1',api:'openai-completions',models:[{id:'fixture'}]};
 return {initial:initialize(),profile,get catalog(){return catalog;},get agents(){return agents;},calls,
  setOffline:value=>{offline=value;},revokeKey:()=>keys.delete('model-provider-original'),
  reopen(){agents.close();catalog.db.close();catalog=new Catalog(root);return initialize();}};
}

for(const provider of ['qwen','compatible'])for(const change of ['removed','revoked credential','changed endpoint','changed protocol'])test(provider+' locally reads saved history after '+change+' and rejects provider operations without transport',async t=>{
 const h=historyFixture(t,provider),id='saved-thread',save=h.initial.routes.get('models.profiles.save');
 const saved=save({profile:h.profile,apiKey:'synthetic-profile-credential'});
 const conversation=h.initial.records.remember({provider,threadId:id,name:'Saved conversation'});
 h.catalog.put('api-dsh-history',id,{schemaVersion:1,harness:'dsh',provider,id,nativeId:'private-native-session',name:'Saved conversation',profileId:saved.id,apiEndpoint:saved.baseUrl,apiProtocol:saved.api,model:'api:original:fixture',updatedAt:1,turns:[
  {id:'saved-turn',status:'completed',items:[{id:'answer',type:'agentMessage',text:'Saved result sk-synthetic-history'}]},
  {id:'interrupted-turn',status:'inProgress',items:[{id:'tool',type:'mcpToolCall',status:'inProgress'}]},
 ]});
 h.catalog.put('agent-service-notification','note',{id:'note',provider,threadId:id,createdAt:123,text:'Worker note Bearer synthetic-secret'});
 const snapshot=h.catalog.get('api-dsh-history',id);
 save({profile:{...h.profile,id:'alternate',name:'Alternate configured fixture'},apiKey:'synthetic-alternate-credential'});
 if(change==='removed')h.initial.routes.get('models.profiles.remove')({id:saved.id,expectedRevision:saved.revision});
 else if(change==='revoked credential')h.revokeKey();
 else save({profile:{...h.profile,...change==='changed endpoint'?{baseUrl:'https://destination.invalid/v1'}:{api:'openai-responses'}},apiKey:'synthetic-replacement-credential',expectedRevision:saved.revision});
 const main=h.reopen();h.setOffline(true);
 assert.equal((await main.select(conversation.id)).id,conversation.id);
 const request=(method,params={})=>main.dispatch({provider,method,params:{threadId:id,...params}});
 const result=await request('thread/read',{includeTurns:true});
 assert.deepEqual([result.thread.provider,result.thread.id,result.studioSession.busy],[provider,id,false]);
 assert.equal(result.thread.turns[0].items[0].text,'Saved result [redacted]');
 assert.equal(result.thread.turns[1].items[0].status,'failed');
 assert.equal(result.thread.turns[2].items[0].text,'Worker note Bearer [redacted]');
 assert.doesNotMatch(JSON.stringify(result),/synthetic-|source\.invalid|private-native-session/);
 assert.deepEqual(h.catalog.get('api-dsh-history',id),snapshot);
 assert.equal(h.agents.bridge(provider,id),undefined);
 assert.deepEqual(h.calls,[]);
 h.setOffline(false);
 const rejected=change==='removed'?/配置不存在或已移除/:change==='revoked credential'?/填写此服务商的 API Key/:/地址或协议已变化/;
 await assert.rejects(h.agents.connect(provider,{threadId:id}),rejected);
 await assert.rejects(request('thread/resume'),rejected);
 const input=[{type:'text',text:'Do not send'}];
 await assert.rejects(request('turn/start',{input}),rejected);
 await assert.rejects(request('turn/start',{model:'api:alternate:fixture',input}),change==='revoked credential'?/不能.*切换/:rejected);
 assert(h.agents.bridge(provider,id)&&!h.agents.bridge(provider,id).process);
 h.setOffline(true);assert.deepEqual((await request('thread/read')).thread,result.thread);
 assert.deepEqual(h.calls,[]);
});

test('older compatible history remains local and generation, provider and deletion boundaries hold',async t=>{
 const h=historyFixture(t,'compatible'),id='legacy';
 const conversation=h.initial.records.remember({provider:'compatible',threadId:id,name:'Legacy'});
 h.catalog.put('compatible-codex-thread',id,{schemaVersion:1,id,apiEndpoint:'https://legacy.invalid/v1',model:'fixture',name:'Legacy',legacyTurns:[{id:'old',items:[{id:'old-item',type:'userMessage',text:'Legacy text'}]}],nativeTurns:[{id:'native',items:[{id:'native-item',type:'agentMessage',text:'Native text'}]}]});
 const main=h.reopen();h.setOffline(true);await main.select(conversation.id);
 const read=provider=>main.dispatch({provider,method:'thread/read',params:{threadId:id,includeTurns:true}});
 assert.deepEqual((await read('compatible')).thread.turns.map(turn=>turn.items[0].text),['Legacy text','Native text']);
 await assert.rejects(read('qwen'),/旧 Qwen CLI 会话/);
 assert.equal(h.catalog.get('api-dsh-history',id),null);
 main.records.remove(conversation.id);await assert.rejects(read('compatible'),/deleted/);
 assert.deepEqual(h.calls,[]);
});
