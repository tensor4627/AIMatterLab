import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {deferred} from '../helpers/agent-hooks.mjs';

const project={id:'fast-project',name:'Fast project',policy:{engines:['pydyn.md'],gpus:[0],environments:['env'],input_roots:['/fixture'],max_seconds:60,max_concurrent:1}};
const run={id:'fast-run',name:'Fast run',engine:'pydyn.md',project_id:project.id,environment_id:'env',status:'succeeded',gpu:0,max_seconds:60,directory:'/fixture/run',created_at:1,updated_at:1,parameters:{},validation:{},inputs:{},command:[]};
const jobs=h=>h.find(node=>node.type==='./JobsPage').props;
const refresh=h=>h.find(node=>node.type==='button'&&node.props?.['aria-label']==='刷新');
const reads=(h,path)=>h.calls.filter(call=>call.method==='worker.request'&&call.data.target===path);

test('fast projects and runs publish before delayed environment and cluster reads finish',async()=>{
 const environment=deferred(),cluster=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='worker.request'?data.target==='/api/projects'?[project]:data.target==='/api/runs'?[run]:data.target==='/api/environments'?environment.promise:data.target==='/api/cluster-runs'?cluster.promise:standard(method,data):standard(method,data)});
 try{await h.flush();assert.deepEqual(jobs(h).projects,[project]);assert.deepEqual(jobs(h).local,[run]);assert.deepEqual(jobs(h).cluster,[]);assert.equal(jobs(h).observations.local.loaded,true);assert.equal(jobs(h).observations.cluster.loaded,false);environment.resolve([{id:'env',name:'Late environment',executables:{python:'/fixture/python'}}]);await h.flush();assert.deepEqual(jobs(h).local,[run]);cluster.resolve([]);await h.flush();assert.equal(jobs(h).observations.cluster.loaded,true);}finally{h.unmount();}
});

test('same-tick manual refresh shares one request set and reports partial completion accurately',async()=>{
 let delayed=false;const environment=deferred(),h=appWorkerHarness({override:(method,data,standard)=>delayed&&method==='worker.request'&&data.target==='/api/environments'?environment.promise:standard(method,data)});
 try{await h.flush();delayed=true;const before=h.calls.length,click=refresh(h).props.onClick;click();click();await h.flush();const requested=h.calls.slice(before).filter(call=>call.method==='worker.request');assert.equal(requested.length,4);assert.equal(new Set(requested.map(call=>call.data.target)).size,4);assert.match(h.text(h.find(node=>node.props?.['data-testid']==='manual-refresh-feedback')),/正在同步记录/);environment.reject(Error('Synthetic unavailable metadata'));await h.flush();assert.match(h.text(h.find(node=>node.props?.['data-testid']==='manual-refresh-feedback')),/部分记录未刷新/);assert.equal(refresh(h).props.disabled,false);}finally{h.unmount();}
});

test('ordinary panel navigation keeps metadata cached while job observations continue',async()=>{
 const h=appWorkerHarness();try{await h.flush();const metadata=[reads(h,'/api/projects').length,reads(h,'/api/environments').length],local=reads(h,'/api/runs').length,cluster=reads(h,'/api/cluster-runs').length;
  h.find(node=>node.type==='button'&&h.text(node)==='查看工具关系').props.onClick();await h.flush();h.find(node=>node.type==='button'&&node.props?.['data-testid']==='navigate-runs').props.onClick();await h.flush();h.find(node=>node.type==='./Agent').props.onOpenCluster();await h.flush();
  assert.deepEqual([reads(h,'/api/projects').length,reads(h,'/api/environments').length],metadata);assert(reads(h,'/api/runs').length>=local+3);assert(reads(h,'/api/cluster-runs').length>=cluster+3);const before=reads(h,'/api/environments').length;refresh(h).props.onClick();await h.flush();assert.equal(reads(h,'/api/environments').length,before+1);
 }finally{h.unmount();}
});

test('late reads from an invalidated worker source cannot publish into its replacement',async()=>{
 let delayed=false;const oldProjects=deferred(),oldRuns=deferred(),h=appWorkerHarness({override:(method,data,standard)=>delayed&&method==='worker.request'&&data.target==='/api/projects'?oldProjects.promise:delayed&&method==='worker.request'&&data.target==='/api/runs'?oldRuns.promise:standard(method,data)});
 try{await h.flush();delayed=true;refresh(h).props.onClick();await h.flush();const settings=h.openSettings();settings.onChange({...settings.settings,distribution:'Replacement source'});await h.flush();oldProjects.resolve([project]);oldRuns.resolve([run]);await h.flush();assert(!jobs(h).projects.some(value=>value.id===project.id));assert(!jobs(h).local.some(value=>value.id===run.id));assert.throws(()=>h.find(node=>node.props?.['data-testid']==='manual-refresh-feedback'));}finally{h.unmount();}
});

test('input save dispatches once and a late save cannot clear edits made while saving',async()=>{
 const gate=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='file.open'?{id:'draft',name:'draft.py',path:'C:/fixture/draft.py',content:'initial'}:method==='file.save'?gate.promise:standard(method,data)});
 try{await h.flush();h.find(node=>node.type==='button'&&node.props?.['aria-label']==='打开源码').props.onClick();await h.flush();const editor=()=>h.find(node=>node.type==='CodeEditor');editor().props.onChange('first edit');await h.flush();const save=h.find(node=>node.type==='button'&&h.text(node)==='另存到 Windows').props.onClick;save();save();await h.flush();assert.equal(h.calls.filter(call=>call.method==='file.save').length,1);assert(h.find(node=>node.props?.label==='正在保存输入文件…').props.busy);editor().props.onChange('newer edit');await h.flush();gate.resolve({id:'saved-file',name:'draft.py',path:'C:/fixture/saved.py'});await h.flush();assert.equal(editor().props.value,'newer edit');assert.match(h.text(h.find(node=>node.props?.className==='editor-workspace')),/draft.py \*/);assert.equal(h.find(node=>node.props?.label==='正在保存输入文件…').props.busy,false);
 }finally{h.unmount();}
});
