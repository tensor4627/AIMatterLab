import test from 'node:test';import assert from 'node:assert/strict';
import {conversationTitle} from "../../contracts/agent/conversation-title.mjs";

import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {providerAccountState} from "../../frontend/features/conversations/provider-account.mjs";


test('scientific chat titles summarize the system and method instead of storing the request sentence',()=>{
 const request='我希望用 PyDyn 为 Cu 做一个分子动力学模拟，温度300K，请帮我把整个流程设计好';
 assert.equal(conversationTitle(request),'Cu · PyDyn · 分子动力学');
 assert.equal(conversationTitle(request,{name:'Cu 扩散对比'}),'Cu 扩散对比');
 assert.equal(conversationTitle('你好，我想聊聊'),'日常交流');
 assert(conversationTitle('请帮我做LLZO的NEB能垒测试，并给我很详细的计算流程').length<=36);
});
test('manual names survive future model proposals and preserve workflow identity and recency',()=>{
 const rows=new Map(),events=[],catalog={get:(k,id)=>structuredClone(rows.get(k+id)),put:(k,id,v)=>rows.set(k+id,structuredClone(v)),list:k=>[...rows.entries()].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v))};const records=new TaskRecords(catalog,e=>events.push(e));
 const task=records.create({planningMode:true,workflowVersion:2,provider:'deepseek',threadId:'same-thread',request:'请为 Cu 做分子动力学'});const original=records.conversation('deepseek','same-thread');
 const changed=records.rename({id:original.id,name:'Cu 生产前检查'});assert.equal(changed.updatedAt,original.updatedAt);assert.equal(changed.taskId,task.id);
 records.event({provider:'deepseek',method:'item/completed',params:{threadId:'same-thread',item:{result:{kind:'task-parameters',id:task.id,name:'AI 自动重命名',steps:[],parameters:{temperature:300},missing_fields:[]}}}});
 assert.equal(records.conversation('deepseek','same-thread').name,'Cu 生产前检查');assert.equal(new TaskRecords(catalog,()=>{}).conversations()[0].name,'Cu 生产前检查');
 for(const name of ['','\n','bad\nname','a'.repeat(61)])assert.throws(()=>records.rename({id:original.id,name}));
});
test('global account presence is independent of conversation execution or model access claims',()=>{
 assert.equal(providerAccountState('codex',{account:null,requiresOpenaiAuth:true}),'missing');
 assert.equal(providerAccountState('codex',{account:{type:'chatgpt'},modelAccess:'not_run'}),'configured');
 assert.equal(providerAccountState('compatible',{credentialStored:true,modelAccess:'not_run'}),'configured');
 assert.equal(providerAccountState('deepseek',{credentialStored:false}),'missing');
 assert.equal(providerAccountState('kimi',{}),'unknown');
});
