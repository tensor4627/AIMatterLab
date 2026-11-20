import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {loadRecoverableWorkbench} from '../../desktop/platform/workbench-recovery.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve=yes; reject=no; });
  return {promise, resolve, reject};
}
function fixture() {
  const window=new EventEmitter(), contents=new EventEmitter(), loads=[], dialogs=[], exits=[];
  window.webContents=contents;
  window.isDestroyed=contents.isDestroyed=()=>false;
  contents.isCrashed=()=>false;
  window.hide=()=>{ window.hidden=true; };
  let quitting=false,time=100;
  const task=loadRecoverableWorkbench({window,isQuitting:()=>quitting,now:()=>time,
    load:()=>{const operation=deferred();loads.push(operation);return operation.promise;},
    recordExit:details=>exits.push(details),
    askRetry:()=>{const decision=deferred();dialogs.push(decision);return decision.promise;}});
  const crash=()=>contents.emit('render-process-gone',{}, {reason:'crashed',exitCode:2});
  return {task,loads,dialogs,exits,crash,window,contents,quit:()=>{quitting=true;},later:()=>{time+=61000;}};
}
test('a crash during first load replaces the original navigation without failing desktop startup',async()=>{
  const f=fixture();await tick();f.crash();f.loads[0].reject(Error('aborted'));await tick();
  assert.equal(f.loads.length,2);assert.deepEqual(f.exits,[{reason:'crashed',exitCode:2}]);
  f.loads[1].resolve();assert.equal(await f.task,true);assert.equal(f.dialogs.length,0);
});
test('a second rapid exit asks once and a deferred retry resumes on the next tray open',async()=>{
  const f=fixture();await tick();f.loads[0].resolve();await f.task;
  f.crash();await tick();f.crash();f.loads[1].reject(Error('old load'));f.crash();await tick();
  assert.equal(f.dialogs.length,1);assert.equal(f.loads.length,2);
  f.dialogs[0].resolve(false);await tick();assert(f.window.hidden);f.window.emit('show');f.window.emit('show');
  await tick();assert.equal(f.loads.length,3);f.loads[2].resolve();await tick();
  f.later();f.crash();await tick();assert.equal(f.loads.length,4);assert.equal(f.dialogs.length,1);
});
test('a failed recovery navigation offers manual reload and a pending decision cannot revive a quitting desktop',async()=>{
  const f=fixture();await tick();f.loads[0].resolve();await f.task;
  f.crash();await tick();f.loads[1].reject(Error('read failed'));await tick();f.dialogs[0].resolve(true);await tick();
  assert.equal(f.loads.length,3);f.crash();await tick();assert.equal(f.dialogs.length,2);
  f.quit();f.dialogs[1].resolve(true);f.crash();await tick();assert.equal(f.loads.length,3);
});
test('normal first-load errors still reach startup diagnostics and destruction cancels a pending startup',async()=>{
  const a=fixture();await tick();const failed=assert.rejects(a.task,/invalid page/);a.loads[0].reject(Error('invalid page'));await failed;
  const b=fixture();await tick();b.contents.emit('destroyed');assert.equal(await b.task,false);b.loads[0].resolve();
});
