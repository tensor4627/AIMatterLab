import {frontendSource} from "../helpers/frontend-source-paths.mjs";
// Actual RunReview/RunDetail hooks and JSX; controlled API responses, no desktop or run execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {ObservedRead} from "../../frontend/api/observed-read.mjs";
import * as logBuffer from "../../frontend/features/runs/log-buffer.mjs";
import * as runReviewDraft from "../../frontend/features/runs/run-review-draft.mjs";

import {runContinuation} from "../../frontend/features/runs/run-continuation.mjs";

import * as taskFieldsOwner0 from "../../contracts/workflows/task-fields.mjs";
import * as taskFieldsOwner1 from "../../frontend/ui/task-fields.mjs";
import * as taskFieldsOwner2 from "../../frontend/features/conversations/workflow-intent.mjs";
const taskFields={...taskFieldsOwner0,...taskFieldsOwner1,...taskFieldsOwner2};


const binding={schema_version:1,workflow_id:'workflow',execution_id:'execution',step_id:'first',snapshot_sha256:'a'.repeat(64),group_id:'reference',group_version:'b'.repeat(64),configuration_id:'configuration',execution_skill_id:'skill',execution_skill_sha256:'c'.repeat(64)};
const run=(status='draft',bound=false)=>({id:'run',name:'Controlled UI run',project_id:'project',environment_id:'environment',gpu:0,max_seconds:30,directory:'/fixture/run',engine:'gpumd.md',status,validation:{status:status==='ready'?'passed':'not_run'},parameters:{},command:['fixture'],inputs:{'run.in':'snapshot'},created_at:1,updated_at:1,...bound?{studio_workflow_binding:binding}:{}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(t,{component='RunDetail',props={},override,storageValues=[],storageUnavailable=false}={}){
 const calls=[],errors=[],opened=[],replaced=[],refreshes=[],frames=new Map(),modules=new Map(),effects=[],storage=new Map(storageValues);let active,dirty=false,tree,currentProps,disposed=false;
 const hooks={useState(initial){const frame=active,index=frame.cursor++;frame.hooks[index]??={value:typeof initial==='function'?initial():initial};return [frame.hooks[index].value,value=>{if(frame.disposed)return;const before=frame.hooks[index].value;frame.hooks[index].value=typeof value==='function'?value(before):value;if(!Object.is(before,frame.hooks[index].value))dirty=true;}];},useRef(value){const frame=active;return frame.hooks[frame.cursor++]??={current:value};},useEffect(fn,deps){const frame=active,index=frame.cursor++,previous=frame.hooks[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){const record={deps,cleanup:previous?.cleanup};frame.hooks[index]=record;effects.push(()=>{if(frame.disposed)return;record.cleanup?.();record.cleanup=fn();});}}};
 const standard=async target=>target==='/api/run/log'?{offset:1,text:'CONTROLLED LOG BODY'}:target==='/api/run/collect'?{run:'run',artifacts:[{name:'receipt.json',size:5}]}:target==='/api/run/file'?{text:'CONTROLLED ARTIFACT BODY'}:target==='/api/run/revise'?{...run('draft'),id:'revision'}:target==='/api/run/validate'?{...run('ready'),id:'revision'}:target==='/api/run/submit'?{...run('queued'),id:'revision'}:target==='/api/run/resume'?{id:'continuation'}:target==='/api/run/cancel'?run('cancelled'):target==='/api/run/status'?run('unknown'):Promise.reject(Error('Unexpected controlled API '+target));
 const api=async(method,target,data)=>{calls.push({method,target,data});return override?override(target,data,()=>standard(target)):standard(target);};
 function load(name){if(modules.has(name))return modules.get(name);const source=fs.readFileSync(frontendSource(name+'.tsx'),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};modules.set(name,module.exports);
  const require=target=>target==='react'?hooks:target==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'}:target==='./RunDetail'?load('RunDetail'):target==='./run-review-draft.mjs'?runReviewDraft:target==='./log-buffer.mjs'?logBuffer:["./run-continuation.mjs"].includes(target)?{runContinuation}:["../../api/observed-read.mjs"].includes(target)?{ObservedRead}:["./workflow-intent.mjs","../../../contracts/workflows/task-fields.mjs","../../ui/task-fields.mjs"].includes(target)?taskFields:['../../api/studio','../../api/worker'].includes(target)?{api,invoke:async(method,data)=>{calls.push({method,target:method,data});return {};}}:target==='../../ui/i18n'?{t:value=>value,tr:value=>value}:new Proxy({},{get:(_value,key)=>String(key)});
  const storagePort={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},windowPort={studio:{onEvent:()=>()=>{}},confirm:()=>true,addEventListener(){},removeEventListener(){},get localStorage(){if(storageUnavailable)throw Error('SecurityError: storage getter blocked');return storagePort;}};
  new Function('require','module','exports','window','localStorage','crypto',compiled)(require,module,module.exports,windowPort,storagePort,{randomUUID});modules.set(name,module.exports);return module.exports;
 }
 const Root=load(component).default,Detail=load('RunDetail').default;
 function dispose(frame){frame.disposed=true;for(const hook of frame.hooks)hook?.cleanup?.();}
 function render(changes={}){currentProps={...currentProps,...changes};const used=new Set();function call(fn,props,key){let frame=frames.get(key);if(!frame||frame.fn!==fn){if(frame)dispose(frame);frame={fn,hooks:[],cursor:0,count:null,disposed:false};frames.set(key,frame);}used.add(key);frame.cursor=0;active=frame;const result=fn(props);if(frame.count!==null)assert.equal(frame.cursor,frame.count,'hook order/count changed in '+key);frame.count=frame.cursor;active=null;return expand(result,key);}
  function expand(value,key){if(Array.isArray(value))return value.map((child,i)=>expand(child,key+'/'+i));if(!value||typeof value!=='object')return value;if(value.type===Detail)return call(Detail,value.props,key+'/RunDetail');return {...value,props:{...value.props,children:expand(value.props?.children,key+'/children')}};}
  dirty=false;tree=call(Root,currentProps,'root');for(const [key,frame]of frames)if(!used.has(key)){dispose(frame);frames.delete(key);}
 }
 currentProps={run:run(),connected:true,environments:[{id:'environment',name:'Fixture'}],theme:'dark',onRefresh:()=>refreshes.push('refresh'),onError:value=>errors.push(String(value)),onReplace:value=>replaced.push(value),onOpenWorkflow:id=>opened.push(id),...props};
 function nodes(value=tree){return Array.isArray(value)?value.flatMap(item=>nodes(item??null)):value&&typeof value==='object'?[value,...nodes(value.props?.children??null)]:[];}
 function text(value=tree){return Array.isArray(value)?value.map(item=>text(item??null)).join(''):value&&typeof value==='object'?text(value.props?.children??null):value==null||typeof value==='boolean'?'':String(value);}
 const buttons=()=>nodes().filter(node=>node.type==='button'),find=label=>{const result=buttons().find(node=>text(node)===label);assert(result,'button '+label);return result;};
 async function flush(){for(let i=0;i<12;i++){while(effects.length)effects.shift()();await new Promise(done=>setImmediate(done));if(dirty&&!disposed)render();}}
 const unmount=()=>{disposed=true;for(const frame of frames.values())dispose(frame);frames.clear();};t.after(unmount);render();return {calls,errors,opened,replaced,refreshes,storage,render,flush,nodes,text,buttons,find,unmount,click:label=>{const button=find(label);if(!button.props.disabled)button.props.onClick();},run:()=>currentProps.run};
}
const mutations=h=>h.calls.filter(call=>/\/api\/run\/(revise|validate|submit|resume|cancel)$/.test(call.target));
const operationButtons=h=>{const area=h.nodes().find(node=>node.props?.className==='run-actions');assert(area);return h.nodes(area).filter(node=>node.type==='button');};

for(const status of ['draft','ready','unknown'])test('bound RunReview '+status+' renders the real readonly detail with log/artifacts and a run-ID-only return callback',async t=>{
 const h=harness(t,{component:'RunReview',props:{run:run(status,true)}});await h.flush();assert(h.text().includes('工具组步骤管理'));assert(h.text().includes('CONTROLLED LOG BODY'));assert(!h.buttons().some(button=>button.props['data-testid']==='execute-reviewed'));assert(!operationButtons(h).some(button=>['验证','提交计算','续算','取消'].includes(h.text(button))));
 const before=h.calls.length;h.click('返回所属工具组步骤');await h.flush();assert.deepEqual(h.opened,['run']);assert.equal(h.calls.length,before);h.click('产物');await h.flush();h.click('receipt.json0.0 KB');await h.flush();assert(h.nodes().some(node=>node.props?.value==='CONTROLLED ARTIFACT BODY'));assert.equal(mutations(h).length,0);
});

test('bound detail remains readonly without a navigation callback, and keeps existing queued/running cancellation only',async t=>{
 const absent=harness(t,{props:{run:run('ready',true),onOpenWorkflow:undefined}});await absent.flush();assert(absent.text().includes('工具组步骤管理'));assert(!absent.buttons().some(button=>hText(button)==='返回所属工具组步骤'));assert.equal(mutations(absent).length,0);
 for(const status of ['queued','running']){const h=harness(t,{props:{run:run(status,true)}});await h.flush();h.click('取消');await h.flush();assert.deepEqual(mutations(h).map(call=>call.target),['/api/run/cancel']);assert(!operationButtons(h).some(button=>['验证','提交计算','续算'].includes(h.text(button))));}
 function hText(value){return typeof value==='string'?value:Array.isArray(value)?value.map(hText).join(''):value&&typeof value==='object'?hText(value.props?.children):'';}
});

test('legacy RunReview preserves revise, validate and submit while hook order stays stable across bound/status transitions',async t=>{
 const h=harness(t,{component:'RunReview'});await h.flush();h.click('确认并执行');await h.flush();assert.deepEqual(mutations(h).map(call=>call.target),['/api/run/revise','/api/run/validate','/api/run/submit']);assert.equal(h.replaced.at(-1).status,'queued');
 for(const [status,bound]of [['draft',true],['ready',false],['unknown',true],['draft',false]]){h.render({run:run(status,bound)});await h.flush();assert.equal(h.buttons().some(button=>button.props['data-testid']==='execute-reviewed'),!bound&&['draft','ready'].includes(status));}
});

test('legacy detail still validates/submits/resumes, and bound mode blocks captured stale generic handlers',async t=>{
 const h=harness(t,{props:{run:run('ready')}});await h.flush();const validate=h.find('验证'),submit=h.find('提交计算');h.click('验证');await h.flush();h.click('提交计算');await h.flush();assert.deepEqual(mutations(h).map(call=>call.target),['/api/run/validate','/api/run/submit']);const before=mutations(h).length;h.render({run:run('ready',true)});await h.flush();validate.props.onClick();submit.props.onClick();await h.flush();assert.equal(mutations(h).length,before);
 const resume=harness(t,{props:{run:run('failed')},storageValues:[['studio.resume.run',JSON.stringify({key:'existing-attempt',parameters:{checkpoint_files:['restart.xyz']}})]]});await resume.flush();resume.click('续算');await resume.flush();resume.click('重试同一续算请求');await resume.flush();assert.equal(mutations(resume)[0].target,'/api/run/resume');assert.equal(mutations(resume)[0].data.parameters.idempotency_key,'existing-attempt');
});

test('bound transition blocks a captured Review execute and an in-flight legacy revision before validation/submission',async t=>{
 const h=harness(t,{component:'RunReview'});await h.flush();const execute=h.find('确认并执行');h.render({run:run('draft',true)});await h.flush();execute.props.onClick();await h.flush();assert.equal(mutations(h).length,0);
 const gate=deferred(),entered=deferred(),pending=harness(t,{component:'RunReview',override:(target,data,next)=>{if(target==='/api/run/revise'){entered.resolve();return gate.promise;}return next();}});await pending.flush();pending.click('确认并执行');await entered.promise;pending.render({run:run('draft',true)});await pending.flush();gate.resolve({...run('draft'),id:'revision'});await pending.flush();assert.deepEqual(mutations(pending).map(call=>call.target),['/api/run/revise']);assert.equal(pending.replaced.length,0);
});

test('bound transition hides a cached continuation dialog, prevents its stale handler, and preserves the old attempt record',async t=>{
 const cached=JSON.stringify({key:'unknown-attempt',parameters:{checkpoint_files:['restart.xyz']}}),h=harness(t,{props:{run:run('failed')},storageValues:[['studio.resume.run',cached]]});await h.flush();h.click('续算');await h.flush();const retry=h.find('重试同一续算请求');h.render({run:run('failed',true)});await h.flush();assert(!h.buttons().some(button=>['续算','重试同一续算请求','创建续算草稿'].includes(h.text(button))));retry.props.onClick();await h.flush();assert.equal(mutations(h).length,0);assert.equal(h.storage.get('studio.resume.run'),cached);
});

test('actual Review remount restores resources, scientific parameters, input paths and source edits without worker writes',async t=>{
 const props={draftScope:'isolated-source'},override=(target,data,next)=>target==='/api/run/input'?{editable:true,text:'Original input',sha256:'a'.repeat(64)}:next();
 const first=harness(t,{component:'RunReview',props,override});await first.flush();
 const change=(predicate,value)=>{const node=first.nodes().find(predicate);assert(node,'editable target');node.props.onChange({target:{value}});};
 change(node=>node.type==='input'&&node.props.value==='Controlled UI run','My unsent revision');await first.flush();
 change(node=>node.type==='input'&&node.props.value===30,'120');await first.flush();
 first.nodes().find(node=>node.type==='ParameterFields').props.onChange('temperature',350);await first.flush();
 first.click('run.in');await first.flush();first.nodes().find(node=>node.type==='CodeEditor').props.onChange('Edited scientific input');await first.flush();
 assert(first.text().includes('本地编辑草稿已保留'));assert.equal(mutations(first).length,0);const saved=[...first.storage];first.unmount();
 const reopened=harness(t,{component:'RunReview',props,override,storageValues:saved});await reopened.flush();
 assert(reopened.nodes().some(node=>node.type==='input'&&node.props.value==='My unsent revision'));assert(reopened.nodes().some(node=>node.type==='input'&&node.props.value===120));assert.equal(reopened.nodes().find(node=>node.type==='ParameterFields').props.parameters.temperature,350);
 reopened.click('run.in *');await reopened.flush();assert.equal(reopened.nodes().find(node=>node.type==='CodeEditor').props.value,'Edited scientific input');
 reopened.render({draftScope:'different-source'});await reopened.flush();assert(reopened.nodes().some(node=>node.type==='input'&&node.props.value==='Controlled UI run'));
 reopened.render(props);await reopened.flush();assert(reopened.nodes().some(node=>node.type==='input'&&node.props.value==='My unsent revision'));assert.equal(mutations(reopened).length,0);
 reopened.click('丢弃本地草稿');await reopened.flush();assert(reopened.nodes().some(node=>node.type==='input'&&node.props.value==='Controlled UI run'));assert(!reopened.text().includes('本地编辑草稿已保留'));assert.equal(mutations(reopened).length,0);
});

test('Review baseline conflicts expose the retained draft and block execution until explicit discard',async t=>{
 const h=harness(t,{component:'RunReview',props:{draftScope:'same-source'}});await h.flush();h.nodes().find(node=>node.type==='input'&&node.props.value==='Controlled UI run').props.onChange({target:{value:'Important old edit'}});await h.flush();h.render({run:{...run(),parameters:{temperature:400}}});await h.flush();assert(h.text().includes('原始记录已变化'));assert(h.text().includes('Important old edit'));assert.equal(h.find('确认并执行').props.disabled,true);h.find('确认并执行').props.onClick();await h.flush();assert.equal(mutations(h).length,0);
 h.click('丢弃本地草稿');await h.flush();assert.equal(h.find('确认并执行').props.disabled,false);assert.equal(h.nodes().find(node=>node.type==='ParameterFields').props.parameters.temperature,400);assert.equal(mutations(h).length,0);
});

test('Review remains editable when the localStorage getter throws and reports memory-only drafts',async t=>{
 const props={draftScope:'blocked-storage-source'},first=harness(t,{component:'RunReview',props,storageUnavailable:true});await first.flush();assert(first.text().includes('本地持久化失败'));first.nodes().find(node=>node.type==='input'&&node.props.value==='Controlled UI run').props.onChange({target:{value:'Memory-only edit'}});await first.flush();assert(first.nodes().some(node=>node.type==='input'&&node.props.value==='Memory-only edit'));first.unmount();const remounted=harness(t,{component:'RunReview',props,storageUnavailable:true});await remounted.flush();assert(remounted.nodes().some(node=>node.type==='input'&&node.props.value==='Memory-only edit'));assert(remounted.text().includes('本地持久化失败'));assert.equal(mutations(first).length+mutations(remounted).length,0);
});
