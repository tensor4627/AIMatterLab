import test from 'node:test';
import assert from 'node:assert/strict';
import {deferred} from './helpers/agent-hooks.mjs';
import {appWorkerHarness} from './helpers/app-worker-hooks.mjs';
const footer=h=>h.text(h.find(node=>node.props?.className==='statusbar'));
const queue=h=>h.text(h.find(node=>node.props?.className==='queue-empty'));
const queueTab=h=>h.text(h.find(node=>node.props?.className==='bottom-tabs'));
const writes=h=>h.calls.filter(call=>call.method==='worker.connect'||call.method.startsWith('agent.')||call.method==='worker.request'&&call.data.method!=='GET');

test('App reload observes the existing worker and derives idle queue only from successful current run reads',async()=>{
 const h=appWorkerHarness();assert(footer(h).includes('WSL 未连接'));assert(queue(h).includes('状态未知'));assert(queueTab(h).includes('运行队列?'));await h.flush();assert(footer(h).includes('WSL 已连接'));assert(queue(h).includes('队列空闲'));assert(queueTab(h).includes('运行队列0'));assert(h.calls.some(call=>call.method==='worker.status'));assert(h.calls.some(call=>call.method==='worker.request'&&call.data.target==='/api/runs'));assert.deepEqual(writes(h),[]);h.unmount();
});
test('App health verification alone cannot display idle or queue zero when run reads fail',async()=>{
 const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='worker.request'&&data.target==='/api/runs')throw Error('run status unavailable');return standard(method,data);}});await h.flush();assert(queue(h).includes('状态未知'));assert(!queue(h).includes('队列空闲'));assert(queueTab(h).includes('运行队列?'));assert(footer(h).includes('状态未知'));assert.deepEqual(writes(h),[]);h.unmount();
});
for(const status of ['disconnected','unknown','rejected'])test('App '+status+' existing worker observation remains disconnected without starting anything',async()=>{
 const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='worker.status'){if(status==='rejected')throw Error('unavailable');return {status,checkedAt:1};}return standard(method,data);}});await h.flush();assert(footer(h).includes('WSL 未连接'));assert(queue(h).includes('状态未知'));assert.deepEqual(writes(h),[]);assert(!h.calls.some(call=>call.method==='worker.request'));h.unmount();
});
test('App late failed observation cannot overwrite a newer successful connection event',async()=>{
 const pending=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='worker.status'?pending.promise:standard(method,data)});await h.flush();h.emit({method:'studio/workerConnected',params:{}});await h.flush();pending.resolve({status:'unknown',checkedAt:1});await h.flush();assert(footer(h).includes('WSL 已连接'));assert(queue(h).includes('队列空闲'));assert.deepEqual(writes(h),[]);h.unmount();
});
test('App explicit failed connection invalidates a late successful hydration and later explicit recovery still works',async()=>{
 const pending=deferred();let fail=true;const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='worker.status')return pending.promise;if(method==='worker.connect'&&fail)throw Error('explicit connection failed');return standard(method,data);}});await h.flush();h.connect();await h.flush();pending.resolve({status:'connected',checkedAt:1});await h.flush();assert(footer(h).includes('WSL 未连接'));assert(queue(h).includes('状态未知'));fail=false;h.connect();await h.flush();assert(footer(h).includes('WSL 已连接'));assert(queue(h).includes('队列空闲'));assert.equal(h.calls.filter(call=>call.method==='worker.connect').length,2);h.unmount();
});
test('App target settings edit invalidates a late successful worker observation',async()=>{
 const pending=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='worker.status'?pending.promise:standard(method,data)});await h.flush();const settings=h.openSettings();settings.onChange({...settings.settings,distribution:'New chosen Ubuntu'});await h.flush();pending.resolve({status:'connected',checkedAt:1});await h.flush();assert(footer(h).includes('WSL 未连接'));assert.equal(h.openSettings().settings.distribution,'New chosen Ubuntu');assert.deepEqual(writes(h),[]);h.unmount();
});
test('App old initial settings response cannot overwrite settings edited before it arrived',async()=>{
 const pending=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='state'?pending.promise:standard(method,data)});await h.flush();const settings=h.openSettings();settings.onChange({...settings.settings,distribution:'User chosen Ubuntu'});await h.flush();pending.resolve({settings:{...h.settings,distribution:'Old saved Ubuntu'}});await h.flush();assert.equal(h.openSettings().settings.distribution,'User chosen Ubuntu');assert(!h.calls.some(call=>call.method==='worker.status'));assert.deepEqual(writes(h),[]);h.unmount();
});
test('App old observation is ignored after unmount',async()=>{const pending=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='worker.status'?pending.promise:standard(method,data)});await h.flush();h.unmount();pending.resolve({status:'connected',checkedAt:1});await h.flush();assert(!h.calls.some(call=>call.method==='worker.request'));});
test('App late saved settings still restore after a newer worker connection event without downgrading that connection',async()=>{
 const state=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='state'?state.promise:standard(method,data)});await h.flush();h.emit({method:'studio/workerConnected',params:{}});await h.flush();state.resolve({settings:{...h.settings,distribution:'Preserved saved distribution',theme:'light',language:'en'}});await h.flush();assert(footer(h).includes('WSL 已连接'));assert(queue(h).includes('队列空闲'));const restored=h.openSettings().settings;assert.equal(restored.distribution,'Preserved saved distribution');assert.equal(restored.theme,'light');assert.equal(restored.language,'en');assert(!h.calls.some(call=>call.method==='worker.status'));assert.deepEqual(writes(h),[]);h.unmount();
});
test('App observed connection preserves the restored conversation, 310 K workflow and selected project through real refresh',async()=>{
 const status=deferred(),selected={id:'codex:kept',provider:'codex',threadId:'kept',name:'Existing chat',projectId:'chosen-project',taskId:'kept-flow'},task={id:'kept-flow',provider:'codex',threadId:'kept',projectId:'chosen-project',name:'310 K task',parameters:{temperature:310},artifacts:[],steps:[]};
 const h=appWorkerHarness({override:(method,data,standard)=>{if(method==='conversation.list')return [selected];if(method==='conversation.select')return selected;if(method==='task.list')return [task];if(method==='worker.status')return status.promise;if(method==='worker.request'&&data.target==='/api/projects')return [{id:'first-other-project',name:'Other',policy:{gpus:[]}},{id:'chosen-project',name:'Chosen',policy:{gpus:[]}}];return standard(method,data);}});h.storage.setItem('studio.conversation',selected.id);await h.flush();const before=h.find(node=>node.type==='./Agent').props;assert.equal(before.projectId,'chosen-project');assert.equal(before.sessionSelection.conversation.id,selected.id);status.resolve({status:'connected',checkedAt:1});await h.flush();const after=h.find(node=>node.type==='./Agent').props;assert.equal(after.projectId,'chosen-project');assert.equal(after.sessionSelection.conversation.id,selected.id);assert.equal(after.sessionSelection.conversation.taskId,'kept-flow');assert.equal(task.parameters.temperature,310);assert(footer(h).includes('WSL 已连接'));assert.deepEqual(writes(h),[]);h.unmount();
});
