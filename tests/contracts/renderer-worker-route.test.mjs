import test from 'node:test';
import assert from 'node:assert/strict';
import {assertWorkerRoute,assertRendererWorkerRoute} from "../../contracts/transport-policy.mjs";
test('generic renderer port refuses every privileged custom action and all canonicalized aliases',()=>{
 for(const action of ['read','save','approve-formula','approve-code','sharing','validate','status','reuse','attach','access','provider-read','provider-status']){
  const direct='/api/custom-cv/'+action;assert.doesNotThrow(()=>assertWorkerRoute('POST',direct));
  for(const target of [direct,direct+'?id=owned',direct+'#fragment','/api/./custom-cv/'+action,'/api/x/../custom-cv/'+action,'/api/%2e/custom-cv/'+action,'/api/x/%2e%2e/custom-cv/'+action,'http://127.0.0.1'+direct,'//127.0.0.1'+direct,'/api\\custom-cv/'+action])assert.throws(()=>assertRendererWorkerRoute('POST',target),undefined,target);
 }
});
test('canonical ordinary UI routes remain available and unrelated targets fail',()=>{
 for(const [method,target]of [['GET','/api/projects'],['GET','/api/runs?project_id=owned'],['POST','/api/pygas/composition/read'],['POST','/api/cluster/cancel'],['POST','/api/run/reconcile']])assert.doesNotThrow(()=>assertRendererWorkerRoute(method,target));
 for(const value of [null,{},'/api/projects#hash','https://elsewhere.invalid/api/projects','/api/projects\n'])assert.throws(()=>assertRendererWorkerRoute('GET',value));
});


test('Empty graph initialization remains a dedicated human action, never generic renderer HTTP',()=>{assert.doesNotThrow(()=>assertWorkerRoute('POST','/api/pygas/composition/initialize'));assert.throws(()=>assertRendererWorkerRoute('POST','/api/pygas/composition/initialize'),/typed human graph/);assert.throws(()=>assertRendererWorkerRoute('POST','/api/pygas/composition/read/../initialize'));});
