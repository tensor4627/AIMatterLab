import test from 'node:test';
import assert from 'node:assert/strict';
import {toolFailure} from "../../agent/tools/tool-failure.mjs";
import {toolActivity,toolLabel} from "../../frontend/features/conversations/tool-activity.mjs";

import {WorkerClient} from "../../agent/tools/worker-client.mjs";
import {workerConnectionFailure} from "../../backend/main/compute/worker-connection-failure.mjs";

test('Action names are readable while unknown names retain their identity',()=>{
 assert.equal(toolLabel('present_task'),'更新计算流程');assert.equal(toolLabel('future_tool'),'future tool');
});
test('Expected blockers and uncertain completion retain separate status and next steps',()=>{
 const input=toolActivity({status:'completed',result:toolFailure(Error('Missing required field'))});assert.equal(input.state,'blocked');assert.match(input.hint,/Agent/);assert.equal(input.artifact,undefined);
 const unknown=toolActivity({status:'completed',result:toolFailure(Error('Missing acknowledgement'),{dispatched:true})});assert.equal(unknown.state,'unknown');assert.match(unknown.hint,/重复提交/);
 const generic=toolActivity({status:'failed',error:{message:'Unexpected failure'}});assert.equal(generic.state,'failed');
});
test('Nested success cannot hide transport failure or expose an execute link',()=>{
 const result={content:[{type:'text',text:JSON.stringify({id:'draft',engine:'pydyn.md',status:'passed'})}]};
 const activity=toolActivity({status:'failed',error:{message:'failed'},result});assert.equal(activity.state,'failed');assert.equal(activity.artifact,undefined);
 assert.equal(toolActivity({status:'completed',result:{content:[{type:'text',text:'{"status":"blocked"}'}]}}).state,'completed');
});
test('Connection diagnostics contain bounded categories, never subprocess arguments',()=>{
 for(const [error,code] of [[{code:'ENOENT'},'wsl_unavailable'],[{stderr:'secret WSL_E_DISTRO_NOT_FOUND'},'distribution_not_found'],[{code:'ETIMEDOUT'},'worker_connection_timeout'],[{message:'command --token secret',stderr:'private path secret'},'worker_start_failed']]){
  const failure=workerConnectionFailure(error);assert.equal(failure.code,code);assert.equal(JSON.stringify(failure).includes('secret'),false);
 }
});
test('Failed connection cleans the partial bridge and a successful reconnect clears its diagnosis',async()=>{
 const worker=new WorkerClient();let closed=0;worker.proxy={close(){closed++;}};worker.open=async()=>{worker.connection={partial:true};throw Object.assign(Error('secret'),{code:'ENOENT'});};
 await assert.rejects(worker.connect({},''));assert.equal(worker.connection,null);assert.equal(closed,1);assert.equal(worker.connectionFailure.code,'wsl_unavailable');
 worker.open=async()=>({ok:true});assert.deepEqual(await worker.connect({},''),{ok:true});assert.equal(worker.connectionFailure,null);worker.close();
});
