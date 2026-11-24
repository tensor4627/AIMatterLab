import __node_test, {describe as __describe} from 'node:test';
import {frontendSource} from "../helpers/frontend-source-paths.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import {renderToStaticMarkup as render} from "react-dom/server";
import {createRequire} from "node:module";
import {workspacePresentation} from "../../frontend/features/workflows/workspace-presentation.mjs";
import {localBuildReviewEligibility} from "../../frontend/features/workflows/local-build-review-eligibility.mjs";
import path from "node:path";
import {parseChartData} from "../../frontend/ui/chart-data.mjs";
import {experienceHarness, deferred as _imp_0_deferred} from "../helpers/settings-experience-hooks.mjs";
import {assetHarness, deferred as _imp_1_deferred} from "../helpers/asset-hooks.mjs";
import {ObservedRead} from "../../frontend/api/observed-read.mjs";
import {followedProjectId} from "../../frontend/app/project-follow.mjs";
import {newProjectDefaults, suggestedProjectEnvironment, scopedSuggestedInputRoot} from "../../frontend/features/compute/project-setup-defaults.mjs";
import {workspaceModule} from "../../frontend/app/workspace-navigation.mjs";
import os from "node:os";
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {settingsPageHarness as _imp_2_harness} from "../helpers/settings-page-hooks.mjs";
import * as diagnostics from "../../frontend/features/diagnostics/ui-diagnostics.mjs";
import {diagnosticComponents} from "../helpers/diagnostic-components.mjs";

await __describe("bugfix-render", async () => {
const test = __node_test;
const require=createRequire(import.meta.url),read=(name)=>fs.readFileSync(frontendSource(name),'utf8');
const storage={getItem:()=>null,setItem:()=>{}},i18n={exports:{}};new Function('module','exports','localStorage',ts.transpileModule(read('i18n.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(i18n,i18n.exports,storage);
const mod={exports:{}},requests=[];const imports={'react':React,'react/jsx-runtime':jsx,'lucide-react':icons,"../../api/studio":{invoke:()=>{requests.push('unexpected');throw Error('SSR must not invoke IPC');}},"../../api/worker":{invoke:()=>{requests.push('unexpected');throw Error('SSR must not invoke IPC');}},"../../ui/i18n":i18n.exports,"./workspace-presentation.mjs":{workspacePresentation}};
const tooltip={exports:{}};new Function('require','module','exports',ts.transpileModule(read('Tooltip.tsx'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id==='./i18n'?i18n.exports:imports[id]??require(id),tooltip,tooltip.exports);imports["../../ui/Tooltip"]=tooltip.exports;
// Keep the real nested workflow UI in SSR; effects must still perform zero IPC.
const frontendModules=new Map();function frontendModule(file){
 if(file===path.resolve('frontend/ui/i18n.ts'))return i18n.exports;if(frontendModules.has(file))return frontendModules.get(file).exports;const module={exports:{}};frontendModules.set(file,module);
 const resolve=name=>{if(name.endsWith('.css'))return {};if(!name.startsWith('.'))return imports[name]??require(name);const target=path.resolve(path.dirname(file),name),found=['.ts','.tsx'].map(extension=>target+extension).find(candidate=>fs.existsSync(candidate));if(!found)throw Error('Unresolved SSR frontend import '+name);return frontendModule(found);};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(resolve,module,module.exports);return module.exports;
}imports["./ToolWorkflowsPanel"]=frontendModule(path.resolve('frontend/features/workflows/ToolWorkflowsPanel.tsx'));
new Function('require','module','exports',ts.transpileModule(read('WorkspacePanel.tsx'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>imports[id]??require(id),mod,mod.exports);
const Panel=mod.exports.default,base={id:'test-task',provider:'codex',threadId:'thread',parameters:{files:[]},workspaceChoice:'draft',authoring:{workspacePending:false,inputRoot:'/saved',imports:[{path:'/saved/input',sha256:'a'.repeat(64),status:'passed'}],pendingInputs:[]}};const panel=task=>render(React.createElement(Panel,{task,worker:false,busy:false,onRefresh:()=>{},onError:()=>{}}));
test('full WorkspacePanel renders saved settled choice and collapsed import detail',()=>{const html=panel(base);assert.match(html,/已选择：草稿目录/);assert.match(html,/<details data-testid="workspace-saved-imports">/);assert.doesNotMatch(html,/<details[^>]*open[^>]*data-testid="workspace-saved-imports"/);assert.match(html,/已记录导入成功/);assert.deepEqual(requests,[]);});
test('full WorkspacePanel partial failure and pending do not claim settled; pending list appears once',()=>{assert.match(panel({...base,authoring:{...base.authoring,workspacePending:true}}),/工作区选择尚未确认/);const html=panel({...base,workspaceChoice:'pending',authoring:{workspacePending:true,pendingInputs:['/pending/input.xyz']}});assert.match(html,/工作区尚未选择/);assert.equal((html.match(/等待导入的当前输入/g)||[]).length,1);assert.equal((html.match(/input.xyz/g)||[]).length,2);assert.doesNotMatch(html,/workspace-saved-imports/);});
function find(node,predicate){if(predicate(node))return node;let result;node.forEachChild(child=>{if(!result)result=find(child,predicate);});return result;}
function byClass(file,name){return find(file,node=>ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==='className'&&a.initializer?.text===name));}
function jsxRender(node,file,bindings){const code=ts.transpileModule('return ('+node.getText(file)+');',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return render(new Function('React','t',...Object.keys(bindings),code)(React,i18n.exports.t,...Object.values(bindings)));}
const opesSource=fs.readFileSync(new URL("../../frontend/features/workflows/AgentTaskPage.tsx",import.meta.url),'utf8'),op=ts.createSourceFile('AgentTaskPage.tsx',opesSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),entry=byClass(op,'local-review-entry');
function localEntry(mode,ownerMatches=true){return jsxRender(entry,op,{localBuildReview:localBuildReviewEligibility('pygas.build',ownerMatches?mode:undefined),compositionBlocked:false,stageUnsaved:false,busy:false,state:{locked:false},saving:false,saveError:false,missing:[],setLocalReviewOpen:()=>{},localReady:false});}
test('actual OPES entry JSX disables unsupported and stale owner; metad/cvonly enable',()=>{assert.match(localEntry('opes'),/disabled=""/);for(const mode of ['metad','cvonly'])assert.doesNotMatch(localEntry(mode),/disabled=/);assert.match(localEntry('metad',false),/disabled=""/);assert.match(localEntry('opes'),/AI 复核/);});
const page=ts.createSourceFile('AgentTaskPage.tsx',read('AgentTaskPage.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),requirements=byClass(page,'workflow-requirements');
test('actual requirement JSX keeps original compound question and neutral provenance',()=>{const question='请选择工作区；构建源码仍未保存';const html=jsxRender(requirements,page,{requirements:[question]});assert.match(html,/Agent 记录的待确认事项/);assert.ok(html.includes(question));assert.doesNotMatch(html,/上轮|尚未按本次/);});
const dialogNode=find(op,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(op)==='LocalInputReview');const dialogExpression=dialogNode.parent;
function inspect(mode,ownerMatches=true){return jsxRender(dialogExpression,op,{localReviewOpen:true,localBuildReview:localBuildReviewEligibility('pygas.build',ownerMatches?mode:undefined),LocalInputReview:()=>React.createElement('button',null,'Inspect'),task:{id:'same'},worker:true,compositionUnsaved:false,stageUnsaved:false,saving:false,saveError:false,localReviewApi:{},setLocalReviewOpen:()=>{},pageRef:{current:null},onRefresh:async()=>{},setLocalReviewNonce:()=>{}});}
test('actual open-dialog JSX loses Inspect after mode/owner eligibility changes',()=>{assert.match(inspect('metad'),/Inspect/);assert.match(inspect('cvonly'),/Inspect/);assert.equal(inspect('opes'),'');assert.equal(inspect('metad',false),'');});
});

await __describe("chart-data", async () => {
const test = __node_test;
test('native mixed wallclock table retains Step/Temp columns, names and source rows',()=>{const text='Time Step Temp\n'+Array.from({length:9},(_,i)=>'12:00:00 '+(i+1)+' 3.000000e+02').join('\n'),r=parseChartData(text,'thermo.out');assert(r.hasData);assert.equal(r.xColumn,1);assert.equal(r.xLabel,'Step');assert.deepEqual(r.ignoredColumns,[{index:0,name:'Time'}]);assert.equal(r.series[0].column,2);assert.equal(r.series[0].name,'Temp');assert.deepEqual(r.series[0].points,Array.from({length:9},(_,i)=>({x:i+1,y:300,rowIndex:i,sourceLine:i+2})));});
test('ordinary numeric GPUMD values and column indices are unchanged',()=>{const r=parseChartData('0 -123.5 300\n0.1 -123.6 301','thermo.out');assert.equal(r.xLabel,'column 0');assert.deepEqual(r.series.map(s=>s.column),[1,2]);assert.deepEqual(r.series[0].points.map(p=>[p.x,p.y]),[[0,-123.5],[0.1,-123.6]]);});
test('matching commented header is preserved; late comments cannot relabel data',()=>{const r=parseChartData('# Time Energy Temp\n0 -1 300\n1 -2 301\n# Wrong Later Names','thermo.out');assert.equal(r.xLabel,'Time');assert.deepEqual(r.series.map(s=>s.name),['Energy','Temp']);});
test('CSV quoted headers, preserved empty cells and scientific notation',()=>{const r=parseChartData('"Step","Potential, eV",Temp\n1,-1e2,300\n2,,301\n3,-9.5e1,302','thermo.csv');assert.equal(r.series[0].name,'Potential, eV');assert.deepEqual(r.series[0].points.map(p=>p.y),[-100,null,-95]);assert.equal(r.missingValues,1);});
test('numeric-column gap stays null, not interpolated or converted to zero',()=>{const r=parseChartData('Time Step Temp\n03:00:00 1 300\n03:00:01 2 bad\n03:00:02 3 302','thermo.out');assert.deepEqual(r.series[0].points.map(p=>[p.x,p.y]),[[1,300],[2,null],[3,302]]);});
test('invalid x is an explicit gap with original source index',()=>{const r=parseChartData('Step Temp\n1 300\nNaN 301\n3 302','thermo.out');assert.deepEqual(r.series[0].points[1],{x:null,y:null,rowIndex:1,sourceLine:3});});
test('ragged/invalid CSV rows are skipped without shifting source row mapping',()=>{const r=parseChartData('Step,Temp\n1,300\n2\n3,302,99\n4,303\n"broken,304','thermo.csv');assert.equal(r.skippedRows,3);assert.deepEqual(r.series[0].points.map(p=>[p.x,p.rowIndex,p.sourceLine]),[[1,0,2],[4,3,5]]);});
for(const text of ['', '\n # empty\n','nonsense','NaN Infinity\nNaN Infinity',',,\n,,'])test('empty/nonfinite/no-numeric input stays empty '+JSON.stringify(text),()=>assert.equal(parseChartData(text,'thermo.out').hasData,false));
test('wallclock is never converted to elapsed or MD time',()=>{const r=parseChartData('Clock Temp\n23:59:59 300\n00:00:00 301','thermo.out');assert.equal(r.xColumn,null);assert.equal(r.xLabel,null);assert.deepEqual(r.series[0].points.map(p=>[p.x,p.y]),[[0,300],[1,301]]);assert.equal(r.ignoredColumns[0].name,'Clock');});
test('4000 source entry budget retained with and without a header',()=>{const rows=Array.from({length:4001},(_,i)=>i+' '+(i+10)).join('\n');const a=parseChartData(rows,'thermo.out'),b=parseChartData('Step Temp\n'+rows,'thermo.out');assert(a.cutLines);assert.equal(a.rows.length,4000);assert.equal(a.series[0].points.at(-1).x,3999);assert(b.cutLines);assert.equal(b.rows.length,3999);});
test('at most six series retain original source column numbers',()=>{const r=parseChartData('0 1 2 3 4 5 6 7 8\n1 2 3 4 5 6 7 8 9','thermo.out');assert(r.cutColumns);assert.deepEqual(r.series.map(s=>s.column),[1,2,3,4,5,6]);assert.equal(parseChartData('0 1 2 3 4 5 6','thermo.out').cutColumns,false);});
test('NEB single-column relative values are not shifted, normalized or assigned time',()=>{const r=parseChartData('0.2\n-0.4\nNaN\n0.8','neb_energies.out');assert(r.neb);assert.deepEqual(r.series[0].points.map(p=>[p.x,p.y]),[[0,.2],[1,-.4],[2,null],[3,.8]]);assert.equal(r.xColumn,null);assert.equal(parseChartData('0 .2\n1 .8','neb_energies.out').hasData,false);});
for(const name of ['model.xyz','trajectory.extxyz','POSCAR','model.cif'])test('structure '+name+' cannot be mislabeled as thermodynamic curves',()=>{const r=parseChartData('2\nLattice="1 0 0 0 1 0 0 0 1"\nH 0 0 0\nH 1 0 0',name);assert(r.structure);assert.equal(r.hasData,false);});
});

await __describe("cluster-files-experience", async () => {
const test = __node_test;
const deferred = _imp_0_deferred;
const sha='a'.repeat(64),file=(text='fixture A')=>({exists:true,base64:Buffer.from(text).toString('base64'),sha256:sha,size:Buffer.byteLength(text)});
function setup(override){return experienceHarness({component:'ClusterFiles',invoke:async(method,data)=>{const result=override?.(method,data);if(result!==undefined)return result;if(method==='worker.request')return file();if(method==='cluster.download')return {bytes:9,sha256:sha};throw Error('Unexpected fixture action');}});}
const pathInput=h=>h.find(node=>node.type==='input');
async function preview(h,path='a.xyz'){h.change(pathInput(h),path);h.button('浏览 / 预览').props.onClick();await h.flush();}
for(const source of ['path','root','project','cluster','root-list','scope','connection'])test(source+' change hides remote preview/download and asks for an explicit new read',async()=>{
 const h=setup();try{await preview(h);assert.match(h.text(),/fixture A/);const calls=h.calls.length;
  if(source==='path')h.change(pathInput(h),'b.xyz');else if(source==='root'){h.change(h.find(n=>n.type==='select'),'1');assert.equal(pathInput(h).props.value,'');}else h.render(source==='project'?{projectId:'project-b'}:source==='cluster'?{clusterId:'cluster-b'}:source==='root-list'?{roots:['~/other']} :source==='scope'?{scope:'other-source'}:{enabled:false});
  await h.flush();assert(!h.text().includes('fixture A'));assert(!h.all().some(n=>n.type==='button'&&n.props.children==='下载文件'));h.byId('cluster-files-stale');assert.match(h.text(),/旧预览已隐藏/);assert.equal(h.calls.length,calls);assert.equal(h.calls.filter(c=>c.method==='cluster.download').length,0);
 }finally{h.unmount();}
});
test('late browse responses and errors cannot replace a new path or connection',async()=>{
 const gates=[],h=setup(method=>{if(method==='worker.request'){const gate=deferred();gates.push(gate);return gate.promise;}});try{await preview(h,'old.xyz');h.change(pathInput(h),'new.xyz');h.button('浏览 / 预览').props.onClick();await h.flush();gates[1].resolve(file('current file'));await h.flush();gates[0].resolve(file('old file'));await h.flush();assert.match(h.text(),/current file/);assert(!h.text().includes('old file'));await preview(h,'third.xyz');h.render({scope:'project-b:cluster-b:2',projectId:'project-b',clusterId:'cluster-b'});gates[2].reject(Error('Old connection failure'));await h.flush();assert(!h.text().includes('current file'));assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
test('download uses immutable preview identity and hash; cancellation never claims success',async()=>{
 const gate=deferred(),h=setup(method=>method==='cluster.download'?gate.promise:undefined);try{await preview(h);const click=h.button('下载文件').props.onClick;click();click();await h.flush();const calls=h.calls.filter(c=>c.method==='cluster.download');assert.equal(calls.length,1);assert.deepEqual(calls[0].data,{project_id:'project-a',cluster_id:'cluster-a',relative:'a.xyz',root_index:0,expected_sha256:sha});assert.match(h.text(),/正在准备下载/);gate.resolve(null);await h.flush();assert(!h.text().includes('文件已下载并通过'));assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
test('successful download reports completion, empty files are downloadable, and failures are retryable',async()=>{
 let fail=false;const h=setup(method=>method==='worker.request'?Promise.resolve(file('')):method==='cluster.download'&&fail?Promise.reject(Error('Synthetic download error')):undefined);try{await preview(h);h.button('下载文件').props.onClick();await h.flush();assert.match(h.text(),/文件已下载并通过 SHA256 核对/);fail=true;h.button('下载文件').props.onClick();await h.flush();assert(!h.text().includes('文件已下载并通过'));assert.match(h.text(),/Synthetic download error/);assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
test('saved-profile requirement disables browsing, and directory rows use the loaded parent path',async()=>{
 const h=setup(()=>Promise.resolve({exists:true,entries:[{name:'child',directory:true}]}));try{h.render({enabled:false});h.button('浏览 / 预览').props.onClick();await h.flush();assert.equal(h.calls.length,0);h.render({enabled:true});await preview(h,'parent');h.button('childdirectory').props.onClick();await h.flush();assert.equal(h.calls.at(-1).data.data.relative,'parent/child');h.button('上一级目录').props.onClick();await h.flush();assert.equal(h.calls.at(-1).data.data.relative,'parent');}finally{h.unmount();}
});

for(const outcome of ['success','cancel','failure'])test('a displaced remote download '+outcome+' settles visibly without applying to the new file',async()=>{
 const gate=deferred(),h=setup(method=>method==='cluster.download'?gate.promise:undefined);try{await preview(h);h.button('下载文件').props.onClick();await h.flush();h.change(pathInput(h),'other.xyz');await h.flush();assert.match(h.text(),/下载仍可能完成/);const calls=h.calls.length;if(outcome==='failure')gate.reject(Error('Old download failed'));else gate.resolve(outcome==='cancel'?null:{bytes:9,sha256:sha});await h.flush();assert.match(h.text(),/先前下载请求已结束/);assert.doesNotMatch(h.text(),/仍可能完成|文件已下载并通过/);assert.equal(h.calls.length,calls);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

for(const partial of [false,true])test((partial?'partial':'complete')+' remote preview reports actual byte coverage without reading more data',async()=>{
 const h=setup(method=>method==='worker.request'?Promise.resolve({...file('结构'),size:partial?400000:6}):undefined);try{await preview(h);h.byId('cluster-file-preview-size');assert.match(h.text(),partial?/6 \/ 400000 B/:/6 \/ 6 B/);if(partial)assert.match(h.text(),/部分预览：仅显示文件前部/);else assert.doesNotMatch(h.text(),/部分预览/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.data.relative,'a.xyz');assert.equal(h.button('下载文件').props.disabled,false);}finally{h.unmount();}
});
});

await __describe("compute-environment-cuda", async () => {
const test = __node_test;
const source=fs.readFileSync(process.env.STUDIO_COMPUTE_SOURCE?path.resolve(process.env.STUDIO_COMPUTE_SOURCE):new URL("../../frontend/features/compute/ComputeEnvironments.tsx",import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const environment={id:'manual',name:'Manual environment',executables:{python:'/registered/python'},repositories:{pydyn:'/registered/source'},variables:{}};
const report=(available=true,engine='pydyn.md')=>({scope:{engine},cuda_available:available,runtime_guide:{status:'observed',facts:{state:'observed',environment_id:'manual',engine,cuda:{available}}}});
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness({probe=()=>report(),runtimeGuide=({environment_id,engine})=>({status:'not_run',environment_id,engine,reason:'No observed runtime guide'}),readiness={environments:[],clusters:[]}}={}){
 const hooks=[],pending=[],calls=[],errors=[];let cursor=0,dirty=false,tree,props={worker:true,workerGeneration:0,environments:[structuredClone(environment)],onRefresh(){},onConnect(){},onManual(){},onAgent(){},onCluster(){},onError:error=>errors.push(String(error))};
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const value={deps,cleanup:old?.cleanup};hooks[i]=value;pending.push(()=>{value.cleanup?.();value.cleanup=fn();});}};
 const api=async(method,target,data)=>{calls.push({method,target,data});if(target==='/api/compute/readiness')return readiness;if(target==='/api/environments/drafts')return [];if(target==='/api/probe')return probe(data);if(target==='/api/runtime-guide')return runtimeGuide(data);throw Error('Unexpected fixture request');};
 const require=name=>{if(name==='react')return {useState,useRef,useEffect};if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(["../../api/worker","../../api/studio","../../ui/presentation/engines"].includes(name))return {api,invoke:()=>{throw Error('No compute setup authorized');},engines:[['pydyn.md','PyDyn MD'],['gpumd.md','GPUMD MD']]};if(name==="../../ui/i18n")return {t:value=>value};return new Proxy({},{get:(_target,key)=>String(key)});};
 const module={exports:{}};new Function('require','module','exports','window','setInterval','clearInterval',compiled)(require,module,module.exports,{studio:{onEvent:()=>()=>{}}},()=>1,()=>{});
 function render(changes={}){props={...props,...changes};cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let i=0;i<12;i++){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 function all(node){if(Array.isArray(node))return node.flatMap(all);return !node||typeof node!=='object'?[]:[node,...all(node.props?.children)];}
 function find(predicate,root=tree){const found=all(root).find(predicate);if(!found)throw Error('Component fixture node not found');return found;}
 function text(node){if(Array.isArray(node))return node.map(text).join('');return node===null||node===undefined||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);}
 const badge=()=>text(find(node=>node.props?.className==='tag',find(node=>node.props?.className==='compute-env-list')));
 const summary=()=>text(find(node=>node.props?.className==='compute-summary'));
 function check(count=1){const click=find(node=>node.type==='button'&&text(node)==='检查依赖与 GPU').props.onClick;for(let i=0;i<count;i++)click();render();}
 function route(engine){find(node=>node.type==='select').props.onChange({target:{value:engine}});render();}
 render();return {render,flush,badge,summary,check,route,calls,errors,text:()=>text(tree)};
}
test('manual environment current selected-route probe updates both CUDA card and summary without discovery',async()=>{const h=harness();await h.flush();assert(h.badge().includes('待检查'));h.check();await h.flush();assert(h.badge().includes('CUDA 已发现'));assert(h.badge().includes('pydyn.md'));assert(h.summary().includes('1 个环境已观察到 CUDA'));assert(h.text().includes('检查通过'));assert(!h.text().includes('尚未观察到可用的 CUDA 环境。'));assert.deepEqual(h.errors,[]);});
test('successful current CPU-only probe states CUDA was not observed and does not count a CUDA environment',async()=>{const h=harness({probe:()=>report(false)});await h.flush();h.check();await h.flush();assert(h.badge().includes('未观察到 CUDA'));assert(h.summary().includes('0 个环境已观察到 CUDA'));});
test('checking, failed and unknown newest probes cannot retain an earlier CUDA success',async()=>{let next=report();const h=harness({probe:()=>next});await h.flush();h.check();await h.flush();assert(h.badge().includes('CUDA 已发现'));const pending=deferred();next=pending.promise;h.check();await h.flush();assert(h.badge().includes('待检查'));assert(h.summary().includes('0 个环境已观察到 CUDA'));pending.resolve({runtime_guide:{status:'blocked'},cuda_available:true});await h.flush();assert(h.badge().includes('待检查'));next={cuda_available:true};h.check();await h.flush();assert(h.badge().includes('待检查'));});
for(const group of ['executables','repositories','variables'])test('configuration changes and reversal do not revive a stale successful check: '+group,async()=>{const h=harness();await h.flush();h.check();await h.flush();assert(h.badge().includes('CUDA 已发现'));const changed=structuredClone(environment);changed[group]={...changed[group],changed:'different'};h.render({environments:[changed]});await h.flush();assert(h.badge().includes('待检查'));h.render({environments:[structuredClone(environment)]});await h.flush();assert(h.badge().includes('待检查'));assert(h.summary().includes('0 个环境已观察到 CUDA'));});
test('selected routes do not inherit another route success and late changed-configuration responses are ignored',async()=>{const pending=deferred();let next=report();const h=harness({probe:()=>next});await h.flush();h.check();await h.flush();h.route('gpumd.md');assert(h.badge().includes('待检查'));h.route('pydyn.md');assert(h.badge().includes('CUDA 已发现'));next=pending.promise;h.check();await h.flush();h.render({environments:[{...environment,executables:{python:'/different/python'}}]});pending.resolve(report());await h.flush();assert(h.badge().includes('待检查'));assert(h.summary().includes('0 个环境已观察到 CUDA'));});
test('blocked or mismatched receipt identity cannot claim CUDA or check passed',async()=>{for(const bad of [{...report(),runtime_guide:{status:'blocked'}},report(true,'gpumd.md'),{...report(),runtime_guide:{status:'observed',facts:{...report().runtime_guide.facts,environment_id:'other'}}}]){const h=harness({probe:()=>bad});await h.flush();h.check();await h.flush();assert(h.badge().includes('待检查'));assert(!h.text().includes('检查通过'));}});
test('worker disconnect invalidates prior checks; discovery fallback is configuration-bound',async()=>{const h=harness();await h.flush();h.check();await h.flush();assert(h.badge().includes('CUDA 已发现'));h.render({worker:false});await h.flush();h.render({worker:true});await h.flush();assert(h.badge().includes('待检查'));assert(h.summary().includes('0 个环境已观察到 CUDA'));const discovery=harness({readiness:{environments:[{...environment,cuda:{torch:{available:true}}}],clusters:[]}});await discovery.flush();assert(discovery.badge().includes('CUDA 已发现'));discovery.render({environments:[{...environment,variables:{LD_LIBRARY_PATH:'/changed'}}]});await discovery.flush();assert(discovery.badge().includes('待检查'));assert(discovery.summary().includes('0 个环境已观察到 CUDA'));});


test('a pending dependency probe blocks duplicate clicks before rendering',async()=>{
 const gate=deferred(),h=harness({probe:()=>gate.promise});await h.flush();h.check(2);await h.flush();assert.equal(h.calls.filter(call=>call.target==='/api/probe').length,1);assert.match(h.text(),/检查中/);gate.resolve(report());await h.flush();assert.match(h.badge(),/CUDA 已发现/);
});
});

await __describe("materials-search-lifecycle", async () => {
const test = __node_test;
const deferred = _imp_1_deferred;
const documents=id=>({documents:[{material_id:id,formula:'Cu',symmetry:{symbol:'Fm-3m'},n_atoms:1}]});
function setup(){const pending=[];const h=assetHarness({component:'MaterialsProjectSearch',override:call=>{const gate=deferred();pending.push({...gate,call});return gate.promise;}});h.find(node=>node.type==='input').props.onChange({target:{value:'Cu'}});h.find(node=>node.type==='select').props.onChange({target:{value:'env-a'}});h.render();return {h,pending};}
const search=h=>h.find(node=>node.type==='button'&&h.text(node)==='搜索结构');
const load=h=>h.find(node=>node.type==='button'&&h.text(node)==='导入并校验');

test('searching before choosing an environment retains candidates through target changes',async()=>{
 const {h,pending}=setup();try{
  h.find(node=>node.type==='select').props.onChange({target:{value:''}});h.render();search(h).props.onClick();pending[0].resolve(documents('mp-cu'));await h.flush();
  assert.equal(load(h).props.disabled,true);
  for(const environment of ['env-a','env-b']){h.find(node=>node.type==='select').props.onChange({target:{value:environment}});h.render();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-cu/);assert.equal(load(h).props.disabled,false);}
  load(h).props.onClick();assert.equal(pending[1].call.data.environment_id,'env-b');
  h.render({projectId:'project-b',workerScope:'new-worker'});assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-cu/);
  pending[1].resolve({path:'/project-a/cu.xyz',sha256:'a'.repeat(64),provenance:{external:{material_id:'mp-cu'}}});await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('Materials Project query edits hide old candidates and ignore late search responses',async()=>{
 const {h,pending}=setup();try{await h.flush();search(h).props.onClick();h.find(node=>node.type==='input').props.onChange({target:{value:'Ag'}});h.render();search(h).props.onClick();pending[1].resolve(documents('mp-ag'));await h.flush();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-ag/);
  pending[0].resolve(documents('mp-cu'));await h.flush();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-ag/);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('Materials Project import reply is scoped to the project, environment and worker that initiated it',async()=>{
 const {h,pending}=setup();try{await h.flush();search(h).props.onClick();pending[0].resolve(documents('mp-cu'));await h.flush();const click=load(h).props.onClick;click();click();assert.equal(pending.length,2);h.render({projectId:'project-b'});
  pending[1].resolve({path:'/project-a/cu.xyz',sha256:'a'.repeat(64),provenance:{external:{material_id:'mp-cu'}}});await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
});

await __describe("observed-read", async () => {
const test = __node_test;
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
});

await __describe("project-follow", async () => {
const test = __node_test;
test('an unchanged project follows conversation updates',()=>{
 assert.equal(followedProjectId('project', 'project', 'next'),'next');
 assert.equal(followedProjectId('', undefined, 'next'),'next');
 assert.equal(followedProjectId('', null, 'next'),'next');
});

test('a project the human selected explicitly is not overwritten by a conversation event',()=>{
 assert.equal(followedProjectId('manual', 'conversation-project', 'next'),'manual');
 assert.equal(followedProjectId('manual', undefined, 'next'),'manual');
});

test('events without a project binding preserve the current selection',()=>{
 assert.equal(followedProjectId('project', 'project', ''),'project');
 assert.equal(followedProjectId('project', 'project', undefined),'project');
});
});

await __describe("project-setup-navigation", async () => {
const test = __node_test;
test('new-project defaults enable the provided implemented engines and bounded visible resource suggestions',()=>{const engines=['pydyn.md','gpumd.md','pygas.build'],environments=['registered'];const next=newProjectDefaults(engines,environments,undefined,'/owned/workflow/inputs');assert.deepEqual(next.policy,{engines,gpus:[0],max_seconds:3600,max_concurrent:1,input_roots:['/owned/workflow/inputs'],environments:['registered'],clusters:[]});next.policy.engines.pop();assert.equal(engines.length,3);assert.deepEqual(environments,['registered']);assert.notEqual(newProjectDefaults(engines,environments).policy.engines,next.policy.engines);});
test('environment suggestions choose only current registered identity or a sole registration, never all resources',()=>{assert.equal(suggestedProjectEnvironment(['one','two']),null);assert.equal(suggestedProjectEnvironment(['one','two'],'two'),'two');assert.equal(suggestedProjectEnvironment(['one','two'],'unknown'),null);assert.equal(suggestedProjectEnvironment(['one'],'unknown'),'one');assert.equal(suggestedProjectEnvironment([]),null);assert.equal(suggestedProjectEnvironment(['one','one']),'one');});
test('suggested roots never fall back to arbitrary host paths, root, traversal or remote resources',()=>{for(const root of [undefined,'','/','//host/root','C:\\research','/owned/../other','/owned/./inputs','/owned\nsecret','/owned\0secret']){const next=newProjectDefaults(['pydyn.md'],['one','two'],'unknown',root);assert.deepEqual(next.policy.input_roots,[]);assert.deepEqual(next.policy.environments,[]);assert.deepEqual(next.policy.clusters,[]);}assert.equal(scopedSuggestedInputRoot('/owned/current/inputs'),'/owned/current/inputs');});
test('new-project suggestion construction does not touch an existing project object or change other registrations',()=>{const existing={id:'old',policy:{engines:['pydyn.md'],gpus:[2],max_seconds:90,max_concurrent:1,input_roots:['/saved'],environments:['legacy'],clusters:['explicit-cluster']}};const before=structuredClone(existing);newProjectDefaults(['gpumd.md','pydyn.md'],['new-env'],undefined,'/current/inputs');assert.deepEqual(existing,before);});
test('tool and workflow tabs use the corresponding module family rather than a single generic mark',()=>{for(const tool of ['md','training','activelearning','pygas','assets','viewer','queue'])assert.equal(workspaceModule('tool:'+tool),tool);for(const [engine,module]of [['gpumd.neb','neb'],['pydyn.md','md'],['gpumd.sampling','md'],['hotpp.export','training'],['nep.eval','training'],['pygas.build','pygas'],['bias.validate','pygas']])assert.equal(workspaceModule('task:run',engine),module);assert.equal(workspaceModule('agent-task:flow'),'workflow');assert.equal(workspaceModule('editor'),'code');assert.equal(workspaceModule('environments'),'resources');});
});

await __describe("pygas-framework", async () => {
const test = __node_test;
const out=fs.mkdtempSync(path.join(os.tmpdir(),'studio-framework-test-'));fs.writeFileSync(path.join(out,'package.json'),' {"type":"commonjs"}');fs.writeFileSync(path.join(out,'state.cjs'),ts.transpileModule(fs.readFileSync('frontend/features/pygas/pygas-composer-state.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);const {compilerGraphModes,appendFrameworkNode,changeCompilerGraphMode,managedOutputNameProposal,adoptManagedOutputName}=createRequire(import.meta.url)(path.join(out,'state.cjs'));
const hash='a'.repeat(64),template={input:{inputs:{},outputs:{pos:'pos'}},collect:{inputs:{value:'value'},outputs:{cv:'cv'}},output:{inputs:{cv:'cv'},outputs:{}},reduce:{inputs:{value:'value'},outputs:{value:'value'}}};const catalog={schema_version:1,status:'passed',source:{files:{'tools/graph_workflow.py':hash}},catalog:{cv:[],bias:[],switch:[],neighbor:[]},ports:{status:'passed',source_sha256:hash,classes:{},templates:{cvonly:template,metad:template},multiple_inputs:[['collect','value']],compatible_pairs:[],reductions:['identity','mean','sum','first']}},receipt=catalog.source;
const graph=()=>({version:2,mode:'cvonly',settings:{cutoff:3,scientific_metadata:{retained:'not scientific proof'}},nodes:[],edges:[],history:{retained:true}});
test('Only current source-matched modes are offered',()=>{assert.deepEqual(compilerGraphModes(catalog,receipt),['cvonly','metad']);const c=structuredClone(catalog);c.ports.source_sha256='b'.repeat(64);assert.deepEqual(compilerGraphModes(c,receipt),[]);assert.deepEqual(compilerGraphModes(catalog,{files:{}}),[]);});
test('Manual mode change preserves every other original data field and input object',()=>{const g=graph(),before=structuredClone(g);assert.deepEqual(changeCompilerGraphMode(g,catalog,receipt,'metad'),{...before,mode:'metad'});assert.deepEqual(g,before);assert.equal(changeCompilerGraphMode(g,catalog,receipt,'cvonly'),g);});
test('Unknown mode is rejected without fallback or mutation',()=>{const g=graph();assert.throws(()=>changeCompilerGraphMode(g,catalog,receipt,'unknown'),/source-matched/);assert.equal(g.mode,'cvonly');});
for(const kind of ['input','collect','output','reduce'])test('Add '+kind+' creates no edges, defaults or replacement',()=>{const g=graph(),before=structuredClone(g),v=appendFrameworkNode(g,catalog,receipt,kind,'new-'+kind);assert.deepEqual(v,{...before,nodes:[{id:'new-'+kind,kind,params:{}}]});assert.deepEqual(g,before);});
test('Current UI singletons reject duplicates, reduce remains explicitly multiple',()=>{for(const kind of ['input','collect','output']){const g=appendFrameworkNode(graph(),catalog,receipt,kind,'first');assert.throws(()=>appendFrameworkNode(g,catalog,receipt,kind,'second'),/currently supports one/);}const g=appendFrameworkNode(graph(),catalog,receipt,'reduce','first');assert.equal(appendFrameworkNode(g,catalog,receipt,'reduce','second').nodes.length,2);});
test('Unique bounded graph IDs and 128-node cap fail closed',()=>{const g=appendFrameworkNode(graph(),catalog,receipt,'reduce','same');for(const id of ['same','../bad','', 'x'.repeat(129)])assert.throws(()=>appendFrameworkNode(g,catalog,receipt,'reduce',id));const full={...graph(),nodes:Array.from({length:128},(_,i)=>({id:'node-'+i,kind:'reduce',params:{}}))};assert.throws(()=>appendFrameworkNode(full,catalog,receipt,'reduce','extra'),/128/);assert.equal(full.nodes.length,128);});
test('Unknown kind/mode/stale template cannot create a node',()=>{assert.throws(()=>appendFrameworkNode(graph(),catalog,receipt,'script','unknown'));assert.throws(()=>appendFrameworkNode({...graph(),mode:'unknown'},catalog,receipt,'reduce','new'));const c=structuredClone(catalog);delete c.ports.templates.cvonly.reduce;assert.throws(()=>appendFrameworkNode(graph(),c,receipt,'reduce','new'));});

function outputCatalog(){return {...structuredClone(catalog),settings_schema:{status:'passed',source_files:{'tools/graph_workflow.py':hash},fields:[{key:'pt_path',type:'owned_output_basename',location:'settings',read_only:true,required:true,origin:{path:'tools/graph_workflow.py',sha256:hash,lines:[433,435]},editor_hint:{}}]}};}
test('Managed basename is missing-only explicit technical data, preserving scientific content',()=>{const c=outputCatalog();for(const value of [undefined,null,'']){const g=graph();g.settings.pt_path=value;g.settings.artifact_formats=['aoti'];g.settings.deployment_backend='aoti';const before=structuredClone(g),v=adoptManagedOutputName(g,c,c.source);assert.equal(v.settings.pt_path,'pygas-model.pt');assert.deepEqual(v.nodes,before.nodes);assert.deepEqual(v.edges,before.edges);assert.deepEqual(v.settings.artifact_formats,['aoti']);assert.equal(v.settings.deployment_backend,'aoti');assert.equal(v.settings.scientific_metadata.retained,before.settings.scientific_metadata.retained);assert.match(v.settings.scientific_metadata.studio_technical_defaults.pt_path.origin,/AIMatterLab technical default/);assert.deepEqual(g,before);}});
test('Existing values including false and zero are never treated as missing',()=>{const c=outputCatalog();for(const value of [0,false,{},'existing.pt',' ']){const g=graph();g.settings.pt_path=value;assert.equal(managedOutputNameProposal(g,c,c.source).available,false);assert.throws(()=>adoptManagedOutputName(g,c,c.source));assert.deepEqual(g.settings.pt_path,value);}});
test('Managed output requires exact readonly source schema and source receipt',()=>{for(const change of ['source','readonly','missingfield','version']){const c=outputCatalog(),g=graph();if(change==='source')c.settings_schema.source_files['tools/graph_workflow.py']='b'.repeat(64);if(change==='readonly')c.settings_schema.fields[0].read_only=false;if(change==='missingfield')c.settings_schema.fields=[];if(change==='version')g.version=1;assert.equal(managedOutputNameProposal(g,c,c.source).available,false);assert.throws(()=>adoptManagedOutputName(g,c,c.source));}});
test('Future names reflect selected formats only, not generated files or backend fallback',()=>{const c=outputCatalog(),g=graph();for(const formats of [['torchscript'],['aoti'],['torchscript','aoti']]){g.settings.artifact_formats=formats;g.settings.deployment_backend=formats.at(-1);assert.deepEqual(managedOutputNameProposal(g,c,c.source).futureOutputs,formats.map(f=>f==='aoti'?'pygas-model.pt2':'pygas-model.pt'));assert.deepEqual(g.settings.artifact_formats,formats);}g.settings.artifact_formats=['unknown'];assert.deepEqual(managedOutputNameProposal(g,c,c.source).futureOutputs,[]);});

test('Malformed fulfilled output field degrades to blocked rather than throwing',()=>{for(const fields of [[null],[{key:'pt_path',type:'owned_output_basename',location:'settings',read_only:true,required:true}]]){const c=outputCatalog();c.settings_schema.fields=fields;assert.equal(managedOutputNameProposal(graph(),c,c.source).available,false);}});
});

await __describe("settings-save-lifecycle", async () => {
const test = __node_test;
const harness = _imp_2_harness;
for(const field of ['theme','workerPort'])test('old settings acknowledgement preserves newer '+field+' edit',async()=>{
 const h=harness();try{
  await h.flush();h.save();await h.flush();
  if(field==='theme')h.find(node=>node.type==='select'&&node.props.value==='dark').props.onChange({target:{value:'light'}});
  else{h.find(node=>node.type==='button'&&h.text(node).includes('计算连接')).props.onClick();await h.flush();h.find(node=>node.props.testId==='worker-port').props.onChange(8768);}
  await h.flush();const newer=h.settings[field];h.gate.resolve(h.calls[0].data);await h.flush();
  assert.equal(h.settings[field],newer);assert.equal(h.saved.length,1,'acknowledges the persisted baseline for Cancel');
  assert(h.text(h.find(node=>node.props?.className==='settings-footer')).includes('未保存修改'));assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('current settings acknowledgement applies normalized result and duplicate clicks dispatch once',async()=>{
 const h=harness();try{await h.flush();h.save();h.save();assert.equal(h.calls.length,1);const result={...h.calls[0].data,fontSize:14};h.gate.resolve(result);await h.flush();assert.equal(h.settings.fontSize,14);assert.deepEqual(h.saved,[result]);assert(h.text(h.find(node=>node.props?.className==='settings-footer')).includes('设置已保存'));}finally{h.unmount();}
});

for(const outcome of ['resolve','reject'])test('settings '+outcome+' after unmount cannot alter another editor or report stale feedback',async()=>{
 const h=harness();await h.flush();h.save();h.unmount();if(outcome==='resolve')h.gate.resolve(h.calls[0].data);else h.gate.reject(Error('old editor failure'));await h.flush();assert.deepEqual(h.saved,[]);assert.deepEqual(h.errors,[]);
});

test('settings replaced externally during save retain the newer owner values',async()=>{
 const h=harness();try{await h.flush();h.save();h.external({distribution:'Newly selected Ubuntu'});h.gate.resolve(h.calls[0].data);await h.flush();assert.equal(h.settings.distribution,'Newly selected Ubuntu');}finally{h.unmount();}
});

test('App keeps the same settings editor open until its pending save settles',async()=>{
 const h=appWorkerHarness();try{
  await h.flush();const props=h.openSettings();props.onChange({...props.settings,theme:'light'});props.onSavingChange(true);await h.flush();
  h.find(node=>node.type==='./SettingsPage').props.onClose();await h.flush();
  const saving=h.find(node=>node.type==='./SettingsPage');assert.equal(saving.props.settings.theme,'light');
  assert.equal(h.find(node=>node.type==='Modal'&&node.props.title==='工作台设置').props.closeDisabled,true);
  saving.props.onOpenComputeResources();await h.flush();h.find(node=>node.type==='./SettingsPage');
  assert.throws(()=>h.find(node=>node.type==='./ComputeConnectionChooser'));
  saving.props.onSaved(saving.props.settings);saving.props.onSavingChange(false);await h.flush();
  h.find(node=>node.type==='./SettingsPage').props.onClose();await h.flush();
  assert.equal(h.openSettings().settings.theme,'light');
 }finally{h.unmount();}
});
});

await __describe("structure-builder", async () => {
const test = __node_test;
const deferred = _imp_1_deferred;
const result={path:'/owned/workspace/structures/generated.xyz',formula:'Ag4',n_atoms:4,provenance:{version:'fixture-ase',assumptions:[{field:'a',source:'ASE reference'}]}};
function setup(override){const h=assetHarness({component:'StructureBuilder',override,props:{projectId:'owned',environments:[{id:'registered',name:'Registered'}]}});h.find(node=>node.props?.['aria-label']==='检查环境').props.onChange({target:{value:'registered'}});h.render();return h;}
const build=h=>h.find(node=>node.type==='button'&&h.text(node).includes('生成'));

test('actual structure builder retains recipe and full source while compacting generated result and assumptions',async()=>{
 const h=setup(async()=>result);try{await h.flush();h.find(node=>node.type==='input'&&node.props.value==='Cu').props.onChange({target:{value:'Ag'}});h.render();build(h).props.onClick();await h.flush();
  assert.deepEqual(h.calls,[{method:'worker.request',data:{method:'POST',target:'/api/structures/create',data:{project_id:'owned',environment_id:'registered',recipe:{kind:'bulk',name:'Ag',repeat:[1,1,1]}}}}]);
  assert.equal(h.errors.length,0);const summary=h.find(node=>node.props?.className==='structure-result-summary');assert.match(h.text(summary),/generated.xyz.*Ag4.*4 atoms.*fixture-ase/);assert(!h.text(summary).includes('/owned/'));
  assert(h.all().some(node=>node.type==='Tooltip'&&node.props.content===result.path));const assumptions=h.find(node=>node.type==='details');assert.equal(assumptions.props.open,undefined);assert.match(h.text(assumptions),/a: ASE reference/);
  assert(h.all().some(node=>node.type==='Tooltip'&&node.props.content.includes('尚未进行能量松弛')));
 }finally{h.unmount();}
});

test('structure creation ignores stale results after recipe or worker ownership changes and prevents duplicate writes',async()=>{
 const pending=[];const h=setup(()=>{const gate=deferred();pending.push(gate);return gate.promise;});try{await h.flush();const click=build(h).props.onClick;click();click();assert.equal(h.calls.length,1);
  h.find(node=>node.type==='input'&&node.props.value==='Cu').props.onChange({target:{value:'Ag'}});h.render();pending[0].resolve(result);await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);
  build(h).props.onClick();h.render({workerScope:'another-worker'});pending[1].reject(Error('old source'));await h.flush();assert.deepEqual(h.errors,[]);assert.equal(h.saved.length,0);
 }finally{h.unmount();}
});
});

await __describe("ui-diagnostics", async () => {
const test = __node_test;
const renderToStaticMarkup = render;
const {createDiagnostic,diagnosticContext,diagnosticCurrent,diagnosticPhase,diagnosticSummary,createDiagnosticJournal}=diagnostics;
const config={target:'local',projectId:'project-id',targetId:'target-id',gpu:0,maxSeconds:60,directoryName:'attempt',resources:{}},task={id:'task-id',name:'Silicon workflow',parameterRevision:3,updatedAt:1,deployment:{revision:2,config,prepared:{artifactId:'run-id'},request:{id:'request-id'}}};
const raw="Error invoking remote method 'studio:task.execute': Error: Required PyDyn runtime imports failed (pydyn).\npydyn: ModuleNotFoundError: pydyn\n/registered/input/run.py:4\n保持原始诊断";
test('transport wrapper is absent from the summary while the complete message and stack stay exact',()=>{const error=new Error(raw),record=createDiagnostic(error,diagnosticContext(task,config,'execute','run-id','Local research environment'));assert.equal(record.raw,raw);assert.equal(record.stack,error.stack);assert(!diagnosticSummary(record,'blocked').includes('Error invoking'));assert(diagnosticSummary(record,'blocked').includes('PyDyn'));});
test('diagnostic severity follows the observed phase, with labels and no secrets in details',()=>{
 const {default:Notice,setLanguage}=diagnosticComponents();setLanguage('en');
 const record=createDiagnostic(new Error('Connection reply included api_key=private-sentinel'));
 for(const [phase,severity,role,label] of [['confirmed','info','status','Information'],['unconfirmed','warning','status','Warning'],['failed','error','alert','Error']]){
  const html=renderToStaticMarkup(React.createElement(Notice,{record,phase}));
  assert(html.includes(`data-severity="${severity}"`));assert(html.includes(`role="${role}"`));assert(html.includes('</svg>'+label));
  assert(!html.includes('private-sentinel'));assert(html.includes('[redacted]'));
 }
});
test('unknown diagnostics use a neutral localized operation summary rather than translating arbitrary tracebacks',()=>{for(const operation of ['save','prepare','execute']){const record=createDiagnostic('English: inner Error: colon\ntrace',diagnosticContext(task,config,operation));assert(diagnosticSummary(record,'blocked').includes('诊断详情'));assert.equal(record.raw,'English: inner Error: colon\ntrace');}assert.equal(diagnosticSummary(createDiagnostic('请先保存参数'),'blocked'),'请先保存参数');});
test('capture is immutable and target/revision changes make old diagnostic historical',()=>{const value=structuredClone(config),record=createDiagnostic(raw,diagnosticContext(task,value,'prepare'));value.targetId='new-target';assert.equal(record.context.targetId,'target-id');assert.equal(diagnosticCurrent(record,task,value),false);assert.equal(diagnosticCurrent(record,{...task,parameterRevision:4},config),false);assert.equal(diagnosticCurrent(record,task,config),true);});
test('journal isolates tasks and preserves complete original diagnostics without clearing history',()=>{const journal=createDiagnosticJournal();journal.add(raw,diagnosticContext(task,config,'save'));journal.add('other',diagnosticContext({...task,id:'other'},config,'save'));assert.equal(journal.list('task-id')[0].raw,raw);assert.equal(journal.list('other')[0].raw,'other');assert.equal(journal.list('task-id').length,1);});
test('navigation cannot resolve unknown, but observed resolution remains latched across a new artifact',()=>{const journal=createDiagnosticJournal(),record=journal.add(raw,diagnosticContext(task,config,'execute','run-id'));const unknown={...task,execution:{artifactId:'run-id',phase:'unknown'}};assert.equal(diagnosticPhase(record,unknown),'unknown');assert.equal(diagnosticPhase(record,{...unknown,deployment:{...task.deployment,config:{...config,targetId:'other'}}}),'unknown');journal.reconcile({...task,updatedAt:2,execution:{artifactId:'run-id',phase:'confirmed',status:'queued'}});const resolved=journal.list(task.id)[0];assert.equal(diagnosticPhase(resolved,{...task,execution:{artifactId:'new-run',phase:'unknown'}}),'confirmed');assert.equal(resolved.raw,raw);});
test('an unrelated updatedAt change with unchanged old execution cannot resolve an uncertain attempt',()=>{const before={...task,execution:{artifactId:'run-id',phase:'blocked',message:'old attempt'}},journal=createDiagnosticJournal(),record=journal.add(raw,diagnosticContext(before,config,'execute','run-id'));const unrelated={...before,updatedAt:999,name:'Renamed only'};journal.reconcile(unrelated);assert.equal(diagnosticPhase(record,unrelated),'unconfirmed');assert.equal(journal.list(task.id)[0].resolution,undefined);});
for(const language of ['zh-CN','en'])test('real React diagnostic component renders localized compact summary and collapsed exact raw text: '+language,()=>{const {default:Notice,setLanguage}=diagnosticComponents();setLanguage(language);const record=createDiagnostic(raw,diagnosticContext(task,config,'execute','run-id','Local research environment'));const html=renderToStaticMarkup(React.createElement(Notice,{record,phase:'blocked'}));const visible=html.slice(0,html.indexOf('<details>'));assert(!visible.includes('task-id'));assert(!visible.includes('run-id'));assert(!visible.includes('request-id'));assert(!visible.includes('Error invoking'));assert(visible.includes('Silicon workflow'));assert(visible.includes('Local research environment'));assert(visible.includes(language==='en'?'Required PyDyn dependencies':'PyDyn 必需依赖'));assert(!html.includes('<details open'));assert(html.includes(renderToStaticMarkup(React.createElement('pre',{className:'diagnostic-raw'},raw))));assert(html.includes('task-id'));});
test('real React history remains available after target change and unknown remains outside collapsed history',()=>{const {DeploymentDiagnostics}=diagnosticComponents(),record=createDiagnostic(raw,diagnosticContext(task,config,'execute','run-id','Old target'));const html=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[record],task,config:{...config,targetId:'new'}}));assert(html.includes('data-pending="true"'));assert(html.includes('Old target'));const resolved={...record,resolution:{phase:'blocked'}};const history=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[resolved],task,config:{...config,targetId:'new'}}));assert(history.includes('data-testid="historical-diagnostics"'));assert(!history.includes('data-pending="true"'));});
test('recorded unknown survives a renderer-only journal reset without creating any retry action',()=>{const {DeploymentDiagnostics}=diagnosticComponents(),value={...task,execution:{artifactId:'run-id',phase:'unknown',message:'submit response missing'}};const html=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[],task:value,config}));assert(html.includes('data-pending="true"'));assert(html.includes('submit response missing'));assert(!html.includes('<button'));});
test('an old resolved diagnostic for the same run cannot hide a newer authoritative unknown',()=>{const {DeploymentDiagnostics}=diagnosticComponents(),record={...createDiagnostic('prior blocked diagnostic',diagnosticContext(task,config,'execute','run-id')),resolution:{phase:'blocked',observedAt:1,execution:{artifactId:'run-id',phase:'blocked'}}},value={...task,execution:{artifactId:'run-id',phase:'unknown',message:'new unknown for the original run'}};const html=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[record],task:value,config}));assert(html.includes('data-pending="true"'));assert(html.includes('new unknown for the original run'));assert(html.includes('prior blocked diagnostic'));assert(!html.includes('<button'));});
test('prepared artifact identity alone makes old resolved diagnostics historical without dismissing pending originals',()=>{const {DeploymentDiagnostics}=diagnosticComponents(),before=createDiagnostic('old diagnostic',diagnosticContext(task,config,'execute','run-id')),resolved={...before,resolution:{phase:'blocked'}},changed={...task,deployment:{...task.deployment,prepared:{...task.deployment.prepared,artifactId:'new-artifact'}}};assert.equal(diagnosticCurrent(resolved,changed,config),false);const html=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[resolved],task:changed,config}));assert(html.includes('data-testid="historical-diagnostics"'));assert(html.includes('old diagnostic'));const pending=renderToStaticMarkup(React.createElement(DeploymentDiagnostics,{records:[before],task:changed,config}));assert(pending.includes('data-pending="true"'));const noRun={...task,deployment:{...task.deployment,prepared:undefined}},save=createDiagnostic('save before preparation',diagnosticContext(noRun,config,'save'));assert.equal(save.context.preparedId,null);assert.equal(diagnosticCurrent(save,task,config),false);});
});
