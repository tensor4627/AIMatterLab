import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';

for(const provider of ['qwen','compatible'])test(provider+' resolves its exact model profile before public guidance assembly',async()=>{
 const calls=[],runtime={agents:{selectContext:async()=>{calls.push('synchronize');},bridge:value=>{assert.equal(value,provider);return {prepareTurnModel:params=>{assert.equal(params.model,'api:fixture:model-a');calls.push('profile');return ()=>calls.push('current');}};}},scientificSkills:{clearManagedSelection:()=>calls.push('clear')},assertIdleAgent(){},workflowContext:{begin:()=>({}),current:()=>({}),assert(){},synchronize:async(_ticket,bind)=>bind(provider,{})},worker:{providerConnection:()=>{calls.push('guidance-boundary');throw Error('fixture stopped before reading any guidance');}}};
 const rpc=createAgentRequests({runtime:()=>runtime});await assert.rejects(rpc({provider,method:'turn/start',params:{threadId:'fixture-thread',model:'api:fixture:model-a',input:[{type:'text',text:'Fixture'}]}}),/stopped before reading/);
 assert(calls.indexOf('synchronize')<calls.indexOf('profile'));assert(calls.indexOf('profile')<calls.indexOf('guidance-boundary'));
});

test('a model profile rejected during selection never reaches workspace or guidance reads',async()=>{
 let reads=0;const rpc=createAgentRequests({runtime:()=>({agents:{selectContext:async()=>{},bridge:()=>({prepareTurnModel:()=>{throw Error('Foreign API profile');}})},scientificSkills:{clearManagedSelection(){}},assertIdleAgent(){},workflowContext:{begin:()=>({}),current:()=>({}),assert(){},synchronize:async(_ticket,bind)=>bind('qwen',{})},worker:{providerConnection:()=>reads++}})});
 await assert.rejects(rpc({provider:'qwen',method:'turn/start',params:{threadId:'fixture-thread',model:'api:foreign:model',input:[{type:'text',text:'Fixture'}]}}),/Foreign API profile/);assert.equal(reads,0);
});
