import assert from 'node:assert/strict';
import test from 'node:test';
import {createRoadmapNotifications} from '../../backend/main/workspace/roadmap-notifications.mjs';
import {sshSourceId} from '../../backend/main/compute/worker-service-version.mjs';
import {serviceHistory} from '../../agent/sessions/wake-delivery.mjs';

test('terminal receipt is delivered once to the original conversation and survives desktop restart',async()=>{
 const rows=new Map(),events=[],calls=[];
 const catalog={get:(ns,id)=>rows.get(ns)?.get(id),list:ns=>[...(rows.get(ns)?.values()||[])],put(ns,id,row){if(!rows.has(ns))rows.set(ns,new Map());rows.get(ns).set(id,row);}};
 const binding={kind:'ssh',version:2,profileId:'original',profileVersion:1,root:'/service',hostIdentity:{hostname:'fixture',uid:1,machineId:'test-id'},runtime:'/service/previous',runtimeId:'previous'};
 catalog.put('roadmap-execution-index','run',{id:'run',task_id:'task',worker_binding:binding,snapshot_sha256:'digest'});
 const task={id:'task',provider:'codex',threadId:'chat',name:'Density'};catalog.put('agent-task',task.id,task);
 const row={id:'run',task_id:'task',status:'failed',snapshot_sha256:'digest',nodes:{density:{status:'failed'}},goals:[]};
 const updated={...binding,runtime:'/service/updated',runtimeId:'updated'};
 const source={kind:'ssh',profileId:'original',id:sshSourceId(updated),binding:updated,health:{root:'/service',hostIdentity:binding.hostIdentity,roadmap_execution_schema:1},
  request:async(...args)=>{calls.push(args);return row;}};
 let available=[{...source,binding:{...updated,profileId:'another'}},{...source,binding:{...updated,profileVersion:2}}];
 const create=()=>createRoadmapNotifications({catalog,sources:()=>available,emit:e=>events.push(e)});
 await create().sweep();assert.equal(calls.length,0);
 available=[source];await create().sweep();await create().sweep();
 assert.equal(calls.length,1);assert.equal(events.length,1);assert.equal(events[0].params.threadId,'chat');
 assert.match(serviceHistory(catalog,'codex','chat')[0].items[0].text,/density/);
 assert.deepEqual(serviceHistory(catalog,'codex','different'),[]);
});
