import {frontendSource} from "../helpers/frontend-source-paths.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as eligibilityModuleOwner0 from "../../frontend/features/workflows/local-build-review-eligibility.mjs";
import * as eligibilityModuleOwner1 from "../../contracts/workflows/local-review-eligibility.mjs";
const eligibilityModule={...eligibilityModuleOwner0,...eligibilityModuleOwner1};

const {localBuildReviewEligibility:eligibility,localReviewUnsupportedCode,localReviewErrorMessage}=eligibilityModule;
const engines=['bias.validate','gpumd.sampling'];

test('explicit OPES blocks each local-review engine before missing graph; selections stay intact',()=>{
 for(const engine of engines)for(const graph of [undefined,'metad','opes']){
  const parameters={engine,mode:'opes',bias_file:'original.pt',manifest_file:'original.json',kernel_capacity:128},before=structuredClone(parameters);
  const result=eligibility(engine,graph,parameters);assert.equal(result.allowed,false);assert.match(result.reason,/OPES.*AI/);assert.equal(localReviewUnsupportedCode(engine,parameters),'LOCAL_REVIEW_UNSUPPORTED_OPES');assert.deepEqual(parameters,before);
 }
});
test('build metad/cvonly remain candidates; unread or stale owner mode stays closed',()=>{
 for(const mode of ['metad','cvonly'])assert.deepEqual(eligibility('pygas.build',mode,{mode:'opes'}),{allowed:true,reason:null});assert.match(eligibility('pygas.build','opes').reason,/OPES.*AI/);
 for(const mode of [undefined,null,'','OPES','future'])assert.equal(eligibility('pygas.build',mode).allowed,false);
});
test('consumer mode and saved graph differ: Metad/WT/static use metad graph, cvonly and unknown remain closed',()=>{
 for(const engine of engines)for(const mode of ['metad','wtmetad','static']){
  assert.deepEqual(eligibility(engine,'metad',{mode}),{allowed:true,reason:null});
  for(const saved of [undefined,null,'cvonly','future'])assert.equal(eligibility(engine,saved,{mode}).allowed,false);
 }
 for(const engine of engines)for(const mode of [undefined,'','future','cvonly'])assert.equal(eligibility(engine,'metad',{mode}).allowed,false);
});
test('selected manifest/kernel consumer contracts stay closed, without reinterpreting build options',()=>{
 for(const engine of engines)for(const selection of [{manifest_file:'explicit.json'},{kernel_capacity:32}])assert.match(eligibility(engine,'metad',{mode:'wtmetad',...selection}).reason,/manifest.*kernel/);
 assert.equal(eligibility('pygas.build','metad',{manifest_file:'build-output.json'}).allowed,true);
});
test('only exact known messages/envelopes map; unrelated errors keep existing diagnostics',()=>{
 for(const key of ['LOCAL_REVIEW_UNSUPPORTED_OPES','LOCAL_REVIEW_UNSUPPORTED_CONSUMER_CONTRACT','Save and complete the actual current canonical pair']){
  const plain=localReviewErrorMessage(Error(key));assert.notEqual(plain,key);
  for(const channel of ['inspect','read','confirm'])assert.equal(localReviewErrorMessage(Error(`Error invoking remote method 'studio:task.localReview.${channel}': Error: ${key}`)),plain);
 }
 for(const raw of ['owner changed','prefix LOCAL_REVIEW_UNSUPPORTED_OPES',"Error invoking remote method 'other': Error: LOCAL_REVIEW_UNSUPPORTED_OPES",'LOCAL_REVIEW_UNSUPPORTED_OPES\nextra'])assert.equal(localReviewErrorMessage(Error(raw)),raw);
});

// Actual full transpiled components. Child views and IPC are inert fixtures; shared
// eligibility, owner keys, draft outbox and source taskHasComposition are real.
const source=name=>readFileSync(frontendSource(name),'utf8');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const pageSource=source('AgentTaskPage.tsx'),shared=new Map();
for(const name of [...pageSource.matchAll(/from ['"]([^'"]+\.mjs)['"]/g)].map(match=>match[1]))shared.set(name,await import(new URL(name,frontendSource('AgentTaskPage.tsx'))));
const composer=ts.createSourceFile('PygasTaskComposer.tsx',source('PygasTaskComposer.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hasCompositionSource=composer.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='taskHasComposition').getText(composer).replace(/^export /,'');
const actualTaskHasComposition=new Function(compile(hasCompositionSource+'; return taskHasComposition;'))();
const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
function harness(file,{task,language='zh-CN',api}={}){
 const hooks=[],effects=[],calls=[],reviews=[];let cursor=0,dirty=false,tree,props,alive=true;
 const values=new Map([['studio.language',language]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||!deps||deps.some((value,k)=>!Object.is(value,old.deps?.[k]))){const h={deps,cleanup:old?.cleanup};hooks[i]=h;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}};
 const jsx=(type,props)=>({type,props});
 const i18n={exports:{}};new Function('module','exports','localStorage',compile(source('i18n.ts')))(i18n,i18n.exports,storage);
 const invoke=async(method,data)=>{calls.push({method,data});if(method==='task.read')return structuredClone(props.task);throw Error('Unexpected component IPC '+method);};
 const imports={'react':{useState,useRef,useEffect},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':new Proxy({},{get:(_t,key)=>String(key)}),"../../api/studio":{invoke,api:()=>{throw Error('Unexpected worker API');}},"../../api/worker":{invoke,api:()=>{throw Error('Unexpected worker API');}},"../../ui/i18n":i18n.exports,"../pygas/PygasTaskComposer":{default:'PygasTaskComposer',taskHasComposition:actualTaskHasComposition},"../pygas/pygas-local-draft":{useTaskPygasDirty:()=>false},"./pygas-local-draft":{useTaskPygasDirty:()=>false},'./stage-editor-draft':{useTaskStageDrafts:()=>[]},'./LocalInputReview':{LocalInputReview:'LocalInputReview'},'./useLocalReviewStatus':{useLocalReviewStatus:()=>({phase:'resolved',value:null}),currentLocalReview:()=>false,localReviewNotice:()=>null}};
 imports['../../api/task-client']={taskApi:{read:id=>invoke('task.read',{id})}};
 const module={exports:{}};new Function('require','module','exports','localStorage','window',compile(source(file)))(name=>shared.get(name)??(["./local-build-review-eligibility.mjs"].includes(name)?eligibilityModule:imports[name]??{default:name}),module,module.exports,storage,{studio:{onEvent:()=>()=>{}}});
 props=file==='AgentTaskPage.tsx'?{task,worker:true,environments:[],theme:'dark',onError:error=>{throw error;},onRun:()=>{},onCluster:()=>{},onSetup:()=>{},onReview:value=>reviews.push(value),onRefresh:async()=>{},onAgent:()=>{},onReplace:()=>{}}:{taskId:'same',workerReady:true,api,onConfirmed:async()=>{},onClose:()=>{},onShowGraph:()=>{}};
 function render(){cursor=0;dirty=false;tree=(module.exports.default||module.exports.LocalInputReview)(props);}
 async function flush(){for(let i=0;i<16;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&alive)render();if(!effects.length&&!dirty)return;}throw Error('Component did not settle');}
 const all=()=>flatten(tree),find=predicate=>{const node=all().find(predicate);assert(node,'Actual source node missing');return node;};
 render();return {calls,reviews,all,find,text,flush,changeTask(value){props={...props,task:value};render();},unmount(){alive=false;for(const hook of hooks)hook?.cleanup?.();}};
}
const task=(engine='gpumd.sampling',mode='opes',withGraph=false)=>({id:'original-task',provider:'codex',threadId:'original-thread',name:'Original OPES',workflowVersion:2,parameterRevision:7,parameters:{engine,mode,files:['original.pt','model.xyz']},steps:[],missingFields:[],review:{status:'not_run'},artifacts:[],...(withGraph?{composition:{status:'rendered',graphPath:'workflow.json'}}:{})});
const byId=id=>node=>node.props?.['data-testid']===id;
function graph(h,mode='metad'){h.find(node=>node.type==='PygasTaskComposer').props.onStateChange({loading:false,dirty:false,saving:false,error:false,renderBlocked:false,savedGraphMode:mode});}
for(const engine of engines)test('actual '+engine+' OPES page blocks local open without calling IPC; ordinary AI review remains explicit',{timeout:3000},async()=>{
 const original=task(engine),before=structuredClone(original),h=harness('AgentTaskPage.tsx',{task:original});await h.flush();const entry=h.find(byId('open-local-review'));assert.equal(entry.props.disabled,true);assert.match(h.text(h.find(byId('local-review-ineligible'))),/OPES.*AI/);entry.props.onClick();await h.flush();assert(!h.all().some(node=>node.type==='LocalInputReview'));assert.deepEqual(h.calls,[]);assert.deepEqual(original,before);
 const review=h.find(byId('review-workflow'));assert.equal(review.props.disabled,false);assert.equal(h.reviews.length,0);review.props.onClick();await h.flush();assert.deepEqual(h.calls.map(call=>call.method),['task.read']);assert.equal(h.reviews[0].id,original.id);h.unmount();
});
test('actual page supported mode opens; mode/owner change cannot keep prior Inspect mounted',{timeout:3000},async()=>{
 const original=task('gpumd.sampling','wtmetad',true),h=harness('AgentTaskPage.tsx',{task:original});await h.flush();assert.equal(h.find(byId('open-local-review')).props.disabled,true);graph(h);await h.flush();assert.equal(h.find(byId('open-local-review')).props.disabled,false);h.find(byId('open-local-review')).props.onClick();await h.flush();assert(h.all().some(node=>node.type==='LocalInputReview'));
 h.changeTask({...original,parameterRevision:8,parameters:{...original.parameters,mode:'opes'}});assert(!h.all().some(node=>node.type==='LocalInputReview'));assert.equal(h.find(byId('open-local-review')).props.disabled,true);h.changeTask({...original,id:'different-owner'});assert(!h.all().some(node=>node.type==='LocalInputReview'));assert.equal(h.find(byId('open-local-review')).props.disabled,true);await h.flush();assert.deepEqual(h.calls,[]);h.unmount();
});
for(const language of ['zh-CN','en'])test('actual LocalInputReview maps wrapped unsupported and canonical-pair failure in '+language,{timeout:3000},async()=>{
 for(const reason of ['LOCAL_REVIEW_UNSUPPORTED_OPES','Save and complete the actual current canonical pair']){
  let calls=0;const h=harness('LocalInputReview.tsx',{language,api:{inspect:async()=>{calls++;throw Error(`Error invoking remote method 'studio:task.localReview.inspect': Error: ${reason}`);}}});await h.flush();assert.equal(calls,0);await h.find(byId('local-review-inspect')).props.onClick();await h.flush();const message=h.text(h.find(node=>node.props?.role==='alert'));assert.doesNotMatch(message,/invoking remote method|LOCAL_REVIEW_/);assert.match(message,language==='en'?reason.includes('OPES')?/OPES.*AI review/:/Metad graph.*build artifact/:reason.includes('OPES')?/OPES.*AI 复核/:/Metad.*构建产物/);assert.equal(calls,1);assert(!h.all().some(byId('local-review-confirm')));h.unmount();
 }
});

const aliasParameters=(path,value,base={})=>{const result=structuredClone(base),parts=path.split('.');let node=result;for(const part of parts.slice(0,-1))node=node[part]??(node[part]={});node[parts.at(-1)]=value;return result;};
for(const engine of engines)test(engine+' uses actual mode aliases, keeps absent-value semantics and fails conflicts closed',()=>{
 for(const path of ['bias.mode','sampling.mode']){
  for(const mode of ['metad','wtmetad','static']){
   const p=aliasParameters(path,mode,{mode:'',bias_file:'original.pt'}),before=structuredClone(p);assert.equal(eligibility(engine,'metad',p).allowed,true);assert.deepEqual(p,before);
  }
  const p=aliasParameters(path,'opes'),before=structuredClone(p);assert.match(eligibility(engine,undefined,p).reason,/OPES.*AI/);assert.equal(localReviewUnsupportedCode(engine,p),'LOCAL_REVIEW_UNSUPPORTED_OPES');assert.deepEqual(p,before);
 }
 for(const p of [{mode:'wtmetad',bias:{mode:'opes'}},{bias:{mode:'metad'},sampling:{mode:'wtmetad'}},{mode:'static',sampling:{mode:'wtmetad'}},{mode:'wtmetad',kernel_capacity:0,bias:{kernel_capacity:16}}]){
  const before=structuredClone(p);assert.equal(localReviewUnsupportedCode(engine,p),'LOCAL_REVIEW_PARAMETER_CONFLICT');assert.match(eligibility(engine,undefined,p).reason,/冲突/);assert.deepEqual(p,before);
 }
 assert.equal(eligibility(engine,'metad',{mode:'wtmetad',bias:{mode:'wtmetad'},sampling:{mode:'wtmetad'}}).allowed,true);
 for(const mode of [undefined,null,'',0,false,[],{},'future','OPES','bias','cvonly'])for(const path of ['mode','bias.mode','sampling.mode']){
  const p=aliasParameters(path,mode);assert.equal(eligibility(engine,'metad',p).allowed,false);assert.equal(localReviewUnsupportedCode(engine,p),'LOCAL_REVIEW_UNSUPPORTED_CONSUMER_MODE');
 }
});
for(const engine of engines)test(engine+' nested explicit manifest/kernel including zero/invalid values never opens review',()=>{
 for(const path of ['bias.manifest_file','bias.kernel_capacity'])for(const value of ['explicit.json',0,false,[],{},16]){
  const p=aliasParameters(path,value,{mode:'wtmetad'}),before=structuredClone(p);assert.equal(localReviewUnsupportedCode(engine,p),'LOCAL_REVIEW_UNSUPPORTED_CONSUMER_CONTRACT');assert.equal(eligibility(engine,'metad',p).allowed,false);assert.deepEqual(p,before);
 }
 for(const value of [undefined,null,''])assert.equal(eligibility(engine,'metad',{mode:'wtmetad',bias:{manifest_file:value,kernel_capacity:value}}).allowed,true);
});
for(const engine of engines)test('actual '+engine+' page handles alias OPES/conflicts/empty modes without IPC, even with old graph callback',{timeout:3000},async()=>{
 const original=task(engine,'wtmetad',true),h=harness('AgentTaskPage.tsx',{task:original});await h.flush();graph(h);await h.flush();const oldCallback=h.find(node=>node.type==='PygasTaskComposer').props.onStateChange;h.find(byId('open-local-review')).props.onClick();await h.flush();assert(h.all().some(node=>node.type==='LocalInputReview'));
 for(const [patch,reason]of [[{bias:{mode:'opes'}},/OPES/],[{sampling:{mode:'opes'}},/OPES/],[{mode:'wtmetad',bias:{mode:'opes'}},/冲突/],[{mode:'wtmetad',bias:{manifest_file:'original.json'}},/manifest/],[{mode:'wtmetad',bias:{kernel_capacity:0}},/kernel/],[{bias:{mode:''}},/消费模式/],[{sampling:{mode:'future'}},/消费模式/]]){
  const current={...original,parameterRevision:8,parameters:{engine,files:original.parameters.files,...patch}},before=structuredClone(current);h.changeTask(current);assert.equal(h.find(byId('open-local-review')).props.disabled,true);assert(!h.all().some(node=>node.type==='LocalInputReview'));oldCallback({loading:false,dirty:false,saving:false,error:false,renderBlocked:false,savedGraphMode:'metad'});await h.flush();assert.equal(h.find(byId('open-local-review')).props.disabled,true);assert.match(h.text(h.find(byId('local-review-ineligible'))),reason);h.find(byId('open-local-review')).props.onClick();await h.flush();assert(!h.all().some(node=>node.type==='LocalInputReview'));assert.deepEqual(current,before);
 }
 h.changeTask({...original,id:'new-owner',parameters:{engine,bias:{mode:'opes'},files:original.parameters.files}});oldCallback({loading:false,dirty:false,saving:false,error:false,renderBlocked:false,savedGraphMode:'metad'});await h.flush();assert.equal(h.find(byId('open-local-review')).props.disabled,true);assert(!h.all().some(node=>node.type==='LocalInputReview'));assert.deepEqual(h.calls,[]);h.unmount();
});
for(const language of ['zh-CN','en'])test('actual alias-conflict error is localized in '+language,{timeout:3000},async()=>{
 const h=harness('LocalInputReview.tsx',{language,api:{inspect:async()=>{throw Error("Error invoking remote method 'studio:task.localReview.inspect': Error: LOCAL_REVIEW_PARAMETER_CONFLICT");}}});await h.flush();await h.find(byId('local-review-inspect')).props.onClick();await h.flush();const message=h.text(h.find(node=>node.props?.role==='alert'));assert.match(message,language==='en'?/conflicting alias values/:/冲突.*别名/);assert.doesNotMatch(message,/invoking remote method|LOCAL_REVIEW_/);h.unmount();
});
