import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createSshService} from '../../backend/main/compute/ssh-service.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {restoreTaskWorker} from '../../backend/main/compute/worker-restore.mjs';
import {stableSshWorkerBinding} from '../../contracts/compute/task-worker-binding.mjs';

test('shipped resources attach an existing released SSH runtime and restore its original workflow binding',async t=>{
 const runtimeId='62034ec6cfc1428aaa4d',sessionId='existing-owned-session',profileId='existing-owned-profile',host={hostname:'owned-host',uid:1000,machineId:'owned-machine'};
 const health={name:'gpu-sampling-studio',root:'/owned/existing-service',runtime:'/owned/existing-service/runtimes/'+runtimeId,runtimeId,port:25000,execution_policy:'desktop-review-v1',hostIdentity:host,ssh_service:true};
 const identity={kind:'ssh',version:2,profileId,profileVersion:1,hostIdentity:host,root:health.root,runtime:health.runtime,runtimeId};
 const task={id:'existing-flow',provider:'codex',threadId:'existing-thread',authoring:{workerBinding:stableSshWorkerBinding(identity)}};
 const worker=new WorkerClient(),owner={provider:task.provider,threadId:task.threadId,taskId:task.id};worker.bundledRuntimeId=runtimeId;t.after(()=>worker.close());
 let starts=0;const terminal={connectService:async(_data,bootstrap)=>{starts++;assert.equal(bootstrap.payload.expected_runtime_id,runtimeId,'performance release must retain the released worker source identity');return {status:'connected',serviceActive:true,serviceId:'existing-owned-service',terminalAccess:'reserved',phase:'ready',service:health};},serviceRequest:async p=>p.target==='/api/health'?{status:200,data:health}:{status:200,data:{jsonrpc:'2.0',id:p.data.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}}};
 const controller=createSshService({worker,terminal,profiles:{read:()=>({kind:'ssh'})},resource:{peek:()=>({kind:'ssh-terminal',sessionId,profileId,profileVersion:1}),capture:()=>1,assertCurrent:value=>assert.equal(value,1)},source:path.resolve('backend/worker'),transportSource:path.resolve('desktop/platform/terminal-service/python'),current:()=>owner});
 const attached=await controller.connect({sessionId,ownerEpoch:1,profileId,profileVersion:1,requestId:'existing-human-connect'});assert.equal(attached.workflowReady,true);assert.equal(starts,1);
 const restored=await restoreTaskWorker({records:{read:()=>task},worker,settings:()=>({}),selection:()=>owner,selectionEpoch:()=>1},{taskId:task.id});
 assert.equal(restored.status,'connected');assert.equal(restored.serviceVersion,'current');assert.deepEqual(stableSshWorkerBinding(worker.identity),task.authoring.workerBinding);
});
