import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
import {appWorkerHarness} from './helpers/app-worker-hooks.mjs';import {deferred} from './helpers/agent-hooks.mjs';import {workspacePresentation} from '../shared/workspace-presentation.mjs';
const feedback=h=>h.text(h.find(n=>n.props?.['data-testid']==='manual-refresh-feedback'));
test('App explicit toolbar and Jobs sync share refresh feedback; startup does not claim manual completion',async()=>{
 const h=appWorkerHarness();await h.flush();assert.throws(()=>feedback(h));
 h.find(n=>n.type==='button'&&n.props?.['aria-label']==='刷新').props.onClick();await h.flush();assert.match(feedback(h),/记录已刷新/);
 const before=h.calls.filter(c=>c.method==='worker.request').length;h.find(n=>n.type==='./JobsPage').props.onRefresh();await h.flush();assert.equal(h.calls.filter(c=>c.method==='worker.request').length-before,5);assert.match(feedback(h),/记录已刷新/);h.unmount();
});
test('App refresh partial/all failures do not claim complete and old owner cannot report success',async()=>{
 let fail='',wait=null;const h=appWorkerHarness({override:(m,d,standard)=>{if(m==='worker.request'){if(wait&&d.target==='/api/projects')return wait.promise;if(fail==='all'||fail===d.target)throw Error('read failed');}return standard(m,d);}});await h.flush();
 const click=()=>h.find(n=>n.type==='button'&&n.props?.['aria-label']==='刷新').props.onClick();
 fail='/api/assets';click();await h.flush();assert.match(feedback(h),/部分记录未刷新/);assert.doesNotMatch(feedback(h),/^记录已刷新/);
 fail='all';click();await h.flush();assert.match(feedback(h),/记录刷新失败/);
 fail='';wait=deferred();click();await h.flush();assert.match(feedback(h),/正在同步/);
 const settings=h.openSettings();settings.onChange({...settings.settings,distribution:'Different fixture source'});await h.flush();wait.resolve([]);await h.flush();assert.throws(()=>feedback(h));h.unmount();
});

function workspaceHarness(invoke){
 const hooks=[],effects=[],errors=[];let cursor=0,dirty=false,tree,alive=true,props={task:{id:'one',provider:'codex',threadId:'thread',parameters:{},workspaceChoice:'draft',authoring:{inputRoot:'/owned'}},worker:true,busy:false,onRefresh:()=>{},onError:e=>errors.push(e)};
 const useState=initial=>{const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return[hooks[i].value,next=>{hooks[i].value=typeof next==='function'?next(hooks[i].value):next;dirty=true;}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};const imports={'react':{useState,useRef,useEffect},'react/jsx-runtime':{jsx,jsxs:jsx},'./types':{invoke},'./i18n':{t:x=>x},'../shared/workspace-presentation.mjs':{workspacePresentation}};
 const code=ts.transpileModule(fs.readFileSync(new URL('../src/WorkspacePanel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>imports[name]||new Proxy({default:name},{get:(o,k)=>o[k]||String(k)}),module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);}const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);const find=p=>{const n=all(tree).find(p);assert(n);return n;};
 async function flush(){for(let i=0;i<12;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&alive)render();}}
 render();return{flush,find,text,errors,change:next=>{props={...props,...next};render();},unmount:()=>{alive=false;hooks.forEach(h=>h.cleanup?.());}};
}
test('Workspace manual refresh announces current empty-list completion; failed and superseded reads do not',async()=>{
 let answer={status:'ready',taskId:'one',workspaces:[]};const h=workspaceHarness(async()=>{if(answer instanceof Error)throw answer;return answer;});await h.flush();const status=()=>h.find(n=>n.props?.['data-testid']==='workspace-list-state');assert.equal(status().props['aria-live'],'polite');
 const click=()=>h.find(n=>n.type==='button'&&h.text(n)==='刷新工作区列表').props.onClick();click();await h.flush();assert.match(h.text(status()),/工作区列表已刷新 · /);
 answer=new Error('failed');click();await h.flush();assert.match(h.text(status()),/读取失败/);assert.doesNotMatch(h.text(status()),/已刷新/);
 answer={status:'superseded',taskId:'one'};click();await h.flush();assert.match(h.text(status()),/待刷新/);assert.doesNotMatch(h.text(status()),/已刷新/);answer={status:'ready',taskId:'two',workspaces:[]};h.change({task:{id:'two',provider:'codex',threadId:'second',parameters:{},workspaceChoice:'draft',authoring:{inputRoot:'/second'}}});await h.flush();assert.match(h.text(status()),/已读取/);assert.doesNotMatch(h.text(status()),/已刷新/);h.unmount();
});
test('Workspace late previous-task result cannot acquire a refresh receipt for the new task',async()=>{
 const old=deferred();const h=workspaceHarness((_m,d)=>d.taskId==='one'?old.promise:Promise.resolve({status:'ready',taskId:'two',workspaces:[]}));await h.flush();h.change({task:{id:'two',provider:'codex',threadId:'second',parameters:{},workspaceChoice:'draft',authoring:{inputRoot:'/second'}}});await h.flush();old.resolve({status:'ready',taskId:'one',workspaces:[{id:'OLD'}]});await h.flush();assert.doesNotMatch(h.text(h.find(n=>n.props?.['data-testid']==='workspace-choice')),/OLD|已刷新/);h.unmount();
});
for(const transition of ['workspace-ABA','offline-online'])test('Workspace abandoned manual ticket does not survive '+transition,async()=>{
 const pending=deferred();let reads=0;const h=workspaceHarness(()=>{reads++;return reads===2?pending.promise:Promise.resolve({status:'ready',taskId:'one',workspaces:[]});});
 await h.flush();h.find(n=>n.type==='button'&&h.text(n)==='刷新工作区列表').props.onClick();await h.flush();assert.equal(reads,2);
 if(transition==='workspace-ABA'){
  const task={id:'one',provider:'codex',threadId:'thread',parameters:{},workspaceChoice:'draft',authoring:{inputRoot:'/owned'}};
  h.change({task:{...task,workspace:{id:'B'}}});await h.flush();h.change({task});
 }else{h.change({worker:false});await h.flush();h.change({worker:true});}
 await h.flush();const status=()=>h.text(h.find(n=>n.props?.['data-testid']==='workspace-list-state'));
 assert.match(status(),/已读取/);assert.doesNotMatch(status(),/已刷新/);
 pending.resolve({status:'ready',taskId:'one',workspaces:[{id:'abandoned'}]});await h.flush();assert.match(status(),/已读取/);assert.doesNotMatch(h.text(h.find(n=>n.props?.['data-testid']==='workspace-choice')),/abandoned|已刷新/);h.unmount();
});
