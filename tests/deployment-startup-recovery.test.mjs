import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentFixture,deploymentHarness} from './helpers/deployment-diagnostic-hooks.mjs';
import {deferred} from './helpers/agent-hooks.mjs';
const dependent=h=>h.calls.filter(call=>['task.deployment.context','worker.request','task.linkRun'].includes(call.method));
test('Deployment defers all worker reads and automatic binding restore until App finishes initial scope verification',async()=>{
 let restores=0,explicit=0;const h=deploymentHarness({properties:{worker:false,restoring:true,onAutomaticRestore:()=>{restores++;},onReconnect:()=>{explicit++;}}});await h.flush();assert.deepEqual(dependent(h),[]);assert.equal(restores,0);assert.equal(explicit,0);assert(h.text(h.find(node=>node.props?.['data-testid']==='deployment-context-state')).includes('正在核对'));h.update({restoring:false});await h.flush();assert.equal(restores,1);assert.equal(explicit,0);assert.deepEqual(dependent(h),[]);assert(!h.text(h.find(node=>node.props?.['data-testid']==='deployment-context-state')).includes('正在核对'));h.update({worker:true});await h.flush();assert(dependent(h).some(call=>call.method==='task.deployment.context'));assert(dependent(h).some(call=>call.method==='task.linkRun'));assert.equal(h.find(node=>node.props?.['data-testid']==='prepare-deployment').props.disabled,false);assert(!h.calls.some(call=>call.method==='task.execute'));h.unmount();
});
test('Deployment late old context failure cannot replace the new verified scope after a worker gate transition',async()=>{
 const pending=deferred();let contexts=0;const h=deploymentHarness({override:(method,data,standard)=>method==='task.deployment.context'&&++contexts===1?pending.promise:standard(method,data)});await h.flush();h.update({worker:false,restoring:true});await h.flush();h.update({worker:true,restoring:false});await h.flush();pending.reject(Error('Old controller unavailable'));await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='prepare-deployment').props.disabled,false);assert.equal(h.externalErrors.length,0);assert.equal(h.calls.filter(call=>call.method==='task.deployment.context').length,2);h.unmount();
});
