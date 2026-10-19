import test from 'node:test';import assert from 'node:assert/strict';
import {verifyProviderAccess,providerSentinelObserver} from '../desktop/install-verification.mjs';
function fixture({models=[{model:'fixture-model',isDefault:true}],account=null,auth=true}={}){const calls=[];return {calls,invoke:async(method,data)=>{calls.push({method,data});if(method==='agent.connect')return {};if(method==='agent.account')return {account,requiresOpenaiAuth:auth};if(data.method==='model/list')return {data:models,authRequired:auth};if(data.method==='thread/start')return {thread:{id:'actual-thread'}};throw Error('Unexpected RPC');}};}
test('Unavailable account metadata cannot replace a real successful provider turn',async()=>{
 const {calls,invoke}=fixture();let turns=0;const result=await verifyProviderAccess('codex',invoke,async payload=>{turns++;assert.equal(payload.params.threadId,'actual-thread');assert.equal(payload.params.planningMode,false);assert.equal(payload.params.input.length,1);return {status:'passed',toolCalls:0};});
 assert.equal(turns,1);assert.equal(result.status,'passed');assert.equal(result.modelAccess,'passed');assert.deepEqual(result.accountMetadata,{available:false,requiresOpenaiAuth:true,catalogAuthRequired:true});assert.equal(calls.filter(call=>call.data?.method==='thread/start').length,1);assert.equal(result.account,undefined);
});
test('Account records and model catalogs never replace an unsuccessful real provider call',async()=>{
 for(const status of ['blocked','failed']){const {invoke}=fixture({account:{type:'chatgpt'},auth:false});const result=await verifyProviderAccess('codex',invoke,async()=>({status,reason:'actual request rejected or timed out'}));assert.equal(result.status,status);assert.notEqual(result.modelAccess,'passed');}
});
test('Empty model catalog stops with an identified stage without fabricating a reply',async()=>{
 const {invoke,calls}=fixture({models:[]});const stages=[];await assert.rejects(()=>verifyProviderAccess('codex',invoke,async()=>{throw Error('must not run');},stage=>stages.push(stage)),/No callable model catalog/);assert.equal(stages.at(-1),'model_list');assert(!calls.some(call=>call.data?.method==='thread/start'));
});

test('Installer sentinel rejects all native, MCP and unknown executable items, including completed-only items',()=>{
 for(const type of ['mcpToolCall','commandExecution','fileChange','dynamicToolCall','collabAgentToolCall','webSearch','imageView','imageGeneration','functionCallOutput','futureUnknownTool']){
  const observe=providerSentinelObserver('codex','t');observe({provider:'codex',method:'item/completed',params:{threadId:'t',item:{id:'native',type}}});observe({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'t',itemId:'a',delta:'STUDIO_INSTALL_AGENT_OK'}});const result=observe({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});assert.equal(result.status,'failed',type);assert.equal(result.toolCalls,1);assert.deepEqual(result.toolItems,[{id:'native',type}]);
 }
});
test('Installer observer accepts exact completed replies, deduplicates item lifecycle and ignores other threads/providers',()=>{
 const observe=providerSentinelObserver('codex','t');for(const [provider,threadId] of [['kimi','t'],['codex','other']])observe({provider,method:'item/started',params:{threadId,item:{id:'elsewhere',type:'commandExecution'}}});for(const method of ['item/started','item/completed'])observe({provider:'codex',method,params:{threadId:'t',item:{id:'a',type:'agentMessage',text:'STUDIO_INSTALL_AGENT_OK'}}});const result=observe({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});assert.equal(result.status,'passed');assert.deepEqual(result.itemTypes,['agentMessage']);assert.equal(result.toolCalls,0);
 const wrong=providerSentinelObserver('codex','t');wrong({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'t',delta:'extra STUDIO_INSTALL_AGENT_OK'}});assert.equal(wrong({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}}).status,'failed');
});
