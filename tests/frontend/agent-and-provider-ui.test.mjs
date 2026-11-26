import {fixtureControlModule} from '../helpers/frontend-component-loader.mjs';
import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {agentHarness, conversation, deferred as _imp_0_deferred, memoryStorage} from "../helpers/agent-hooks.mjs";
import {experienceHarness, deferred as _imp_1_deferred} from "../helpers/settings-experience-hooks.mjs";
import {resumedEffort, importedCodexSelection, readCodexDefaultsCatalog} from "../../frontend/features/conversations/resume-effort.mjs";
import {missingResumeInput, parseResumeParameters, replaceResumeParameter} from "../../frontend/features/runs/resume-parameters.mjs";
import fs from "node:fs";
import ts from "typescript";

await __describe("agent-ssh-service-grant", async () => {
const test = __node_test;
const deferred = _imp_0_deferred;
const ready={kind:'ssh-terminal',selectionId:'selection',profileId:'profile',profileVersion:1,sessionId:'session',status:'selected',alive:true,workflowReady:true,managedRuns:true,authentication:'verified',agentReady:true,operator:'agent'};
const human={...ready,agentReady:false,operator:'human'};
const sendButton=h=>h.find(node=>node.type==='button'&&node.props?.['aria-label']==='发送');
const notice=h=>h.find(node=>node.props?.['data-testid']==='agent-ssh-resource-notice');
const tools=h=>{try{return h.find(node=>node.props?.['data-testid']==='agent-tools-status');}catch{h.click('agent-options');h.render();return h.find(node=>node.props?.['data-testid']==='agent-tools-status');}};
const calls=(h,method)=>h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method===method);
const missing=(h,id)=>assert.throws(()=>h.find(node=>node.props?.['data-testid']===id));
async function connected({resource=human,toolState={status:'ready',count:3},override,props={}}={}){const h=agentHarness({props:{computeResource:resource,...props},override:(method,data,standard)=>method==='agent.connect'?{tools:toolState}:override?override(method,data,standard):standard(method,data)});await h.flush();h.click('agent-connect');await h.flush();return h;}

test('connected service awaiting handoff overrides stale ready tools in banner, options and composer',async()=>{const h=await connected();try{h.type('Retain until this conversation has access');assert.match(JSON.stringify(notice(h)),/交给 Agent.*授权当前对话/);assert.doesNotMatch(JSON.stringify(notice(h)),/重新连接服务商/);missing(h,'agent-ssh-reconnect');assert.equal(tools(h).props['data-status'],'blocked');assert.match(JSON.stringify(tools(h)),/SSH 作业服务待交接/);assert.equal(sendButton(h).props.disabled,true);h.send();await h.flush();assert.equal(calls(h,'thread/start').length,0);assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Retain until this conversation has access');h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'ready',count:9}});await h.flush();assert.equal(sendButton(h).props.disabled,true);}finally{h.unmount();}});
test('a grant owned by another conversation requests take-control and handoff, not provider reconnect',async()=>{const h=await connected({resource:{...ready,agentReady:false}});try{assert.match(JSON.stringify(notice(h)),/当前对话尚无此作业服务权限.*接管/);missing(h,'agent-ssh-reconnect');h.type('kept');assert.equal(sendButton(h).props.disabled,true);}finally{h.unmount();}});
test('grant plus actual workflow tools enable the same retained draft and normal send',async()=>{const h=await connected();try{h.type('Retained request');h.render({computeResource:ready});await h.flush();missing(h,'agent-ssh-resource-notice');assert.equal(tools(h).props['data-status'],'ready');assert.match(JSON.stringify(tools(h)),/SSH 工作流工具已连接/);assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(calls(h,'turn/start').length,1);assert.equal(h.textarea().props.value,'');}finally{h.unmount();}});
for(const toolState of [{status:'blocked',count:0},{status:'ready',scope:'terminal-only',count:3}])test('service grant still requires actual workflow tools: '+JSON.stringify(toolState),async()=>{const h=await connected({resource:ready,toolState});try{h.type('Retained unavailable tools');assert.equal(sendButton(h).props.disabled,true);assert.equal(tools(h).props['data-status'],'blocked');assert(h.find(node=>node.props?.['data-testid']==='agent-ssh-reconnect'));h.send();await h.flush();assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Retained unavailable tools');h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'ready',count:3}});await h.flush();assert.equal(sendButton(h).props.disabled,false);}finally{h.unmount();}});
for(const phase of ['thread/start','conversation.remember','task.create'])test('taking control during '+phase+' invalidates pending send despite unchanged selection and workflow readiness',async()=>{const gate=deferred(),h=await connected({resource:ready,props:{planningMode:phase==='task.create'},override:(method,data,standard)=>method===phase||method==='agent.rpc'&&data.method===phase?gate.promise:standard(method,data)});try{h.type('Do not consume revoked draft');h.send();await h.flush();h.render({computeResource:human});gate.resolve(phase==='thread/start'?{thread:{id:'started-thread'}}:phase==='task.create'?{id:'fixture-task'}:conversation('codex','started-thread'));await h.flush();assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Do not consume revoked draft');assert.equal(sendButton(h).props.disabled,true);h.render({computeResource:ready});await h.flush();assert.equal(sendButton(h).props.disabled,false);assert.equal(calls(h,'turn/start').length,0,'regrant does not replay the previous send');}finally{h.unmount();}});
test('tool readiness lost during workflow creation is checked again before model submission',async()=>{const gate=deferred(),h=await connected({resource:ready,props:{planningMode:true},override:(method,data,standard)=>method==='task.create'?gate.promise:standard(method,data)});try{h.type('Keep if tools become unavailable');h.send();await h.flush();h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'blocked',count:0}});await h.flush();gate.resolve({id:'fixture-task'});await h.flush();assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Keep if tools become unavailable');assert.equal(sendButton(h).props.disabled,true);}finally{h.unmount();}});

const connectionReady={...ready,schemaVersion:2,kind:'ssh-connection',connectionId:'connection',sessionId:null,terminalSessionIds:[],connectionStatus:'authenticated',capabilities:{terminal:{status:'closed',sessionIds:[],agentReady:false,operator:'human'},service:{status:'connected',agentReady:true,workflowReady:true,operator:'agent'},files:{status:'requires_authorized_project',via:'job-service'}}};
test('inventory warning is visible without opening settings and does not block an authorized configuration conversation',async()=>{const h=await connected({resource:connectionReady,toolState:{status:'ready',scope:'workflow',count:3,warning:true,message:'工具清单待核对，可继续配置环境。'}});try{assert.match(JSON.stringify(h.find(n=>n.props?.['data-testid']==='agent-tools-warning')),/配置环境/);h.type('Inspect the existing environment before installing');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(calls(h,'turn/start').length,1);}finally{h.unmount();}});
test('late native inventory warning is displayed and cleared without changing the active grant or draft',async()=>{const h=await connected({resource:connectionReady,toolState:{status:'ready',scope:'workflow',count:3}});try{h.type('Kept draft');h.emit({provider:'codex',method:'studio/toolsWarning',params:{warnings:['studio_tool_inventory_unavailable'],message:'工具待配置'}});await h.flush();assert.match(JSON.stringify(h.find(n=>n.props?.['data-testid']==='agent-tools-warning')),/工具待配置/);assert.equal(sendButton(h).props.disabled,false);assert.equal(h.textarea().props.value,'Kept draft');h.emit({provider:'codex',method:'studio/toolsWarning',params:{warnings:[]}});await h.flush();missing(h,'agent-tools-warning');assert.equal(h.textarea().props.value,'Kept draft');}finally{h.unmount();}});
test('schema2 service grant enables workflow tools without any shell',async()=>{const h=await connected({resource:connectionReady,toolState:{status:'ready',scope:'workflow',count:3}});try{h.type('Service without a shell');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(calls(h,'turn/start').length,1);}finally{h.unmount();}});
test('closing an independent shell during thread preparation preserves the service send',async()=>{const gate=deferred(),withShell={...connectionReady,sessionId:'shell',terminalSessionIds:['shell'],capabilities:{...connectionReady.capabilities,terminal:{status:'ready',sessionIds:['shell'],agentReady:true,operator:'agent'}}},h=await connected({resource:withShell,toolState:{status:'ready',scope:'workflow',count:3},override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'?gate.promise:standard(method,data)});try{h.type('Keep service access');h.send();await h.flush();h.render({computeResource:connectionReady});gate.resolve({thread:{id:'started-thread'}});await h.flush();assert.equal(calls(h,'turn/start').length,1);assert.equal(h.textarea().props.value,'');}finally{h.unmount();}});
test('a shell grant cannot mask a revoked service grant while stale workflow tools remain ready',async()=>{const revoked={...connectionReady,agentReady:true,capabilities:{...connectionReady.capabilities,terminal:{status:'ready',sessionIds:['shell'],agentReady:true,operator:'agent'},service:{...connectionReady.capabilities.service,agentReady:false,operator:'human'}}},h=await connected({resource:revoked,toolState:{status:'ready',scope:'workflow',count:3}});try{h.type('Retain revoked workflow draft');assert.equal(sendButton(h).props.disabled,true);h.send();await h.flush();assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Retain revoked workflow draft');}finally{h.unmount();}});

test('first message captures a waiting SSH terminal, checks its service and dispatches once',async()=>{
 const armed={...connectionReady,agentReady:false,canAcquireConversationTerminal:true,capabilities:{...connectionReady.capabilities,service:{status:'disconnected',workflowReady:false,agentReady:false,operator:'human'}}};
 const h=await connected({resource:armed,props:{projectId:'selected-project'},toolState:{status:'blocked',count:0},override:(method,data,standard)=>method==='compute.resource.status'?connectionReady:method==='agent.tools'?{status:'ready',scope:'workflow',count:3}:standard(method,data)});
 try{h.type('Read the terminal');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();const starts=calls(h,'thread/start');assert.equal(starts.length,1);assert.equal(starts[0].data.params.studioInitialProjectId,'selected-project');assert.equal(calls(h,'turn/start').length,1);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
test('a route change during preparation retains the draft instead of sending over another granted channel',async()=>{const gate=deferred(),both={...connectionReady,capabilities:{...connectionReady.capabilities,terminal:{status:'ready',sessionIds:['shell'],agentReady:true,operator:'agent'}}},h=await connected({resource:both,toolState:{status:'ready',scope:'workflow',count:3},override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'?gate.promise:standard(method,data)});try{h.type('Stay on selected service route');h.send();await h.flush();h.emit({provider:'codex',method:'studio/toolsStatus',params:{status:'ready',scope:'terminal-only',count:3}});await h.flush();gate.resolve({thread:{id:'started-thread'}});await h.flush();assert.equal(calls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Stay on selected service route');}finally{h.unmount();}});
});

await __describe("model-selection", async () => {
const test = __node_test;
const catalog=[{id:'api:a:one',model:'api:a:one',profileId:'a',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'off'},{reasoningEffort:'high'}],defaultReasoningEffort:'off'},{id:'api:a:two',model:'api:a:two',profileId:'a',supportedReasoningEfforts:[{reasoningEffort:'off'},{reasoningEffort:'high'}],defaultReasoningEffort:'off'}];
test('reasoning preferences are remembered independently for each configured model',async()=>{const storage=memoryStorage();storage.setItem('studio.effort.qwen.api:a:one','high');storage.setItem('studio.effort.qwen.api:a:two','off');const h=agentHarness({storage,override:async(method,data,standard)=>method==='state'?{settings:{agentProvider:'qwen'}}:method==='agent.rpc'&&['model/list','model/select'].includes(data.method)?{data:catalog}:standard(method,data)});try{await h.flush();h.click('agent-connect');await h.flush();assert.equal(h.find(v=>v.props?.['data-testid']==='composer-effort').props.value,'high');h.find(v=>v.props?.['data-testid']==='composer-model').props.onChange({target:{value:'api:a:two'}});await h.flush();assert.equal(h.find(v=>v.props?.['data-testid']==='composer-effort').props.value,'off');h.find(v=>v.props?.['data-testid']==='composer-model').props.onChange({target:{value:'api:a:one'}});await h.flush();assert.equal(h.find(v=>v.props?.['data-testid']==='composer-effort').props.value,'high');assert.deepEqual(h.errors,[]);}finally{h.unmount();}});
});

await __describe("provider-login-experience", async () => {
const test = __node_test;
const deferred = _imp_1_deferred;
const saved={schemaVersion:1,id:'fixture-api',provider:'compatible',name:'Fixture API',baseUrl:'https://fixture.invalid/v1',api:'openai-completions',preset:'custom',models:[{id:'model-a',reasoningEfforts:{off:null,high:'high'}}],defaultModel:'model-a',credentialStored:true,revision:1};
function setup(override,props={}){let current=structuredClone(saved);return experienceHarness({component:'ModelProviders',props,invoke:async(method,data)=>{const result=override?.(method,data);if(result!==undefined)return result;if(method==='models.profiles.list')return [current];if(method==='models.profiles.save'){current={...data.profile,defaultModel:data.profile.models.some(v=>v.id===data.profile.defaultModel)?data.profile.defaultModel:data.profile.models[0].id,revision:current.revision+1,credentialStored:true};return current;}if(method==='models.profiles.test')return {status:'passed',model:data.model};if(method==='models.profiles.discover')return {source:'endpoint',models:[{id:'model-a'},{id:'model-b',contextWindow:64000}]};if(method==='models.profiles.remove')return {removed:true};throw Error('Unexpected action '+method);}});}
const imageCheckbox=h=>h.find(node=>node.type==='input'&&node.props['aria-label']==='支持图片输入');
test('keyless local settings display the text-only default for a legacy model',async()=>{
 const h=setup(method=>method==='models.profiles.list'?[{...saved,baseUrl:'http://127.0.0.1:11434/v1',requiresApiKey:false,credentialStored:false}]:undefined);
 try{
  await h.flush();
  assert.match(h.text(),/本机服务无需密钥/);
  assert.equal(h.byId('provider-api-key').props.value,'');
  assert.equal(imageCheckbox(h).props.checked,false);
 }finally{h.unmount();}
});
test('model image capability is saved per model and reloads from the profile',async()=>{
 const h=setup();
 try{
  await h.flush();
  for(const checked of [true,false]){
   imageCheckbox(h).props.onChange({target:{checked}});
   await h.flush();
   h.byId('save-api-provider').props.onClick();
   await h.flush();
   const savedProfile=h.calls.filter(call=>call.method==='models.profiles.save').at(-1).data.profile;
   assert.deepEqual(savedProfile.models[0].input,checked?['text','image']:['text']);
   h.render({provider:'qwen'});
   await h.flush();
   h.render({provider:'compatible'});
   await h.flush();
   assert.equal(imageCheckbox(h).props.checked,checked);
  }
 }finally{h.unmount();}
});
test('API model editor requires save before validation and does not redisplay a stored key',async()=>{const h=setup();try{await h.flush();assert.equal(h.byId('provider-api-key').props.value,'');h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.toasts.at(-1).message,/测试调用成功.*model-a/);h.change(h.byId('api-model-id-0'),'model-b');assert.equal(h.toasts.length,0);assert(h.byId('test-api-provider').props.disabled);h.byId('test-api-provider').props.onClick();await h.flush();assert.equal(h.calls.filter(v=>v.method==='models.profiles.test').length,1);h.byId('save-api-provider').props.onClick();await h.flush();h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.toasts.at(-1).message,/测试调用成功.*model-b/);assert.equal(h.calls.some(v=>/agent\.cli|agent\.login/.test(v.method)),false);}finally{h.unmount();}});
test('validation is single-flight and blocks simultaneous saves before rerender',async()=>{const gate=deferred(),h=setup(method=>method==='models.profiles.test'?gate.promise:undefined);try{await h.flush();const check=h.byId('test-api-provider').props.onClick,save=h.byId('save-api-provider').props.onClick;check();check();save();await h.flush();assert.equal(h.calls.filter(v=>v.method==='models.profiles.test').length,1);assert.equal(h.calls.filter(v=>v.method==='models.profiles.save').length,0);assert(h.byId('model-provider-editor').props.disabled);gate.resolve({model:'model-a'});await h.flush();assert.equal(h.byId('model-provider-editor').props.disabled,false);}finally{h.unmount();}});
test('model discovery merges selected additions without overwriting existing reasoning mappings',async()=>{const h=setup();try{await h.flush();h.byId('discover-api-models').props.onClick();await h.flush();h.find(v=>v.type==='input'&&v.props?.type==='checkbox'&&v.props.checked===false).props.onChange({target:{checked:true}});await h.flush();h.byId('adopt-api-models').props.onClick();await h.flush();h.byId('save-api-provider').props.onClick();await h.flush();const request=h.calls.find(v=>v.method==='models.profiles.save');assert.deepEqual(request.data.profile.models[0].reasoningEfforts,{off:null,high:'high'});assert.equal(request.data.profile.models[1].id,'model-b');assert.equal(request.data.profile.models[1].contextWindow,64000);}finally{h.unmount();}});
test('changing API endpoint clears address-scoped public guide sharing',async()=>{const h=setup(method=>method==='models.profiles.list'?[{...saved,sharePublicGuides:true}]:undefined);try{await h.flush();assert.equal(h.byId('provider-public-guides').props.checked,true);h.change(h.byId('provider-base-url'),'https://other.invalid/v1');assert.equal(h.byId('provider-public-guides').props.checked,false);}finally{h.unmount();}});
test('late discovery and validation cannot update another provider tab',async()=>{for(const action of ['discover','test']){const gate=deferred(),h=setup(method=>method==='models.profiles.'+action?gate.promise:method==='models.profiles.list'?[saved]:undefined);try{await h.flush();h.byId(action==='test'?'test-api-provider':'discover-api-models').props.onClick();await h.flush();h.render({provider:'qwen'});await h.flush();gate.resolve(action==='test'?{model:'obsolete'}:{models:[{id:'obsolete'}]});await h.flush();assert(!h.text().includes('obsolete'));assert.equal(h.byId('model-provider-editor').props.disabled,false);}finally{h.unmount();}}});
test('failed API verification remains visible and retry does not require a CLI',async()=>{const h=setup(method=>method==='models.profiles.test'?Promise.reject(Error('Synthetic API unavailable')):undefined,{provider:'qwen'});try{await h.flush();h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.text(),/Synthetic API unavailable/);assert.equal(h.byId('test-api-provider').props.disabled,false);assert.equal(h.calls.some(v=>v.method.startsWith('agent.cli')),false);}finally{h.unmount();}});
test('DeepSeek account mode resets endpoint, protocol, plaintext field and endpoint consent',async()=>{const h=setup(method=>method==='models.profiles.list'?[{...saved,sharePublicGuides:true}]:undefined);try{await h.flush();h.change(h.byId('provider-api-key'),'synthetic-unsaved-key');h.change(h.byId('provider-auth-mode'),'deepseek-account');assert.equal(h.byId('provider-base-url').props.value,'https://api.deepseek.com/anthropic');assert.equal(h.byId('provider-protocol').props.value,'anthropic-messages');assert.equal(h.byId('provider-api-key').props.value,'');assert.equal(h.byId('provider-public-guides').props.checked,false);assert.match(h.text(),/账户令牌与 API Key 不同/);}finally{h.unmount();}});
test('new Qwen provider defaults to Token Plan and text input',async()=>{const h=experienceHarness({component:'ModelProviders',props:{provider:'qwen'},invoke:async()=>[]});try{await h.flush();h.byId('add-api-provider').props.onClick();await h.flush();assert.equal(h.byId('provider-preset').props.value,'token-cn');assert.match(h.byId('provider-base-url').props.value,/token-plan/);assert.equal(imageCheckbox(h).props.checked,false);assert.equal(h.calls.some(v=>/cli|login/.test(v.method)),false);}finally{h.unmount();}});
});

await __describe("resume-effort", async () => {
const test = __node_test;
const model={supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'high'};
test('fresh model preferences use only the advertised model and reasoning levels',()=>{
 const catalog=[{...model,model:'default',isDefault:true},{...model,model:'chosen'}];
 assert.deepEqual(importedCodexSelection(catalog,{effort:'low'}),{model:'default',effort:'low',reason:null});
 assert.deepEqual(importedCodexSelection(catalog,{model:'chosen'}),{model:'chosen',effort:'high',reason:null});
 assert.equal(importedCodexSelection(catalog,{model:'unlisted',effort:'low'}).reason,'model');
 assert.equal(importedCodexSelection(catalog,{model:'chosen',effort:'unlisted'}).reason,'effort');
});
test('incomplete or repeated model pages cannot be reported as an unavailable account model',async()=>{
 const page=async()=>({data:[],nextCursor:'same-cursor'});
 await assert.rejects(readCodexDefaultsCatalog(page,()=>true),/模型目录读取不完整/);
 await assert.rejects(readCodexDefaultsCatalog(()=>assert.fail('stale connection'),()=>false),/connection changed/);
});
test('explicit provider low survives a restored server high when supported',()=>assert.equal(resumedEffort({provider:'codex',preferences:{codex:'low'},model,serverEffort:'high'}),'low'));
test('unsupported saved choice falls back only to a supported server choice',()=>assert.equal(resumedEffort({provider:'codex',preferences:{codex:'xhigh'},model,serverEffort:'high'}),'high'));
test('missing saved choice uses supported server effort before model default',()=>assert.equal(resumedEffort({provider:'codex',model,serverEffort:'low'}),'low'));
test('unsupported server effort uses the declared supported model default',()=>assert.equal(resumedEffort({provider:'codex',model,serverEffort:'unsupported'}),'high'));
test('provider preference never leaks from another provider',()=>{assert.equal(resumedEffort({provider:'kimi',preferences:{codex:'low'},model,serverEffort:'high'}),'high');assert.equal(resumedEffort({provider:'deepseek',preferences:{codex:'high',deepseek:'none'},model:{supportedReasoningEfforts:[{reasoningEffort:'none'},{reasoningEffort:'high'}]},serverEffort:'high'}),'none');});
test('missing catalog or unsupported default cannot invent an advertised effort',()=>{assert.equal(resumedEffort({provider:'codex',preferences:{codex:'low'},serverEffort:'high'}),'');assert.equal(resumedEffort({provider:'codex',model:{supportedReasoningEfforts:[],defaultReasoningEffort:'high'},serverEffort:'high'}),'');});
test('selection does not mutate preferences or catalog',()=>{const input={provider:'codex',preferences:{codex:'low'},model,serverEffort:'high'},copy=structuredClone(input);resumedEffort(input);assert.deepEqual(input,copy);});
});

await __describe("resume-parameters", async () => {
const test = __node_test;
test('a structured edit changes only the effective JSON member, preserving other raw source',()=>{
 const raw=String.raw`{"checkpoint_files":["prior"],"controls":{"escaped":"\"}:,[]","value":12345678901234567890}, "checkpoint_\u0066iles" : [ "current" ] }`;
 const changed=replaceResumeParameter(raw,'checkpoint_files',['generation/checkpoint 1.pt','generation/checkpoint 2.pt']);
 assert.equal(changed,raw.replace('[ "current" ]','["generation/checkpoint 1.pt","generation/checkpoint 2.pt"]'));
 const added=replaceResumeParameter(changed,'continuation_script','/owned/continue.py');
 assert.equal(parseResumeParameters(added).continuation_script,'/owned/continue.py');
 assert.deepEqual(parseResumeParameters(added).checkpoint_files,['generation/checkpoint 1.pt','generation/checkpoint 2.pt']);
 assert(added.includes('12345678901234567890'));
});

test('sparse writes add into empty or nested JSON and never replace invalid user source',()=>{
 for(const source of ['{}',' {\r\n } ','{"other":[true,{"name":"checkpoint_files"}]}']){
  const result=replaceResumeParameter(source,'checkpoint_files',['step/restart.xyz']);
  assert.deepEqual(parseResumeParameters(result),{...parseResumeParameters(source),checkpoint_files:['step/restart.xyz']});
 }
 assert.throws(()=>replaceResumeParameter('[]','checkpoint_files',['x']),/JSON 对象/);
 assert.throws(()=>replaceResumeParameter('{bad JSON','checkpoint_files',['x']),SyntaxError);
});

test('new-attempt guidance follows each engine’s required names without rejecting extra data',()=>{
 const scenarios=[
  ['gpumd.md',{checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/continue.in'},'continuation_run_in',/run.in/],
  ['gpumd.sampling',{checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/continue.in'},'checkpoint_files',/checkpoint_files/],
  ['hotpp.train',{checkpoint_files:['saved/model.ckpt'],checkpoint:'saved/model.ckpt',continuation_config:'/owned/continue.yaml'},'checkpoint',/HotPP checkpoint/],
  ['pydyn.md',{checkpoint_files:['step/md.json'],continuation_script:'/owned/continue.py'},'continuation_script',/脚本/],
  ['pydyn.sampling',{checkpoint_files:['step/pair.json'],continuation_script:'/owned/continue.py',paired_manifest:'step/pair.json'},'paired_manifest',/配对清单/],
 ];
 for(const [engine,parameters,key,reason] of scenarios){
  assert.equal(missingResumeInput(engine,{...parameters,extension:{temperature:500}}),null);
  assert.match(missingResumeInput(engine,{...parameters,[key]:undefined}),reason);
 }
 assert.match(missingResumeInput('gpumd.md',{checkpoint_files:['unrelated.xyz']}),/restart\.xyz/);
 assert.match(missingResumeInput('pydyn.sampling',{...scenarios[4][1],paired_manifest:'another.json'}),/配对清单/);
 assert.equal(missingResumeInput('pydyn.md',{checkpoint_files:{'older-state.json':true},continuation_script:'/owned/continue.py'}),null);
});
});

await __describe("skills-refresh", async () => {
const test = __node_test;
function harness(override){
 const hooks=[],effects=[],calls=[],toasts=[];let cursor=0,dirty=false,tree;
 const toast={show:entry=>toasts.push(entry)};
 const props={provider:'codex',settings:{},onSaved(){},onSelect(){},onError(){}};
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];};
 const useRef=value=>{const i=cursor++;return hooks[i]??(hooks[i]={current:value});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const jsx=(type,props)=>({type,props});
 const invoke=async(method,data)=>{calls.push({method,data});const v=override?.(method,data);if(v!==undefined)return await v;if(method==='scientific.skills')return {schema_version:1,functions:[]};if(method==='skills.catalog')return [];if(method==='state')return {settings:{}};throw Error('Unexpected write');};
 const require=name=>name.endsWith('/Toast')?{useToast:()=>toast}:fixtureControlModule(name)??(name==='react'?{useState,useEffect,useRef}:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==="../../api/studio"?{invoke}:name==="../../ui/i18n"?{t:x=>x}:new Proxy({},{get:(_t,key)=>String(key)}));
 const code=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/tools/SkillsWorkbench.tsx",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let i=0;i<15;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty)render();}}
 const find=fn=>{const n=all(tree).find(fn);assert(n);return n;};render();
 return {props,calls,toasts,render,flush,text,find,status:()=>find(n=>n.props?.['data-testid']==='resource-refresh-status'),refresh:()=>find(n=>n.type==='button'&&text(n)==='刷新资源').props.onClick(),unmount:()=>hooks.forEach(h=>h?.cleanup?.())};
}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
test('real resources component reports refresh completion for empty catalogs without claiming availability',async()=>{
 const h=harness();await h.flush();assert.match(h.text(h.status()),/已刷新/);assert.equal(h.status().props['aria-live'],undefined);assert.equal(h.toasts.length,0);
 h.refresh();await h.flush();assert.match(h.text(h.status()),/已刷新/);assert.deepEqual(h.toasts,[{message:'已刷新'}]);assert(!h.calls.some(c=>c.method==='settings'));h.unmount();
});
test('partial catalog results retain errors and do not announce success',async()=>{
 const h=harness(m=>m==='scientific.skills'?Promise.reject(Error('catalog unavailable')):undefined);await h.flush();assert.equal(h.text(h.status()),'');assert.match(h.text(h.find(n=>n.props?.title==='暂时无法读取全部科学资源').props.details),/功能目录读取失败/);assert.equal(h.toasts.length,0);h.unmount();
});
test('late old-provider refresh cannot announce completion in the new provider',async()=>{
 const old=deferred(),next=deferred();const h=harness((m,d)=>m==='scientific.skills'?(d.provider==='codex'?old.promise:next.promise):undefined);await h.flush();h.props.provider='kimi';h.render();await h.flush();old.resolve({schema_version:1,functions:[]});await h.flush();assert.equal(h.text(h.status()),'');next.resolve({schema_version:1,functions:[]});await h.flush();assert.match(h.text(h.status()),/已刷新/);h.unmount();
});

test('current Chinese source labels map stable studio IDs to AIMatterLab and preserve engine names',async()=>{
 const route={id:'sampling.gpumd',phase:'sampling',status:'source_guidance_only',engines:['GPU-Sampling'],tools:[],sources:['studio','gpumd'],permission:'allowed',source_status:'registered'};
 const h=harness(method=>method==='scientific.skills'?{schema_version:1,functions:[route]}:undefined);await h.flush();
 const displayed=h.text(h.find(node=>node.props?.className==='skill-function'));
 assert.match(displayed,/GPU-Sampling/);assert.match(displayed,/AIMatterLab \+ gpumd/);assert.doesNotMatch(displayed,/Studio/);assert.deepEqual(route.sources,['studio','gpumd']);h.unmount();
});
});
