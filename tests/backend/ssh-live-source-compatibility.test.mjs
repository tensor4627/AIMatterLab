import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createSshService} from '../../backend/main/compute/ssh-service.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {restoreTaskWorker} from '../../backend/main/compute/worker-restore.mjs';
import {stableSshWorkerBinding} from '../../contracts/compute/task-worker-binding.mjs';
import {prepareSshServiceResources} from '../../backend/main/compute/ssh-service-resources.mjs';
import {bundledWorkerRuntimeId} from '../../backend/main/compute/worker-service-version.mjs';

test('shipped resources attach an existing released SSH runtime and restore its original workflow binding',async t=>{
 const runtimeId='62034ec6cfc1428aaa4d',connectionId='new-authenticated-connection',profileId='existing-owned-profile',host={hostname:'owned-host',uid:1000,machineId:'owned-machine'};
 const health={name:'gpu-sampling-studio',root:'/owned/existing-service',runtime:'/owned/existing-service/runtimes/'+runtimeId,runtimeId,port:25000,execution_policy:'desktop-review-v1',hostIdentity:host,ssh_service:true};
 const identity={kind:'ssh',version:2,profileId,profileVersion:1,hostIdentity:host,root:health.root,runtime:health.runtime,runtimeId};
 const task={id:'existing-flow',provider:'codex',threadId:'existing-thread',authoring:{workerBinding:stableSshWorkerBinding(identity)}};
 const worker=new WorkerClient(),owner={provider:task.provider,threadId:task.threadId,taskId:task.id};worker.bundledRuntimeId=bundledWorkerRuntimeId(path.resolve('backend/worker'));t.after(()=>worker.close());
 let starts=0;const connections={state:async()=>({schemaVersion:2,connectionId,profileId,profileVersion:1,status:'authenticated',authentication:'verified'}),openService:async(data,bootstrap)=>{starts++;assert.equal(bootstrap.payload.expected_runtime_id,runtimeId,'retain the explicitly selected released worker source identity');return {connectionId,profileId,profileVersion:1,attemptId:data.requestId,status:'connected',serviceActive:true,serviceId:'existing-owned-service',phase:'ready',service:health};},serviceRequest:async p=>p.target==='/api/health'?{status:200,data:health}:{status:200,data:{jsonrpc:'2.0',id:p.data.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}}};
 const controller=createSshService({worker,connections,profiles:{read:()=>({kind:'ssh',id:profileId,version:1})},resource:{peek:()=>({schemaVersion:2,kind:'ssh-connection',connectionId,profileId,profileVersion:1}),capture:()=>1,assertCurrent:value=>assert.equal(value,1)},source:path.resolve('backend/worker'),transportSource:path.resolve('desktop/platform/terminal-service/python'),preferredRuntimeId:()=>runtimeId,prepareResources:async(source,options)=>prepareSshServiceResources(source,{...options,reuseOnly:true}),current:()=>owner});
 const attached=await controller.connect({connectionId,profileId,profileVersion:1,requestId:'existing-human-connect'});assert.equal(attached.workflowReady,true);assert.equal(starts,1);
 const restored=await restoreTaskWorker({records:{read:()=>task},worker,settings:()=>({}),selection:()=>owner,selectionEpoch:()=>1},{taskId:task.id});
 assert.equal(restored.status,'connected');assert.equal(restored.serviceVersion,worker.bundledRuntimeId===runtimeId?'current':'different');assert.deepEqual(stableSshWorkerBinding(worker.identity),task.authoring.workerBinding);
});
