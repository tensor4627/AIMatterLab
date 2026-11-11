import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {createSshService,normalizeSshServiceHealth} from '../../backend/main/compute/ssh-service.mjs';

const host={hostname:'fixture.invalid',uid:1000,machineId:'fixture-machine'},health={name:'gpu-sampling-studio',root:'/fixture/service',runtime:'/fixture/service/runtimes/'+'a'.repeat(20),runtimeId:'a'.repeat(20),port:25000,execution_policy:'desktop-review-v1',hostIdentity:host};
const intent={sessionId:'owned-session',ownerEpoch:2,profileId:'saved-profile',profileVersion:1,requestId:'human-connect'};
const selected={kind:'ssh-terminal',sessionId:intent.sessionId,profileId:intent.profileId,profileVersion:1};
function fixture(t){
 const worker=new WorkerClient(),calls=[],remembered=[];t.after(()=>worker.close());
 let owner={provider:'codex',threadId:'fixture-thread'},revision=1,selection=structuredClone(selected);
 const terminal={connectService:async(data,bootstrap)=>{calls.push({operation:'connect',data,bootstrap});return {serviceId:'service-lease-one',service:health};},serviceRequest:async packet=>{calls.push({operation:'request',packet});if(packet.target==='/api/health')return {status:200,data:health};if(packet.target==='/mcp')return {status:200,data:{jsonrpc:'2.0',id:packet.data.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}};return {status:200,data:{echo:packet.data}};},disconnectService:async data=>{calls.push({operation:'disconnect',data});return {status:'disconnected'};}};
 const resource={peek:()=>selection,capture:()=>revision,assertCurrent:ticket=>assert.equal(ticket,revision)};
 const controller=createSshService({worker,terminal,profiles:{read:data=>{assert.equal(data.id,intent.profileId);assert.equal(data.version,1);return {kind:'ssh'};}},resource,source:'/inert/fixed/worker',current:()=>owner,prepareResources:()=>({source:'fixed inert source',payload:{expected_runtime_id:health.runtimeId}}),remember:(...args)=>remembered.push(args)});
 return {worker,terminal,controller,calls,remembered,changeOwner:()=>owner={provider:'codex',threadId:'other-thread'},changeSelection:next=>{revision++;if(next)selection=next;}};
}
test('human interactive service attaches a real loopback MCP proxy and forwards admin calls through only the selected private lease',async t=>{
 const f=fixture(t),result=await f.controller.connect(intent);assert.equal(result.workflowReady,true);assert.equal(result.tools.status,'ready');assert.equal(f.worker.identity.kind,'ssh');assert.deepEqual(f.worker.identity.hostIdentity,host);assert.equal(f.remembered.length,1);
 const answer=await f.worker.request('POST','/api/workspace/read',{owned:'fixture'});assert.deepEqual(answer,{echo:{owned:'fixture'}});
 assert(f.calls.filter(c=>c.operation==='request').every(c=>c.packet.serviceId==='service-lease-one'&&c.packet.sessionId===intent.sessionId));
 const scoped=f.worker.providerConnection('codex');assert.match(scoped.url,/^http:\/\/127\.0\.0\.1:\d+\/providers\/codex$/);assert.equal(scoped.tokens.admin,undefined);assert.notEqual(scoped.tokens.mcp,'remote-token');
 assert.equal(JSON.stringify(result).includes('tokens'),false);await f.controller.disconnect({});assert.equal(f.worker.connection,null);assert.deepEqual(f.calls.find(c=>c.operation==='disconnect').data,{sessionId:intent.sessionId,serviceId:'service-lease-one'});
});
test('delayed bootstrap cannot attach a service after selected conversation changes',async t=>{
 const f=fixture(t);let release;f.terminal.connectService=()=>new Promise(resolve=>release=resolve);const pending=f.controller.connect(intent);f.changeOwner();release({serviceId:'late-lease',service:health});await assert.rejects(pending,/context_changed/);assert.equal(f.worker.connection??null,null);assert.equal(f.remembered.length,0);
});
test('service errors are unknown and never automatically replay an uncertain request',async t=>{
 const f=fixture(t);await f.controller.connect(intent);let attempts=0;const original=f.terminal.serviceRequest;f.terminal.serviceRequest=async packet=>{if(packet.target==='/api/cluster/submit'){attempts++;throw Error('ssh_service_response_unknown');}return original(packet);};
 await assert.rejects(f.worker.request('POST','/api/cluster/submit',{fixture:'no real job'}),/response_unknown/);assert.equal(attempts,1);assert.equal(f.controller.peek().status,'unknown');assert.equal(f.controller.peek().workflowReady,false);
});
test('safe service health drops arbitrary private fields rather than publishing credentials',()=>{
 const normalized=normalizeSshServiceHealth({...health,tokens:{admin:'must-not-publish'},secret:'must-not-publish'});assert(!JSON.stringify(normalized).includes('must-not-publish'));assert.throws(()=>normalizeSshServiceHealth({...health,hostIdentity:{...host,uid:-1}}),/identity_unavailable/);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('a delayed disconnect fences new connections until its owned cleanup completes',async t=>{
 const f=fixture(t);await f.controller.connect(intent);const stopped=deferred(),entered=deferred();let stops=0;
 f.terminal.disconnectService=async data=>{stops++;assert.equal(data.serviceId,'service-lease-one');entered.resolve();await stopped.promise;return {status:'disconnected'};};
 const closing=f.controller.disconnect({});await entered.promise;const next={...intent,sessionId:'new-owned-session',requestId:'human-connect-next'};f.changeSelection({...selected,sessionId:next.sessionId});
 await assert.rejects(f.controller.connect(next),/ssh_service_busy/);assert.equal(f.calls.filter(row=>row.operation==='connect').length,1);assert.equal(f.controller.peek().sessionId,intent.sessionId);
 const duplicate=f.controller.disconnect({});assert.equal(stops,1);stopped.resolve();await Promise.all([closing,duplicate]);assert.equal(f.controller.peek().status,'disconnected');assert.equal(f.worker.connection,null);
 const connected=await f.controller.connect(next);assert.equal(connected.sessionId,next.sessionId);assert.equal(connected.status,'connected');assert.equal(connected.workflowReady,true);assert.equal(f.worker.connectionTarget.sessionId,next.sessionId);
});

test('bootstrap failure after disconnect cannot revive an unknown record or close a later lease',async t=>{
 const f=fixture(t),bootstrap=deferred();f.terminal.connectService=()=>bootstrap.promise;f.terminal.serviceState=async()=>({serviceId:'pending-owned-lease'});
 const pending=f.controller.connect(intent);pending.catch(()=>{});await f.controller.disconnect({});assert.equal(f.controller.peek().status,'disconnected');bootstrap.reject(Error('controlled bootstrap failure'));
 await assert.rejects(pending,/controlled bootstrap failure/);assert.deepEqual(f.controller.peek(),{status:'disconnected',workflowReady:false});assert.equal(f.worker.connection??null,null);
 f.terminal.connectService=async()=>({serviceId:'later-owned-lease',service:health});await f.controller.connect({...intent,requestId:'human-reconnect'});assert.equal(f.controller.peek().status,'connected');assert.equal(f.calls.filter(row=>row.operation==='request').at(-1).packet.serviceId,'later-owned-lease');
});

test('a failed old tool probe after disconnect does not overwrite disconnected state or authorize same-session overlap',async t=>{
 const f=fixture(t),probe=deferred(),entered=deferred(),original=f.worker.probeTools.bind(f.worker);f.worker.probeTools=async()=>{entered.resolve();return probe.promise;};
 const pending=f.controller.connect(intent);pending.catch(()=>{});await entered.promise;assert.equal(f.worker.identity.kind,'ssh');await f.controller.disconnect({});assert.equal(f.worker.connection,null);
 await assert.rejects(f.controller.connect({...intent,requestId:'premature-reconnect'}),/ssh_service_busy/);probe.reject(Error('controlled old probe failure'));await assert.rejects(pending,/controlled old probe failure/);assert.deepEqual(f.controller.peek(),{status:'disconnected',workflowReady:false});
 f.worker.probeTools=original;const next=await f.controller.connect({...intent,requestId:'human-reconnect'});assert.equal(next.status,'connected');assert(next.workflowReady);
});

for(const [label,changed]of [
 ['hostname',{hostIdentity:{...host,hostname:'other.invalid'}}],['uid',{hostIdentity:{...host,uid:1001}}],['machineId',{hostIdentity:{...host,machineId:'other-machine'}}],
 ['runtime id',{runtimeId:'b'.repeat(20)}],['runtime path',{runtime:'/fixture/other-runtime'}],['root',{root:'/fixture/other-root'}],['port',{port:25001}],['name',{name:'other-service'}],['execution policy',{execution_policy:'unreviewed-policy'}]
])test('actual health readback rejects changed '+label+' before tools, source registration or authoring',async t=>{
 const f=fixture(t),original=f.terminal.serviceRequest;f.terminal.serviceRequest=async packet=>packet.target==='/api/health'?{status:200,data:{...health,...changed}}:original(packet);
 await assert.rejects(f.controller.connect(intent),/ssh_service_identity_changed/);assert.equal(f.worker.connection,null);assert.equal(f.worker.proxy,null);assert.equal(f.remembered.length,0);assert.equal(f.controller.peek().status,'unknown');assert(!f.calls.some(row=>row.packet?.target==='/mcp'));
});
