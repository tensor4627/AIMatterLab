import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {taskSchemas} from "../../contracts/workflows/plan-schema.mjs";
import {validatePlan} from "../../contracts/workflows/plan.mjs";
import {tasks, createPlan} from "../../frontend/features/workflows/workflow-catalog.mjs";
import {assertWorkerRoute, assertRendererWorkerRoute} from "../../contracts/transport-policy.mjs";
import {registerSshConnectionRoutes, validateSshConnectionRequest} from "../../backend/main/compute/ssh-connection-ipc.mjs";
import {SCIENTIFIC_TOOL_ACCESS} from "../../agent/tools/private-cv-access.mjs";
import {normalizeSteps, workflowMissing} from "../../contracts/workflows/task-fields.mjs";
import {stageFixture, configured} from "../helpers/task-stage-fixture.mjs";

await __describe("compute-profile-removal-ipc", async () => {
const test = __node_test;
test('preload exposes only the named saved-profile removal method and forwards the exact request',async()=>{
 const calls=[];let studio;const source=fs.readFileSync(new URL('../../desktop/preload.cjs',import.meta.url),'utf8');
 vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'studio');studio=value;}},ipcRenderer:{invoke:async(channel,data)=>{calls.push({channel,data});return {removed:true,id:data.id,version:data.expectedVersion};}}};}});
 const request={id:'00000000-0000-4000-8000-000000000001',expectedVersion:3},response=await studio.invoke('compute.profiles.remove',request);
 assert.equal(calls[0].channel,'studio:compute.profiles.remove');assert.equal(calls[0].data,request);assert.equal(response.removed,true);assert.equal(response.version,3);
 await assert.rejects(studio.invoke('compute.profiles.removeRemote',request),/Unsupported method/);assert.equal(calls.length,1);
});
});

await __describe("domain-contract-ownership", async () => {
const test = __node_test;
const root=fileURLToPath(new URL('../..',import.meta.url));
test('persisted plan schema matches every frontend catalogue task and required step',()=>{
 assert.deepEqual(taskSchemas,tasks.map(({id,steps})=>({id,steps:steps.map(({id,required})=>({id,required}))})));
 for(const task of tasks){const plan=createPlan(task.id);assert.deepEqual(validatePlan(plan),plan);}
});

test('former shared contracts are pure boundaries and the legacy generic source root is absent',()=>{
 assert.equal(fs.existsSync(path.join(root,'shared')),false);
 const files=['contracts/agent/conversation-title.mjs','contracts/agent/provider-account.mjs','contracts/agent/user-message.mjs','contracts/compute/deployment.mjs','contracts/compute/deployment-draft.mjs','contracts/compute/deployment-authorization.mjs','contracts/compute/project-policy.mjs','contracts/compute/task-worker-binding.mjs','contracts/tools/engine-contracts.mjs','contracts/workflows/task-fields.mjs','contracts/workflows/known-run-reconcile.mjs','contracts/workflows/local-review-eligibility.mjs','contracts/workflows/plan.mjs','contracts/workflows/plan-schema.mjs'];
 for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);for(const node of source.statements){if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;const spec=node.moduleSpecifier?.text;if(!spec)continue;assert(spec.startsWith('.'),file+': '+spec);const target=path.resolve(path.dirname(path.join(root,file)),spec);assert(target.startsWith(path.join(root,'contracts')+path.sep),file+': '+spec);}}
});
});

await __describe("renderer-worker-route", async () => {
const test = __node_test;
test('generic renderer port refuses every privileged custom action and all canonicalized aliases',()=>{
 for(const action of ['read','save','approve-formula','approve-code','sharing','validate','status','reuse','attach','access','provider-read','provider-status']){
  const direct='/api/custom-cv/'+action;assert.doesNotThrow(()=>assertWorkerRoute('POST',direct));
  for(const target of [direct,direct+'?id=owned',direct+'#fragment','/api/./custom-cv/'+action,'/api/x/../custom-cv/'+action,'/api/%2e/custom-cv/'+action,'/api/x/%2e%2e/custom-cv/'+action,'http://127.0.0.1'+direct,'//127.0.0.1'+direct,'/api\\custom-cv/'+action])assert.throws(()=>assertRendererWorkerRoute('POST',target),undefined,target);
 }
});
test('canonical ordinary UI routes remain available and unrelated targets fail',()=>{
 for(const [method,target]of [['GET','/api/projects'],['GET','/api/runs?project_id=owned'],['POST','/api/pygas/composition/read'],['POST','/api/cluster/cancel'],['POST','/api/run/reconcile']])assert.doesNotThrow(()=>assertRendererWorkerRoute(method,target));
 for(const value of [null,{},'/api/projects#hash','https://elsewhere.invalid/api/projects','/api/projects\n'])assert.throws(()=>assertRendererWorkerRoute('GET',value));
});


test('Empty graph initialization remains a dedicated human action, never generic renderer HTTP',()=>{assert.doesNotThrow(()=>assertWorkerRoute('POST','/api/pygas/composition/initialize'));assert.throws(()=>assertRendererWorkerRoute('POST','/api/pygas/composition/initialize'),/typed human graph/);assert.throws(()=>assertRendererWorkerRoute('POST','/api/pygas/composition/read/../initialize'));});
});

await __describe("ssh-connection-ipc", async () => {
const test = __node_test;
const names=['open','list','state','authRead','authInput','authResize','confirm','completeLogin','loginStatus','openShell','close'];
const body=method=>method==='open'?{profileId:'profile',profileVersion:1,requestId:'open-request'}:method==='list'?{}:method==='authInput'?{connectionId:'connection',requestId:'input-request',data:'SYNTHETIC_TEST_INPUT'}:method==='authResize'?{connectionId:'connection',cols:90,rows:30}:['openShell','completeLogin','loginStatus'].includes(method)?{connectionId:'connection',requestId:'shell-request'}:{connectionId:'connection'};
test('each new privileged route uses actual main sender validation and retains human-only authentication entry points',async()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declarations=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&['handle','trusted'].includes(node.name?.text)).map(node=>node.getText(tree));
 let registration;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='registerSshConnectionRoutes')registration=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.equal(declarations.length,2);assert(registration);
 const handlers=new Map(),calls=[],events=[],service={connectionLost:id=>calls.push({method:'serviceUnknown',id}),connectionClosed:id=>calls.push({method:'serviceClosed',id})},connections=Object.fromEntries(names.map(method=>[method,async value=>{
  calls.push({method,value});
  if(method==='list')return {connections:[]};
  if(method==='completeLogin')return {connection:{connectionId:value.connectionId,profileId:'profile',profileVersion:1,loginRequestId:value.requestId,
   status:'authenticated',authentication:'verified',capabilities:{multiplex:true}}};
  return {connectionId:value.connectionId||'new-connection',...method==='close'?{status:'closed',closed:true}:{}};
 }]));
 const context={registerSshConnectionRoutes,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},sharedTerminal:{connections},sshService:service,
  managedResources:{revokeConnection:({connectionId:id})=>calls.push({method:'resourceRevoked',id}),
   noteLogin:value=>calls.push({method:'noteLogin',value}),restoreHosted:(value,requestId)=>calls.push({method:'restoreHosted',value,requestId})},
  workspaceTerminalAuthorization:{revokeConnection:id=>calls.push({method:'workspaceRevoked',id})},conversationTerminals:{releaseConnection:id=>calls.push({method:'releaseConversation',id})},
  emit:(_channel,value)=>events.push(value),shuttingDown:false,window:{isDestroyed:()=>false,webContents:{id:41,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}}};
 vm.runInNewContext(declarations.join('\n')+'\n'+registration,context);
 const valid={sender:{id:41,isDestroyed:()=>false},senderFrame:{parent:null,url:'file:///studio/index.html'}};
 for(const method of names){const route=handlers.get('studio:compute.sshConnection.'+method);assert(route);for(const change of [{sender:{id:42,isDestroyed:()=>false}},{senderFrame:{parent:{},url:'file:///studio/index.html'}},{senderFrame:{parent:null,url:'https://foreign.invalid'}}])await assert.rejects(route({...valid,...change},body(method)),/Untrusted IPC/);}
 assert.equal(calls.length,0);
 for(const method of names)await handlers.get('studio:compute.sshConnection.'+method)(valid,body(method));
 assert.equal(calls.filter(call=>call.method==='noteLogin').length,1);
 assert.equal(calls.filter(call=>call.method==='restoreHosted'&&call.requestId==='shell-request'&&call.value.profileId==='profile').length,1);
 assert.equal(calls.filter(c=>c.method==='authInput').length,1);const close=calls.findIndex(c=>c.method==='close');assert.equal(calls[close-1].method,'serviceUnknown');assert.equal(calls[close+1].method,'serviceClosed');assert.equal(calls[close-4].method,'resourceRevoked');assert.deepEqual(calls[close-2],{method:'workspaceRevoked',id:'connection'});assert(events.some(e=>e.method==='studio/sshConnectionChanged'));
 for(const name of ['authInput','authRead','open','confirm','completeLogin','loginStatus'])assert.equal(Object.hasOwn(SCIENTIFIC_TOOL_ACCESS,'compute.sshConnection.'+name),false);
});
test('connection IPC rejects extra fields, injected identities and invalid authentication bounds before dispatch',()=>{
 for(const method of names)assert.throws(()=>validateSshConnectionRequest(method,{...body(method),command:'do-not-run'}),/invalid_request/);
 for(const method of names.filter(n=>!['open','list'].includes(n)))assert.throws(()=>validateSshConnectionRequest(method,{...body(method),connectionId:'../../other'}),/invalid_request/);
 for(const value of [{connectionId:'connection',cursor:-1},{connectionId:'connection',maxBytes:65537},{connectionId:'connection',cursor:1.5}])assert.throws(()=>validateSshConnectionRequest('authRead',value),/invalid_request/);
 for(const data of ['',null,123,'x'.repeat(8193)])assert.throws(()=>validateSshConnectionRequest('authInput',{...body('authInput'),data}),/invalid_request/);
 assert.throws(()=>validateSshConnectionRequest('open',{...body('open'),profileVersion:0}),/invalid_request/);
 assert.throws(()=>validateSshConnectionRequest('authResize',{...body('authResize'),rows:1}),/invalid_request/);
});
test('actual preload admits only the declared connection methods and no authentication wildcard',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(new URL('../../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return args[1];},on(){},removeListener(){}}})});
 for(const method of names){const value=body(method);assert.equal(await bridge.invoke('compute.sshConnection.'+method,value),value);}
 for(const method of ['execute','spawn','authenticate','readKey','grantProject','reconnect'])await assert.rejects(bridge.invoke('compute.sshConnection.'+method,{}),/Unsupported/);
 assert.equal(calls.length,names.length);
});
test('a lost whole-connection close acknowledgement revokes use but retains unknown attempt evidence without retry',async()=>{
 const handlers=new Map(),effects=[];let calls=0;
 registerSshConnectionRoutes({handle:(name,fn)=>handlers.set(name,fn),connections:{close:async()=>{calls++;throw Error('unconfirmed');}},onClosing:id=>effects.push(['closing',id]),onUnknown:id=>effects.push(['unknown',id]),onClosed:id=>effects.push(['closed',id])});
 await assert.rejects(handlers.get('compute.sshConnection.close')({connectionId:'exact-owned-connection'}),/unconfirmed/);
 assert.equal(calls,1);assert.deepEqual(effects,[['closing','exact-owned-connection'],['unknown','exact-owned-connection']]);
});
});

await __describe("stage-dto-ownership", async () => {
const test = __node_test;
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));

test('renderer API clients depend on contracts, not on feature implementations',()=>{
 const directory=path.join(root,'frontend','api');
 for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.ts'))){
  const source=fs.readFileSync(path.join(directory,name),'utf8');
  assert.doesNotMatch(source,/from ['"](?:\.\.\/)+features\//,`${name} imports feature implementation types`);
 }
});

test('staged authoring DTOs live in contracts and the old feature copies are gone',()=>{
 const dto=fs.readFileSync(path.join(root,'contracts','dto','stage.ts'),'utf8');
 for(const name of ['StageInspection','TaskStageApi','ConsumerPrefill','ConsumerStageInspection','ConsumerStageProposal','ConsumerTargetScope','ConsumerTargetInspection','ConsumerArtifactOption','ConsumerArtifactList','ConsumerArtifactAdoption','ConsumerArtifactApi']){
  assert.match(dto,new RegExp('(?:interface|type) '+name+'\\b'),'missing contract type '+name);
 }
 for(const stale of ['task-stage-types.ts','consumer-stage-types.ts','consumer-artifact-types.ts']){
  assert.equal(fs.existsSync(path.join(root,'frontend','features','workflows',stale)),false,'stale feature DTO remains: '+stale);
 }
});

test('the moved DTOs import only pure contract modules',()=>{
 const dto=fs.readFileSync(path.join(root,'contracts','dto','stage.ts'),'utf8');
 for(const match of dto.matchAll(/from ['"]([^'"]+)['"]/g)){
  assert.ok(match[1].startsWith('../workflows/')||match[1].startsWith('./'),'DTO import escaped contracts: '+match[1]);
 }
});
});

await __describe("task-fields-generated", async () => {
const test = __node_test;
const step=(id,key)=>({id,title:id,fields:[{key,label:key,type:'number',required:true}]});
for(const count of [0,1,2,9])test('Generated ID skips all '+count+' existing parameters suffixes and stays idempotent',()=>{const steps=Array.from({length:count},(_,i)=>step(i?'parameters-'+i:'parameters','known'+i)),params=Object.fromEntries([...Array.from({length:count},(_,i)=>['known'+i,i]),['leftover',7]]),out=normalizeSteps(steps,params);assert.equal(out.at(-1).id,count?'parameters-'+count:'parameters');assert.equal(new Set(out.map(s=>s.id)).size,out.length);assert.deepEqual(normalizeSteps(out,params),out);assert.deepEqual(workflowMissing(out,params),[]);});
test('Noncontiguous existing suffixes never overwrite authored groups or change their names',()=>{const steps=[step('parameters','a'),step('parameters-1','b'),step('parameters-3','c')],out=normalizeSteps(steps,{a:1,b:2,c:3,x:4});assert.equal(out.at(-1).id,'parameters-2');assert.deepEqual(out.slice(0,3).map(s=>s.id),steps.map(s=>s.id));});
test('Actual duplicate authored IDs still reject; no silent renaming/deduplication',()=>{assert.throws(()=>normalizeSteps([step('same','a'),step('same','b')],{a:1,b:2}),/Invalid workflow step/);assert.throws(()=>normalizeSteps([step('parameters','a'),step('parameters','b')],{a:1,b:2}),/Invalid workflow step/);});
test('Unknown missing requirements remain blockers and are not changed by generated names',()=>{const p={a:1},steps=[step('parameters','a')],once=normalizeSteps(steps,p,['未知科学条件','pending']);assert.deepEqual(normalizeSteps(once,p,['未知科学条件','pending']),once);assert.deepEqual(workflowMissing(once,p,['未知科学条件','pending']).sort(),['未知科学条件','pending'].sort());});
test('Real typed stage-save roundtrip with persisted parameters group and retained aliases renders valid normalized steps',async()=>{const f=stageFixture();f.mutate(t=>{t.parameters.cv.output_size=1;t.parameters.cv.custom_draft_id='private';t.steps.push({id:'parameters',title:'Saved existing parameter group',fields:[{key:'cv.output_size',label:'output_size',type:'number',required:true},{key:'cv.custom_draft_id',label:'custom draft',type:'text',required:true}]});});const privateBefore=structuredClone(f.task().customCv),originalCv=structuredClone(f.task().parameters.cv);await configured(f);const t=f.task(),n=normalizeSteps(t.steps,t.parameters,t.missingFields);assert.deepEqual(normalizeSteps(n,t.parameters,t.missingFields),n);assert.deepEqual(workflowMissing(n,t.parameters,t.missingFields),[]);assert.equal(new Set(n.map(s=>s.id)).size,n.length);assert.equal(t.parameters.cv.ell,originalCv.ell);assert.equal(t.parameters.cv.formula,originalCv.formula);assert.equal(t.parameters.engine,'pygas.build');assert.deepEqual(t.customCv,privateBefore);assert.equal(t.review.status,'not_run');assert.equal(t.deployment.prepared,undefined);assert.equal(f.calls.some(x=>/prepare|validate|sharing/.test(x.target)),false);});
});

await __describe("typed-workspace-ipc", async () => {
const test = __node_test;
const root=fileURLToPath(new URL('../..',import.meta.url));
function check(source){
 const filename=path.join(root,'tests/contracts/__typed_ipc_fixture__.ts');
 const options={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler};
 const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
 host.getSourceFile=(file,...rest)=>path.resolve(file)===filename?ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true):original(file,...rest);
 const program=ts.createProgram([filename],options,host);
 return ts.getPreEmitDiagnostics(program).map(value=>({code:value.code,text:ts.flattenDiagnosticMessageText(value.messageText,' ')}));
}
const imports=`import type {TypedInvoke} from '../../contracts/dto/ipc';\nimport type {Run,ClusterRun} from '../../contracts/dto/runs';\ndeclare const call:TypedInvoke;\n`;

test('critical IPC requests and returned values are tied to the selected method',()=>{
 assert.deepEqual(check(imports+`
 const run:Run|ClusterRun=await call('task.execute',{taskId:'task',artifactId:'run',inputReceipt:'snapshot'});
 const input=await call('task.input.read',{taskId:'task',path:'inputs/run.py'});
 const hash:string=input.sha256;
 await call('task.edit',{id:'task',changes:{temperature:300}});
 await call('compute.resource.clear',{selectionId:'current-selection'});
 `),[]);
 const diagnostics=check(imports+`
 await call('task.execute',{taskId:'task'});
 await call('task.edti',{id:'task',changes:{}});
 await call('task.input.read',{taskId:'task',path:42});
 await call('task.execute',{taskId:'task',artifactId:'run',authorize:true});
 await call('compute.resource.clear',{profileId:'not-a-selection'});
 const run=await call('task.execute',{taskId:'task',artifactId:'run'});
 const fake:string=run.fabricatedProperty;
 `);
 assert.equal(diagnostics.length,6,JSON.stringify(diagnostics));
 assert(diagnostics.some(value=>value.text.includes('artifactId')));
 assert(diagnostics.some(value=>value.text.includes('fabricatedProperty')));
});

function api(file,calls){
 const module={exports:{}};
 const javascript=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(javascript,{module,exports:module.exports,require:name=>{
  assert.equal(name,'./studio');return {invoke:async(method,data)=>{calls.push({method,data});return {method,data};}};
 }});
 return module.exports;
}
test('typed authoring wrappers preserve exact owner, revision and input receipt on the existing bridge',async()=>{
 const calls=[],{taskApi}=api('frontend/api/task-client.ts',calls),{deploymentApi}=api('frontend/api/deployment-client.ts',calls);
 const execute={taskId:'original-task',artifactId:'existing-run',inputReceipt:'original-input-hash'};
 await taskApi.execute(execute);
 await taskApi.edit({id:'original-task',changes:{temperature:325}});
 await deploymentApi.prepare('original-task');
 await deploymentApi.save({taskId:'original-task',value:{target:'local'},expectedDraftRevision:4});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
  {method:'task.execute',data:execute},
  {method:'task.edit',data:{id:'original-task',changes:{temperature:325}}},
  {method:'task.deployment.prepare',data:{taskId:'original-task'}},
  {method:'task.deployment.save',data:{taskId:'original-task',value:{target:'local'},expectedDraftRevision:4}},
 ]);
});
});
