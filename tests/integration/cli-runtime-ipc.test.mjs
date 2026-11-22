import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {cliRuntimeRequest} from '../../contracts/agent/cli-runtime.mjs';
import {providerId} from '../../agent/providers/contracts.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';
import {selectConversation} from '../../agent/sessions/conversation-selection.mjs';
import {createParallelAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function nodeText(predicate){let found;function visit(node){if(predicate(node))found=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(found);return found;}
const callback=route=>{const call=nodeText(node=>ts.isCallExpression(node)&&node.expression.getText(tree)==='handle'&&node.arguments[0]?.text===route);return call.slice(call.indexOf(',')+1,-1);};
const compile=(text,ports)=>new Function(...Object.keys(ports),'return ('+text+');')(...Object.values(ports));
const routes=['agent.cli.inspect','agent.cli.choose','agent.cli.install','agent.cli.cancel'];
test('exact CLI request contract refuses renderer paths, URLs and unsupported providers',()=>{
 for(const value of [null,[],{provider:'codex'},{provider:'kimi',url:'https://example.com'},{provider:'qwen',executable:'C:\\arbitrary.exe'},{provider:'qwen',directory:'elsewhere'}])assert.throws(()=>cliRuntimeRequest(value));
 for(const requestId of ['', '../escape',123])assert.throws(()=>cliRuntimeRequest({provider:'kimi',requestId},{installation:true}));
 assert.deepEqual(cliRuntimeRequest({provider:'kimi'}),{provider:'kimi'});assert.deepEqual(cliRuntimeRequest({provider:'qwen',requestId:'owned-1'},{installation:true}),{provider:'qwen',requestId:'owned-1'});
});
test('actual new main handlers retain the common sender and top-frame checks',async()=>{
 const registered=new Map(),calls=[],window={isDestroyed:()=>false,webContents:{id:7,isDestroyed:()=>false,getURL:()=> 'file:///owned/index.html'}},trusted=compile(nodeText(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='trusted'),{window});
 const handle=compile(nodeText(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='handle'),{window,shuttingDown:false,trusted,ipcMain:{handle:(name,fn)=>registered.set(name,fn)}});
 const ports={cliRuntimeRequest,cliRuntimes:{inspect:async()=>{calls.push('inspect');return {};},install:async()=>{calls.push('install');return {};},cancel:async()=>{calls.push('cancel');return {};}},dialog:{showOpenDialog:async()=>{calls.push('choose');return {canceled:true};}},window};
 for(const route of routes)handle(route,compile(callback(route),ports));
 const event={sender:{id:7,isDestroyed:()=>false},senderFrame:{url:'file:///owned/index.html',parent:null}};
 for(const route of routes){const fn=registered.get('studio:'+route),value=route.endsWith('install')||route.endsWith('cancel')?{provider:'kimi',requestId:'owned'}:{provider:'kimi'};
  for(const forged of [{...event,sender:{...event.sender,id:8}},{...event,senderFrame:{...event.senderFrame,parent:{}}},{...event,senderFrame:{...event.senderFrame,url:'https://untrusted.invalid/'}}])await assert.rejects(fn(forged,value),/Untrusted/);
  await fn(event,value);
 }
 assert.deepEqual(calls,['inspect','choose','install','cancel']);
});
test('native chooser saves only a ready native selection and never accepts a renderer executable',async()=>{
 for(const status of ['ready','missing','incompatible','invalid','failed']){
  const calls=[],selected='C:\\native-selected\\kimi.cmd',ports={cliRuntimeRequest,window:{},settings:{kimiPath:'previous'},normalizeSettings:(current,patch)=>({...current,...patch}),catalog:{put:(kind,id,value)=>{calls.push({method:'save',value});return value;}},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[selected]})},cliRuntimes:{inspect:async value=>{calls.push({method:'inspect',value});return {provider:'kimi',status,executable:'resolved-real-entry.mjs'};}}};
  const run=compile(callback('agent.cli.choose'),ports);await assert.rejects(run({provider:'kimi',executable:'forged'}));await run({provider:'kimi'});
  assert.deepEqual(calls[0],{method:'inspect',value:{provider:'kimi',executable:selected}});assert.equal(calls.filter(call=>call.method==='save').length,status==='ready'?1:0);if(status==='ready')assert.equal(calls[1].value.kimiPath,selected);
 }
});
function connectFixture(t,connect){
 const events=[],rows=new Map(),catalog={
  get:(kind,id)=>rows.get(kind+':'+id),
  put:(kind,id,value)=>{rows.set(kind+':'+id,value);return value;},
 };
 const records=new TaskRecords(catalog,event=>events.push(event));
 const createCodex=()=>({close(){}});
 const agents=new ConversationAgentHub({initialProvider:'kimi',authCodex:createCodex(),createCodex,catalog,root:process.cwd(),
  settings:()=>({}),vault:{get:()=>null},createHub:options=>{
   const hub=new AgentHub(options);
   hub.connect=connect;
   return hub;
  },runSession:(identity,run)=>workflowContext.runInSession(identity,run),dropSession:id=>workflowContext.dropSession(id)});
 const workflowContext=createParallelAgentWorkflowContext({records,selectedProvider:()=>agents.foregroundProvider});
 t.after(()=>agents.close());
 const ports={providerId,workflowContext,agentConnectAttempts:new Map(),resourceRouting:{capture:()=>({selection:null,assertCurrent(){}})},
  settings:{},catalog,agents,scientificTools:async()=>({status:'not_run'}),subscriptionRuntime:{envImport:{settings:()=>({defaults:null})}},
  emit:(channel,event)=>{assert.equal(channel,'studio:event');events.push(event);}};
 const select=(provider,threadId)=>{
  if(threadId)records.remember({provider,threadId,name:threadId,projectId:null});
  return selectConversation({catalog,records,workflowContext,agents},threadId?{id:provider+':'+threadId}:{new:true,provider});
 };
 return {events,agents,select,run:compile(callback('agent.connect'),ports)};
}
test('main emits CLI installation prompt only for a current, actionable CLI failure',async t=>{
 for(const status of ['missing','incompatible','invalid','failed']){
  const readiness={provider:'kimi',status},failure=Object.assign(Error('fixture'),{readiness});
  const f=connectFixture(t,async()=>{throw failure;});
  if(status==='failed')await assert.rejects(f.run({provider:'kimi'}),error=>error===failure);
  else assert.deepEqual(await f.run({provider:'kimi'}),{cliRequired:readiness});
  assert.deepEqual(f.events,status==='failed'?[]:[{method:'studio/cliRuntimeRequired',provider:'kimi',params:readiness}]);
 }
 const codexFailure=Object.assign(Error('fixture'),{readiness:{provider:'codex',status:'missing'}});
 const f=connectFixture(t,async()=>{throw codexFailure;});
 await assert.rejects(f.run({provider:'codex'}),error=>error===codexFailure);
 assert.deepEqual(f.events,[]);
});
test('late CLI failure stays with its caller when foreground changes and other sessions remain independent',async t=>{
 let rejectBlank;
 const blank=new Promise((_resolve,reject)=>{rejectBlank=reject;});
 const draft=connectFixture(t,async provider=>provider==='kimi'?blank:{protocolVersion:1});
 const blankFailure=Object.assign(Error('old blank connection'),{readiness:{provider:'kimi',status:'missing'}});
 const blankRejected=assert.rejects(draft.run({provider:'kimi'}),error=>error===blankFailure);
 assert.equal((await draft.run({provider:'qwen'})).protocolVersion,1);
 rejectBlank(blankFailure);
 await blankRejected;
 assert.equal(draft.agents.foregroundProvider,'qwen');
 assert.deepEqual(draft.events,[{method:'studio/toolsStatus',provider:'qwen',params:{status:'not_run'}}]);
 for(const returnToOriginal of [false,true]){
  let reject;
  const pending=new Promise((_resolve,no)=>{reject=no;}),seen=[];
  const f=connectFixture(t,async(provider,{threadId})=>{
   seen.push([provider,threadId]);
   if(threadId==='original')return pending;
   return {protocolVersion:1};
  });
  await f.select('kimi','original');
  const original=f.agents.sessionIdentity('kimi','original');
  const failure=Object.assign(Error('old missing'),{readiness:{provider:'kimi',status:'missing'}});
  const rejected=assert.rejects(f.run({provider:'kimi',threadId:'original'}),error=>error===failure);
  const nextProvider=returnToOriginal?'kimi':'qwen';
  await f.select(nextProvider,'newer');
  assert.equal((await f.run({provider:nextProvider,threadId:'newer'})).protocolVersion,1);
  const foreground=f.agents.sessionIdentity(nextProvider);
  assert.equal((await f.run({provider:'kimi',threadId:'background'})).protocolVersion,1);
  assert.equal(f.agents.sessionIdentity(nextProvider).id,foreground.id);
  if(returnToOriginal){
   await f.select('kimi','original');
   assert.equal(f.agents.sessionIdentity('kimi').id,original.id);
  }
  reject(failure);
  await rejected;
  assert.deepEqual(seen,[['kimi','original'],[nextProvider,'newer'],['kimi','background']]);
  assert(!f.events.some(event=>event.method==='studio/cliRuntimeRequired'));
 }
});
test('preload exposes four named runtime routes without a generic command or download surface',async()=>{
 const calls=[];let studio;vm.runInNewContext(fs.readFileSync(new URL('../../desktop/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{studio=value;}},ipcRenderer:{invoke:async(channel,data)=>{calls.push({channel,data});return {};}}};}});
 for(const route of routes)await studio.invoke(route,{provider:'kimi'});for(const route of ['agent.cli.execute','agent.cli.downloadUrl','agent.cli.shell'])await assert.rejects(studio.invoke(route,{}),/Unsupported method/);assert.equal(calls.length,4);
});

test('source and packaged main use physical PTY resource roots for deferred Qwen installation',()=>{
 const root=path.resolve('fixture-checkout'),resources=path.resolve('fixture-resources');
 for(const isPackaged of [false,true]){
  const options=compile(nodeText(node=>ts.isCallExpression(node)&&node.expression.getText(tree)==='createCliRuntimeManager'),{root,path,process:{resourcesPath:resources},app:{isPackaged,getPath:()=>path.resolve('fixture-profile')},settings:{},net:{},emit(){},createCliRuntimeManager:value=>value});
  assert.equal(options.dependencyRoot,isPackaged?path.join(resources,'agent-runtimes'):path.join(root,'.studio','agent-runtimes'));
 }
 const pkg=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 for(const name of ['build','dev','start'])assert(pkg.scripts[name].includes('node scripts/stage-agents.mjs'),name+' must prepare the native-only physical core');
 assert(!pkg.scripts.pack.includes('stage:agents'),'pack reuses the stage already prepared by build');
});
