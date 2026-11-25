import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,deferred} from '../helpers/agent-hooks.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';

const starts=h=>h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start');
const acceptedTurnId=number=>'planning-turn-'+number;
const newThread=h=>h.calls.find(call=>call.method==='agent.rpc'&&call.data.method==='thread/start')?.data.params;
async function finish(h){
 const {threadId}=starts(h).at(-1).data.params;
 h.emit({provider:'codex',method:'turn/completed',params:{threadId,turn:{id:acceptedTurnId(starts(h).length),status:'completed'}}});
 await h.flush();
}
async function connect({override,...options}={}){
 let accepted=0;
 const h=agentHarness({...options,override:async(method,data,standard)=>{
  const response=await (override?override(method,data,standard):standard(method,data));
  if(method==='agent.rpc'&&data.method==='turn/start')return {...response,turn:{...response.turn,id:acceptedTurnId(++accepted)}};
  return response;
 }});
 await h.flush();h.click('agent-connect');await h.flush();return h;
}
function records(){
 const rows=new Map(),store={get:(kind,id)=>structuredClone(rows.get(kind+':'+id)??null),put(kind,id,value){rows.set(kind+':'+id,structuredClone(value));},list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value))};
 return {rows,records:new TaskRecords(store,()=>{})};
}
test('discussion then enabling planning creates one workflow in the same conversation and keeps it when toggled off',async()=>{
 const f=records(),prepared=[],opened=[];
 const h=await connect({props:{onOpenTask:id=>opened.push(id)},override:(method,data,standard)=>{
  if(method==='conversation.remember')return f.records.remember(data);
  if(method==='task.create')return f.records.create(data);
  if(method==='agent.rpc'&&data.method==='turn/start')prepared.push(f.records.prepareTurn(data.provider,data.params));
  return standard(method,data);
 }});
 try{
  h.type('先讨论同一个测试方案');h.send();await h.flush();assert.equal(starts(h)[0].data.params.planningMode,false);assert.equal(f.records.tasks().length,0);await finish(h);
  h.render({planningMode:true});h.type('按刚才的方案开始规划');h.send();await h.flush();assert.equal(starts(h)[1].data.params.planningMode,true);assert.equal(f.records.tasks().length,1);const task=f.records.tasks()[0];assert.equal(starts(h)[1].data.params.threadId,'started-thread');assert.equal(starts(h)[1].data.params.studioTaskId,task.id);assert.deepEqual(opened,[task.id]);assert.match(prepared[1].input.at(-1).text,/mode: planning/);await finish(h);
  h.render({planningMode:false});h.type('继续讨论已绑定的同一流程');h.send();await h.flush();assert.equal(starts(h)[2].data.params.planningMode,false);assert.equal(starts(h)[2].data.params.studioTaskId,task.id);assert.match(prepared[2].input.at(-1).text,/mode: workflow/);assert.equal(f.records.tasks().length,1);
  assert.equal(h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='thread/start').length,1);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

const terminal={kind:'ssh-terminal',selectionId:'saved-selection',profileId:'saved-profile',profileVersion:1,sessionId:'selected-session',status:'selected',alive:true,agentReady:true,operator:'agent'};
for(const selected of [true,false])test('terminal-only planning checkbox is sent truthfully without creating a workflow or switching resources: selected='+selected,async()=>{
 let choices=0;
 const h=await connect({props:{computeResource:selected?terminal:null,onConnectCompute:()=>choices++},override:(m,d,s)=>m==='agent.connect'?{tools:{status:'ready',scope:'terminal-only',count:3}}:s(m,d)});
 try{
  h.type('先讨论终端检查');h.send();await h.flush();assert.equal(starts(h)[0].data.params.planningMode,false);await finish(h);
  h.render({planningMode:true});assert.equal(h.find(n=>n.props?.['data-testid']==='agent-planning-mode').props.checked,true);const notice=h.find(n=>n.props?.['data-testid']==='agent-planning-terminal-notice');assert.match(JSON.stringify(notice),/任务规划已开启/);assert.match(JSON.stringify(notice),/连接作业服务/);assert.equal(choices,0);assert.equal(starts(h).length,1,'toggle never sends a message');
  h.type('现在整理规划方案');h.send();await h.flush();assert.equal(starts(h)[1].data.params.planningMode,true);assert.equal(starts(h)[1].data.params.threadId,'started-thread');assert.equal(h.calls.some(c=>c.method==='task.create'),false);assert.equal(h.calls.some(c=>c.method==='compute.resource.activate'||c.method==='worker.connect'||c.method==='task.execute'),false);assert.equal(choices,0);await finish(h);
  h.click('agent-planning-connect-worker');await h.flush();assert.equal(choices,1);assert.equal(starts(h).length,2);h.render({planningMode:false});assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-planning-terminal-notice'));h.type('回到普通讨论');h.send();await h.flush();assert.equal(starts(h)[2].data.params.planningMode,false);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
const sshConnection={schemaVersion:2,kind:'ssh-connection',selectionId:'sel-managed',connectionId:'conn-managed',profileId:'saved-profile',profileVersion:1,sessionId:null,terminalSessionIds:[],status:'selected',connectionStatus:'authenticated',alive:true,agentReady:false,operator:'human',authentication:'verified',managedRuns:false,workflowReady:false,capabilities:{terminal:{status:'closed',sessionIds:[],agentReady:false,operator:'human'},service:{status:'disconnected',agentReady:false,operator:'human',workflowReady:false},files:{status:'unavailable',via:null}}};
test('managed compute planning never shows terminal-only notice or blocks workflow creation',async()=>{
 const f=records();
 const h=await connect({
  props:{planningMode:true,computeConnected:false,computeResource:sshConnection},
  override:(m,d,s)=>{
   if(m==='agent.connect')return {tools:{status:'ready',scope:'terminal-only',count:0,managedCompute:true,managedTools:{status:'ready',count:3}}};
   if(m==='conversation.remember')return f.records.remember(d);
   if(m==='task.create')return f.records.create(d);
   return s(m,d);
  }
 });
 try{
  assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-planning-terminal-notice'));
  h.type('请创建托管规划流程');h.send();await h.flush();
  assert.equal(newThread(h).studioPlanningThread,true);
  assert.equal(f.records.tasks().length,1);
  assert.equal(starts(h).length,1);
  assert.equal(starts(h)[0].data.params.planningMode,true);
  assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
test('send preparation keeps the mode chosen at submit time despite later parent state changes',async()=>{
 const pending=deferred(),f=records();
 const h=await connect({props:{planningMode:true},override:(m,d,s)=>{
  if(m==='conversation.remember')return pending.promise.then(()=>f.records.remember(d));
  if(m==='task.create')return f.records.create(d);
  return s(m,d);
 }});
 try{h.type('准备当前模式');h.send();await h.flush();assert.equal(newThread(h).studioPlanningThread,true);h.render({planningMode:false});pending.resolve();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.planningMode,true);assert.equal(f.records.tasks().length,1);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

test('managedCompute mode ignores leftover legacy ssh-terminal binding when starting planning turns',async()=>{
 const f=records(),legacy={schemaVersion:1,selectionId:'legacy-ssh',kind:'ssh-terminal',profileId:'profile',profileVersion:1,sessionId:'legacy-shell',status:'selected',alive:true,authentication:'verified',operator:'human'};
 const h=await connect({props:{planningMode:true,computeResource:legacy},override:(m,d,s)=>m==='agent.connect'?{tools:{status:'ready',count:1,managedCompute:true}}:m==='conversation.remember'?f.records.remember(d):m==='task.create'?f.records.create(d):s(m,d)});
 try{
  h.type('请核对任务参数');h.send();await h.flush();
  assert.equal(starts(h).length,1);
  assert.equal(starts(h)[0].data.params.planningMode,true);
  assert.equal(f.records.tasks().length,1);
  assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
