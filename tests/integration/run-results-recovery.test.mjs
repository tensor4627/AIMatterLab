import test from 'node:test';
import assert from 'node:assert/strict';
import {runDetailHarness as harness} from '../helpers/run-detail-hooks.mjs';
import {deferred,memoryStorage} from '../helpers/agent-hooks.mjs';
const run={id:'r',project_id:'p',environment_id:'e',directory:'/owned/r',engine:'gpumd.md',status:'draft',name:'review',gpu:0,max_seconds:60,parameters:{},validation:{status:'not_run'},command:[],inputs:{},created_at:1};
const collect=h=>h.calls.filter(c=>c.target==='/api/run/collect');
test('review pins progress across parent cancellation and same-event double click submits only the revised run once',async()=>{
 const gate=deferred(),replaced=[],revised={...run,id:'revision'},h=harness({component:'RunReview',props:{run,onReplace:r=>replaced.push(r)},request:async target=>target.endsWith('/revise')?revised:target.endsWith('/validate')?gate.promise:{...revised,status:'queued'}});await h.flush();const button=h.button('确认并执行');button.props.onClick();button.props.onClick();await h.flush();h.render({run:{...run,status:'cancelled',superseded_by:'revision'}});await h.flush();assert(h.text().includes('验证输入与环境'));assert(h.nodes().find(n=>n.props?.['data-testid']==='execute-reviewed').props.disabled);assert.equal(h.calls.filter(c=>c.target.endsWith('/revise')).length,1);gate.resolve({...revised,status:'ready',validation:{status:'passed'}});await h.flush();assert.deepEqual(h.calls.filter(c=>c.target.endsWith('/submit')).map(c=>c.data.run_id),['revision']);assert.equal(replaced.at(-1).id,'revision');h.unmount();
});
test('leaving review during validation never starts submit or overwrites the new owner',async()=>{
 const gate=deferred(),replaced=[],h=harness({component:'RunReview',props:{run,onReplace:r=>replaced.push(r)},request:async target=>target.endsWith('/revise')?{...run,id:'revision'}:gate.promise});await h.flush();h.click('确认并执行');await h.flush();h.unmount();gate.resolve({...run,id:'revision',status:'ready',validation:{status:'passed'}});await h.flush();assert(!h.calls.some(c=>c.target.endsWith('/submit')));assert.equal(h.lateWrites(),0);assert.equal(replaced.length,0);
});
test('failed validation transport keeps the revised identity available without another revision or submission',async()=>{
 const h=harness({component:'RunReview',props:{run},request:async target=>{if(target.endsWith('/revise'))return{...run,id:'revision'};throw Error('observation unavailable');}});await h.flush();h.click('确认并执行');await h.flush();assert(h.text().includes('保留原修订任务'));assert(h.nodes().some(n=>n.props?.run?.id==='revision'));assert(!h.calls.some(c=>c.target.endsWith('/submit')));h.unmount();
});
test('completed run refreshes an already-open empty artifact observation once',async()=>{
 let n=0;const h=harness({props:{run:{...run,status:'running'}},request:async()=>({run:'r',artifacts:n++?[{name:'final.out',size:20}]:[]})});await h.flush();h.click('产物');await h.flush();assert(h.text().includes('当前结果目录为空'));h.render({run:{...run,status:'succeeded'}});await h.flush();assert(h.text().includes('final.out'));h.render({run:{...run,status:'succeeded',updated_at:99}});await h.flush();assert.equal(collect(h).length,2);h.unmount();
});
test('terminal transition defers artifact hashing until the user opens the artifacts tab',async()=>{
 const h=harness({props:{run:{...run,status:'running'}}});await h.flush();h.render({run:{...run,status:'succeeded'}});await h.flush();assert.equal(collect(h).length,0);h.click('产物');await h.flush();assert.equal(collect(h).length,1);h.unmount();
});
test('byte-limited preview stays visibly partial in raw text and curves even below the chart row limit',async()=>{
 const h=harness({request:async target=>target.endsWith('/collect')?{run:'r',artifacts:[{name:'thermo.out',size:400000}]}:{name:'thermo.out',text:'0 300\n1 310',offset:262144,size:400000}});await h.flush();h.click('产物');await h.flush();h.nodes().find(n=>n.type==='button'&&h.text(n).startsWith('thermo.out')).props.onClick();await h.flush();assert(h.text().includes('曲线不代表完整结果'));h.click('曲线');await h.flush();assert(h.text().includes('曲线不代表完整结果'));assert(h.text().includes('400,000'));h.unmount();
});
test('terminal logs drain several chunks through EOF then stop; active logs retain bounded scheduling',async()=>{
 const offsets=[],size=3*262144+12;const h=harness({observeLogs:true,props:{run:{...run,status:'succeeded'}},request:async(target,{offset})=>{assert.equal(target,'/api/run/log');offsets.push(offset);const count=Math.min(262144,size-offset);return{offset:offset+count,text:'x'.repeat(count)};}});await h.flush();assert.deepEqual(offsets,[0,262144,524288,786432,size]);assert.equal(h.timers.size,0);assert(h.text().includes('xxx'));h.unmount();
 const active=harness({observeLogs:true,props:{run:{...run,status:'running'}},request:async(target,{offset})=>({offset:offset+262144,text:'x'.repeat(262144)})});await active.flush();assert.equal(active.calls.length,8);assert.equal(active.timers.size,1);active.unmount();assert.equal(active.timers.size,0);
});
test('pending log reads do not continue chasing an unmounted run',async()=>{
 const gate=deferred(),h=harness({observeLogs:true,request:()=>gate.promise});await h.flush();h.unmount();gate.resolve({offset:262144,text:'x'.repeat(262144)});await h.flush();assert.equal(h.calls.length,1);assert.equal(h.lateWrites(),0);
});
test('corrupt continuation record remains visible until explicit acknowledgement and never creates a request while clearing',async()=>{
 const storage=memoryStorage();storage.setItem('studio.resume.r','corrupt-original');let consent=false;const h=harness({storage,confirm:()=>consent});await h.flush();assert(h.button('续算').props.disabled);assert(h.text().includes('corrupt-original'));h.click('已核对，清除损坏记录');await h.flush();assert.equal(storage.getItem('studio.resume.r'),'corrupt-original');consent=true;h.click('已核对，清除损坏记录');await h.flush();assert.equal(storage.getItem('studio.resume.r'),null);assert(!h.button('续算').props.disabled);assert(!h.calls.some(c=>c.target==='/api/run/resume'));h.unmount();
});
test('unknown runs expose only an explicit reconciliation request and show worker cancellation feedback',async()=>{
 const h=harness({props:{run:{...run,status:'unknown'}},request:async target=>target.endsWith('/reconcile')?{...run,status:'unknown',reconciliation:{status:'blocked',message:'Launch evidence is insufficient'}}:{...run,status:'unknown',cancellation:{status:'unconfirmed',message:'Cancellation preserved; no signal sent'}}});await h.flush();assert.equal(h.calls.length,0);h.click('核对停止状态');await h.flush();assert(h.text().includes('Launch evidence is insufficient'));h.click('取消');await h.flush();assert(h.text().includes('Cancellation preserved; no signal sent'));assert(!h.calls.some(c=>/submit|resume|revise/.test(c.target)));h.unmount();
});
