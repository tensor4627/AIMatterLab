import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputeOnboarding} from '../desktop/compute-onboarding.mjs';
test('discovery registers only observed identities, with no grants or scientific requests',async()=>{
 const calls=[],events=[],worker={connection:{},async request(method,target,data){calls.push({method,target,data});return target.endsWith('discover')?{identity:'receipt',observed_at:123,entries:[{id:'gpu',status:'discovered'},{python:'/missing',status:'blocked'}]}:{environments:[{id:'env'}]};}};
 const result=await createComputeOnboarding({worker,publish:e=>events.push(e)})();
 assert.equal(result.status,'observed');assert.deepEqual(calls.map(x=>x.target),['/api/environments/discover','/api/environments/adopt']);assert.deepEqual(calls[1].data,{identity:'receipt',candidates:['gpu']});assert.equal(events.at(-1).params.count,1);
});
test('a worker switch during discovery cannot register the old findings into the new worker',async()=>{
 const calls=[],worker={connection:{},async request(method,target){calls.push(target);worker.connection={};return {identity:'old',entries:[{id:'old',status:'discovered'}]};}};
 await assert.rejects(createComputeOnboarding({worker})(),/connection changed/);assert.deepEqual(calls,['/api/environments/discover']);
});
test('discovery failure remains blocked and is not silently registered',async()=>{
 const events=[],worker={connection:{},async request(){throw Error('unavailable');}};
 await assert.rejects(createComputeOnboarding({worker,publish:e=>events.push(e)})(),/unavailable/);assert.equal(events.at(-1).params.status,'blocked');
});
test('parallel requests share the same discovery and registration, empty findings do not register',async()=>{
 let release,count=0;const waiting=new Promise(resolve=>{release=resolve;}),worker={connection:{},async request(){count++;await waiting;return {identity:'empty',entries:[]};}};
 const setup=createComputeOnboarding({worker}),first=setup(),second=setup();release();const values=await Promise.all([first,second]);assert.equal(count,1);assert.equal(values[0].status,'blocked');
});
test('explicit read-only setup cannot register a candidate',async()=>{
 const calls=[],worker={connection:{},async request(method,target){calls.push(target);return {identity:'receipt',entries:[{id:'gpu',status:'discovered'}]};}};
 await createComputeOnboarding({worker})({register:false});assert.deepEqual(calls,['/api/environments/discover']);
});
