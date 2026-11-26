import {fixtureControlModule,frontendComponentLoader} from '../helpers/frontend-component-loader.mjs';
import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {deploymentFixture, deploymentHarness} from "../helpers/deployment-diagnostic-hooks.mjs";
import {deferred} from "../helpers/agent-hooks.mjs";
import {partitionFields} from "../../frontend/ui/task-fields.mjs";
import * as fieldsOwner1 from "../../frontend/ui/task-fields.mjs";
import {validField, fieldMissing, workflowMissing, normalizeSteps} from "../../contracts/workflows/task-fields.mjs";
import * as fieldsOwner0 from "../../contracts/workflows/task-fields.mjs";
import fs from "node:fs";
import ts from "typescript";
import * as shell from "../../frontend/app/workspace-shell.mjs";
import {knownRunReconcile as pick, knownRunReconcileScope as scope} from "../../contracts/workflows/known-run-reconcile.mjs";
import {frontendSource} from "../helpers/frontend-source-paths.mjs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import * as fieldsOwner2 from "../../frontend/features/conversations/workflow-intent.mjs";
import {parameterDisplayLabel} from "../../frontend/ui/parameter-label.mjs";
import {stepMatchesQuery} from "../../frontend/features/workflows/task-step-search.mjs";
import {keyWorkflowFields, workflowMissingTargets, workflowOutputLabels} from "../../frontend/features/workflows/workflow-entry-summary.mjs";
import {tools, tasks, createPlan, planPrompt} from "../../frontend/features/workflows/workflow-catalog.mjs";
import {validatePlan} from "../../contracts/workflows/plan.mjs";

await __describe("deployment-startup-recovery", async () => {
const test = __node_test;
const dependent=h=>h.calls.filter(call=>['task.deployment.context','worker.request','task.linkRun'].includes(call.method));
test('Deployment defers all worker reads and automatic binding restore until App finishes initial scope verification',async()=>{
 let restores=0,explicit=0;const h=deploymentHarness({properties:{worker:false,restoring:true,onAutomaticRestore:()=>{restores++;},onReconnect:()=>{explicit++;}}});await h.flush();assert.deepEqual(dependent(h),[]);assert.equal(restores,0);assert.equal(explicit,0);assert(h.text(h.find(node=>node.props?.['data-testid']==='deployment-context-state')).includes('正在核对'));h.update({restoring:false});await h.flush();assert.equal(restores,1);assert.equal(explicit,0);assert.deepEqual(dependent(h),[]);assert(!h.text(h.find(node=>node.props?.['data-testid']==='deployment-context-state')).includes('正在核对'));h.update({worker:true});await h.flush();assert(dependent(h).some(call=>call.method==='task.deployment.context'));assert(dependent(h).some(call=>call.method==='task.linkRun'));assert.equal(h.find(node=>node.props?.['data-testid']==='prepare-deployment').props.disabled,false);assert(!h.calls.some(call=>call.method==='task.execute'));h.unmount();
});
test('Deployment late old context failure cannot replace the new verified scope after a worker gate transition',async()=>{
 const pending=deferred();let contexts=0;const h=deploymentHarness({override:(method,data,standard)=>method==='task.deployment.context'&&++contexts===1?pending.promise:standard(method,data)});await h.flush();h.update({worker:false,restoring:true});await h.flush();h.update({worker:true,restoring:false});await h.flush();pending.reject(Error('Old controller unavailable'));await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='prepare-deployment').props.disabled,false);assert.equal(h.externalErrors.length,0);assert.equal(h.calls.filter(call=>call.method==='task.deployment.context').length,2);h.unmount();
});
});

await __describe("field-presentation", async () => {
const test = __node_test;
test('Required science precedes optional details, with typed traceable defaults',()=>{
 const fields=[{key:'metad.seed',label:'Seed',type:'integer',required:false,advanced:true,default:0,default_source:'registered engine config'},{key:'metad.height',label:'Height',type:'number',required:true},{key:'metad.cv_definition',label:'CV',type:'text',required:true},{key:'metad.sigma',label:'Sigma',type:'number',required:true}];
 fields.forEach(validField);const groups=partitionFields(fields);assert.deepEqual(groups.primary.map(f=>f.key),['metad.cv_definition','metad.sigma','metad.height']);assert.equal(groups.advanced[0].key,'metad.seed');assert.equal(fieldMissing({...fields[0],required:true},{}),true);assert.throws(()=>validField({...fields[0],default_source:''}));assert.throws(()=>validField({...fields[0],default:1.5}));assert.throws(()=>validField({...fields[0],advanced:'yes'}));assert.throws(()=>validField({...fields[0],default:Infinity}));
 const p={metad:{cv_definition:'known',sigma:.1,height:.01}};assert.deepEqual(workflowMissing([{id:'m',title:'MetaD',fields}],p,[]),[]);assert.equal(p.metad.seed,undefined);
});

test('Required scientific lists reject nested empty values and non-finite numbers while false/zero remain supplied',()=>{
 const field={key:'values',label:'Values',type:'list',required:true};
 for(const values of [[[1,null,3]],[[1,undefined,3]],[[1,'',3]],[[1,NaN,3]],[[1,Infinity,3]],[[]],[]])assert.equal(fieldMissing(field,{values}),true);
 const valid=[[0,1,2],[false,true,false],{label:null}];assert.equal(fieldMissing(field,{values:valid}),false);assert.equal(valid[0][0],0);assert.equal(valid[1][0],false);assert.equal(Array.isArray(valid[0]),true);assert.equal(fieldMissing({...field,required:false},{values:[]}),false);
 const steps=[{id:'inputs',title:'Inputs',fields:[field]}];assert.deepEqual(workflowMissing(steps,{values:[[1,null,3]]},[]),['values']);assert.deepEqual(workflowMissing(steps,{values:[[1,0,3],false]},[]),[]);
});
});

await __describe("jobs-experience", async () => {
const test = __node_test;
const code=ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/runs/JobsPage.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(initial={}){
 const now=Date.now()/1000,states=[],actions=[];let cursor=0,tree;let props={local:[{id:'local-running',name:'Older local run',project_id:'other',status:'running',engine:'pydyn.md',created_at:now-60*86400},{id:'local-done',name:'Finished local run',project_id:'current',status:'succeeded',engine:'pydyn.md',created_at:now}],cluster:[{id:'cluster-queued',name:'Cluster waiting',project_id:'current',status:'queued',engine:'gpumd.md',created_at:now},{id:'cluster-unknown',name:'Unconfirmed cluster run',project_id:'current',status:'unknown',engine:'gpumd.md',created_at:now}],observations:{local:{at:now,loaded:true,stale:false},cluster:{at:now,loaded:true,stale:true}},projects:[{id:'current',name:'Current project'},{id:'other',name:'Other project'}],projectId:'current',tasks:[],conversations:[],worker:true,busy:false,onRefresh:()=>actions.push('refresh'),onOpen:job=>actions.push(['open',job.key]),onConversation:conversation=>actions.push(['conversation',conversation.id]),...initial};
 const jsx=(type,props)=>({type,props}),module={exports:{}},require=name=>fixtureControlModule(name)??(name==='react'?{useState:initial=>{const i=cursor++;states[i]??={value:typeof initial==='function'?initial():initial};return [states[i].value,value=>{states[i].value=typeof value==='function'?value(states[i].value):value;}];}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='../../app/workspace-shell.mjs'?shell:name==='../../ui/i18n'?{t:value=>value}:name==='../../ui/Dialogs'?{Badge:'Badge',statusNames:{running:'运行中',queued:'排队中',unknown:'待核对',succeeded:'已完成'}}:new Proxy({default:name},{get:(object,key)=>object[key]??key}));
 new Function('require','module','exports',code)(require,module,module.exports);
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 function render(next){if(next)props={...props,...next};cursor=0;tree=module.exports.default(props);}
 const find=fn=>{const found=all(tree).find(fn);assert(found,'fixture target exists');return found;};
 const select=label=>find(node=>node.props?.['aria-label']===label);
 const change=(label,value)=>{select(label).props.onChange({target:{value}});render();};
 const byId=id=>find(node=>node.props?.['data-testid']===id);
 const click=(id,event)=>{byId(id).props.onClick(event);render();};
 render();return {render,find,select,change,byId,click,actions,text:()=>text(tree),nodeText:text,rows:()=>all(tree).filter(node=>node.props?.className==='job-record'),props};
}
test('status cards preserve location, time, text and project filters, including an empty intersection',()=>{
 const h=harness();h.change('计算位置筛选','cluster');h.change('任务时间筛选','1');h.change('搜索任务','Cluster');h.change('任务项目筛选','current');h.click('jobs-overview-running');assert.equal(h.select('计算位置筛选').props.value,'cluster');assert.equal(h.select('任务时间筛选').props.value,'1');assert.equal(h.select('搜索任务').props.value,'Cluster');assert.equal(h.select('任务项目筛选').props.value,'current');assert.equal(h.select('任务状态筛选').props.value,'running');assert.equal(h.rows().length,0);assert.equal(h.byId('jobs-overview-running').props['aria-pressed'],true);h.click('jobs-overview-queued');assert.deepEqual(h.rows().map(node=>node.props['data-job-key']),['cluster:cluster-queued']);assert.deepEqual(h.actions,[]);
});
test('empty-result reset restores all read records and unknown remains an observed status',()=>{
 const h=harness();h.change('搜索任务','no match');assert.match(h.nodeText(h.byId('jobs-empty')),/没有匹配/);assert.match(h.nodeText(h.byId('jobs-filter-summary')),/no match/);h.find(node=>node.type==='button'&&h.nodeText(node)==='清除筛选，查看全部记录').props.onClick();h.render();assert.equal(h.rows().length,4);assert.match(h.nodeText(h.byId('jobs-filter-summary')),/未设置筛选/);h.click('jobs-overview-unknown');assert.deepEqual(h.rows().map(node=>node.props['data-job-key']),['cluster:cluster-unknown']);assert.match(h.text(),/上次记录 · 请核对原作业/);assert.equal(h.props.cluster[1].status,'unknown');assert.deepEqual(h.actions,[]);
});
test('unread selected source is distinguished from an empty filtered result and counts stay unknown',()=>{
 const h=harness({cluster:[],observations:{local:{at:123,loaded:true,stale:false},cluster:{at:null,loaded:false,stale:false}}});h.change('计算位置筛选','cluster');assert.match(h.nodeText(h.byId('jobs-empty')),/记录尚未读取完整/);assert.match(h.nodeText(h.byId('jobs-empty')),/所选来源尚未读取成功/);assert.match(h.nodeText(h.byId('jobs-overview-running')),/—/);assert.deepEqual(h.actions,[]);
});
test('planning overview expands seven collapsed flows, scrolls and focuses their summary',()=>{
 const tasks=Array.from({length:7},(_,i)=>({id:'task-'+i,name:'Planning '+i})),conversations=tasks.map(task=>({id:'conversation-'+task.id,taskId:task.id})),h=harness({tasks,conversations});const details=()=>h.find(node=>node.type==='details'&&node.props.id==='planning-overview');assert.equal(details().props.open,false);const events=[],panel={open:false,querySelector:()=>({scrollIntoView:options=>events.push(['scroll',options]),focus:options=>events.push(['focus',options])})};h.click('jobs-overview-planning',{currentTarget:{closest:()=>({querySelector:()=>panel})}});assert.equal(details().props.open,true);assert.equal(panel.open,true);assert.deepEqual(events,[['scroll',{block:'start'}],['focus',{preventScroll:true}]]);details().props.onToggle({currentTarget:{open:false}});h.render();assert.equal(details().props.open,false);h.change('搜索任务','other');assert.equal(details().props.open,false,'manual collapse survives unrelated filtering');assert.deepEqual(h.actions,[]);
});
test('planning navigation remains disabled while busy or when no conversation is bound',()=>{
 const h=harness({tasks:[{id:'task-a',name:'Plan A'},{id:'task-b',name:'Plan B'}],conversations:[{id:'conversation-a',taskId:'task-a'}],busy:true});const buttons=()=>['Plan A','Plan B'].map(label=>h.find(node=>node.type==='button'&&h.nodeText(node).startsWith(label)));assert(buttons().every(button=>button.props.disabled));h.render({busy:false});assert.equal(buttons()[0].props.disabled,false);assert.equal(buttons()[1].props.disabled,true);buttons()[0].props.onClick();assert.deepEqual(h.actions,[['conversation','conversation-a']]);
});
test('disconnected saved records remain visible but cannot issue an open request',()=>{
 const h=harness({worker:false});assert.equal(h.rows().length,4);assert.match(h.text(),/请先恢复原服务/);const button=h.find(node=>node.props?.className==='job-record-open');assert(button.props.disabled);button.props.onClick();assert.deepEqual(h.actions,[]);h.render({worker:true});const restored=h.find(node=>node.props?.className==='job-record-open');assert.equal(restored.props.disabled,false);restored.props.onClick();assert.equal(h.actions[0][0],'open');
});
});

await __describe("jobs-tooltip", async () => {
const test = __node_test;
test('Jobs sync tooltip uses the actual button while offline/paused observations and timestamps remain visible',()=>{
 const jsx=(type,props)=>({type,props});const module={exports:{}};
 const require=name=>fixtureControlModule(name)??(name==='react'?{useState:value=>[value,()=>{}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==="../../app/workspace-shell.mjs"?shell:name==="../../ui/i18n"?{t:x=>x}:name==="../../ui/Tooltip"?{default:'Tooltip'}:new Proxy({},{get:(_t,k)=>String(k)}));
 const code=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/runs/JobsPage.tsx",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(require,module,module.exports);
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 let refreshes=0;
 for(const connected of [false,true]){
  const tree=module.exports.default({local:[],cluster:[],observations:{local:{loaded:true,stale:true,paused:true,at:123},cluster:{loaded:false,stale:false,at:null}},projects:[],projectId:'',tasks:[],conversations:[],worker:connected,busy:false,onRefresh:()=>refreshes++,onOpen(){},onConversation(){}});
  const nodes=all(tree),tooltip=nodes.find(n=>n.type==='Tooltip');assert.equal(tooltip.props.asChild,true);
  const button=tooltip.props.children;assert.equal(button.type,'button');assert.equal(button.props.disabled,!connected);if(connected)button.props.onClick();
  assert.equal(nodes.filter(n=>n.type==='button'&&text(n)==='同步记录').length,1);assert(!nodes.some(n=>n.props?.className==='jobs-scope'));
  const observation=nodes.find(n=>n.props?.['data-testid']==='job-observation-local');assert.match(text(observation),/自动同步已暂停/);assert.match(text(observation),/记录读取时间/);
 }
 assert.equal(refreshes,1);
});
});

await __describe("known-run-reconcile", async () => {
const test = __node_test;
const task=()=>({id:'task',provider:'codex',threadId:'thread',projectId:'project',workflowVersion:2,parameterRevision:5,authoring:{projectId:'author',environmentId:'env',inputRoot:'/owned'},execution:{artifactId:'run',phase:'confirmed',status:'queued'},artifacts:[{id:'old',kind:'run'},{id:'run',kind:'run'}],deployment:{revision:3,config:{target:'local'},prepared:{artifactId:'run',parameterRevision:4,deploymentRevision:3}}});
test('confirmed queued uses exact existing prepared identity without unconfirmed warning',()=>{assert.deepEqual(pick(task()),{request:{taskId:'task',runId:'run',kind:'run',expectedPrepared:{artifactId:'run',parameterRevision:4,deploymentRevision:3}},uncertain:false});});
test('running cluster execution follows its linked artifact rather than last historical run',()=>{const t=task();t.execution.status='running';t.artifacts=[{id:'run',kind:'cluster-run'},{id:'unrelated',kind:'run'}];assert.equal(pick(t).request.kind,'cluster-run');assert.equal(pick(t).request.runId,'run');});
test('uncertain validating submitting and unknown only reconcile the existing id',()=>{for(const phase of ['validating','submitting','unknown']){const t=task();t.execution.phase=phase;t.execution.status='unknown';assert.equal(pick(t).uncertain,true);assert.equal(pick(t).request.runId,'run');}});
test('terminal succeeded failed cancelled statuses never add a reconcile button',()=>{for(const status of ['succeeded','failed','cancelled']){const t=task();t.execution.status=status;t.execution.phase='unknown';assert.equal(pick(t),null);}});
test('no or ambiguous linked artifact cannot create an actionable dead button',()=>{for(const artifacts of [[],[{id:'other',kind:'run'}],[{id:'run',kind:'cluster-setup'}],[{id:'run',kind:'run'},{id:'run',kind:'run'}]]){const t=task();t.artifacts=artifacts;assert.equal(pick(t),null);}const t=task();delete t.execution.artifactId;assert.equal(pick(t),null);});
test('v2 missing changed or malformed prepared anchors stay closed',()=>{for(const patch of [{prepared:null},{prepared:{artifactId:'different',parameterRevision:4,deploymentRevision:3}},{prepared:{artifactId:'run',parameterRevision:4,deploymentRevision:2}},{prepared:{artifactId:'run',parameterRevision:1.5,deploymentRevision:3}}]){const t=task();Object.assign(t.deployment,patch);assert.equal(pick(t),null);}});
test('legacy workflow reconciles its linked existing run without inventing prepared data',()=>{const t=task();t.workflowVersion=1;delete t.deployment;assert.deepEqual(pick(t).request,{taskId:'task',runId:'run',kind:'run'});});
test('scope changes on worker or trusted ownership/revision/context, not queued-to-running status',()=>{const t=task(),s=scope(t,true);assert.notEqual(scope(t,false),s);for(const key of ['id','provider','threadId','projectId','parameterRevision']){const a=structuredClone(t);a[key]=String(a[key])+'-changed';assert.notEqual(scope(a,true),s);}const a=structuredClone(t);a.authoring.inputRoot='/other';assert.notEqual(scope(a,true),s);a.authoring=t.authoring;a.deployment.config.target='cluster';assert.notEqual(scope(a,true),s);const b=structuredClone(t);b.execution.status='running';assert.equal(scope(b,true),s);});
test('selection and scope are pure and do not modify historical artifacts or authority',()=>{const t=task(),before=JSON.stringify(t);pick(t);scope(t,true);assert.equal(JSON.stringify(t),before);});
});

await __describe("parameter-notes", async () => {
const test = __node_test;
const fields={...fieldsOwner0,...fieldsOwner1,...fieldsOwner2};


const read=n=>fs.readFileSync(frontendSource(n),'utf8');
function panel(parameters,manualEdits,field={key:'validation.fd_step',label:'有限差分 fd_step（留空；可点击默认值）',type:'number',unit:'A',required:true,default:1e-5,default_source:'软件契约 / schema=1；当前未赋值',description:'范围0 < h < 0.01；keep scientific (meaning) 原文'}){
 const calls=[],ipc=[],module={exports:{}},jsx=(type,props)=>({type,props});
 let nextId=0;const hooks={useState:v=>[v,()=>{}],useRef:v=>({current:v}),useId:()=>String(++nextId),useLayoutEffect(){},useCallback:fn=>fn};
 const load=frontendComponentLoader({'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'./Tooltip':{default:({children})=>children}});
 const require=n=>['./Button','./Field','./Disclosure'].includes(n)?load('frontend/ui/'+n.slice(2)+'.tsx'):n==='react'?hooks:n==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:["./task-fields.mjs","../../contracts/workflows/task-fields.mjs","./workflow-intent.mjs","../../../contracts/workflows/task-fields.mjs","../../ui/task-fields.mjs"].includes(n)?fields:["./parameter-label.mjs","../../ui/parameter-label.mjs"].includes(n)?{parameterDisplayLabel}:["./i18n","../../ui/i18n"].includes(n)?{t:x=>x}:["../api/studio","./presentation/paths","../../api/studio","../../api/worker"].includes(n)?{invoke:()=>ipc.push('unexpected'),wslPath:x=>x}:new Proxy({},{get:(_t,k)=>String(k)});
 new Function('require','module','exports',ts.transpileModule(read('ParameterFields.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(require,module,module.exports);
 const expand=n=>Array.isArray(n)?n.map(expand):n&&typeof n==='object'?typeof n.type==='function'?expand(n.type(n.props)):{...n,props:{...n.props,children:expand(n.props?.children)}}:n;
 const tree=expand(module.exports.ParameterFields({fields:[field],parameters,manualEdits,onChange:(...args)=>calls.push(args),onError:assert.fail}));
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];const nodes=all(tree);const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 return{field,tree,nodes,calls,ipc,text};
}
test('legacy unset notes remain exact but secondary while current edited value/default state is computed',()=>{
 const parameters={validation:{fd_step:1e-5}},before=structuredClone(parameters),p=panel(parameters,{'validation.fd_step':2});const label=p.nodes.find(n=>n.type==='label');assert.match(p.text(label),/validation.fd_step/);assert.doesNotMatch(p.text(label),/留空/);assert.equal(p.nodes.find(n=>n.type==='input').props.value,1e-5);assert(!p.nodes.some(n=>n.type==='button'&&p.text(n)==='使用默认值'));
 const notes=p.nodes.find(n=>n.type==='details'&&n.props.className.includes('parameter-notes'));assert(notes);assert.notEqual(notes.props.open,true);assert.equal(p.text(notes).includes(p.field.label),true);assert.equal(p.text(p.nodes.find(n=>n.props?.className==='aml-field-description')).includes(p.field.description),true);assert.equal(p.text(p.nodes.find(n=>n.props?.className==='aml-field-default')).includes(p.field.default_source),true);assert.deepEqual(parameters,before);assert.deepEqual(p.ipc,[]);
});
test('missing default action retains exact onChange contract and no-metadata consumers keep readable labels',()=>{
 const parameters={validation:{fd_step:null}},p=panel(parameters,undefined),label=p.nodes.find(n=>n.type==='label');assert(p.text(label).includes(p.field.label));p.nodes.find(n=>n.type==='button'&&p.text(n)==='使用默认值').props.onClick();assert.deepEqual(p.calls,[['validation.fd_step',1e-5]]);assert.equal(parameters.validation.fd_step,null);assert.deepEqual(p.ipc,[]);
 const optional=panel({},undefined,{...p.field,required:false});assert.equal(optional.nodes.find(n=>n.type==='input').props.value,1e-5);assert(!optional.nodes.some(n=>n.type==='button'&&optional.text(n)==='使用默认值'));
});
test('file controls, required marker and arbitrary multilingual original labels remain intact',()=>{
 const field={key:'model_file',label:'模型 (原始) Δ / file',type:'file',required:true,description:'物理说明 αβ — do not rewrite'};const p=panel({model_file:'/owned/model.xyz'},{model_file:3},field);assert(p.nodes.some(n=>n.type==='button'&&p.text(n)==='更换文件'));assert(p.nodes.some(n=>n.props?.className==='aml-field-required'));assert(p.text(p.nodes.find(n=>n.props?.className==='aml-field-description')).includes(field.description));assert.equal(parameterDisplayLabel(field,{unrelated:3}),field.label);assert.equal(parameterDisplayLabel(field,{model_file:3}),'model_file');
});
test('actual task step explanation is closed recorded prose, not an inferred version or current state',()=>{
 const source=read('AgentTaskPage.tsx'),ast=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let node;function walk(n){if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='className'&&a.initializer?.text==='workflow-planning-notes'))node=n;ts.forEachChild(n,walk);}walk(ast);assert(node,'recorded planning details required');const step={description:'当前未赋值 / unset；保持科学文义 E = hν (原文)'};const code=ts.transpileModule('return ('+node.getText(ast)+');',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;const element=new Function('React','step','t','Disclosure',code)(React,step,x=>x,frontendComponentLoader()('frontend/ui/Disclosure.tsx').default);const html=renderToStaticMarkup(element);assert.match(html,/<details/);assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,/规划说明/);assert.equal(element.props.children.props.children,step.description);assert.doesNotMatch(html,/v1|v2|过期/);
});
});

await __describe("task-step-search", async () => {
const test = __node_test;
const field=(key,type='file',required=true)=>({key,label:'Input asset',type,required});
const parameters={md:{script:'/owned/project/run.in',structure:'C:\\owned\\MODEL.XYZ'},training:{files:[' /owned/train.xyz ','C:\\owned\\Validation Data.XYZ','third.xyz']},empty:null,notes:'secret source run.in',matrix:[[1,2],[3,4]]};
const steps=normalizeSteps([{id:'md',title:'MD setup',tool:'configure_md',fields:[field('md.script'),field('md.structure')]},{id:'training',title:'Training inputs',fields:[field('training.files','files')]},{id:'missing',title:'Incomplete input',fields:[field('empty')]},{id:'private',title:'Definition',fields:[field('notes','multiline'),field('matrix','list')]}],parameters);
for(const [query,ids]of [['run.in',['md']],['MODEL.xyz',['md']],['  RUN.IN  ',['md']],['validation   data.xyz',['training']],['third.xyz',['training']],['train.xyz',['training']],['configure_MD',['md']],['MD setup',['md']],['Input asset',['md','training','missing','private']],['md.script',['md']],['   ',['md','training','missing','private']],['owned',[]],['secret source',[]]])test('current controlled step matching: '+JSON.stringify(query),()=>{assert.deepEqual(steps.filter(step=>stepMatchesQuery(step,parameters,query)).map(step=>step.id),ids);});
test('current edited controlled value replaces the stale persisted filename',()=>{const changed={...parameters,md:{...parameters.md,script:'/owned/project/new.in'}};assert(!stepMatchesQuery(steps[0],changed,'run.in'));assert(stepMatchesQuery(steps[0],changed,'new.in'));});
test('file lists include every basename without mixing another step or the global file set',()=>{const task={...parameters,files:['/elsewhere/run.in']};assert(!stepMatchesQuery(steps[1],task,'run.in'));assert(!stepMatchesQuery(steps[2],task,'run.in'));assert(stepMatchesQuery(steps[1],task,'third.xyz'));});
test('non-file values are never traversed or stringified',()=>{const guarded={toString(){throw Error('Private object was stringified');}};const values={notes:guarded,matrix:new Proxy([],{get(){throw Error('Matrix traversed');}}),files:[null,guarded,42,'/safe/run.in']};const step={title:'Safe step',fields:[field('notes','object'),field('matrix','list'),field('files','files')]};assert(stepMatchesQuery(step,values,'run.in'));assert(!stepMatchesQuery(step,values,'private'));});
test('legacy absolute-path list fields normalized to files retain searchable owned basenames',()=>{const values={inputs:['/owned/a.xyz','C:\\owned\\b.xyz']},[step]=normalizeSteps([{id:'inputs',title:'Inputs',fields:[field('inputs','list')]}],values);assert.equal(step.fields[0].type,'files');assert(stepMatchesQuery(step,values,'b.xyz'));});

const source=fs.readFileSync(process.env.STUDIO_STEP_SEARCH_SOURCE||new URL("../../frontend/features/workflows/AgentTaskPage.tsx",import.meta.url),'utf8'),ast=ts.createSourceFile('AgentTaskPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression,summary;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='visibleSteps')expression=node.initializer.getText(ast);if(ts.isFunctionDeclaration(node)&&node.name?.text==='fieldSummary')summary=node.getText(ast);node.forEachChild(visit);}visit(ast);assert(expression);assert(summary);
const filter=new Function('steps','parameters','query','onlyMissing','fieldMissing','stepMatchesQuery','return '+expression);
test('actual AgentTaskPage filter finds the filename on only its owning step',()=>{assert.deepEqual(filter(steps,parameters,'run.in',false,fieldMissing,stepMatchesQuery).map(step=>step.id),['md']);});
test('actual AgentTaskPage onlyMissing still intersects filename search and preserves stable step identity',()=>{assert.deepEqual(filter(steps,parameters,'run.in',true,fieldMissing,stepMatchesQuery),[]);assert.deepEqual(filter(steps,parameters,'',true,fieldMissing,stepMatchesQuery).map(step=>step.id),['missing']);assert.deepEqual(filter(steps,parameters,'empty',true,fieldMissing,stepMatchesQuery).map(step=>step.id),['missing']);});
test('existing concise basename summaries remain unchanged',()=>{const code=ts.transpileModule(summary,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const render=new Function('parameterValue','parameters','t',code+';return fieldSummary;')((p,key)=>key.split('.').reduce((v,k)=>v?.[k],p),parameters,value=>value);assert.equal(render(field('md.script')),'run.in');assert.equal(render(field('md.structure')),'MODEL.XYZ');assert.equal(render(field('training.files','files')),'3 个文件 · train.xyz , Validation Data.XYZ…');});
});

await __describe("workflow-entry-summary", async () => {
const test = __node_test;
test('summary prioritizes already recorded structure, elements, atom count, potential and sampling fields',()=>{
 const parameters={engine:'gpumd.sampling',seed:15,structure:{file:'/fixture/atoms.xyz',elements:['Cu','Ni'],atom_count:128},potential:{file:'/fixture/nep.txt'},dynamics:{temperature_K:300}};
 const steps=normalizeSteps([{id:'other',title:'Earlier controls',fields:[{key:'engine',label:'Engine',type:'text',required:true},{key:'seed',label:'Seed',type:'integer',required:true}]}],parameters);
 const before=structuredClone(parameters),selected=keyWorkflowFields(steps,parameters);
 assert.deepEqual(selected.map(item=>item.field.key),['structure.file','structure.elements','structure.atom_count','potential.file','dynamics.temperature_K']);
 assert.deepEqual(parameters,before);
 const uninspected={structure_file:'/owned/Cu128.xyz',atom_selection:[0,1,2]};
 const keys=keyWorkflowFields(normalizeSteps([],uninspected),uninspected).map(item=>item.field.key);
 assert(!keys.some(key=>/elements|symbols|atom_count/.test(key)));
});

test('missing links target only real normalized fields and keep required object drafts separate from review notes',()=>{
 const parameters={temperature:310},requirements=['Queue owner needs to confirm the target'];
 const steps=normalizeSteps([{id:'a',title:'Existing workflow',fields:[{key:'advanced.engine_config',label:'Native options',type:'object',required:true,advanced:true},{key:'temperature',label:'Temperature',type:'number',required:true},{key:'structure_file',label:'Structure',type:'file',required:true}]}],parameters,requirements);
 const targets=workflowMissingTargets(steps,parameters);
 assert.deepEqual(targets.map(({step,field})=>[step.id,field.key]),[['a','structure_file'],['a','advanced.engine_config']]);
 assert(!targets.some(({field})=>requirements.includes(field.key)));
});

test('goal labels only come from saved output references and preserve inference status',()=>{
 const roadmap={outputs:['traj','report','unlisted'],resources:[{id:'structure',label:'Input only'},{id:'traj',label:'Sampled trajectory',basis:'user'},{id:'report',label:'Temperature report',basis:'inferred'}]};
 assert.deepEqual(workflowOutputLabels(roadmap),[{id:'traj',label:'Sampled trajectory',inferred:false},{id:'report',label:'Temperature report',inferred:true}]);
 assert.deepEqual(workflowOutputLabels(undefined),[]);
});
});

await __describe("workflows", async () => {
const test = __node_test;
test('Every task step resolves a declared tool and core unavailable capabilities remain explicit',()=>{
 for(const task of tasks){assert.equal(new Set(task.steps.map(s=>s.id)).size,task.steps.length);for(const step of task.steps)assert(tools.find(t=>t.id===step.tool));for(const tool of task.tools)assert(tools.find(t=>t.id===tool));}
 assert(!tasks.find(t=>t.id==='neb').steps.some(s=>s.required&&s.planned));
 assert(tools.find(t=>t.id==='md').engines.includes('gpumd.neb'));
 assert.match(planPrompt(createPlan('neb')),/gpumd.neb/);
 assert(tasks.find(t=>t.id==='learning').steps.find(s=>s.id==='dft').planned);
 assert.equal(tools.find(t=>t.id==='activelearning').status,'planned');
});
test('Core steps cannot be skipped; optional steps and user inputs round-trip independently',()=>{
 const plan=createPlan('sampling');assert(!plan.steps.find(s=>s.id==='learning').enabled);
 plan.steps.find(s=>s.id==='structure').source='user';plan.steps.find(s=>s.id==='structure').value='/data/initial.xyz';
 assert.deepEqual(validatePlan(plan),plan);
 const corrupted=structuredClone(plan);corrupted.steps.find(s=>s.id==='md').enabled=false;assert.throws(()=>validatePlan(corrupted));
 const duplicate=structuredClone(plan);duplicate.steps[0]=duplicate.steps[1];assert.throws(()=>validatePlan(duplicate));
 assert.throws(()=>validatePlan({...plan,steps:[...plan.steps,{id:'submit-shell',enabled:true,source:'agent',value:'x'}]}));
});
test('Plan prompts retain human inputs, unavailable tools and the review gate without asserting job status',()=>{
 const plan=createPlan('sampling');plan.steps.find(s=>s.id==='model').source='user';plan.steps.find(s=>s.id==='model').value='asset-verified-model';
 plan.steps.find(s=>s.id==='learning').enabled=true;
 const prompt=planPrompt({...plan,id:'workflow-fixture'});assert.match(prompt,/asset-verified-model/);assert.match(prompt,/workflow-fixture/);assert.match(prompt,/blocked/);assert.match(prompt,/停止等待/);
 assert.equal('status' in validatePlan({...plan,status:'succeeded'}),false);
 assert.throws(()=>createPlan('unknown'));
});

test('Hamiltonian entry is discoverable but exposes no backend execution action',()=>{
 const entry=tools.find(tool=>tool.id==='hamiltonian');assert.equal(entry.name,'机器学习哈密顿量');assert.equal(entry.status,'planned');assert.deepEqual(entry.engines,[]);assert.equal(entry.page,entry.id);assert.match(entry.description,/后端待接入/);
});
});
