import contracts from '../../contracts/tools/engine-contracts.json' with {type:'json'};
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {runContinuation} from '../../frontend/features/runs/run-continuation.mjs';
import {deferred,memoryStorage} from '../helpers/agent-hooks.mjs';
import {runDetailHarness as harness} from '../helpers/run-detail-hooks.mjs';
const collect=h=>h.calls.filter(c=>c.target==='/api/run/collect');

test('read-only history allows observations while submit, validate, cancel, reconcile and resume handlers reject writes',async()=>{
 for(const status of ['draft','running','unknown','succeeded']){
  const h=harness({props:{readOnly:true,run:{id:'r',name:'Read-only saved run',engine:'gpumd.md',status,project_id:'p',environment_id:'e',directory:'/owned/r',parameters:{},validation:{},command:[],inputs:{},created_at:1}},request:async()=>({run:'r',artifacts:[]})});
  try{await h.flush();assert(h.text().includes('提交、续算等操作需匹配原服务与权限'));
   for(const node of h.nodes().filter(n=>n.type==='button'&&['验证','提交计算','取消','核对停止状态','续算'].includes(h.text(n)))){assert.equal(node.props.disabled,true);node.props.onClick();}
   await h.flush();assert(!h.calls.some(c=>/\/(validate|submit|cancel|reconcile|resume)$/.test(c.target)));h.click('结果');await h.flush();assert.equal(collect(h).length,1);
  }finally{h.unmount();}
 }
});

test('a callback captured before a detail becomes read-only cannot submit afterward',async()=>{
 const h=harness({props:{run:{id:'r',name:'Draft',engine:'pydyn.md',status:'draft',project_id:'p',environment_id:'e',directory:'/owned/r',parameters:{},validation:{},command:[],inputs:{},created_at:1}}});
 try{await h.flush();const submit=h.button('提交计算').props.onClick;h.render({readOnly:true});await h.flush();submit();await h.flush();assert(!h.calls.some(c=>c.target==='/api/run/submit'));}finally{h.unmount();}
});
test('first artifact tab reads once; tab switches preserve; manual refresh and remount reread explicitly',async()=>{let count=0;const request=async()=>({run:'r',artifacts:[{name:'file'+(++count)+'.xyz',size:12}]});let h=harness({request});await h.flush();assert.equal(collect(h).length,0);h.click('结果');await h.flush();assert(h.text().includes('file1.xyz'));h.click('输入');await h.flush();h.click('结果');await h.flush();assert.equal(collect(h).length,1);h.click('收集产物');await h.flush();assert(h.text().includes('file2.xyz'));h.unmount();h=harness({request});await h.flush();assert.equal(collect(h).length,0);h.click('结果');await h.flush();assert(h.text().includes('file3.xyz'));h.unmount();});
for(const transition of ['disconnect','identity','unmount','event'])test('late collect cannot publish after '+transition,async()=>{const gate=deferred(),h=harness({request:()=>gate.promise});await h.flush();h.click('结果');await h.flush();assert.equal(collect(h).length,1);if(transition==='disconnect')h.render({connected:false});if(transition==='identity')h.render({run:{...h.run(),directory:'/owned/other'}});if(transition==='unmount')h.unmount();if(transition==='event')h.emit();await h.flush();gate.resolve({run:'r',artifacts:[{name:'LATE_SECRET',size:1}]});await h.flush();assert(!h.text().includes('LATE_SECRET'));assert.equal(collect(h).length,1);if(transition==='unmount')assert.equal(h.lateWrites(),0);h.unmount();});
test('failed observation can retry and real empty directory is distinguished',async()=>{let n=0;const h=harness({request:async()=>{if(!n++)throw Error('fixture unavailable');return{run:'r',artifacts:[]};}});await h.flush();h.click('结果');await h.flush();assert(h.text().includes('读取失败'));h.click('收集产物');await h.flush();assert(h.text().includes('当前结果目录为空'));assert.equal(collect(h).length,2);h.unmount();});
test('disconnected tab and reconnection do not automatically hash files',async()=>{const h=harness({props:{connected:false}});await h.flush();h.click('结果');await h.flush();assert.equal(collect(h).length,0);h.render({connected:true});await h.flush();assert.equal(collect(h).length,0);h.click('结果');await h.flush();assert.equal(collect(h).length,1);h.unmount();});
const engineMap=JSON.parse(fs.readFileSync(new URL("../../backend/worker/studio_worker/engine_contracts.json",import.meta.url))).engines;
test('all current routes plus unknown use conservative actual continuation entry support',async()=>{const expected=new Set(['gpumd.md','hotpp.train','pydyn.md','pydyn.sampling']);assert.deepEqual(Object.keys(engineMap).sort(),Object.keys(contracts.engines).sort());for(const engine of [...Object.keys(engineMap),'unknown']){const h=harness({props:{run:{id:'r',project_id:'p',environment_id:'e',directory:'/r',engine,status:'succeeded',parameters:{mode:'opes'},validation:{},command:[],inputs:{},created_at:1}}});await h.flush();assert.equal(!h.button('续算').props.disabled,expected.has(engine),engine);h.click('续算');await h.flush();if(!expected.has(engine))assert(!h.text().includes('从实际 checkpoint'));assert(!h.calls.some(c=>c.target==='/api/run/resume'));h.unmount();}assert(runContinuation('gpumd.sampling','static').allowed);for(const mode of ['opes','metad',undefined,'unknown'])assert(!runContinuation('gpumd.sampling',mode).allowed);assert(runContinuation('pydyn.sampling','opes').allowed);});
test('unsupported changed route cannot dispatch cached unconfirmed continuation; cache retained',async()=>{const storage=memoryStorage(),cached=JSON.stringify({key:'unknown-request',parameters:{checkpoint_files:['actual.ckpt']}});storage.setItem('studio.resume.r',cached);const h=harness({storage});await h.flush();h.click('续算');await h.flush();const create=h.button('重试同一续算请求');h.render({run:{...h.run(),engine:'bias.validate'}});await h.flush();assert(h.button('重试同一续算请求').props.disabled);create.props.onClick();await h.flush();assert(!h.calls.some(c=>c.target==='/api/run/resume'));assert.equal(storage.getItem('studio.resume.r'),cached);h.unmount();});

test('supported continuations still dispatch the original single-use retry identity',async()=>{for(const [engine,mode] of [['gpumd.md',null],['gpumd.sampling','static'],['hotpp.train',null],['pydyn.md',null],['pydyn.sampling','opes']]){const storage=memoryStorage();storage.setItem('studio.resume.r',JSON.stringify({key:'kept-key',parameters:{checkpoint_files:['actual.ckpt']}}));const h=harness({storage,props:{run:{id:'r',project_id:'p',environment_id:'e',directory:'/r',engine,status:'failed',parameters:{mode},validation:{},command:[],inputs:{},created_at:1}},request:async target=>{assert.equal(target,'/api/run/resume');return{id:'next'};}});await h.flush();h.click('续算');await h.flush();h.click('重试同一续算请求');await h.flush();const calls=h.calls.filter(c=>c.target==='/api/run/resume');assert.equal(calls.length,1,engine);assert.equal(calls[0].data.parameters.idempotency_key,'kept-key');assert.equal(storage.getItem('studio.resume.r'),null);h.unmount();}});

test('new continuation prompts for actual inputs before locking and dispatches explicit extra parameters unchanged',async t=>{
 const storage=memoryStorage(),h=harness({storage,request:async()=>({id:'next'})});t.after(h.unmount);
 await h.flush();h.click('续算');await h.flush();
 const editor=()=>h.nodes().find(node=>node.props?.engine==='gpumd.md'&&typeof node.props.onChange==='function');
 assert.equal(editor().props.value,'{}');
 h.click('创建续算草稿');await h.flush();assert.match(h.errors.at(-1),/checkpoint_files/);
 assert.equal(storage.getItem('studio.resume.r'),null);assert.deepEqual(h.calls,[]);assert.equal(editor().props.disabled,false);
 const parameters={checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/contin.in',unknown:{temperature:230,empty:false}};
 editor().props.onChange(JSON.stringify(parameters));await h.flush();h.click('创建续算草稿');await h.flush();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].target,'/api/run/resume');
 const {idempotency_key:key,...received}=h.calls[0].data.parameters;assert.equal(typeof key,'string');assert.deepEqual(received,parameters);
});

test('new continuation preserves unsafe JSON for correction before any request or idempotency record',async t=>{
 const key='studio.resume.r',storage=memoryStorage(),h=harness({storage,request:async()=>({id:'next'})});t.after(h.unmount);
 await h.flush();h.click('续算');await h.flush();
 const editor=()=>h.nodes().find(node=>node.props?.engine==='gpumd.md'&&typeof node.props.onChange==='function');
 for(const [value,notice] of [['{"n":9007199254740993}',/精度/],['{"signed":-0}',/精度/],[String.raw`{"name":1,"\u006eame":2}`,/重复键/]]){
  const raw='{"checkpoint_files":["restart.xyz"],"continuation_run_in":"/owned/continuation.in","extra":'+value+'}';
  editor().props.onChange(raw);await h.flush();h.click('创建续算草稿');await h.flush();
  assert.match(h.errors.at(-1),notice);assert.equal(editor().props.value,raw);assert.equal(editor().props.disabled,false);
  assert.deepEqual(h.calls,[]);assert.equal(storage.getItem(key),null);
 }
 editor().props.onChange('{"checkpoint_files":["restart.xyz"],"continuation_run_in":"/owned/continuation.in","extra":0}');
 await h.flush();h.click('创建续算草稿');await h.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.parameters.extra,0);
});

test('legacy locked continuation retries preserve their prior parsed payload and key',async t=>{
 const storage=memoryStorage();storage.setItem('studio.resume.r',String.raw`{"key":"legacy-key","parameters":{"checkpoint_files":["prior"],"checkpoint_\u0066iles":["restart.xyz"],"legacy":-0}}`);
 const h=harness({storage,request:async()=>({id:'next'})});t.after(h.unmount);
 await h.flush();h.click('续算');await h.flush();h.click('重试同一续算请求');await h.flush();
 assert.equal(h.calls.length,1);const {parameters}=h.calls[0].data;
 assert.deepEqual(parameters.checkpoint_files,['restart.xyz']);assert.equal(parameters.idempotency_key,'legacy-key');assert(Object.is(parameters.legacy,-0));
});

test('a retained older form cannot replace a newly unconfirmed continuation',async t=>{
 const key='studio.resume.r',storage=memoryStorage(),h=harness({storage,request:async()=>({id:'next'})});t.after(h.unmount);
 await h.flush();h.click('续算');await h.flush();const editor=h.nodes().find(node=>node.props?.engine==='gpumd.md'&&typeof node.props.onChange==='function');
 editor.props.onChange(JSON.stringify({checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/unused.in'}));await h.flush();
 const pending={key:'earlier-dispatch',parameters:{checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/earlier.in',extra:'keep'}};
 storage.setItem(key,JSON.stringify(pending));h.click('创建续算草稿');await h.flush();
 assert.deepEqual(h.calls,[]);assert.equal(storage.getItem(key),JSON.stringify(pending));assert.match(h.errors.at(-1),/本地续算记录已变化/);
 h.click('续算');await h.flush();h.click('重试同一续算请求');await h.flush();
 assert.deepEqual(h.calls,[{target:'/api/run/resume',data:{run_id:'r',parameters:{...pending.parameters,idempotency_key:pending.key}}}]);
});

const clearLabel='已核对，清除损坏记录',clearTitle='清除损坏的本地续算记录';
const discardDialog=h=>h.nodes().find(node=>node.props?.title===clearTitle);
const discardButton=(h,dialog)=>h.nodes(dialog).find(node=>node.type==='button'&&h.text(node)===clearLabel);

test('local continuation repair needs explicit confirmation for the named run and makes no worker request',async t=>{
 const storage=memoryStorage();storage.setItem('studio.resume.r','broken json');storage.setItem('studio.resume.other','other run');
 const h=harness({storage,confirm:()=>{assert.fail('Native confirm is forbidden');}});t.after(h.unmount);
 await h.flush();h.click(clearLabel);await h.flush();const dialog=discardDialog(h);assert(dialog);assert.match(h.text(dialog),/fixture · r/);
 assert.equal(storage.getItem('studio.resume.r'),'broken json');
 dialog.props.onClose();discardButton(h,dialog).props.onClick();await h.flush();assert.equal(storage.getItem('studio.resume.r'),'broken json');
 h.click(clearLabel);await h.flush();discardButton(h,discardDialog(h)).props.onClick();await h.flush();
 assert.equal(storage.getItem('studio.resume.r'),null);assert.equal(storage.getItem('studio.resume.other'),'other run');assert.equal(discardDialog(h),undefined);
 assert.equal(h.button('续算').props.disabled,false);assert.deepEqual(h.calls,[]);
});

test('a newly written valid pending continuation survives an older damage confirmation',async t=>{
 const storage=memoryStorage(),replacement=JSON.stringify({key:'keep-this-attempt',parameters:{checkpoint_files:['actual.ckpt']}});
 storage.setItem('studio.resume.r','{broken');const h=harness({storage});t.after(h.unmount);
 await h.flush();h.click(clearLabel);await h.flush();storage.setItem('studio.resume.r',replacement);
 discardButton(h,discardDialog(h)).props.onClick();await h.flush();
 assert.equal(storage.getItem('studio.resume.r'),replacement);assert.equal(discardDialog(h),undefined);
 h.click('续算');await h.flush();assert(h.button('重试同一续算请求'));assert.deepEqual(h.calls,[]);
});

test('older continuation repair cannot cross a different record, hidden workspace, read-only boundary or service event',async t=>{
 for(const transition of [h=>h.render({run:{...h.run(),directory:'/new-source/r'}}),h=>h.render({viewActive:false}),h=>h.render({readOnly:true}),h=>h.render({run:{...h.run(),studio_workflow_binding:{}}}),h=>h.emit()]){
  const storage=memoryStorage();storage.setItem('studio.resume.r','broken');const h=harness({storage});t.after(h.unmount);
  await h.flush();h.click(clearLabel);await h.flush();const confirm=discardButton(h,discardDialog(h)).props.onClick;
  transition(h);confirm();await h.flush();assert.equal(discardDialog(h),undefined);assert.equal(storage.getItem('studio.resume.r'),'broken');assert.deepEqual(h.calls,[]);
 }
});
test('manual refresh preserves previous same-owner list on failure and mismatched run is refused',async()=>{let n=0;const h=harness({request:async()=>{n++;if(n===1)return{run:'r',artifacts:[{name:'kept.xyz',size:1}]};if(n===2)throw Error('refresh unavailable');return{run:'OTHER',artifacts:[{name:'FOREIGN',size:1}]};}});await h.flush();h.click('结果');await h.flush();h.click('收集产物');await h.flush();assert(h.text().includes('kept.xyz'));assert(h.text().includes('读取失败'));h.click('收集产物');await h.flush();assert(!h.text().includes('FOREIGN'));assert(h.text().includes('kept.xyz'));h.unmount();});

for(const transition of ['same-id-directory','service-event'])test('successful artifact body and structure are cleared on '+transition,async()=>{
 const h=harness({request:async target=>target==='/api/run/collect'?{run:'r',artifacts:[{name:'actual.xyz',size:12}]}:target==='/api/run/file'?{text:'PRIOR_OWNER_BODY'}:{atoms:['PRIOR_OWNER_STRUCTURE']}});await h.flush();h.click('结果');await h.flush();h.nodes().find(n=>n.type==='button'&&h.text(n).startsWith('actual.xyz')).props.onClick();await h.flush();assert(h.nodes().some(n=>n.props?.value==='PRIOR_OWNER_BODY'));h.click('结构预览');await h.flush();assert(h.nodes().some(n=>n.props?.data?.atoms?.includes('PRIOR_OWNER_STRUCTURE')));assert(h.text().includes('actual.xyz'));
 if(transition==='same-id-directory')h.render({run:{...h.run(),directory:'/new-owner/same-id'}});else h.emit();await h.flush();assert(!h.text().includes('actual.xyz'));assert(!h.nodes().some(n=>n.props?.src==='PRIOR_OWNER_IMAGE'||n.props?.data?.atoms?.includes('PRIOR_OWNER_STRUCTURE')||n.props?.value==='PRIOR_OWNER_BODY'));assert.equal(collect(h).length,1);h.click('结果');await h.flush();assert.equal(collect(h).length,2);h.unmount();
});
test('NEB preserves the explicit missing optimizer-state explanation',()=>{assert.equal(runContinuation('gpumd.neb').reason,'NEB 路径不含优化器状态，请显式创建新的路径计算');});

test('successful image preview is removed on service epoch without automatic collection',async()=>{const h=harness({request:async target=>target==='/api/run/collect'?{run:'r',artifacts:[{name:'image.png',size:12}]}:{image:'PRIOR_OWNER_IMAGE'}});await h.flush();h.click('结果');await h.flush();h.nodes().find(n=>n.type==='button'&&h.text(n).startsWith('image.png')).props.onClick();await h.flush();assert(h.nodes().some(n=>n.props?.src==='PRIOR_OWNER_IMAGE'));h.emit();await h.flush();assert(!h.nodes().some(n=>n.props?.src==='PRIOR_OWNER_IMAGE'));assert(!h.text().includes('image.png'));assert.equal(collect(h).length,1);h.unmount();});

for(const pendingKind of ['file','inspect'])for(const outcome of ['resolve','reject'])test('actual pending '+pendingKind+' '+outcome+' after unmount writes no state or error',async()=>{
 const gate=deferred(),h=harness({request:async target=>{if(target==='/api/run/collect')return{run:'r',artifacts:[{name:'pending.xyz',size:12}]};if(target==='/api/run/file')return pendingKind==='file'?gate.promise:{text:'current owner file'};if(target==='/api/inspect')return gate.promise;throw Error('Unexpected fixture call');}});await h.flush();h.click('结果');await h.flush();h.nodes().find(n=>n.type==='button'&&h.text(n).startsWith('pending.xyz')).props.onClick();await h.flush();if(pendingKind==='inspect'){h.click('结构预览');await h.flush();}const target=pendingKind==='file'?'/api/run/file':'/api/inspect';assert.equal(h.calls.filter(c=>c.target===target).length,1,'deferred request must actually be pending');assert.equal(h.errors.length,0);h.unmount();const writes=h.lateWrites();if(outcome==='reject')gate.reject(Error('late old-owner failure'));else gate.resolve(pendingKind==='file'?{text:'late old-owner text'}:{atoms:['late old-owner structure']});await h.flush();assert.equal(h.lateWrites(),writes);assert.equal(h.errors.length,0);
});

test('inherited continuation notice survives actual completed RunDetail input-tab navigation',async()=>{const h=harness({props:{run:{id:'continued',project_id:'p',environment_id:'e',directory:'/owned/continued',engine:'gpumd.md',status:'succeeded',name:'continued',parameters:{dynamics:{steps:10}},continuation_metadata:{schema:'gpumd-continuation-v1',parameter_scope:'inherited_unverified'},validation:{},command:['gpumd'],inputs:{},created_at:1}}});await h.flush();h.click('输入');await h.flush();assert.match(h.text(),/继承值/);const note=h.nodes().find(n=>n.props?.content?.includes('checkpoint 速度尚未检查'));assert(note);assert(!h.nodes().some(n=>n.type==='button'&&h.text(n)==='继承值'));h.render({run:{...h.run(),id:'legacy',continuation_metadata:undefined}});await h.flush();assert.doesNotMatch(h.text(),/继承值/);h.unmount();});

test('only phase-relevant RunDetail actions render while history and recovery controls remain',async()=>{for(const status of ['draft','ready','queued','running','unknown','succeeded','failed','cancelled']){const h=harness();h.render({run:{...h.run(),status}});await h.flush();const area=h.nodes().find(n=>n.props?.className==='run-actions');const buttons=h.nodes(area).filter(n=>n.type==='button');const labels=buttons.map(n=>h.text(n));assert.equal(labels.includes('验证'),['draft','ready'].includes(status),status);assert.equal(labels.includes('提交计算'),['draft','ready'].includes(status),status);assert.equal(labels.includes('取消'),['queued','running','unknown'].includes(status),status);assert(labels.includes('收集产物'));assert(labels.includes('续算'));assert(buttons.some(n=>n.props?.['aria-label']==='导出不可变输入与复现记录 ZIP'));if(['draft','ready'].includes(status))assert.equal(buttons.find(n=>h.text(n)==='提交计算').props.disabled,false,status);h.unmount();}});


test('draft submission checks the exact run through submit without forcing optional validation first',async()=>{
 const original={id:'direct-draft',project_id:'p',environment_id:'e',directory:'/owned/direct-draft',engine:'pydyn.md',name:'Unreviewed draft',status:'draft',validation:{status:'not_run'},parameters:{},inputs:{},command:[],created_at:1},h=harness({props:{run:original},request:async(target,data)=>{assert.equal(target,'/api/run/submit');assert.equal(data.run_id,original.id);return {...original,status:'queued'};}});await h.flush();assert.equal(h.calls.length,0);assert.equal(h.button('提交计算').props.disabled,false);h.click('提交计算');await h.flush();assert.deepEqual(h.calls.map(call=>call.target),['/api/run/submit']);assert.equal(original.validation.status,'not_run');h.unmount();
});
