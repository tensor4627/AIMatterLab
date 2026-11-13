import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputeResourceInspection} from '../../agent/tools/compute-resource-inspection.mjs';

const health={name:'gpu-sampling-studio',ssh_service:true,root:'/private-service-root',runtime:'/private-runtime',runtimeId:'a'.repeat(20),port:23456,hostIdentity:{hostname:'private-host',uid:1000,machineId:'private-machine'}};
const rawHealth={...health,runtime_id:health.runtimeId,hostname:health.hostIdentity.hostname,uid:1000,machineId:health.hostIdentity.machineId};
const observed={status:'observed',observed_at:100,automatic_retry:false,observations:[{scheduler:'slurm',status:'observed',queues:[{name:'gpu',default:true,availability:'up',node_count:2,node_state:'idle',gres:'gpu:a100:4'}]},{scheduler:'lsf',status:'not_found',queues:[]}]};
function fixture({provider='codex',capable=true,profiles=[]}={}){
 let granted=true,lease=true,revision=1,selection={schemaVersion:2,kind:'ssh-connection',profileId:'saved-profile',profileVersion:2,connectionId:'connection'},status='connected',healthGate,probeGate;
 const calls=[],scope={provider,threadId:'thread',checkCurrent:()=>lease},worker={connection:{},identity:{kind:'ssh',version:3,connectionId:'connection',profileId:'saved-profile',profileVersion:2},connectionTarget:{connectionId:'connection',serviceId:'service'},request:async(method,path)=>{calls.push({method,path});if(path==='/api/health'){await healthGate;return structuredClone(rawHealth);}assert.equal(path,'/api/clusters');return structuredClone(profiles);}};
 const service={peek:()=>({status,workflowReady:status==='connected',connectionId:'connection',serviceId:'service',attemptId:'attempt',profileId:'saved-profile',profileVersion:2,health:structuredClone(health)}),hasCurrentGrant:(p,caller)=>granted&&p===provider&&caller===scope};
 const resource={peek:()=>structuredClone(selection),capture:()=>revision,assertCurrent:ticket=>assert.equal(ticket,revision,'Selected compute context changed')};
 const terminal={state:async()=>({schemaVersion:2,connectionId:'connection',profileId:'saved-profile',profileVersion:2,status:'authenticated',authentication:'verified'}),serviceState:async()=>{calls.push({state:true});return {status:'connected',serviceActive:true,connectionId:'connection',attemptId:'attempt',serviceId:'service',profileId:'saved-profile',profileVersion:2,service:{...structuredClone(rawHealth),...capable?{bridge_capabilities:['scheduler-inspection-v1']}: {}}};},serviceRequest:async value=>{calls.push({probe:structuredClone(value)});await probeGate;return {status:200,data:structuredClone(observed)};}};
 const inspection=createComputeResourceInspection({worker,resource:()=>resource,service:()=>service,connections:()=>terminal});
 return {calls,scope,worker,service,resource,terminal,inspection,call:args=>inspection.call('inspect_compute_resource',args||{},scope),reclaim:()=>{granted=false;},expire:()=>{lease=false;},unknown:()=>{status='unknown';},switch:()=>{selection.profileVersion++;revision++;},delayHealth:promise=>{healthGate=promise;},delayProbe:promise=>{probeGate=promise;}};
}
const barrier=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};

for(const provider of ['codex','kimi','qwen','deepseek','compatible'])test(provider+' can identify a ready granted service without creating a workflow or sharing its raw terminal',async()=>{
 const f=fixture({provider}),result=await f.call();assert.equal(result.resource.status,'ready');assert.equal(result.resource.authentication,'verified');assert.equal(result.resource.agent_access,'granted');assert.equal(result.resource.raw_terminal_required,false);assert.equal(result.scheduler.registration,'missing');assert.equal(result.scheduler.observation.status,'not_run');assert(!f.calls.some(call=>call.probe));
 for(const secret of ['private-service-root','private-runtime','private-host','private-machine'])assert(!JSON.stringify(result).includes(secret));
 assert.match(result.interpretation,/not SSH login/);assert.match(result.next_step,/No new workflow or repeated SSH authentication/);
});

test('only same-host reviewed scheduler identities are reported; private registration fields never leave the main process',async()=>{
 const f=fixture({profiles:[{id:'same-host',version:3,scheduler:'slurm',transport_kind:'ssh-service-local',activation:'private command',environment:{python:'/private-python'},notes:'private notes'},{id:'other',version:1,scheduler:'lsf',host:'other.invalid'}]}),result=await f.call();
 assert.equal(result.scheduler.registration,'configured');assert.deepEqual(result.scheduler.profiles,[{id:'same-host',version:3,scheduler:'slurm'}]);assert(!JSON.stringify(result).includes('private command'));assert(!JSON.stringify(result).includes('other.invalid'));
});

test('an explicit requested probe uses only the negotiated exact bridge and preserves scientific and project review boundaries',async()=>{
 const f=fixture(),result=await f.call({probe_scheduler:true}),requests=f.calls.filter(call=>call.probe);assert.equal(requests.length,1);const value=requests[0].probe;
 assert.deepEqual({...value,requestId:'id'},{connectionId:'connection',serviceId:'service',requestId:'id',method:'POST',target:'/api/ssh-service/inspect-scheduler',data:{},mcp:false,timeoutMs:15000});assert.equal(result.scheduler.observation.status,'observed');assert.equal(result.scheduler.observation.observations[0].queues[0].name,'gpu');assert.equal(result.scheduler.registration,'missing');assert.equal(result.scientific_validation,'not_run');assert.match(result.scheduler.observation.scope,/GPU availability.*not_run/);
 assert(f.calls.every(value=>!value.path||['/api/health','/api/clusters'].includes(value.path)),'No registration, project, execution or other worker endpoint is invoked');
});

test('an old bridge keeps a verified service visible and blocks probing before dispatch without automatic reconnect',async()=>{
 const f=fixture({capable:false}),result=await f.call({probe_scheduler:true});assert.equal(result.resource.status,'ready');assert.equal(result.scheduler.inspection_supported,false);assert.equal(result.scheduler.observation.status,'requires_new_attachment');assert.equal(result.scheduler.observation.operation_state,'not_started');assert(!f.calls.some(value=>value.probe));assert.match(result.scheduler.observation.next_step,/Do not reconnect or update the worker automatically/);
});

for(const mode of ['reclaim','expire','unknown','switch'])test(mode+' rejects inspection before any local/remote operation',async()=>{
 const f=fixture();f[mode]();await assert.rejects(f.call({probe_scheduler:true}));assert.equal(f.calls.length,0);
});

for(const mode of ['reclaim','expire','unknown','switch'])test('late health after '+mode+' does not disclose old resource metadata or run a probe',async()=>{
 const f=fixture(),gate=barrier();f.delayHealth(gate.promise);const pending=f.call({probe_scheduler:true});assert.equal(f.calls.length,1);f[mode]();gate.release();await assert.rejects(pending);assert.equal(f.calls.length,1);
});

test('a late read-only queue observation after human reclaim is discarded and never replayed',async()=>{
 const f=fixture(),gate=barrier();f.delayProbe(gate.promise);const pending=f.call({probe_scheduler:true});while(!f.calls.some(value=>value.probe))await new Promise(resolve=>setImmediate(resolve));f.reclaim();gate.release();await assert.rejects(pending);assert.equal(f.calls.filter(value=>value.probe).length,1);
});

test('same-connection worker identity drift during a health read invalidates the inspection',async()=>{
 const f=fixture(),gate=barrier();f.delayHealth(gate.promise);const pending=f.call({probe_scheduler:true});f.worker.identity.runtimeId='b'.repeat(20);gate.release();await assert.rejects(pending);assert.equal(f.calls.length,1);
});

test('tool input accepts no command, host, profile, file or operation overrides',async()=>{
 const f=fixture();for(const args of [{command:'whoami'},{sessionId:'other'},{path:'/private'},[],null,{probe_scheduler:1}])await assert.rejects(f.inspection.call('inspect_compute_resource',args,f.scope),/Invalid selected compute/);assert.equal(f.calls.length,0);
});

test('unexpected queue output fails closed rather than returning a partial or unsafe observation',async()=>{
 const f=fixture();f.terminal.serviceRequest=async()=>({status:200,data:{...structuredClone(observed),observations:[{scheduler:'slurm',status:'observed',queues:[{name:'safe'},{name:'$(unsafe)'}]},observed.observations[1]]}});await assert.rejects(f.call({probe_scheduler:true}),/not confirmed/);
});
