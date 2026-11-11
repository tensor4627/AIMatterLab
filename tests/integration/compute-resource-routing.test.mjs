import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';import {EventEmitter} from 'node:events';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';import {CodexBridge} from '../../agent/providers/codex.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
const clone=value=>structuredClone(value),deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const main=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',main,ts.ScriptTarget.Latest,true);
function find(predicate){let value;function visit(node){if(predicate(node))value=node;ts.forEachChild(node,visit);}visit(ast);assert(value,'Actual main wiring is present');return value.getText(ast);}
const initializer=name=>{let value;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)value=node.initializer?.getText(ast);if(ts.isBinaryExpression(node)&&node.left.getText(ast)===name)value=node.right.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(value,name);return value;};
async function fixture(t,{connectedWorker=true}={}){
 const rows=new Map(),cache=[],calls=[],events=[],revokes=[];let serial=1,ready=false,readySession=null,profileValid=true,readGate,readEntered;
 const owner={provider:'codex',threadId:'thread',taskId:null,projectId:null,environmentId:null,inputRoot:null};
 const catalog={get:(kind,id)=>clone(rows.get(kind+':'+id)),put:(kind,id,value)=>{rows.set(kind+':'+id,clone(value));cache.push({kind,id,value:clone(value)});return clone(value);},remove:(kind,id)=>rows.delete(kind+':'+id),list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>clone(value))};
 const profiles={read:({id,version})=>{if(!profileValid)throw Error('Changed');return {id,version,kind:'ssh',name:'Fixture'};}};
 const shared={tools:()=>[],hasCurrentGrant:(provider,sessionId)=>ready&&provider==='codex'&&(!sessionId||sessionId===readySession),resourceState:async({sessionId})=>{if(readGate){readEntered.resolve();await readGate.promise;}const allowed=ready&&sessionId===readySession;return {resource:{kind:'ssh-terminal',profileId:'profile',profileVersion:1},sessionId,operator:allowed?'agent':'human',ownerEpoch:allowed?1:0,processStatus:'running',alive:true,agentReady:allowed,authentication:'not_observed',managedRuns:false};}};
 const worker=new WorkerClient();worker.request=()=>assert.fail('Selected SSH must not access WSL worker APIs');if(connectedWorker){worker.connection={url:'http://127.0.0.1:31234',tokens:{admin:'synthetic-admin',mcp:'synthetic-mcp'},transport:'localhost'};worker.identity={distribution:'Fixture',root:'/untouched'};worker.connectionTarget={distribution:'Fixture',root:'/untouched',port:31234};}
 const revoke=worker.revokeProvider.bind(worker);worker.revokeProvider=provider=>{revokes.push(provider);revoke(provider);};
 const terminalMcp=new TerminalMcp({terminal:shared});await terminalMcp.start();
 const codex=new EventEmitter();codex.activeTurns=new Set();codex.starts=0;codex.closes=0;codex.process={};codex.close=()=>{codex.closes++;codex.process=null;codex.emit('event',{method:'studio/codexDisconnected',params:{}});};codex.start=async(_file,connection)=>{codex.starts++;codex.process={};codex.attached=connection;return {};};codex.request=async(method,params,_timeout,options)=>{options?.assertCurrent();calls.push({method,params:clone(params)});if(method==='turn/start')return {turn:{id:'synthetic-turn'}};if(method==='thread/start'||method==='thread/resume')return {thread:{id:method==='thread/start'?'new-thread':params.threadId,turns:[]}};return {};};
 const mcpContext=()=>Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,owner[key]]));
 const workflowContext={current:()=>({...owner,serial}),revision:()=>serial,begin:(provider,threadId)=>{owner.provider=provider;owner.threadId=threadId;serial++;return {provider,serial};},assert:ticket=>{assert.equal(ticket.serial,serial);},synchronize:async(ticket,bind)=>bind(ticket.provider,mcpContext()),started:(_ticket,id)=>{owner.threadId=id;}};
 const handlers=new Map(),sender={id:7,isDestroyed:()=>false},window={isDestroyed:()=>false,webContents:{id:7,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}},event={sender,senderFrame:{url:'file:///studio/index.html'}};
 const context={sshService:{peek:()=>null},path,createAgentResourceRouting,createComputeResourceBinding,createAgentRequests,AgentHub,worker,terminalMcp,sharedTerminal:shared,computeProfiles:profiles,catalog,codex,root:process.cwd(),settings:{codexPath:'synthetic',agent:{}},workflowContext,window,shuttingDown:false,app:{getPath:()=>process.cwd(),isPackaged:false},safeStorage:{},CredentialVault:class{get(){return null;}},net:{fetch:()=>assert.fail('No external network')},emit:(channel,data)=>events.push({channel,data}),assertIdleAgent:()=>{if(codex.activeTurns.size)throw Error('busy');},scientificToolReadiness:()=>assert.fail('No selected-SSH scientific readiness query'),ipcMain:{handle:(name,handler)=>handlers.set(name,handler)}};
 context.resourceRouting=vm.runInNewContext(initializer('resourceRouting'),context);
 context.agents=vm.runInNewContext(initializer('agents'),context);
 context.computeResource=vm.runInNewContext(initializer('computeResource'),context);
 for(const name of ['trusted','handle','scientificTools'])vm.runInNewContext(find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),context);
 vm.runInNewContext(find(node=>ts.isCallExpression(node)&&node.expression.getText(ast)==='handle'&&node.arguments[0]?.text==='compute.resource.status'),context);
 vm.runInNewContext(find(node=>ts.isForOfStatement(node)&&node.getText(ast).includes("handle('compute.resource.'+method")),context);
 const taskRecords={bound:()=>null,deleted:()=>false,failedTurn:()=>{},prepareTurn:()=>assert.fail('No automatic workflow context')};
 Object.assign(context,{taskRecords,privateAccess:{assertTask:()=>assert.fail('No WSL private read')},scientificSkills:{router:{routes:new Map()},context:{}},setupInstructions:{},bundledSkillRoot:process.cwd(),studioSkillRoots:()=>[],managedSkillRoots:()=>[],managedSkillEntries:()=>[],managedSkillRecords:()=>[],skillGuidanceScope:()=>{},openUrl:()=>{}});
 const request=vm.runInNewContext(initializer('agentRequests'),context);
 const invoke=(name,data={},suppliedEvent=event)=>handlers.get('studio:'+name)(suppliedEvent,data);
 const activate=async(sessionId='session')=>invoke('compute.resource.activate',{kind:'ssh-terminal',profileId:'profile',profileVersion:1,sessionId});
 t.after(()=>{context.agents.close();worker.close();terminalMcp.close();});
 return {context,worker,codex,calls,cache,events,revokes,shared,owner,mcpContext,activate,invoke,request,setReady:(value,sessionId=context.computeResource.peek()?.sessionId)=>{ready=value;readySession=sessionId;},setProfileValid:value=>{profileValid=value;},delayRead:()=>{readGate=deferred();readEntered=deferred();return {entered:readEntered.promise,release:()=>{readGate.resolve();readGate=null;}};}};
}

test('actual main routes select SSH with an existing WSL worker, require exact grant and leave worker facts untouched',async t=>{
 const f=await fixture(t),before=clone({identity:f.worker.identity,target:f.worker.connectionTarget,connection:f.worker.connection});
 await assert.rejects(f.invoke('compute.resource.activate',{kind:'ssh-terminal',profileId:'profile',profileVersion:1,sessionId:'session'},{sender:{id:8,isDestroyed:()=>false},senderFrame:{url:'file:///studio/index.html'}}),/Untrusted/);assert.equal(f.context.computeResource.peek(),null);
 await f.activate();assert.equal(f.context.agents.getWorker('codex').transport,'desktop-terminal');const blocked=await f.context.scientificTools('codex');assert.equal(blocked.status,'blocked');
 f.setReady(true);const available=await f.context.scientificTools('codex');assert.equal(available.status,'ready');assert.equal(available.scope,'terminal-only');assert.equal(available.resource.sessionId,'session');
 assert.deepEqual({identity:f.worker.identity,target:f.worker.connectionTarget,connection:f.worker.connection},before);assert.equal(f.codex.starts,0);assert(f.events.some(item=>item.data.method==='studio/computeResourceChanged'));
 f.setProfileValid(false);assert.equal((await f.context.scientificTools('codex')).status,'blocked');assert.equal(f.context.agents.getWorker('codex').transport,'desktop-terminal');
});

test('resource actions reject pending turn dispatch before changing the selection',async t=>{
 const f=await fixture(t);f.context.agents.pendingTurnDispatches.add('codex:thread');await assert.rejects(f.activate(),/current reply/);assert.equal(f.context.computeResource.peek(),null);f.context.agents.pendingTurnDispatches.clear();
 await f.activate();const selection=f.context.computeResource.peek();f.context.agents.pendingTurnDispatches.add('codex:thread');await assert.rejects(f.invoke('compute.resource.clear',{selectionId:selection.selectionId}),/current reply/);assert.deepEqual(f.context.computeResource.peek(),selection);
});

test('same conversation switches WSL transport once, while terminal-session selection preserves its current process',async t=>{
 const f=await fixture(t);f.context.agents.contexts.set('codex',f.mcpContext());f.context.agents.bridgeWorkers.set('codex',f.worker.providerConnection('codex'));
 await f.activate();await f.context.agents.selectContext('codex',f.mcpContext());assert.equal(f.codex.starts,1);assert.equal(f.codex.attached.transport,'desktop-terminal');
 const process=f.codex.process,starts=f.codex.starts;await f.activate('second');await f.context.agents.selectContext('codex',f.mcpContext());assert.equal(f.codex.process,process);assert.equal(f.codex.starts,starts);
});

test('without WSL an already terminal-only bridge keeps its fresh conversation process on SSH selection',async t=>{
 const f=await fixture(t,{connectedWorker:false});f.context.agents.contexts.set('codex',f.mcpContext());f.context.terminalMcp.bindProviderContext('codex',f.mcpContext());f.context.agents.bridgeWorkers.set('codex',f.context.agents.getWorker('codex'));
 const process=f.codex.process;await f.activate();await f.context.agents.selectContext('codex',f.mcpContext());assert.equal(f.codex.process,process);assert.equal(f.codex.starts,0);
});

test('actual request factory uses selected SSH despite WSL and never injects workspace files',async t=>{
 const f=await fixture(t);await f.activate();f.setReady(true);f.context.agents.bridgeWorkers.set('codex',f.context.agents.getWorker('codex'));f.context.agents.threadProcess=f.codex.process;f.context.agents.readyThreads=new Set(['thread']);
 const result=await f.request({provider:'codex',method:'turn/start',params:{threadId:'thread',input:[{type:'text',text:'Use the selected resource'},{type:'text',text:'PRIVATE WORKFLOW FILE'}]}});assert.equal(result.turn.id,'synthetic-turn');const sent=f.calls.find(call=>call.method==='turn/start');assert(sent.params.input[1].text.includes('SSH terminal session'));assert(!JSON.stringify(sent).includes('PRIVATE WORKFLOW FILE'));assert(!JSON.stringify(sent).includes('worker is disconnected'));
});

test('a selected SSH resource without its current grant rejects turns and steering, but permits conversation start/resume',async t=>{
 const f=await fixture(t);await f.activate();for(const method of ['turn/start','turn/steer'])await assert.rejects(f.request({provider:'codex',method,params:{threadId:'thread',input:[{type:'text',text:'synthetic'}]}}),/所选 SSH/);assert.equal(f.calls.length,0);
 for(const method of ['thread/start','thread/resume'])assert((await f.request({provider:'codex',method,params:method==='thread/resume'?{threadId:'thread'}:{}})).thread.id);assert.equal(f.calls.some(call=>call.method.startsWith('turn/')),false);
});

test('a different terminal grant cannot make the selected resource ready or dispatch its turn',async t=>{
 const f=await fixture(t);await f.activate();f.setReady(true,'another-session');assert.equal(f.shared.hasCurrentGrant('codex'),true);assert.equal((await f.context.scientificTools('codex')).status,'blocked');
 await assert.rejects(f.request({provider:'codex',method:'turn/start',params:{threadId:'thread',input:[{type:'text',text:'synthetic'}]}}),/所选 SSH/);assert.equal(f.calls.length,0);
});

test('selection changes during actual status observation stop a prepared turn without falling back to WSL',async t=>{
 const f=await fixture(t);await f.activate();f.setReady(true);const gate=f.delayRead(),pending=f.request({provider:'codex',method:'turn/start',params:{threadId:'thread',input:[{type:'text',text:'synthetic'}]}});pending.catch(()=>{});await gate.entered;const selection=f.context.computeResource.peek();f.context.computeResource.clear({selectionId:selection.selectionId});gate.release();await assert.rejects(pending,/compute_resource.*changed/);assert.equal(f.calls.length,0);
});

test('the internal native isolation await rechecks the resource before raw turn dispatch',async t=>{
 const f=await fixture(t);await f.activate();f.setReady(true);const entered=deferred(),ready=deferred(),bridge=new CodexBridge({strictIsolation:true,host:{constrainedRequest:(_method,params)=>params,verifyIsolation:async()=>{entered.resolve();await ready.promise;return {status:'verified'};}}});bridge.isolation={};bridge.isolationReady=true;bridge.process={kill:()=>{}};const calls=[];bridge.rawRequest=async method=>{calls.push(method);return {turn:{id:'must-not-dispatch'}};};
 const scope=f.context.resourceRouting.scope('codex','turn/start'),pending=bridge.request('turn/start',{threadId:'thread',input:[]},undefined,{assertCurrent:scope.assertCurrent});pending.catch(()=>{});await entered.promise;const selection=f.context.computeResource.peek();f.context.computeResource.clear({selectionId:selection.selectionId});ready.resolve();await assert.rejects(pending,/compute_resource_selection_changed/);assert.deepEqual(calls,[]);bridge.close();
});
