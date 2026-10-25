import test from 'node:test';import assert from 'node:assert/strict';import {ObservedRead} from '../shared/observed-read.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const drain=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(read){const scheduled=new Map(),states=[];let id=0,clock=10;const reader=new ObservedRead(read,state=>states.push(state),{delay:2,now:()=>clock++,schedule:(fn,delay)=>{scheduled.set(++id,{fn,delay});return id;},unschedule:id=>scheduled.delete(id)});return {reader,states,scheduled,async next(){const [key,value]=scheduled.entries().next().value;scheduled.delete(key);value.fn();await drain();}};}
test('Failed observation retains actual data/time, stops after bounded failures and manual recovery reads once',async()=>{
 let calls=0,fail=false;const f=fixture(async()=>{calls++;if(fail)throw Error('offline');return {id:'original',status:'running'};});f.reader.setConnected(true);await drain();const actual=f.reader.state.value,time=f.reader.state.observedAt;fail=true;
 await f.next();await f.next();await f.next();assert.equal(calls,4);assert.equal(f.scheduled.size,0);assert.equal(f.reader.state.paused,true);assert.equal(f.reader.state.value,actual);assert.equal(f.reader.state.observedAt,time);
 fail=false;await f.reader.refresh();assert.equal(calls,5);assert.equal(f.reader.state.error,null);assert.equal(f.reader.state.paused,false);assert.ok(f.reader.state.observedAt>time);f.reader.dispose();
});
test('Disconnect preserves last observation and ignores a late response across reconnect',async()=>{
 const first=deferred(),next=deferred();let calls=0;const f=fixture(()=>++calls===1?first.promise:next.promise);f.reader.setConnected(true);await drain();f.reader.setConnected(false);assert.equal(f.reader.state.pending,false);f.reader.setConnected(true);await drain();first.resolve({id:'stale'});await drain();assert.equal(f.reader.state.value,null);assert.equal(f.reader.state.pending,true);next.resolve({id:'current'});await drain();assert.equal(f.reader.state.value.id,'current');f.reader.setConnected(false);assert.equal(f.reader.state.value.id,'current');assert.equal(f.scheduled.size,0);f.reader.dispose();
});
test('Refresh is single-flight; disposal prevents callbacks or further polling',async()=>{
 let calls=0;const task=deferred(),f=fixture(()=>{calls++;return task.promise;});f.reader.setConnected(true);await drain();const a=f.reader.refresh(),b=f.reader.refresh();assert.equal(a,b);assert.equal(calls,1);const count=f.states.length;f.reader.dispose();task.resolve({status:'succeeded'});await a;assert.equal(f.states.length,count);assert.equal(f.scheduled.size,0);await f.reader.refresh();assert.equal(calls,1);
});
