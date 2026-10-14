import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TaskRecords,structuredResult} from '../desktop/task-records.mjs';
import {AgentHub} from '../desktop/agent-hub.mjs';
test('Task intent opens a durable central record before model or worker output',()=>{
 const records=new Map(),events=[],catalog={get:(k,id)=>records.get(k+id),put:(k,id,v)=>records.set(k+id,v)};
 const store=new TaskRecords(catalog,e=>events.push(e)),task=store.create({planningMode:true,provider:'codex',request:'Prepare MD parameters',projectId:'project'});
 assert.equal(events[0].method,'studio/taskUpdated');assert.equal(task.phase,'collecting');
 store.attach(task.id,'codex','thread');
 store.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{result:{content:[{type:'text',text:JSON.stringify({id:task.id,kind:'task-parameters',name:'MD draft',steps:['prepare','review'],parameters:{temperature:300},missing_fields:['model']})}]}}}});
 const saved=catalog.get('agent-task',task.id);assert.equal(saved.parameters.temperature,300);assert.deepEqual(saved.missingFields,['model']);assert.equal(saved.plan[0].assistantStatus,'proposed');
 assert(!('status' in saved));assert(!('validation' in saved));
});
test('Artifacts and native plans never cross the selected task provider',()=>{
 const records=new Map(),catalog={get:(k,id)=>records.get(k+id),put:(k,id,v)=>records.set(k+id,v)},store=new TaskRecords(catalog,()=>{});
 const task=store.create({planningMode:true,provider:'kimi',request:'Bias task'});assert.throws(()=>store.attach(task.id,'qwen','s'));
 store.attach(task.id,'kimi','s');store.event({provider:'qwen',method:'turn/plan/updated',params:{threadId:'s',plan:[{step:'not mine',status:'completed'}]}});assert.equal(catalog.get('agent-task',task.id).plan.length,0);
 const artifact={id:'remote',kind:'cluster-run',engine:'pydyn.md',parameters:{temperature:300}};
 assert.equal(structuredResult({structuredContent:artifact})[0],artifact);
 store.event({provider:'kimi',method:'item/completed',params:{threadId:'s',item:{result:{content:[{type:'text',text:JSON.stringify(artifact)}]}}}});
 assert.equal(catalog.get('agent-task',task.id).artifacts[0].kind,'cluster-run');
});
test('Codex login completion comes from the real protocol event and account query',async()=>{
 const codex=new EventEmitter();codex.process={};codex.start=async()=>({});codex.request=async(method,params)=>method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.test'},requiresOpenaiAuth:true}:{type:'chatgptDeviceCode',loginId:'login',verificationUrl:'https://auth.openai.com/device',userCode:'fixture'};
 const hub=new AgentHub({codex,catalog:{list:()=>[]},vault:{get:()=>null},settings:()=>({codexPath:'fixture'}),worker:()=>null});
 const start=await hub.login('codex',{type:'chatgptDeviceCode'});assert.equal(start.phase,'authorizing');assert.equal(start.userCode,'fixture');
 codex.emit('event',{method:'account/login/completed',params:{success:true}});const account=await hub.account('codex');assert.equal(account.phase,'completed');assert.equal(account.account.type,'chatgpt');assert.equal(account.modelAccess,'not_run');
});

test('Unbound chat creates no task; a bound conversation can refine its persistent workflow without planning',()=>{
 const records=new Map(),events=[],catalog={get:(k,id)=>records.get(k+id),put:(k,id,v)=>records.set(k+id,v)},store=new TaskRecords(catalog,e=>events.push(e));
 assert.throws(()=>store.create({provider:'codex',request:'chat'}),/Enable task planning/);assert.equal(events.length,0);
 const chat=store.prepareTurn('codex',{planningMode:false,threadId:'unbound',input:[]});assert.match(chat.input.at(-1).text,/mode: chat/);
 const task=store.create({planningMode:true,provider:'codex',request:'plan',threadId:'thread'});
 const planning=store.prepareTurn('codex',{planningMode:true,studioTaskId:task.id,threadId:'thread',input:[]});assert(!('planningMode' in planning));assert(!('studioTaskId' in planning));assert.match(planning.input.at(-1).text,/mode: planning/);
 const continued=store.prepareTurn('codex',{planningMode:false,studioTaskId:task.id,threadId:'thread',input:[]});assert.match(continued.input.at(-1).text,/mode: workflow/);assert(continued.input.at(-1).text.includes(task.id));
 assert.throws(()=>store.prepareTurn('codex',{planningMode:'true',threadId:'thread'}));
});

test('Consecutive parameter saves always advance the renderer revision',()=>{
 const records=new Map(),catalog={get:(k,id)=>records.get(k+id),put:(k,id,v)=>records.set(k+id,v)},store=new TaskRecords(catalog,()=>{});
 const clock=Date.now;Date.now=()=>100;
 try{const task=store.create({planningMode:true,provider:'codex',request:'plan'}),initial=task.updatedAt;store.save(task);const first=task.updatedAt;store.save(task);assert(first>initial);assert(task.updatedAt>first);}finally{Date.now=clock;}
});
