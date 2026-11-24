import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
import {inspect} from 'node:util';
import {createSshConnection,sshConnectionReview,sshOwner,installSshPrivacyLifecycle,requireCurrentSshWorker,requiresCurrentSshWorker,sshTaskSource,assertSshSource} from "../../backend/main/compute/ssh-connection.mjs";
import {assertRendererWorkerRoute,assertWorkerRoute} from "../../contracts/transport-policy.mjs";
import {agentHarness} from "../helpers/agent-hooks.mjs";
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {memoryStorage} from "../helpers/agent-hooks.mjs";
import {ObservedRead} from '../../frontend/api/observed-read.mjs';
import * as environmentDraft from '../../frontend/features/cluster/cluster-environment-draft.ts';
import * as readiness from '../../frontend/features/cluster/cluster-readiness.ts';

const deferred=()=>{let resolve,reject;return {promise:new Promise((done,fail)=>{resolve=done;reject=fail;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const profile={id:'saved',version:1,name:'Fixture',host:'fixture.invalid',username:'fixture',port:2201,ssh_client:'/usr/bin/ssh',identity_file:'/fixture/reference',proxy_jump:[],via:[],auth_mode:'interactive'};
function fixture(){
 let selected={taskId:'flow',provider:'codex',threadId:'thread'},revision=1,next=0,override,serviceVersion='current',taskSource={binding:{distribution:'Fixture',root:'/original',port:8767}};
 const calls=[],sender={isDestroyed:()=>false},frame={parent:null},event={sender,senderFrame:frame},worker={connection:{health:{root:'/original'}},connectionEpoch:1,identity:{distribution:'Fixture',root:'/original'}};
 worker.request=async(method,path,data)=>{calls.push({method,path,data});if(override){const result=override(method,path,data);if(result!==undefined)return await result;}if(path==='/api/cluster/profile')return structuredClone(profile);if(path.endsWith('/auth/plan'))return {sessionId:'session',clusterId:'saved',version:1,status:'review',review:{host:profile.host},clientRoute:'none'};if(path.endsWith('/auth/start'))return {status:'awaiting_auth',authenticated:false};if(path.endsWith('/auth/read'))return {status:'awaiting_auth',privateOutput:Buffer.from('PRIVATE_TTY_SENTINEL').toString('base64'),cursor:20};if(path.endsWith('/auth/finish'))return {status:data.retain?'verified':'closed',authenticated:data.retain};if(path.endsWith('/tunnel/plan'))return {tunnelId:'owned-forward',status:'review',destinationVerification:'not_run'};if(path.includes('/tunnel/'))return {tunnelId:data.tunnel_id,status:path.endsWith('/close')?'closed':'listener_ready',destinationVerification:'not_run',sshAuthenticated:false};return {accepted:true};};
 const api=createSshConnection({worker,selection:()=>selected,revision:()=>revision,sourceScope:request=>request?.kind==='original-run'&&!request.taskId?null:taskSource,assertSource:request=>{if(request?.kind==='original-run'&&!request.taskId)return;if(worker.identity?.root!==taskSource.binding.root)throw Error('needs_original_worker');},beforeStart:()=>calls.push({stage:'idle'}),observeWorker:async()=>({status:'connected',serviceVersion}),id:()=>`pane-${++next}`,secret:()=> 'a'.repeat(48)});
 return {api,worker,calls,event,plan:()=>api.plan({clusterId:'saved',version:1,expected:sshConnectionReview(profile),owner:sshOwner(selected)},event),request:p=>({paneId:p.paneId,paneEpoch:p.paneEpoch}),owner:()=>sshOwner(selected),setSource:value=>{taskSource=value;},setOverride:value=>{override=value;},setVersion:value=>{serviceVersion=value;},switch:()=>{selected={...selected,taskId:'other'};revision++;}};
}

test('private plan rereads the saved profile and never returns the worker owner token',async()=>{const f=fixture(),p=await f.plan();assert.equal(p.status,'review');assert.equal(p.review.host,profile.host);assert.equal(f.api.privacy().active,true);assert.equal(JSON.stringify(p).includes('a'.repeat(48)),false);assert.deepEqual(f.calls.map(c=>c.path),['/api/cluster/profile','/api/cluster/auth/plan']);});
test('a dirty or externally changed saved connection blocks before authentication',async()=>{const f=fixture();f.setOverride((_m,path)=>path==='/api/cluster/profile'?{...profile,port:2222}:undefined);const p=await f.plan();assert.equal(p.reason,'saved_connection_changed');assert.equal(f.calls.length,1);assert.equal(f.api.privacy().active,true);await f.api.finish({...f.request(p),retain:false},f.event);f.api.closed(f.request(p),f.event);assert.equal(f.api.privacy().active,false);});
test('private errors redact message/cause and retain the capture lock until disposal acknowledgement',async()=>{const f=fixture(),secret=['SYNTHETIC','PRIVATE','TOKEN'].join('_');f.setOverride(()=>{throw Error(secret,{cause:Error(secret)});});const p=await f.plan();assert.equal(p.reason,'private_ssh_operation_failed');assert(!inspect(p).includes(secret));assert(!JSON.stringify(p).includes(secret));assert(f.api.privacy().active);await f.api.finish({...f.request(p),retain:false},f.event);assert(f.api.privacy().active);f.api.closed(f.request(p),f.event);assert(!f.api.privacy().active);});
test('only the owning sender and main frame may read, input or release private state',async()=>{const f=fixture(),p=await f.plan(),ref=f.request(p),other={sender:f.event.sender,senderFrame:{parent:null}};for(const [method,data]of [['read',{...ref,cursor:0}],['input',{...ref,data:'otp',sequence:1}],['finish',{...ref,retain:false}]])await assert.rejects(f.api[method](data,other),/unavailable/);assert.throws(()=>f.api.closed(ref,other),/unavailable/);assert.equal(f.calls.length,2);});
test('start is explicit and typed; private input has no generic command/socket fields',async()=>{const f=fixture(),p=await f.plan(),ref=f.request(p);assert(!f.calls.some(c=>c.path?.endsWith('/start')));await f.api.start({...ref,requestId:'reviewed'},f.event);assert(f.calls.some(c=>c.stage==='idle'));await f.api.input({...ref,data:'human input',sequence:1},f.event);await assert.rejects(f.api.input({...ref,data:'x',sequence:2,command:'arbitrary'},f.event),/Invalid/);await assert.rejects(f.api.input({...ref,data:'x'.repeat(4097),sequence:2},f.event),/Invalid/);await assert.rejects(f.api.resize({...ref,rows:1000,cols:80},f.event),/Invalid/);assert.equal(f.calls.filter(c=>c.path?.endsWith('/input')).length,1);});
test('selection change discards late private output and cancels only the original scoped session',async()=>{const f=fixture(),p=await f.plan(),wait=deferred();f.setOverride((_m,path)=>path.endsWith('/auth/read')?wait.promise:undefined);const pending=f.api.read({...f.request(p),cursor:0},f.event);f.switch();wait.resolve({status:'awaiting_auth',privateOutput:Buffer.from('PRIVATE_TTY_SENTINEL').toString('base64'),cursor:20});const value=await pending;assert.equal(value.reason,'source_changed');assert(!value.privateOutput);assert(f.calls.some(c=>c.path?.endsWith('/finish')&&c.data.retain===false));assert(f.api.privacy().active);});
test('a changed worker never receives the old session input or cleanup',async()=>{const f=fixture(),p=await f.plan();f.worker.connection={health:{root:'/other'}};f.worker.connectionEpoch++;const before=f.calls.length,value=await f.api.input({...f.request(p),data:'private',sequence:1},f.event);assert.equal(value.reason,'source_changed');assert.equal(f.calls.length,before);});
test('a late plan after owner change cannot publish private review or start authentication',async()=>{const f=fixture(),wait=deferred();f.setOverride((_m,path)=>path.endsWith('/auth/plan')?wait.promise:undefined);const pending=f.plan();await Promise.resolve();f.switch();wait.resolve({sessionId:'late-session',review:{host:'PRIVATE'},status:'review'});const value=await pending;assert(!value.review);assert.equal(value.reason,'source_changed');assert(!f.calls.some(c=>c.path?.endsWith('/start')));});
test('closed acknowledgement requires finish and cannot release a newer pane',async()=>{const f=fixture(),first=await f.plan(),a=f.request(first),initial=f.api.privacy().revision;assert.throws(()=>f.api.closed(a,f.event),/cleanup/);await f.api.finish({...a,retain:true},f.event);assert(f.api.privacy().active);f.api.closed(a,f.event);assert(f.api.privacy().revision>initial);const second=await f.plan();assert.throws(()=>f.api.closed(a,f.event),/unavailable/);assert.equal(f.api.privacy().active,true);assert(second.paneEpoch>first.paneEpoch);});
test('pane destruction releases privacy only for an actually destroyed owning surface',async()=>{const f=fixture();await f.plan();f.api.destroyed(f.event.sender);assert(f.api.privacy().active);f.event.sender.isDestroyed=()=>true;f.api.destroyed(f.event.sender);assert(!f.api.privacy().active);});
test('managed tunnel identity is main-owned and listener readiness never asserts destination authentication',async()=>{const f=fixture(),p=await f.plan(),ref=f.request(p),planned=await f.api.tunnelPlan({...ref,clusterId:'saved',version:1,localPort:2202,destinationHost:'target.invalid',destinationPort:22},f.event);assert.equal(planned.tunnel.tunnelId,'owned-forward');const result=await f.api.tunnelStart({...ref,tunnelId:'owned-forward',requestId:'forward'},f.event);assert.equal(result.tunnel.status,'listener_ready');assert.equal(result.tunnel.destinationVerification,'not_run');assert.equal(result.tunnel.sshAuthenticated,false);const before=f.calls.length,foreign=await f.api.tunnelClose({...ref,tunnelId:'external-unknown'},f.event);assert.equal(f.calls.length,before);assert.equal(foreign.reason,'private_ssh_operation_failed');});
test('private auth and tunnel routes are internal admin channels, unavailable to generic renderer workers',()=>{for(const route of ['/api/cluster/auth/plan','/api/cluster/auth/start','/api/cluster/auth/read','/api/cluster/auth/input','/api/cluster/auth/resize','/api/cluster/auth/finish','/api/cluster/tunnel/plan','/api/cluster/tunnel/start','/api/cluster/tunnel/status','/api/cluster/tunnel/close']){assert.doesNotThrow(()=>assertWorkerRoute('POST',route));assert.throws(()=>assertRendererWorkerRoute('POST',route),/private/);}});
test('legacy terminal and codex IPC routes remain retired from main and preload',()=>{
 const preload=fs.readFileSync(new URL("../../desktop/preload.cjs",import.meta.url),'utf8'),main=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8');
 for(const removed of ['terminal.start','terminal.input','terminal.close','studio:terminal','onTerminal','codex.connect','codex.rpc','codex.respond','terminal-routes.mjs']){
  const pattern=new RegExp('\\b'+removed.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b');
  assert.equal(pattern.test(preload),false,removed+' must not appear in preload');
  assert.equal(pattern.test(main),false,removed+' must not appear in main');
 }
});

test('only verified current workers may plan new authentication; old implementations get an inline update state',async()=>{for(const version of ['different','unconfirmed']){const f=fixture();f.setVersion(version);const p=await f.plan();assert.equal(p.status,'blocked');assert.equal(p.reason,'needs_worker_update');assert.equal(f.calls.length,0);assert(f.api.privacy().active);}});
test('new SSH modes require current capability but legacy key/via does not acquire a new version gate',async()=>{assert.equal(requiresCurrentSshWorker({auth_mode:'key',via:['existing']}),false);assert.equal(requiresCurrentSshWorker({auth_mode:'interactive'}),true);assert.equal(requiresCurrentSshWorker({auth_mode:'key',proxy_jump:['reviewed']}),true);const worker={connection:{},connectionEpoch:1};await assert.rejects(requireCurrentSshWorker(worker,async()=>({status:'connected',serviceVersion:'different'})),/needs_worker_update/);const pending=deferred(),call=requireCurrentSshWorker(worker,()=>pending.promise);worker.connectionEpoch++;pending.resolve({status:'connected',serviceVersion:'current'});await assert.rejects(call,/needs_worker_update/);});
test('a previously verified original lease survives a selection change; a late fresh verification is cancelled',async()=>{
 const f=fixture(),p=await f.plan();f.setOverride((_m,path)=>path.endsWith('/auth/read')?{status:'verified',authenticated:true,cursor:0}:undefined);await f.api.read({...f.request(p),cursor:0},f.event);f.switch();await f.api.input({...f.request(p),data:'never sent',sequence:1},f.event);assert.equal(f.calls.findLast(c=>c.path?.endsWith('/finish')).data.retain,true);assert(!f.calls.some(c=>c.path?.endsWith('/input')));
 const g=fixture(),q=await g.plan(),wait=deferred();g.setOverride((_m,path)=>path.endsWith('/auth/read')?wait.promise:undefined);const operation=g.api.read({...g.request(q),cursor:0},g.event);g.switch();wait.resolve({status:'verified',authenticated:true,privateOutput:'UFJJVkFURQ==',cursor:7});const result=await operation;assert(!result.privateOutput);assert.equal(g.calls.findLast(c=>c.path?.endsWith('/finish')).data.retain,false);
});
test('an unconfirmed finish holds ownership until a sanitized successful cleanup retry',async()=>{const f=fixture(),p=await f.plan(),secret=['PRIVATE','CAUSE'].join('_');f.setOverride((_m,path)=>{if(path.endsWith('/finish'))throw Error(secret,{cause:Error(secret)});});await assert.rejects(f.api.finish({...f.request(p),retain:false},f.event),error=>!inspect(error).includes(secret)&&/cleanup is unconfirmed/.test(error.message));assert(f.api.privacy().active);assert.throws(()=>f.api.closed(f.request(p),f.event),/cleanup/);f.setOverride(undefined);await f.api.finish({...f.request(p),retain:false},f.event);f.api.closed(f.request(p),f.event);assert(!f.api.privacy().active);});
for(const trigger of ['reload','renderer_crash'])test('same WebContents '+trigger+' ignores old finish and releases only matching committed replacement after paint',async()=>{
 const f=fixture(),emitter=new EventEmitter(),wait=deferred();let paints=0;const oldFrame={parent:null,processId:1,routingId:10,frameToken:'old-frame',isDestroyed:()=>false,executeJavaScript:async()=>{throw Error('Never paint old private frame');}},newFrame={parent:null,processId:2,routingId:20,frameToken:'new-frame',isDestroyed:()=>false,executeJavaScript:async code=>{paints++;assert.match(code,/requestAnimationFrame/);return wait.promise;}};f.event.senderFrame=oldFrame;Object.assign(f.event.sender,{on:emitter.on.bind(emitter),mainFrame:oldFrame});installSshPrivacyLifecycle(f.event.sender,f.api);const p=await f.plan(),before=f.api.privacy().revision;
 if(trigger==='reload')emitter.emit('did-start-navigation',{},'file:///studio',false,true);else emitter.emit('render-process-gone',{},{});assert(f.api.privacy().active);assert(f.api.privacy().revision>before);await assert.rejects(f.api.input({...f.request(p),data:'private',sequence:1},f.event),/unavailable/);assert.throws(()=>f.api.closed(f.request(p),f.event),/unavailable/);
 emitter.emit('did-frame-finish-load',{},true,1,10);await Promise.resolve();assert.equal(paints,0);assert(f.api.privacy().active);f.event.sender.mainFrame=newFrame;f.event.senderFrame=newFrame;emitter.emit('did-frame-navigate',{},'file:///studio',-1,'',true,2,20);emitter.emit('did-frame-finish-load',{},true,1,10);assert.equal(paints,0);emitter.emit('did-frame-finish-load',{},true,2,20);assert.equal(paints,1);assert(f.api.privacy().active);wait.resolve();await new Promise(resolve=>setImmediate(resolve));assert(!f.api.privacy().active);const next=await f.plan();assert(next.paneEpoch>p.paneEpoch);assert.throws(()=>f.api.closed(f.request(p),f.event),/unavailable/);assert(f.api.privacy().active);
 const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8');assert(source.includes('installSshPrivacyLifecycle(window.webContents,sshConnection)'));
});
test('rapid navigation epochs reject an earlier committed frame paint callback',async()=>{
 const f=fixture(),emitter=new EventEmitter(),first=deferred(),second=deferred(),frame=(token,promise)=>({parent:null,processId:1,routingId:token,frameToken:String(token),isDestroyed:()=>false,executeJavaScript:()=>promise});const old=frame(1,Promise.resolve());f.event.senderFrame=old;Object.assign(f.event.sender,{on:emitter.on.bind(emitter),mainFrame:old});installSshPrivacyLifecycle(f.event.sender,f.api);await f.plan();emitter.emit('did-start-navigation',{},'file:///first',false,true);const a=frame(2,first.promise);f.event.sender.mainFrame=a;emitter.emit('did-frame-navigate',{},'file:///first',-1,'',true,1,2);emitter.emit('did-frame-finish-load',{},true,1,2);const previous=f.api.privacy().revision;emitter.emit('did-start-navigation',{},'file:///second',false,true);assert(f.api.privacy().revision>previous);first.resolve();await new Promise(resolve=>setImmediate(resolve));assert(f.api.privacy().active);emitter.emit('did-frame-finish-load',{},true,1,2);assert(f.api.privacy().active);const b=frame(3,second.promise);f.event.sender.mainFrame=b;emitter.emit('did-frame-navigate',{},'file:///second',-1,'',true,1,3);emitter.emit('did-frame-finish-load',{},true,1,3);second.resolve();await new Promise(resolve=>setImmediate(resolve));assert(!f.api.privacy().active);
});
test('new private acquisition is refused while the main document is navigating',async()=>{const f=fixture();f.event.sender.isLoadingMainFrame=()=>true;await assert.rejects(f.plan(),/owning main frame/);assert(!f.api.privacy().active);assert.equal(f.calls.length,0);});
test('subframe and in-place navigation never release or inherit the owning private main frame',async()=>{const f=fixture(),emitter=new EventEmitter();Object.assign(f.event.sender,{on:emitter.on.bind(emitter),executeJavaScript:async()=>{throw Error('No replacement');}});installSshPrivacyLifecycle(f.event.sender,f.api);await f.plan();const before=f.api.privacy().revision;emitter.emit('did-start-navigation',{},'about:blank',false,false);emitter.emit('did-start-navigation',{},'file:///studio#same',true,true);assert.equal(f.api.privacy().revision,before);assert(f.api.privacy().active);});
test('the real main renderer bridge blocks new-mode save/test/probe on old worker while preserving legacy key calls',async()=>{
 const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let registration,callback,saved=profile;const calls=[],worker={connection:{},connectionEpoch:1,request:async(method,target,data)=>{calls.push({method,target,data});return target==='/api/cluster/profile'?saved:{saved:true};}};function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='handle'&&node.arguments[0]?.text==='worker.request')registration=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);vm.runInNewContext(registration,{handle:(_name,fn)=>{callback=fn;},assertRendererWorkerRoute,requiresCurrentSshWorker,requireCurrentSshWorker,worker,readWorkerStatus:async()=>({status:'connected',serviceVersion:'different'}),settings:{},URL,catalog:{put:()=>{}}});
 for(const[target,data]of [['/api/clusters',profile],['/api/cluster/test',{connection:profile}],['/api/cluster/probe',{cluster_id:'saved'}]])await assert.rejects(callback({method:'POST',target,data}),/needs_worker_update/);assert(!calls.some(c=>['/api/clusters','/api/cluster/test','/api/cluster/probe'].includes(c.target)));
 saved={...profile,auth_mode:'key',proxy_jump:[]};await callback({method:'POST',target:'/api/clusters',data:saved});await callback({method:'POST',target:'/api/cluster/probe',data:{cluster_id:'saved'}});assert(calls.some(c=>c.target==='/api/clusters'));assert(calls.some(c=>c.target==='/api/cluster/probe'));
});

test('project permissions from resource tool setup stay on the reviewed SSH bridge and selection',async()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8');
 const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 let callback;
 function visit(node){
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='handle'&&node.arguments[0]?.text==='worker.request')vm.runInNewContext(node.getText(ast),context);
  ts.forEachChild(node,visit);
 }
 const projectScope={connectionId:'original-master',profileId:'fixture-resource',profileVersion:4};
 let selection={kind:'ssh-connection',...projectScope},owner=1;
 const approved={status:'connected',sourceKind:'ssh',...projectScope},calls=[];
 let observe=async()=>approved;
 const worker={connection:{},connectionEpoch:1,request:async(method,target,data)=>{calls.push({method,target,data});return {id:'reviewed-project'};}};
 const context={handle:(_name,fn)=>{callback=fn;},URL,worker,settings:{},catalog:{put:()=>{}},assertRendererWorkerRoute,
  readWorkerStatus:()=>observe(),workflowContext:{revision:()=>owner},computeResource:{capture:()=>({selection}),assertCurrent:hold=>{if(hold.selection!==selection)throw Error('Selection changed');}}};
 visit(ast);
 const apply=()=>callback({method:'POST',target:'/api/projects',data:{name:'Reviewed project'},projectScope});
 observe=async()=>({...approved,connectionId:'unrelated-master'});await assert.rejects(apply(),/project_edit_unavailable/);
 const pending=deferred();observe=()=>pending.promise;const old=apply();worker.connection={};worker.connectionEpoch++;pending.resolve(approved);await assert.rejects(old,/project_edit_unavailable/);
 const pendingOwner=deferred();observe=()=>pendingOwner.promise;const oldOwner=apply();owner++;pendingOwner.resolve(approved);await assert.rejects(oldOwner,/project_edit_unavailable/);
 const pendingSelection=deferred();observe=()=>pendingSelection.promise;const oldSelection=apply();selection={...selection,profileVersion:5};pendingSelection.resolve(approved);await assert.rejects(oldSelection,/project_edit_unavailable/);
 assert.deepEqual(calls,[]);
 selection={kind:'ssh-connection',...projectScope};observe=async()=>approved;
 await assert.rejects(callback({method:'POST',target:'/api/cluster/probe',projectScope}),/Invalid scoped project request/);
 await apply();
 assert.deepEqual(calls,[{method:'POST',target:'/api/projects',data:{name:'Reviewed project'}}]);
});

function clusterHarness({serviceVersion='current',override,runPage=false,selectedClusterId,sourceId}={}){
 const hooks=[],effects=[],calls=[],auth=[],errors=[],terminal=[],updates=[],agents=[],props={id:'prepared-run',worker:true,serviceVersion,selectedClusterId,sourceId,settings:{},project:{id:'project',name:'Fixture project',policy:{clusters:['other'],input_roots:['/fixture'],max_seconds:60}},onAuthenticate:r=>auth.push(r),onOpenConnections:source=>updates.push(source),onConnectCompute:async()=>updates.push('guide'),onTerminal:id=>terminal.push(id),onError:e=>errors.push(e),onRefresh:()=>{},onAgent:text=>agents.push(text),onRun:()=>{}};
 let stored={...profile,environment:{executables:{python:'/usr/bin/python3'}},scheduler:'slurm',remote_root:'~/fixture-runs',read_roots:[],queue:'fixture',activation:'',limits:{cpus:1,gpus:0,memory_mb:1024}},cursor=0,dirty=false,tree,disposed=false;
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];},useRef=value=>{const i=cursor++;return hooks[i]??(hooks[i]={current:value});},useEffect=(fn,deps)=>{const i=cursor++,previous=hooks[i];if(!previous||deps.some((v,k)=>v!==previous.deps[k])){hooks[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const readyRun={kind:'cluster-run',id:'prepared-run',name:'Fixture run',engine:'pydyn.md',project_id:'project',cluster_id:'saved',status:'ready',snapshots:[],inputs:{},parameters:{},directory:'/fixture-run',resources:{},max_seconds:60,validation:{status:'passed'},scientific_validation:{status:'not_run'},cluster:{scheduler:'slurm'},job_id:null,script:'# fixture'};
 const timers=new Map();let nextTimer=0;
 class ManualObservedRead extends ObservedRead{constructor(read,publish,options){super(read,publish,{...options,schedule:callback=>{const number=++nextTimer;timers.set(number,callback);return number;},unschedule:number=>timers.delete(number)});}}
 const api=async(method,target,data)=>{calls.push({method,target,data});if(override){const result=override(method,target,data);if(result!==undefined)return await result;}if(['/api/cluster/observation','/api/cluster/status','/api/cluster/validate'].includes(target))return structuredClone(readyRun);if(target==='/api/clusters'&&method==='GET')return [{id:stored.id,name:stored.name,version:stored.version,auth_mode:stored.auth_mode}];if(target==='/api/cluster-runs')return [];if(target==='/api/cluster/profile')return structuredClone(stored);if(target==='/api/clusters'&&method==='POST'){stored={...structuredClone(data),version:stored.version+1};return {id:stored.id,version:stored.version};}if(target==='/api/projects')return method==='GET'?[props.project]:data;if(target==='/api/cluster/probe')return {status:'passed',ssh_status:'passed',scheduler_status:'passed',observed_at:123};if(target==='/api/cluster/test')return {status:'passed'};throw Error('Unexpected cluster fixture route '+target);};
 const jsx=(type,props)=>({type,props}),require=name=>name==='react'?{useState,useRef,useEffect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:["../../api/worker","../../api/studio"].includes(name)?{api,invoke:async(method,data)=>{calls.push({method,data});const result=override?.('IPC',method,data);if(result!==undefined)return await result;if(method==='ssh.existing')return [];throw Error('No privileged shortcut');}}:name==='./ClusterEnvironmentEditor'?{__esModule:true,default:'ClusterEnvironmentEditor'}:name==='./cluster-environment-draft'?environmentDraft:name==='./cluster-readiness'?readiness:name==='./cluster-observation'?observation:name==='../../api/observed-read.mjs'?{ObservedRead:ManualObservedRead}:name==="../../ui/i18n"?{t:value=>value}:new Proxy({},{get:(_t,key)=>String(key)});
 function loadComponent(file){
  const source=fs.readFileSync(new URL('../../frontend/features/cluster/'+file,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports','setTimeout',compiled)(require,module,module.exports,(callback,delay)=>setTimeout(callback,delay).unref());
  return module.exports;
 }
 const observation=loadComponent('cluster-observation.tsx');
 const renderComponent=loadComponent(runPage?'ClusterRunPage.tsx':'ClusterPage.tsx').default;
 function render(){cursor=0;dirty=false;tree=renderComponent(props);}
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[],text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 const byId=id=>find(node=>node.props?.['data-testid']===id);
 const button=label=>find(node=>node.type==='button'&&text(node)===label);
 function find(predicate){const value=all(tree).find(predicate);assert(value,'Cluster source node missing');return value;}
 async function flush(){for(let i=0;i<22;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 async function reveal(){find(node=>node.type==='button'&&node.props?.['data-guide-target']==='cluster-host').props.onClick();await flush();}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();
 return {readyRun,timers,async poll(){const entries=[...timers];for(const [number,callback] of entries){timers.delete(number);callback();}await flush();},calls,auth,errors,terminal,updates,agents,props,find,text,button,byId,reveal,flush,unmount,render};
}
test('actual ClusterPage refuses dirty authentication, restores saved identity, and does not save or grant to authenticate',async()=>{const h=clusterHarness();await h.flush();h.button('打开私有认证').props.onClick();assert.equal(h.auth.length,1);assert.deepEqual(h.auth[0].expected,sshConnectionReview(profile));await h.reveal();h.byId('ssh-host').props.onChange({target:{value:'edited.invalid'}});await h.flush();h.button('打开私有认证').props.onClick();await h.flush();assert.equal(h.auth.length,1);assert(h.text(h.find(node=>node.props?.className==='cluster-footer')).includes('未保存'));h.button('恢复已保存配置').props.onClick();await h.flush();h.button('打开私有认证').props.onClick();assert.equal(h.auth.length,2);assert.equal(h.auth[1].expected.host,profile.host);assert(!h.calls.some(c=>c.target==='/api/clusters'&&c.method==='POST'||c.target==='/api/projects'));assert.equal(h.terminal.length,0);h.unmount();});
test('actual ClusterPage Save and Grant are separate explicit actions and preserve the full existing policy',async()=>{const h=clusterHarness();await h.flush();h.button('保存连接').props.onClick();await h.flush();assert.equal(h.calls.filter(c=>c.target==='/api/clusters'&&c.method==='POST').length,1);assert(!h.calls.some(c=>c.target==='/api/projects'));h.button('允许当前项目使用此连接').props.onClick();await h.flush();const granted=h.calls.find(c=>c.target==='/api/projects'&&c.method==='POST');assert(granted);assert.equal(granted.data.policy.max_seconds,60);assert.deepEqual(granted.data.policy.input_roots,['/fixture']);assert.deepEqual(granted.data.policy.clusters,['other','saved']);assert.equal(h.errors.length,0);h.unmount();});
test('actual ClusterPage keeps MFA expiry as inline guidance and normal probe health cannot dirty its saved form',async()=>{const h=clusterHarness({override:(_m,target)=>{if(target==='/api/cluster/probe')throw Error('needs_human_auth');}});await h.flush();h.button('检查连接与调度器').props.onClick();await h.flush();assert.equal(h.errors.length,0);assert(h.text(h.find(node=>node.props?.className==='cluster-footer')).includes('需要人工认证'));assert(!h.calls.some(c=>c.method==='terminal.start'));h.button('打开私有认证').props.onClick();assert.equal(h.auth.length,1);h.unmount();const okay=clusterHarness();await okay.flush();okay.button('检查连接与调度器').props.onClick();await okay.flush();okay.button('打开私有认证').props.onClick();assert.equal(okay.auth.length,1);assert.equal(okay.errors.length,0);okay.unmount();});
test('actual ClusterPage new-mode use on an old worker offers the exact shared update guide without saving or direct connecting',async()=>{const h=clusterHarness({serviceVersion:'different'});await h.flush();h.button('打开私有认证').props.onClick();h.button('保存连接').props.onClick();h.button('检查连接与调度器').props.onClick();await h.flush();assert.equal(h.auth.length,0);assert(!h.calls.some(c=>c.target==='/api/clusters'&&c.method==='POST'||c.target==='/api/cluster/probe'||c.method==='worker.connect'));h.button('按原来源更新作业服务').props.onClick();await h.flush();assert.deepEqual(h.updates,['guide']);assert.equal(h.errors.length,0);h.unmount();});
for(const code of ['needs_human_auth','needs_worker_update'])test('Agent '+code+' tool result offers navigation only and retains unsent input without resending',async()=>{
 const actions=[],h=agentHarness({props:{onOpenCluster:()=>actions.push('cluster'),onConnectCompute:async()=>actions.push('compute')}});await h.flush();h.type('Unsent scientific choices');h.emit({method:'item/completed',params:{item:{id:'auth-handoff',type:'mcpToolCall',tool:'probe_cluster',status:'completed',result:{isError:true,content:[{type:'text',text:JSON.stringify({status:code,code,automatic_retry:false,message:'Human action required'})}]}}}});await h.flush();h.click(code==='needs_human_auth'?'agent-open-cluster':'agent-open-compute');await h.flush();assert.deepEqual(actions,[code==='needs_human_auth'?'cluster':'compute']);assert.equal(h.textarea().props.value,'Unsent scientific choices');assert(!h.calls.some(call=>call.method.startsWith('ssh.auth.')||call.method==='worker.connect'||call.method==='agent.rpc'&&call.data.method==='turn/start'));h.unmount();
});
test('free text mentioning authentication never creates an automatic Agent handoff action',async()=>{const h=agentHarness({props:{onOpenCluster:()=>{throw Error('No navigation');}}});await h.flush();h.emit({method:'item/completed',params:{item:{id:'ordinary',type:'mcpToolCall',tool:'read_log',result:{isError:false,content:[{type:'text',text:'A user note mentions needs_human_auth, without a structured request.'}]}}}});await h.flush();assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-open-cluster'));h.unmount();});
test('private authentication compares original click ownership and rejects a wrong workflow worker before reading its cluster profile',async()=>{const f=fixture(),owner=f.owner();f.switch();await assert.rejects(f.api.plan({clusterId:'saved',version:1,expected:sshConnectionReview(profile),owner},f.event),/workflow changed/);assert.equal(f.calls.length,0);assert(!f.api.privacy().active);const g=fixture();g.worker.identity={distribution:'Other',root:'/wrong-global'};const p=await g.plan();assert.equal(p.reason,'needs_original_worker');assert.equal(g.calls.length,0);});
test('a changed saved task source invalidates late private output even when worker and conversation are unchanged',async()=>{const f=fixture(),p=await f.plan(),wait=deferred();f.setOverride((_m,path)=>path.endsWith('/auth/read')?wait.promise:undefined);const pending=f.api.read({...f.request(p),cursor:0},f.event);f.setSource({binding:{distribution:'Fixture',root:'/other-source',port:9999}});wait.resolve({status:'verified',authenticated:true,privateOutput:'c2VjcmV0',cursor:6});const value=await pending;assert.equal(value.reason,'source_changed');assert(!value.privateOutput);assert.equal(f.calls.findLast(c=>c.path?.endsWith('/finish')).data.retain,false);});
test('ClusterRunPage missing lease is an inline navigation action, retains the ready artifact and never retries submit',async()=>{const h=clusterHarness({runPage:true,override:(_m,target)=>{if(target==='/api/cluster/submit')throw Error('needs_human_auth');}});await h.flush();h.button('审阅完成，提交到集群').props.onClick();await h.flush();assert.equal(h.errors.length,0);assert(h.text(h.find(node=>node.props?.className==='notice')).includes('需要人工认证'));h.button('核对原作业连接').props.onClick();await h.flush();assert.deepEqual(h.updates,[{runId:'prepared-run'}]);assert.equal(h.calls.filter(call=>call.target==='/api/cluster/submit').length,1);assert.equal(h.props.id,'prepared-run');assert(!h.calls.some(call=>call.method?.startsWith('ssh.auth.')||call.target==='/api/projects'||call.target==='/api/clusters'));h.unmount();});
test('ClusterRunPage revises mixed snapshots without treating remote sources as local inputs',async()=>{
 const original={id:'prepared-run',kind:'cluster-run',status:'ready',name:'Mixed inputs',engine:'pydyn.md',project_id:'project',cluster_id:'saved',max_seconds:60,
  directory:'/fixture-run',validation:{status:'passed'},scientific_validation:{status:'not_run'},cluster:{scheduler:'slurm'},resources:{cpus:1,gpus:0,memory_mb:256},job_id:null,script:'# original',parameters:{},
  inputs:{'run.py':'/fixture-original/run.py','assets/model.xyz':'/registered/inputs/model.xyz'},remote_inputs:{'assets/model.xyz':'/registered/inputs/model.xyz'},
  snapshots:[{name:'run.py',source:'/fixture-original/run.py',sha256:'a'.repeat(64),size:11},
   {name:'assets/model.xyz',source:'/registered/inputs/model.xyz',sha256:'b'.repeat(64),size:14,source_kind:'remote'}]};
 let observed=original;
 const h=clusterHarness({runPage:true,override:(_method,target,data)=>{
  if(target==='/api/cluster/observation'&&data.run_id===observed.id)return structuredClone(observed);
  if(target==='/api/cluster/revise'){
   observed={...observed,...data.changes,id:'revised-run',directory:'/revised-run',status:'draft',script:'# revised'};
   return structuredClone(observed);
  }
 }});
 try{
  await h.flush();
  h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await h.flush();
  const editor=h.find(n=>n.type==='textarea'&&n.props['aria-label']==='运行参数');
  const displayed=JSON.parse(editor.props.value);
  assert.deepEqual(displayed.inputs,{'run.py':'/fixture-run/simulation/run.py'});
  assert.deepEqual(displayed.remote_inputs,original.remote_inputs);
  assert.match(h.text(h.find(n=>n.props?.className==='page-heading')),/科学检查结果供参考.*执行检查须在计算节点通过/);
  editor.props.onChange({target:{value:JSON.stringify({...displayed,name:'Revised inputs',max_seconds:45})}});await h.flush();
  h.button('保存修订并预览脚本').props.onClick();await h.flush();
  assert.deepEqual(h.calls.filter(c=>c.target==='/api/cluster/revise').map(c=>c.data),[{run_id:original.id,changes:{name:'Revised inputs',engine:original.engine,
   max_seconds:45,resources:original.resources,parameters:{},inputs:displayed.inputs,remote_inputs:original.remote_inputs}}]);
  assert(h.calls.some(c=>c.target==='/api/cluster/observation'&&c.data.run_id==='revised-run'));
  assert.match(h.text(h.find(n=>n.type==='h1')),/Revised inputs/);
  assert.equal(h.text(h.find(n=>n.props?.className==='batch-script')),'# revised');
  assert(!h.calls.some(c=>c.target==='/api/cluster/submit'));
  assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
test('controlled jump form rejects an incomplete hop inline without saving or authenticating',async()=>{const h=clusterHarness();await h.flush();const jump=h.find(node=>node.type==='textarea'&&node.props.value==='');jump.props.onChange({target:{value:'bare-jump.invalid'}});await h.flush();h.button('保存连接').props.onClick();h.button('打开私有认证').props.onClick();await h.flush();assert.equal(h.auth.length,0);assert(!h.calls.some(call=>call.target==='/api/clusters'&&call.method==='POST'));assert(h.text(h.find(node=>node.props?.className==='cluster-footer')).includes('用户@主机:端口'));h.unmount();});

const runReceipt={runId:'prepared-run',nonce:'PRIVATE_NONCE_SENTINEL',projectId:'project',clusterId:'saved',version:1,snapshotDigest:'b'.repeat(64)};
const runReply=(changes={})=>({sessionId:'session',clusterId:'saved',version:1,status:'review',authenticated:false,sourceReceipt:structuredClone(runReceipt),authMode:'interactive',origin:{kind:'original-run',runId:'prepared-run',version:1},review:{host:profile.host},...changes});
function originalFixture(taskId){const f=fixture();f.setOverride((_m,path)=>path.includes('/auth/')?runReply(path.endsWith('/finish')?{status:'closed'}:{}):undefined);f.original=()=>f.api.plan({kind:'original-run',runId:'prepared-run',...taskId?{taskId}:{},owner:f.owner()},f.event);return f;}
test('original-run plan resolves only the worker raw record and never exposes trusted receipt or asks latest profile/status',async()=>{const f=originalFixture();f.worker.identity={distribution:'Other',root:'/unrelated-current-task'};const p=await f.original();assert.equal(p.status,'review');assert.equal(p.origin.kind,'original-run');assert.equal(p.newForwardAllowed,false);assert.deepEqual(f.calls.map(c=>c.path),['/api/cluster/auth/plan']);assert.deepEqual(f.calls[0].data,{run_id:'prepared-run',owner:'a'.repeat(48)});assert(!JSON.stringify(p).includes('PRIVATE_NONCE_SENTINEL'));assert(!Object.hasOwn(p,'sourceReceipt'));const before=f.calls.length;const forward=await f.api.tunnelPlan({...f.request(p),clusterId:'saved',version:1,localPort:2202,destinationHost:'fixture.invalid',destinationPort:22},f.event);assert.equal(forward.reason,'historical_forward_disabled');assert.equal(f.calls.length,before);});
test('original-run typed request refuses renderer snapshot/profile overrides before any privileged work',async()=>{for(const extra of [{clusterId:'saved'},{version:2},{snapshot:{host:'untrusted'}},{expected:sshConnectionReview(profile)}]){const f=fixture();await assert.rejects(f.api.plan({kind:'original-run',runId:'prepared-run',owner:f.owner(),...extra},f.event),/Invalid/);assert.equal(f.calls.length,0);assert(!f.api.privacy().active);}});
for(const [field,changed]of [['nonce','changed'],['projectId','other'],['version',2],['snapshotDigest','c'.repeat(64)]])test('original-run '+field+' drift cannot publish private output or switch immutable identity',async()=>{const f=originalFixture(),p=await f.original();f.setOverride((_m,path)=>path.endsWith('/auth/read')?runReply({version:field==='version'?changed:1,sourceReceipt:{...runReceipt,[field]:changed},privateOutput:'c2VjcmV0',cursor:6}):path.endsWith('/auth/finish')?runReply({status:'closed'}):undefined);const value=await f.api.read({...f.request(p),cursor:0},f.event);assert.equal(value.reason,'original_run_changed');assert(!value.privateOutput);assert.equal(value.authenticated,false);});
test('original-run private key result is explicitly not an authenticated master lease',async()=>{const f=originalFixture(),p=await f.original();f.setOverride((_m,path)=>path.endsWith('/auth/start')?runReply({status:'key_verified',authMode:'key',keyCheckStatus:'passed',authenticated:false}):undefined);const value=await f.api.start({...f.request(p),requestId:'reviewed-key'},f.event);assert.equal(value.status,'key_verified');assert.equal(value.keyCheckStatus,'passed');assert.equal(value.authenticated,false);});
test('original-run late owner/source changes never publish verified output',async()=>{for(const bound of [false,true]){const f=originalFixture(bound?'flow':undefined),p=await f.original(),wait=deferred();f.setOverride((_m,path)=>path.endsWith('/auth/read')?wait.promise:path.endsWith('/auth/finish')?runReply({status:'closed'}):undefined);const operation=f.api.read({...f.request(p),cursor:0},f.event);if(bound)f.setSource({binding:{distribution:'Fixture',root:'/new-source'}});else f.switch();wait.resolve(runReply({status:'verified',authenticated:true,privateOutput:'c2VjcmV0'}));const value=await operation;assert.equal(value.reason,'source_changed');assert(!value.privateOutput);assert.equal(f.calls.findLast(c=>c.path?.endsWith('/finish')).data.retain,false);}});
test('main task resolver scopes only explicit original task artifacts and standalone ignores unrelated chat binding',()=>{let task={id:'flow',provider:'codex',threadId:'thread',artifacts:[{id:'prepared-run',kind:'cluster-run'}],deployment:{workerBinding:{distribution:'Fixture',root:'/original',port:8767},prepared:{artifactId:'prepared-run'},config:{projectId:'project'}}};const records={read:id=>{assert.equal(id,'flow');return task;}},selected=()=>({taskId:'flow',provider:'codex',threadId:'thread'});assert.equal(sshTaskSource({read(){throw Error('Unrelated task must not be read');}},selected,{kind:'original-run',runId:'standalone'}),null);const proof=sshTaskSource(records,selected,{kind:'original-run',runId:'prepared-run',taskId:'flow'});assert.equal(proof.preparedProject,'project');assert.deepEqual(proof.artifact,{id:'prepared-run',kind:'cluster-run'});assert.doesNotThrow(()=>assertSshSource(proof,{connection:{},identity:{distribution:'Fixture',root:'/original'},connectionTarget:{port:8767}}));assert.throws(()=>assertSshSource(proof,{connection:{},identity:{distribution:'Other',root:'/other'}}),/needs_original_worker/);task={...task,artifacts:[]};assert.throws(()=>sshTaskSource(records,selected,{kind:'original-run',runId:'prepared-run',taskId:'flow'}),/original_run_unavailable/);});
test('ClusterRunPage unknown record without job ID retains original-run authentication action without replay',async()=>{const h=clusterHarness({runPage:true,override:(_m,target)=>target==='/api/cluster/observation'?{id:'prepared-run',status:'unknown',job_id:null,submit_attempted:true,snapshots:[],cluster:{scheduler:'slurm'},validation:{status:'passed'},scientific_validation:{status:'not_run'},connection_action:{kind:'authenticate_original_run',code:'needs_human_auth',runId:'prepared-run'}}:undefined});await h.flush();h.button('核对原作业连接').props.onClick();assert.deepEqual(h.updates,[{runId:'prepared-run'}]);assert(!h.calls.some(c=>c.target==='/api/cluster/submit'||c.target==='/api/cluster/profile'));assert.equal(h.errors.length,0);h.unmount();});
test('ClusterRunPage first status auth rejection still gives direct original-run review instead of endless loading',async()=>{const h=clusterHarness({runPage:true,override:(_m,target)=>{if(target==='/api/cluster/observation')throw Error('needs_human_auth');}});await h.flush();h.button('核对原作业连接').props.onClick();assert.deepEqual(h.updates,[{runId:'prepared-run'}]);assert.equal(h.errors.length,0);assert(!h.calls.some(c=>c.target==='/api/cluster/submit'));h.unmount();});
test('ClusterPage requested source selects exact second profile and never substitutes first when missing',async()=>{for(const wanted of ['saved','missing']){const h=clusterHarness({selectedClusterId:wanted,override:(_m,target)=>target==='/api/clusters'?[{id:'other',name:'Other'},{id:'saved',name:'Saved'}]:undefined});await h.flush();const loads=h.calls.filter(c=>c.target==='/api/cluster/profile');if(wanted==='saved'){assert(loads.length>0);assert(loads.every(c=>c.data.cluster_id==='saved'));h.button('打开私有认证').props.onClick();assert.equal(h.auth[0].clusterId,'saved');}else{assert.equal(loads.length,0);assert.equal(h.auth.length,0);}h.unmount();}});
test('late discovery of a saved connection does not replace an unsaved environment draft',async()=>{
 const pending=deferred(),h=clusterHarness({override:(_method,target)=>target==='/api/clusters'?pending.promise:undefined});
 try{
  await h.flush();h.button('环境探测').props.onClick();await h.flush();
  const editor=()=>h.find(node=>node.type==='ClusterEnvironmentEditor');
  const incomplete='{"executables":{"python":"/fixture';
  editor().props.onText(incomplete);await h.flush();
  pending.resolve([{id:'saved',name:'Saved profile'}]);await h.flush();
  assert.equal(editor().props.draft.text,incomplete);
  assert.equal(editor().props.draft.rawIssue,'syntax');
  assert(!h.calls.some(call=>call.target==='/api/cluster/profile'));
 }finally{h.unmount();}
});
test('Agent original-run action navigates exact run, keeps draft, and never opens authentication implicitly',async()=>{const actions=[],h=agentHarness({props:{onOpenOriginalRun:id=>actions.push(id),onOpenCluster:()=>actions.push('wrong-generic')}});await h.flush();h.type('Unsent original scientific question');h.emit({method:'item/completed',params:{item:{id:'original-monitor',type:'mcpToolCall',tool:'read_cluster_run',status:'completed',result:{content:[{type:'text',text:JSON.stringify({status:'unknown',job_id:null,connection_action:{kind:'authenticate_original_run',code:'needs_human_auth',runId:'prepared-run'}})}]}}}});await h.flush();h.click('agent-open-original-run');assert.deepEqual(actions,['prepared-run']);assert.equal(h.textarea().props.value,'Unsent original scientific question');assert(!h.calls.some(c=>c.method.startsWith('ssh.auth.')||c.method==='worker.connect'||c.method==='agent.rpc'&&c.data.method==='turn/start'));h.unmount();});
test('actual App standalone run review captures current owner but never enables guessed worker update or rebinding',async()=>{const storage=memoryStorage();storage.setItem('studio.section','cluster-run:prepared-run');const h=appWorkerHarness({storage});await h.flush();const run=h.find(n=>n.type==='./ClusterRunPage'&&n.props.id==='prepared-run');run.props.onOpenConnections({runId:'prepared-run'});await h.flush();const guide=h.find(n=>n.type==='./SshConnectionGuide');assert.deepEqual(guide.props.request,{kind:'original-run',runId:'prepared-run',owner:null});assert.equal(guide.props.onWorkerUpdate,undefined);assert(!h.calls.some(c=>c.method==='worker.connect'||c.method==='conversation.select'||c.method==='task.bind'));h.unmount();});

test('actual main factory validates task project receipt while standalone never inherits unrelated task scope',()=>{const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let factory;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='sshConnection')factory=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(factory);let task={id:'flow',provider:'codex',threadId:'thread',artifacts:[{id:'prepared-run',kind:'cluster-run'}],deployment:{workerBinding:{distribution:'Fixture',root:'/original'},prepared:{artifactId:'prepared-run'},config:{projectId:'project'}}};const deps=vm.runInNewContext(factory,{createSshConnection:value=>value,worker:{connection:{},identity:{distribution:'Fixture',root:'/original'}},workflowContext:{current:()=>({taskId:'flow',provider:'codex',threadId:'thread'}),revision:()=>1},taskRecords:{read:()=>task},sshTaskSource,assertSshSource,assertIdleAgent(){},readWorkerStatus(){},settings:{}});const explicit={kind:'original-run',runId:'prepared-run',taskId:'flow'};assert.doesNotThrow(()=>deps.validateRunReceipt(explicit,runReceipt));assert.throws(()=>deps.validateRunReceipt(explicit,{...runReceipt,projectId:'unrelated'}),/original_run_changed/);task={...task,artifacts:[]};assert.throws(()=>deps.validateRunReceipt(explicit,runReceipt),/original_run_unavailable/);assert.equal(deps.sourceScope({kind:'original-run',runId:'prepared-run'}),null);assert.doesNotThrow(()=>deps.validateRunReceipt({kind:'original-run',runId:'prepared-run'},runReceipt));});
function ownedApp(){const storage=memoryStorage(),chat={id:'codex:thread',provider:'codex',threadId:'thread',taskId:'flow',projectId:'project'},task={id:'flow',provider:'codex',threadId:'thread',title:'Original flow',artifacts:[{id:'prepared-run',kind:'cluster-run'}],deployment:{config:{projectId:'project',targetId:'saved'},prepared:{artifactId:'prepared-run'}}};storage.setItem('studio.conversation',chat.id);const h=appWorkerHarness({storage,override:(method,data,standard)=>method==='conversation.list'?[chat]:method==='conversation.select'?chat:method==='task.list'?[task]:method==='worker.status'||method==='worker.restore'?{status:'connected',serviceVersion:'current',taskId:chat.taskId,conversationId:chat.id}:standard(method,data)});return {h,chat,task};}
test('actual App original-run from unrelated selected chat stays standalone and leaves update action disabled',async()=>{const {h,chat}=ownedApp();await h.flush();h.find(n=>n.type==='./Agent').props.onOpenOriginalRun('unrelated-run');await h.flush();h.find(n=>n.type==='./ClusterRunPage').props.onOpenConnections({runId:'unrelated-run'});await h.flush();const guide=h.find(n=>n.type==='./SshConnectionGuide');assert.deepEqual(guide.props.request,{kind:'original-run',runId:'unrelated-run',owner:{provider:'codex',threadId:'thread',taskId:'flow'}});assert.equal(guide.props.onWorkerUpdate,undefined);assert.equal(h.storage.getItem('studio.conversation'),chat.id);assert(!h.calls.some(c=>c.method==='worker.connect'||c.method==='task.authoring.bindWorker'));h.unmount();});
test('actual App task CTA passes original run/task and explicit worker update owner; no-run CTA selects exact cluster',async()=>{const {h}=ownedApp();await h.flush();const agent=h.find(n=>n.type==='./Agent');agent.props.onOpenOriginalRun('prepared-run');await h.flush();h.find(n=>n.type==='./ClusterRunPage').props.onOpenConnections({runId:'prepared-run',taskId:'flow'});await h.flush();let guide=h.find(n=>n.type==='./SshConnectionGuide');assert.equal(guide.props.request.taskId,'flow');assert.equal(guide.props.request.runId,'prepared-run');void guide.props.onWorkerUpdate();await h.flush();assert.equal(h.find(n=>n.type==='./ComputeConnectionGuide').props.taskId,'flow');assert(!h.calls.some(c=>c.method==='worker.connect'));guide.props.onClose();await h.flush();h.find(n=>n.type==='./ClusterRunPage').props.onOpenConnections({taskId:'flow',clusterId:'saved'});await h.flush();assert.equal(h.find(n=>n.type==='./ClusterPage').props.selectedClusterId,'saved');h.unmount();});

test('explicit human End reaches the same owned worker after owner change while privacy stays locked until ACK',async()=>{const f=fixture();f.setOverride((_m,path)=>path.endsWith('/auth/plan')?{sessionId:'session',clusterId:'saved',version:1,status:'verified',authenticated:true}:undefined);const p=await f.plan();f.switch();let attempts=0;f.setOverride((_m,path,data)=>{if(path.endsWith('/finish')){attempts++;if(data.retain)throw Error('PRIVATE-cleanup-failure');return {status:'closed',authenticated:false};}});for(let i=0;i<2;i++)await assert.rejects(f.api.finish({...f.request(p),retain:false},f.event),/unconfirmed/);assert.deepEqual(f.calls.filter(c=>c.path?.endsWith('/finish')).map(c=>c.data.retain),[true,true]);assert(f.api.privacy().active);const result=await f.api.finish({...f.request(p),retain:false,end:true},f.event);assert.equal(result.status,'closed');assert.equal(attempts,3);assert.deepEqual(f.calls.filter(c=>c.path?.endsWith('/finish')).map(c=>c.data.retain),[true,true,false]);assert(!f.calls.some(c=>c.data&&Object.hasOwn(c.data,'end')));assert(f.api.privacy().active);f.api.closed(f.request(p),f.event);assert(!f.api.privacy().active);assert(!f.calls.some(c=>c.path?.endsWith('/input')||c.path?.endsWith('/start')));});
test('passive cleanup after source change retains a prior verified connection without explicit End intent',async()=>{const f=fixture();f.setOverride((_m,path)=>path.endsWith('/auth/plan')?{sessionId:'session',status:'verified',authenticated:true}:undefined);const p=await f.plan();f.setSource({binding:{distribution:'Fixture',root:'/changed-source'}});await f.api.finish({...f.request(p),retain:false},f.event);assert.equal(f.calls.findLast(c=>c.path?.endsWith('/finish')).data.retain,true);assert(f.api.privacy().active);});
test('explicit human End validates literal intent, owning frame and epoch before any worker cleanup',async()=>{for(const invalid of [{end:undefined,retain:false},{end:false,retain:false},{end:'true',retain:false},{end:1,retain:false},{end:true,retain:true},{end:true,retain:'false'}]){const f=fixture(),p=await f.plan(),before=f.calls.length;await assert.rejects(f.api.finish({...f.request(p),...invalid},f.event),/Invalid/);assert.equal(f.calls.length,before);assert(f.api.privacy().active);}const f=fixture(),p=await f.plan(),before=f.calls.length,request={...f.request(p),retain:false,end:true};for(const event of [{sender:{isDestroyed:()=>false},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{parent:null}}])await assert.rejects(f.api.finish(request,event),/unavailable/);await assert.rejects(f.api.finish({...request,paneEpoch:p.paneEpoch+1},f.event),/unavailable/);assert.equal(f.calls.length,before);});
test('explicit End cannot route cleanup to a replacement worker and keeps disposal ownership until ACK',async()=>{const f=fixture(),p=await f.plan(),before=f.calls.length;f.worker.connection={health:{root:'/replacement'}};f.worker.connectionEpoch++;const result=await f.api.finish({...f.request(p),retain:false,end:true},f.event);assert.equal(result.authenticated,false);assert.equal(f.calls.length,before);assert(f.api.privacy().active);f.api.closed(f.request(p),f.event);assert(!f.api.privacy().active);});


test('scheduler mismatch offers an explicit draft change without profile save or project grant',async()=>{
 const h=clusterHarness({override:(_m,path)=>path==='/api/cluster/probe'?{status:'passed',ssh_status:'passed',scheduler_status:'mismatch',observed_at:1,selected_scheduler:'slurm',selected_scheduler_match:false,detected_schedulers:['lsf'],queues:[]}:undefined});await h.flush();h.button('检查连接与调度器').props.onClick();await h.flush();h.button('环境探测').props.onClick();await h.flush();h.find(n=>n.props?.['data-testid']==='scheduler-draft-lsf').props.onClick();await h.flush();h.button('SSH 连接').props.onClick();await h.flush();assert.equal(h.find(n=>n.type==='select'&&n.props.value==='lsf').props.value,'lsf');assert(!h.calls.some(c=>c.method==='POST'&&['/api/clusters','/api/projects'].includes(c.target)));h.unmount();
});
test('queue editor is a secondary SSH tab with profile drafts saved only by existing explicit save',async()=>{
 const h=clusterHarness();await h.flush();h.button('队列与环境').props.onClick();await h.flush();const q=h.find(n=>n.props?.profile?.id==='saved'&&typeof n.props.onTargets==='function');assert.equal(q.props.profileDirty,false);q.props.onTargets([{id:'draft-target'}]);await h.flush();assert(!h.calls.some(c=>c.method==='POST'&&c.target==='/api/clusters'));assert.equal(h.find(n=>n.props?.profile?.id==='saved'&&typeof n.props.onTargets==='function').props.profileDirty,true);h.button('保存连接').props.onClick();await h.flush();assert.deepEqual(h.calls.find(c=>c.method==='POST'&&c.target==='/api/clusters').data.queue_targets,[{id:'draft-target'}]);assert(!h.calls.some(c=>c.target==='/api/projects'));h.unmount();
});
for(const snapshot of [false,true])test('run review exposes resolved queue snapshot only when worker actually recorded one '+snapshot,async()=>{
 const h=clusterHarness({runPage:true,override:(_m,path)=>path==='/api/cluster/observation'?{kind:'cluster-run',id:'prepared-run',name:'Run',engine:'pydyn.md',project_id:'project',cluster_id:'saved',status:'succeeded',snapshots:[],resources:{queue:'actual-q'},max_seconds:30,validation:{status:'passed'},scientific_validation:{status:'not_run'},cluster:{scheduler:'slurm'},job_id:null,script:'script',...snapshot?{queue_target_snapshot:{id:'actual-target',queue:'actual-q',usage_class:'owned',environment:{executables:{python:'/registered/python'}}},queue_profile_version:4}:{}}:undefined});await h.flush();if(snapshot){const card=h.find(n=>n.props?.['data-testid']==='resolved-queue-target');assert.match(h.text(card),/actual-q/);assert.match(h.text(card),/actual-target/);assert.match(h.text(card),/v4/);assert.match(h.text(card),/registered\/python/);}else assert.throws(()=>h.find(n=>n.props?.['data-testid']==='resolved-queue-target'));assert(!h.calls.some(c=>/submit|prepare/.test(c.target||'')));h.unmount();
});


test('late saved-profile acknowledgement cannot replace a newly selected blank SSH draft',async()=>{
 let resolve;const saved=new Promise(r=>resolve=r),h=clusterHarness({override:(method,path)=>method==='POST'&&path==='/api/clusters'?saved:undefined});await h.flush();const reads=h.calls.filter(c=>c.target==='/api/cluster/profile').length;h.button('保存连接').props.onClick();await h.flush();h.find(n=>n.type==='select'&&n.props.value==='saved').props.onChange({target:{value:''}});await h.flush();resolve({id:'saved',version:99});await h.flush();await h.reveal();assert.equal(h.byId('ssh-host').props.value,'');assert.equal(h.calls.filter(c=>c.target==='/api/cluster/profile').length,reads);h.unmount();
});


test('queue controls on an old worker offer the existing original-source update flow without writes',async()=>{
 const h=clusterHarness({serviceVersion:'different'});await h.flush();h.button('队列与环境').props.onClick();await h.flush();assert.equal(h.find(n=>n.props?.profile?.id==='saved'&&typeof n.props.onTargets==='function').props.worker,false);h.button('按原来源更新作业服务').props.onClick();await h.flush();assert.deepEqual(h.updates,['guide']);assert(!h.calls.some(c=>c.method==='POST'&&['/api/clusters','/api/projects'].includes(c.target)));h.unmount();
});

for(const outcome of ['resolve','reject'])test('actual SSH test ignores late '+outcome+' after a connection edit and releases busy state',async()=>{const wait=deferred();const h=clusterHarness({override:(_m,path)=>path==='/api/cluster/test'?wait.promise:undefined});await h.flush();await h.reveal();h.button('测试 SSH 连接').props.onClick();await h.flush();h.byId('ssh-host').props.onChange({target:{value:'different.invalid'}});await h.flush();if(outcome==='resolve')wait.resolve({status:'passed',username_matches:true});else wait.reject(Error('late private failure'));await h.flush();assert.notEqual(h.byId('cluster-ready-ssh').props['data-state'],'verified');assert.equal(h.errors.length,0);assert.equal(h.button('测试 SSH 连接').props.disabled,false);assert(!h.calls.some(c=>c.target==='/api/clusters'&&c.method==='POST'||c.target==='/api/projects'));h.unmount();});

test('SSH test result follows project/profile scope and unmounted pages receive no result',async()=>{for(const change of ['project','profile','unmount']){const wait=deferred();const h=clusterHarness({override:(_m,path)=>path==='/api/cluster/test'?wait.promise:undefined});await h.flush();h.button('测试 SSH 连接').props.onClick();await h.flush();if(change==='project'){h.props.project={...h.props.project,id:'other-project'};h.render();}else if(change==='profile'){h.find(n=>n.type==='select'&&n.props.value==='saved').props.onChange({target:{value:''}});await h.flush();}else h.unmount();wait.resolve({status:'passed'});await h.flush();if(change!=='unmount')assert.notEqual(h.byId('cluster-ready-ssh').props['data-state'],'verified');assert.equal(h.errors.length,0);h.unmount();}});

test('import cancellation retains the existing form; opaque Xshell reference loads only unsaved draft and review guard blocks actions',async()=>{let response={cancelled:true};const h=clusterHarness({override:(method,path)=>method==='IPC'&&path==='ssh.existing'?[{ref:'opaque-session',label:'Synthetic session',source:'xshell'}]:method==='IPC'&&path==='ssh.import'?response:undefined});await h.flush();const importer=()=>h.find(n=>n.props?.['aria-label']==='导入本机已有连接');importer().props.onChange({target:{value:'opaque-session'}});await h.flush();await h.reveal();assert.equal(h.byId('ssh-host').props.value,profile.host);response={name:'Imported fixture',host:'fixture.invalid',username:'fixture-user',port:22,identity_file:'',ssh_client:'/fixture/ssh',scheduler:'lsf',auth_mode:'key',via:[],environment:{executables:{python:'/fixture/python'}},limits:{cpus:1,gpus:0,memory_mb:1024},source:'xshell',import_review:{requires_review:true,reasons:['unsupported route'],credential_values_imported:false}};importer().props.onChange({target:{value:'opaque-session'}});await h.flush();await h.reveal();assert.equal(h.byId('ssh-host').props.value,'fixture.invalid');assert(h.button('测试 SSH 连接').props.disabled);assert(h.button('保存连接').props.disabled);assert(!h.calls.some(c=>c.target==='/api/clusters'&&c.method==='POST'||c.target==='/api/projects'||c.target==='/api/cluster/test'));assert(h.text(h.find(n=>n.props?.['data-testid']==='cluster-current-observation')).includes('默认认证'));h.unmount();});

test('probe summary sent to Agent is allowlisted while literal queue names remain local and unapproved',async()=>{const probe={status:'passed',ssh_status:'passed',scheduler_status:'passed',queue_status:'passed',selected_scheduler:'lsf',detected_schedulers:['lsf','PRIVATE_ENDPOINT_SENTINEL'],observed_at:123,queues:['synthetic!','ordinary'],host:'PRIVATE_HOST_SENTINEL',username:'PRIVATE_USER_SENTINEL',port:12345,commands:{raw:'PRIVATE_COMMAND_SENTINEL'},privateOutput:'PRIVATE_OUTPUT_SENTINEL'};const h=clusterHarness({override:(_m,path)=>path==='/api/cluster/probe'?probe:undefined});await h.flush();h.button('检查连接与调度器').props.onClick();await h.flush();h.button('环境探测').props.onClick();await h.flush();h.button('让 Agent 协助配置').props.onClick();assert.equal(h.agents.length,1);assert.match(h.agents[0],/visible_queue_count.*2/);assert.doesNotMatch(h.agents[0],/PRIVATE_|12345|synthetic!|ordinary/);h.button('队列与环境').props.onClick();await h.flush();const queues=h.find(n=>n.props?.profile?.id==='saved'&&typeof n.props.onTargets==='function');assert.deepEqual(queues.props.probe.queues,['synthetic!','ordinary']);assert(!h.calls.some(c=>c.target==='/api/projects'||c.target==='/api/clusters'&&c.method==='POST'||c.target==='/api/cluster/submit'));h.unmount();});

test('cluster primary path has three stages and secondary tools stay under More without opening connections',async()=>{const h=clusterHarness();await h.flush();const primary=h.find(n=>n.props?.['aria-label']==='集群配置步骤');const txt=h.text(primary);assert.match(txt,/SSH 连接/);assert.match(txt,/环境探测/);assert.match(txt,/队列与环境/);assert.doesNotMatch(txt,/提交 Skill|远程文件|作业监视/);for(const label of ['提交 Skill','远程文件','作业监视'])h.button(label);assert(!h.calls.some(c=>['/api/cluster/test','/api/cluster/probe','/api/cluster/submit'].includes(c.target)));h.unmount();});

test('late probe cannot revive an edited-and-restored connection or touch policy',async()=>{const wait=deferred();const h=clusterHarness({override:(_m,path)=>path==='/api/cluster/probe'?wait.promise:undefined});await h.flush();h.button('检查连接与调度器').props.onClick();await h.flush();await h.reveal();const host=()=>h.byId('ssh-host');host().props.onChange({target:{value:'other.invalid'}});await h.flush();host().props.onChange({target:{value:profile.host}});await h.flush();wait.resolve({status:'passed',ssh_status:'passed',scheduler_status:'passed',queue_status:'passed',queues:['stale-queue']});await h.flush();assert.equal(h.byId('cluster-ready-scheduler').props['data-state'],'configured');assert.equal(h.errors.length,0);assert(!h.button('检查连接与调度器').props.disabled);assert(!h.calls.some(c=>c.target==='/api/projects'||c.target==='/api/clusters'&&c.method==='POST'));h.unmount();});

test('a late source import cannot replace a newer draft and default authentication is not given a guessed key',async()=>{const wait=deferred();let imports=0;const imported={name:'Newer',host:'synthetic.invalid',username:'synthetic-user',port:22,identity_file:'',ssh_client:'/fixture/ssh',auth_mode:'key',scheduler:'lsf',environment:{executables:{python:'/fixture/python'}},limits:{cpus:1,gpus:0,memory_mb:1024},import_review:{requires_review:false,credential_values_imported:false}};const h=clusterHarness({override:(method,path)=>method==='IPC'&&path==='ssh.import'?(++imports===1?wait.promise:imported):undefined});await h.flush();const importer=()=>h.find(n=>n.props?.['aria-label']==='导入本机已有连接');importer().props.onChange({target:{value:'old-reference'}});await h.flush();importer().props.onChange({target:{value:'new-reference'}});await h.flush();wait.resolve({...imported,host:'stale.invalid'});await h.flush();await h.reveal();assert.equal(h.byId('ssh-host').props.value,'synthetic.invalid');h.button('测试 SSH 连接').props.onClick();await h.flush();const call=h.calls.find(c=>c.target==='/api/cluster/test');assert.equal(call.data.connection.identity_file,'');assert.equal(h.byId('cluster-ready-ssh').props['data-state'],'verified');assert(!h.calls.some(c=>c.target==='/api/projects'||c.target==='/api/clusters'&&c.method==='POST'));h.unmount();});

test('saved and draft SSH evidence share one status and edited endpoints need a new observation',async()=>{
 const h=clusterHarness({override:(_m,target)=>target==='/api/cluster/probe'?{status:'passed',ssh_status:'passed',scheduler_status:'passed',observed_at:Date.now()/1000}:undefined});await h.flush();
 const status=id=>h.byId('cluster-ready-'+id).props['data-state'];
 assert.equal(status('ssh'),'configured');
 h.button('检查连接与调度器').props.onClick();await h.flush();
 assert.equal(status('ssh'),'verified');
 assert.equal(status('scheduler'),'verified');
 assert.equal(status('science'),'configured');
 h.byId('ssh-test').props.onClick();await h.flush();
 assert.equal(status('ssh'),'verified');
 await h.reveal();h.byId('ssh-host').props.onChange({target:{value:'edited.invalid'}});await h.flush();
 assert.equal(status('ssh'),'stale');
 assert.equal(status('scheduler'),'stale');
 assert(!h.calls.some(c=>c.target==='/api/clusters'&&c.method==='POST'));h.unmount();
});

const verifiedClusterProbe=observed_at=>({status:'passed',ssh_status:'passed',scheduler_status:'passed',
 selected_scheduler:'slurm',selected_scheduler_match:true,queues:['observed'],queue_status:'passed',observed_at});
const savedClusterObservation=(probe,connection_check)=>({...profile,scheduler:'slurm',probe,connection_check,
 environment:{executables:{python:'/usr/bin/python3'}},limits:{cpus:1,gpus:0,memory_mb:1024}});
const readinessState=(h,stage)=>h.byId('cluster-ready-'+stage).props['data-state'];
const currentCheck=probe=>({...probe,version:profile.version});
const failedCheck=observed_at=>({status:'failed',observed_at,version:profile.version,compute_node_status:'not_run'});

test('a rejected cluster probe shows the recorded failure and retires older passes across refresh and reopen',async()=>{
 const observed=Date.now()/1000-10,passed=verifiedClusterProbe(observed),failure=failedCheck(observed+1);
 let stored=savedClusterObservation(null,undefined),attempts=0;
 const override=(method,target)=>{
  if(target==='/api/clusters'&&method==='GET')return [structuredClone(stored)];
  if(target==='/api/cluster/profile')return structuredClone(stored);
  if(target!=='/api/cluster/probe')return;
  if(++attempts===1){stored=savedClusterObservation(passed,currentCheck(passed));return passed;}
  stored=savedClusterObservation(null,failure);
  throw Error('private_ssh_operation_failed');
 };
 const h=clusterHarness({override});
 await h.flush();
 h.button('检查连接与调度器').props.onClick();await h.flush();
 assert.equal(readinessState(h,'ssh'),'verified');
 assert.equal(readinessState(h,'scheduler'),'verified');
 h.button('检查连接与调度器').props.onClick();await h.flush();
 assert.equal(readinessState(h,'ssh'),'stale');
 assert.equal(readinessState(h,'scheduler'),'stale');
 assert.equal(readinessState(h,'science'),'configured');
 assert(h.find(node=>node.type==='time'&&node.props.dateTime===new Date(observed*1000).toISOString()));
 assert(h.text(h.byId('cluster-saved-check-failed')).includes('最近保存的集群连接检查失败。'));
 assert(h.find(node=>node.type==='time'&&node.props.dateTime===new Date(failure.observed_at*1000).toISOString()));
 assert.throws(()=>h.byId('cluster-probe-unconfirmed'),/missing/);
 h.unmount();

 const reopened=clusterHarness({override});
 await reopened.flush();
 assert(reopened.byId('cluster-saved-check-failed'));
 assert.equal(readinessState(reopened,'ssh'),'configured');
 assert.equal(readinessState(reopened,'scheduler'),'configured');
 const fresh=verifiedClusterProbe(observed+2);
 stored=savedClusterObservation(fresh,currentCheck(fresh));
 reopened.find(node=>node.props?.['aria-label']==='刷新连接列表').props.onClick();await reopened.flush();
 assert.equal(readinessState(reopened,'ssh'),'verified');
 assert.equal(readinessState(reopened,'scheduler'),'verified');
 assert.throws(()=>reopened.byId('cluster-saved-check-failed'),/missing/);
 assert(!reopened.calls.some(call=>call.target==='/api/cluster/probe'||call.target==='/api/projects'||call.target==='/api/clusters'&&call.method==='POST'));
 reopened.unmount();
});

test('an unavailable probe result retains historical checks and a later SSH-only receipt leaves scheduler unconfirmed',async()=>{
 const observed=Date.now()/1000-10,passed=verifiedClusterProbe(observed);
 let stored=savedClusterObservation(passed,currentCheck(passed)),unavailable=false,recovered=false;
 const h=clusterHarness({override:(method,target)=>{
  if(target==='/api/clusters'&&method==='GET'){
   if(unavailable)throw Error('worker read unavailable');
   return [structuredClone(stored)];
  }
  if(target==='/api/cluster/profile')return structuredClone(stored);
  if(target!=='/api/cluster/probe')return;
  if(!recovered){unavailable=true;throw Error('worker response unavailable');}
  const probe=verifiedClusterProbe(observed+2);
  stored=savedClusterObservation(probe,currentCheck(probe));
  return probe;
 }});
 await h.flush();
 assert.equal(readinessState(h,'scheduler'),'verified');
 h.button('检查连接与调度器').props.onClick();await h.flush();
 assert(h.byId('cluster-probe-unconfirmed'));
 assert.throws(()=>h.byId('cluster-saved-check-failed'),/missing/);
 assert.equal(readinessState(h,'ssh'),'stale');
 assert.equal(readinessState(h,'scheduler'),'stale');
 assert.equal(h.errors.length,1);
 assert.equal(h.button('检查连接与调度器').props.disabled,false);
 unavailable=false;
 stored=savedClusterObservation(passed,{status:'passed',username_matches:true,observed_at:observed+1,version:profile.version});
 h.find(node=>node.props?.['aria-label']==='刷新连接列表').props.onClick();await h.flush();
 assert.equal(readinessState(h,'ssh'),'verified');
 assert.equal(readinessState(h,'scheduler'),'stale');
 assert(h.byId('cluster-probe-unconfirmed'));
 recovered=true;
 h.button('检查连接与调度器').props.onClick();await h.flush();
 assert.equal(readinessState(h,'scheduler'),'verified');
 assert.throws(()=>h.byId('cluster-probe-unconfirmed'),/missing/);
 h.unmount();
});

test('late probe failures and follow-up reads do not change a replacement observation scope',async()=>{
 for(const resolution of ['probe','follow-up']){
  const observed=Date.now()/1000-10,passed=verifiedClusterProbe(observed),failure=failedCheck(observed+1),wait=deferred();
  const stored=savedClusterObservation(passed,currentCheck(passed));
  let probeCount=0;
  const h=clusterHarness({override:(method,target)=>{
   if(target==='/api/clusters'&&method==='GET')return probeCount&&resolution==='follow-up'?wait.promise:[structuredClone(stored)];
   if(target==='/api/cluster/profile')return structuredClone(stored);
   if(target!=='/api/cluster/probe')return;
   probeCount++;
   if(resolution==='probe')return wait.promise;
   throw Error('private_ssh_operation_failed');
  }});
  await h.flush();h.button('检查连接与调度器').props.onClick();await h.flush();
  const followUpRead=h.calls.filter(call=>call.method==='GET'&&call.target==='/api/clusters').length;
  h.props.project={...h.props.project,id:'replacement-project'};h.render();await h.flush();
  if(resolution==='probe')wait.reject(Error('late probe failure'));
  else wait.resolve([savedClusterObservation(null,failure)]);
  await h.flush();
  assert.equal(readinessState(h,'ssh'),'verified');
  assert.equal(readinessState(h,'scheduler'),'verified');
  assert.throws(()=>h.byId('cluster-saved-check-failed'),/missing/);
  assert.throws(()=>h.byId('cluster-probe-unconfirmed'),/missing/);
  assert.equal(h.calls.filter(call=>call.method==='GET'&&call.target==='/api/clusters').length,followUpRead);
  if(resolution==='probe')assert.deepEqual(h.errors,[]);
  h.unmount();
 }
});

test('scheduler observation cannot verify a different scheduler or a superseded profile version',async()=>{
 for(const changed of ['scheduler','version']){
  let lists=0;
  const h=clusterHarness({override:(method,target)=>{
   if(method==='GET'&&target==='/api/clusters')return [{...profile,version:changed==='version'&&++lists>1?2:profile.version}];
   if(target==='/api/cluster/probe')return {status:'passed',ssh_status:'passed',scheduler_status:'passed',
    selected_scheduler:changed==='scheduler'?'lsf':'slurm',observed_at:Date.now()/1000};
  }});
  await h.flush();
  h.button('检查连接与调度器').props.onClick();await h.flush();
  assert.equal(h.byId('cluster-ready-scheduler').props['data-state'],'stale');
  assert.equal(h.byId('cluster-ready-ssh').props['data-state'],changed==='scheduler'?'verified':'stale');
  assert.equal(h.calls.filter(call=>call.target==='/api/cluster/probe').length,1);
  h.unmount();
 }
});

test('key-mode ClusterPage uses compact default-auth label and reserves 2FA explanation for interactive mode',async()=>{
 const h=clusterHarness({override:(_m,target)=>target==='/api/cluster/profile'?{...profile,auth_mode:'key',identity_file:'',environment:{executables:{python:'/usr/bin/python3'}},scheduler:'lsf',remote_root:'~/fixture-runs',read_roots:[],limits:{cpus:1,gpus:0,memory_mb:1024}}:undefined});
 await h.flush();
 assert.match(h.text(h.find(n=>n.props?.['data-testid']==='cluster-current-observation')),/使用默认认证/);
 assert.throws(()=>h.find(n=>n.type==='p'&&h.text(n).includes('二步验证使用已核对')),/missing/);
 assert(!h.calls.some(c=>c.target==='/api/cluster/test'||c.target==='/api/cluster/probe'));h.unmount();
});

test('read-only ClusterRunPage preserves status and rejects stale submit or edit callbacks',async()=>{
 const h=clusterHarness({runPage:true});try{await h.flush();const submit=h.button('审阅完成，提交到集群').props.onClick;h.props.readOnly=true;h.render();await h.flush();assert.equal(h.button('审阅完成，提交到集群').props.disabled,true);submit();h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await h.flush();assert(!h.calls.some(c=>['/api/cluster/submit','/api/cluster/revise'].includes(c.target)));assert.equal(h.find(n=>n.type==='textarea').props.readOnly,true);assert(h.calls.some(c=>c.target==='/api/cluster/observation'));assert(!h.calls.some(c=>c.target==='/api/cluster/status'));assert(h.text(h.find(n=>n.props?.['data-testid']==='run-readonly-observation')).includes('提交、续算'));}finally{h.unmount();}
});

for(const status of ['succeeded','failed','cancelled'])test('an observed '+status+' cluster run stops periodic reads but allows a manual check with logs',async()=>{
 const h=clusterHarness({runPage:true,override:(_method,path)=>{
  if(['/api/cluster/observation','/api/cluster/status'].includes(path))return {...h.readyRun,status,job_id:'1'};
  if(path==='/api/cluster/log')return {text:'Synthetic log'};
 }});
 try{
  await h.flush();await h.poll();
  assert.equal(h.calls.filter(call=>call.target==='/api/cluster/observation').length,1);
  assert.equal(h.timers.size,0);
  h.button('核对作业与日志').props.onClick();await h.flush();
  assert.equal(h.calls.filter(call=>call.target==='/api/cluster/status').length,1);
  assert.equal(h.calls.filter(call=>call.target==='/api/cluster/log').length,1);
  assert.equal(h.timers.size,0);
 }finally{h.unmount();}
});

test('a cancellation request and unknown job remain observable until the worker confirms cancellation',async()=>{
 let reads=0;
 const h=clusterHarness({runPage:true,override:(_method,path)=>path==='/api/cluster/observation'?{
  ...h.readyRun,job_id:'2',status:reads++?'cancelled':'unknown',cancellation:{status:'requested',signal_sent:true}
 }:undefined});
 try{
  await h.flush();
  assert.match(h.text(h.find(node=>node.props?.['data-testid']==='cluster-cancellation-receipt')),/等待作业的最终状态/);
  assert.equal(h.timers.size,1);
  await h.poll();
  assert.equal(h.timers.size,0);
  assert.equal(h.text(h.find(node=>node.props?.className==='tag')),'cancelled');
  assert(!h.calls.some(call=>call.target==='/api/cluster/submit'||call.target==='/api/cluster/cancel'));
 }finally{h.unmount();}
});

test('cluster monitor finds new runs after all earlier runs complete, pauses when hidden, and rejects a former source failure',async()=>{
 const old=deferred();let reads=0;
 const h=clusterHarness({sourceId:'service-a',override:(_method,path)=>{
  if(path==='/api/cluster-runs'){
   const terminal={...h.readyRun,status:'succeeded'};
   switch(++reads){
    case 1:return [terminal];
    case 2:return [terminal,{...terminal,id:'added',name:'New fixture',status:'running'}];
    case 3:return old.promise;
    default:return [{...terminal,name:'Current source fixture'}];
   }
  }
 }});
 try{
  await h.flush();
  assert.equal(reads,0);
  h.button('作业监视').props.onClick();await h.flush();
  assert.equal(reads,1);
  await h.poll();
  assert.equal(reads,2);
  assert.match(h.text(h.find(node=>node.props?.className==='cluster-run-row'&&h.text(node).includes('New fixture'))),/New fixture/);
  await h.poll();assert.equal(reads,3);
  h.props.visible=false;h.render();await h.flush();
  assert.equal(h.timers.size,0);
  h.props.sourceId='service-b';h.props.visible=true;h.render();await h.flush();
  old.reject(Error('expired fixture read'));await h.flush();
  assert.equal(reads,4);
  assert.equal(h.calls.filter(call=>call.target==='/api/clusters').length,2);
  assert.match(h.text(h.find(node=>node.props?.className==='cluster-run-row')),/Current source fixture/);
  assert.equal(h.find(node=>node.type?.name==='ClusterObservationStatus').props.error,false);
 }finally{h.unmount();}
});

test('same-source disconnect retains the last run and fences read failures, and a source switch retires both the run and its diagnostics',async()=>{
 const old=deferred(),replacement=deferred();let reads=0;
 const h=clusterHarness({runPage:true,sourceId:'service-a',override:(_method,path)=>{
  if(path!=='/api/cluster/observation')return;
  if(++reads===1)return {...h.readyRun,status:'running'};
  return reads===2?old.promise:replacement.promise;
 }});
 try{
  await h.flush();await h.poll();
  h.props.connected=false;h.render();await h.flush();
  assert.equal(h.text(h.find(node=>node.type==='h1')),'Fixture run');
  assert.equal(h.button('核对作业与日志').props.disabled,true);
  assert.equal(h.find(node=>node.type?.name==='ClusterObservationStatus').props.connected,false);
  h.props.sourceId='service-b';h.props.connected=true;h.render();await h.flush();
  assert.throws(()=>h.find(node=>node.type==='h1'));
  replacement.resolve({...h.readyRun,name:'Other source',status:'succeeded'});
  old.reject(Error('needs_human_auth'));
  await h.flush();
  assert.equal(h.text(h.find(node=>node.type==='h1')),'Other source');
  assert.throws(()=>h.button('核对原作业连接'));
  assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('an older worker uses its local job list, while a late unsupported-route error cannot target the replacement worker',async()=>{
 const rejectedOld=deferred();let queries=0;
 const h=clusterHarness({runPage:true,sourceId:'service-a',override:(_method,path)=>{
  if(path==='/api/cluster/observation'){
   if(++queries===1)return Promise.reject(Error('unknown route'));
   if(queries===2)return rejectedOld.promise;
   return {...h.readyRun,name:'Replacement source',status:'succeeded'};
  }
  if(path==='/api/cluster-runs')return [{...h.readyRun,name:'Older worker record',status:'running'}];
 }});
 try{
  await h.flush();assert.equal(h.text(h.find(node=>node.type==='h1')),'Older worker record');
  await h.poll();assert.equal(queries,2);
  h.props.sourceId='service-b';h.render();await h.flush();
  rejectedOld.reject(Error('unknown route'));await h.flush();
  assert.equal(h.text(h.find(node=>node.type==='h1')),'Replacement source');
  assert.equal(h.calls.filter(call=>call.target==='/api/cluster-runs').length,1);
  assert(!h.calls.some(call=>call.target==='/api/cluster/status'));
 }finally{h.unmount();}
});

for(const startsOnline of [false,true])test('App preserves original worker restoration '+(startsOnline?'with a retained cluster record':'before the first cluster read'),async()=>{
 const storage=memoryStorage();let online=startsOnline;
 const chat={id:'codex:cluster-owner',provider:'codex',threadId:'cluster-owner',taskId:'original-flow',projectId:'project'};
 const task={id:chat.taskId,provider:chat.provider,threadId:chat.threadId,artifacts:[{kind:'cluster-run',id:'prepared-run'}],deployment:{workerBinding:{distribution:'Fixture',root:'/original',port:8767}}};
 const sourceId='a'.repeat(64);
 storage.setItem('studio.conversation',chat.id);storage.setItem('studio.section','cluster-run:prepared-run');
 const h=appWorkerHarness({storage,override:(method,data,standard)=>{
  if(method==='conversation.list')return [chat];
  if(method==='conversation.select')return chat;
  if(method==='task.list')return [task];
  if(method==='worker.status'||method==='worker.restore')return online?{status:'connected',taskId:task.id,conversationId:chat.id,sourceId,checkedAt:1}:{status:'disconnected',taskId:task.id,checkedAt:2};
  return standard(method,data);
 }});
 try{
  await h.flush();
  h.find(node=>node.type==='./Agent').props.onOpenOriginalRun('prepared-run');
  await h.flush();
  if(startsOnline){
   assert.equal(h.find(node=>node.type==='./ClusterRunPage').props.connected,true);
   online=false;h.emit({method:'studio/workerConnected'});await h.flush();
   const retained=h.find(node=>node.type==='./ClusterRunPage');
   assert.equal(retained.props.connected,false);assert.equal(retained.props.sourceId,sourceId);
  }else assert.throws(()=>h.find(node=>node.type==='./ClusterRunPage'));
  h.find(node=>node.type==='button'&&h.text(node)==='恢复原作业服务').props.onClick();
  await h.flush();
  assert.equal(h.find(node=>node.type==='./ComputeConnectionGuide').props.taskId,task.id);
  assert(!h.calls.some(call=>call.method==='worker.connect'||/\/(submit|cancel)$/.test(call.data?.target||'')));
 }finally{h.unmount();}
});
