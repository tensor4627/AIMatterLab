import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL("../..",import.meta.url));
const runtimeNames=['api','engines','invoke','readWorkerStatus','recoverConversation','restoreWorker','saveWorkbenchImage','wslPath'];

// Execute the actual canonical TS clients. Only the privileged bridge is a fixture.
function clientModules(bridge){
 const modules=new Map();
 const window=bridge===undefined?undefined:{studio:bridge};
 function resolve(from,specifier){
  assert(specifier.startsWith('.'),'Renderer clients must not import runtime packages or Node builtins: '+specifier);
  const base=path.resolve(path.dirname(from),specifier);
  const file=[base,base+'.ts',base+'.tsx',path.join(base,'index.ts')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
  assert(file&&file.startsWith(root),'Expected an in-repository renderer module: '+specifier);
  return file;
 }
 function load(file){
  const absolute=path.resolve(root,file);
  if(modules.has(absolute))return modules.get(absolute).exports;
  const module={exports:{}};modules.set(absolute,module);
  const source=fs.readFileSync(absolute,'utf8');
  const compiled=ts.transpileModule(source,{fileName:absolute,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports','window',compiled)(specifier=>load(resolve(absolute,specifier)),module,module.exports,window);
  return module.exports;
 }
 const runtime=()=>Object.assign({},...['frontend/api/studio.ts','frontend/api/worker.ts','frontend/api/agent.ts','frontend/api/diagnostics.ts','frontend/ui/presentation/paths.ts','frontend/ui/presentation/engines.ts'].map(load));
 return {load,modules,runtime};
}

test('compute resource client preserves exact typed status, observed session activation and CAS-clear envelopes',async()=>{
 const calls=[],answer={actual:'receipt'},f=clientModules({async invoke(method,data){calls.push({method,data});return answer;}}),{computeResources}=f.load('frontend/api/compute-resources.ts'),reference={kind:'ssh-terminal',profileId:'saved',profileVersion:3,sessionId:'actual-session'};
 assert.equal(await computeResources.status(),answer);assert.equal(await computeResources.activate(reference),answer);assert.equal(await computeResources.clear('selection-A'),answer);assert.deepEqual(calls,[{method:'compute.resource.status',data:{}},{method:'compute.resource.activate',data:reference},{method:'compute.resource.clear',data:{selectionId:'selection-A'}}]);assert.equal(calls[1].data,reference);
});

test('canonical owners import without a browser and expose the eight runtime exports',()=>{
 const f=clientModules(),actual=f.runtime();
 assert.deepEqual(Object.keys(actual).sort(),runtimeNames);
 for(const [file,names]of [
  ['frontend/api/studio.ts',['invoke']],
  ['frontend/api/worker.ts',['api','readWorkerStatus','restoreWorker']],
  ['frontend/api/agent.ts',['recoverConversation']],
  ['frontend/api/diagnostics.ts',['saveWorkbenchImage']],
  ['frontend/ui/presentation/paths.ts',['wslPath']],
  ['frontend/ui/presentation/engines.ts',['engines']]
 ]){const current=f.load(file);for(const name of names)assert.equal(actual[name],current[name],name);}
 assert([...f.modules.keys()].every(file=>!file.includes(path.sep+'contracts'+path.sep)), 'Type-only contracts must not be loaded as renderer runtime dependencies');
});

test('invoke preserves bridge receiver, exact payload, returned object and rejection',async()=>{
 const calls=[],answer={result:'actual-bridge-result'},failure=new Error('bridge rejected');
 const bridge={async invoke(method,data){assert.equal(this,bridge);calls.push({method,data});if(method==='reject')throw failure;return answer;}};
 const {invoke}=clientModules(bridge).load('frontend/api/studio.ts'),payload={taskId:'owned',revision:0};
 assert.equal(await invoke('task.read',payload),answer);
 assert.equal(calls[0].data,payload);
 assert.deepEqual(calls[0],{method:'task.read',data:payload});
 await assert.rejects(invoke('reject',payload),error=>error===failure);
});

test('missing Electron bridge keeps the existing browser-preview error and never dispatches',async()=>{
 const {invoke}=clientModules(null).runtime();
 await assert.rejects(invoke('task.read',{id:'owned'}),{message:'此页面是浏览器预览。请从 Electron 桌面应用连接计算环境。'});
});

test('worker wrappers preserve status, all restore ownership forms and the exact HTTP envelope',async()=>{
 const calls=[],answer={status:'connected'},bridge={async invoke(method,data){calls.push({method,data});return answer;}};
 const client=clientModules(bridge).runtime();
 assert.equal(await client.readWorkerStatus(),answer);
 assert.equal(await client.restoreWorker('task-A'),answer);
 const conversation={conversationId:'codex:thread-A'},global={scope:'global'};
 await client.restoreWorker(conversation);await client.restoreWorker(global);
 const data={run_id:'known-run'};
 assert.equal(await client.api('POST','/api/run/status',data),answer);
 assert.deepEqual(calls,[
  {method:'worker.status',data:undefined},
  {method:'worker.restore',data:{taskId:'task-A'}},
  {method:'worker.restore',data:conversation},
  {method:'worker.restore',data:global},
  {method:'worker.request',data:{method:'POST',target:'/api/run/status',data}}
 ]);
 assert.equal(calls[2].data,conversation);assert.equal(calls[3].data,global);assert.equal(calls[4].data.data,data);
});

test('recovery and image wrappers keep their dedicated channels and neutral cancellation results',async()=>{
 const calls=[],answers=[{thread:{id:'recovered'}},{status:'cancelled'},null];
 const bridge={async invoke(method,data){calls.push({method,data});return answers[calls.length-1];}};
 const client=clientModules(bridge).runtime(),request={provider:'codex',threadId:'old',model:'selected'};
 assert.equal(await client.recoverConversation(request),answers[0]);
 assert.equal(await client.saveWorkbenchImage(),answers[1]);assert.equal(await client.saveWorkbenchImage(),null);
 assert.deepEqual(calls,[{method:'agent.recover',data:request},{method:'diagnostics.saveWorkbenchImage',data:{}},{method:'diagnostics.saveWorkbenchImage',data:{}}]);
});

test('renderer path formatting and engine labels retain their public values and ordering',()=>{
 const {wslPath,engines}=clientModules().runtime();
 assert.equal(wslPath('C:\\one\\two'),'/mnt/c/one/two');
 assert.equal(wslPath('D:/one/two'),'/mnt/d/one/two');
 for(const value of ['/already/linux','relative/file','\\\\server\\share'])assert.equal(wslPath(value),value);
 assert.deepEqual(engines,[
  ['gpumd.neb','GPU-Sampling · NEB'],['gpumd.md','GPUMD · 传统 MD'],['pydyn.md','PyDyn · 传统 MD'],['pygas.build','pyGAS · Bias 构建'],
  ['bias.validate','pyGAS · 产物验证'],['gpumd.sampling','GPUMD · GPU-Sampling'],['pydyn.sampling','PyDyn · pyGAS'],
  ['nep.analyze','NEP · 回归图'],['nep.train','NEP · 训练'],['nep.eval','NEP · 测试'],['hotpp.train','HotPP · 训练'],
  ['hotpp.eval','HotPP · 测试'],['hotpp.export','HotPP · 模型导出'],['pygas.reweight','WTMetaD · 重加权'],['pygas.opes-reweight','OPES · 重加权']
 ]);
});

test('existing typed renderer clients dispatch through the real extracted transport unchanged',async()=>{
 const calls=[],answer={receipt:'actual-result'},f=clientModules({async invoke(method,data){calls.push({method,data});return answer;}});
 const task={taskId:'task'},save={taskId:'task',inspectionId:'observed',values:{},engine:'pygas.build'};
 const read={taskId:'task',snapshotId:'snapshot',entryId:'entry'},confirm={taskId:'task',snapshotId:'snapshot'};
 const inspectConsumer={taskId:'task',engine:'gpumd.sampling'},propose={taskId:'task',inspectionId:'observed',values:{},selections:{potentialId:null,historyId:null}},proposal={taskId:'task',proposalId:'proposal'};
 const challenge={taskId:'task',challengeId:'challenge'},selection={taskId:'task',selectionId:'selected'};
 const config={target:'local',projectId:'project',targetId:'env',inputSource:'local',directoryName:'minimal',maxSeconds:1,gpu:0,resources:{cpus:1,gpus:1,memory_mb:16,queue:'',account:''}};
 const draft={taskId:'task',value:config,expectedRevision:0,mutationId:'mutation'};
 const project={taskId:'task',spec:{name:'test',policy:{engines:['pygas.build'],gpus:[0],max_seconds:1,max_concurrent:1,input_roots:['/fixture'],environments:['env']}},config,expectedRevision:0,requestId:'request'};
 const cases=[
  ['frontend/api/task-stage-client.ts',m=>m.taskStageApi.inspect,[task],'task.stage.inspect',task],
  ['frontend/api/task-stage-client.ts',m=>m.taskStageApi.save,[save],'task.stage.save',save],
  ['frontend/api/local-review-client.ts',m=>m.localReviewApi.inspect,[task],'task.localReview.inspect',task],
  ['frontend/api/local-review-client.ts',m=>m.localReviewApi.read,[read],'task.localReview.read',read],
  ['frontend/api/local-review-client.ts',m=>m.localReviewApi.confirm,[confirm],'task.localReview.confirm',confirm],
  ['frontend/api/local-review-client.ts',m=>m.readLocalReviewStatus,[task],'task.localReview.status',task],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerStageApi.inspect,[inspectConsumer],'task.consumerStage.inspect',inspectConsumer],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerStageApi.propose,[propose],'task.consumerStage.propose',propose],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerStageApi.save,[proposal],'task.consumerStage.save',proposal],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerTargetApi.inspect,[task],'task.consumerTarget.inspect',task],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerTargetApi.confirm,[challenge],'task.consumerTarget.confirm',challenge],
  ['frontend/api/consumer-stage-client.ts',m=>m.consumerTargetApi.status,[task],'task.consumerTarget.status',task],
  ['frontend/api/consumer-artifact-client.ts',m=>m.consumerArtifactApi.list,[task],'task.stage.artifacts',task],
  ['frontend/api/consumer-artifact-client.ts',m=>m.consumerArtifactApi.adopt,[selection],'task.stage.adoptArtifact',selection],
  ['frontend/api/deployment-client.ts',m=>m.deploymentApi.read,['task'],'task.deployment.context',task],
  ['frontend/api/deployment-client.ts',m=>m.deploymentApi.open,['task'],'task.deployment.open',task],
  ['frontend/api/deployment-client.ts',m=>m.deploymentApi.saveDraft,[draft],'task.deployment.draft',draft],
  ['frontend/api/deployment-client.ts',m=>m.deploymentApi.createProject,[project],'task.deployment.createProject',project]
 ];
 for(const [file,select,args,method,data]of cases){assert.equal(await select(f.load(file))(...args),answer);assert.deepEqual(calls.at(-1),{method,data},method);}
});

test('DTO dependency graph stays type-only and within shared contracts',()=>{
 const directory=path.join(root,'contracts/dto'),contractsRoot=path.join(root,'contracts');
 for(const filename of fs.readdirSync(directory).filter(name=>name.endsWith('.ts'))){
  const file=path.join(directory,filename),parsed=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  for(const statement of parsed.statements){
   if(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement)){
    assert(ts.isImportDeclaration(statement)?statement.importClause?.isTypeOnly:statement.isTypeOnly,filename+' has a runtime import/export');
    if(statement.moduleSpecifier){const specifier=statement.moduleSpecifier.text;assert(specifier.startsWith('.'),filename+' imports an external package');const target=path.resolve(directory,specifier);assert(target.startsWith(contractsRoot+path.sep),filename+' depends on renderer/platform source');}
   }else assert(ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement),filename+' contains a runtime declaration');
  }
 }
});

test('tool clients dispatch exact typed package, group and human configuration requests through the renderer transport',async()=>{
 const calls=[],answer={receipt:'typed-tool-answer'},f=clientModules({async invoke(method,data){calls.push({method,data});return answer;}}),{toolPackages:p,toolConfigurations:c,toolGroups:g}=f.load('frontend/api/tools.ts');
 const root='/selected/data-tool-package',read={package_id:'data-tool',package_version:'a'.repeat(64)},change={package_id:'data-tool',package_root:root,expected_revision:1},ref={configuration_id:'configuration-001'},review={...ref,expected_revision:2,plan_sha256:'b'.repeat(64)},plan={...read,project_id:'cpu-check',environment_id:'cpu',request_id:'request-001'},binding={...ref,providers:['codex']},grant={...ref,purpose:'repair',resource_ids:['specific-guide']},definition={schema_version:1,id:'group'},project={environment_id:'cpu',name:'CPU reference',request_id:'project-001'};
 const cases=[
  [p.choose,[], 'tools.packages.choose',{}],[p.inspect,[root],'tools.packages.inspect',{package_root:root}],[p.register,[root],'tools.packages.register',{package_root:root}],[p.update,[change],'tools.packages.update',change],[p.relocate,[change],'tools.packages.relocate',change],[p.list,[],'tools.packages.list',{}],[p.read,[read],'tools.packages.read',read],
  [c.context,[],'tools.configurations.context',{}],[c.list,[],'tools.configurations.list',{}],[c.createProject,[project],'tools.configurations.createProject',project],[c.plan,[plan],'tools.configurations.plan',plan],[c.execute,[review],'tools.configurations.execute',review],[c.status,[ref],'tools.configurations.status',ref],[c.activate,[review],'tools.configurations.activate',review],[c.read,[ref],'tools.configurations.read',ref],[c.bind,[binding],'tools.configurations.bind',binding],[c.grant,[grant],'tools.configurations.grant',grant],
  [g.compile,[definition],'tools.groups.compile',{definition}],[g.save,[definition,3],'tools.groups.save',{definition,expected_revision:3}],[g.read,['group'],'tools.groups.read',{id:'group'}],[g.list,[],'tools.groups.list',{}]
 ];
 for(const [method,args,channel,data]of cases){assert.equal(await method(...args),answer);assert.deepEqual(calls.at(-1),{method:channel,data});}
 assert.equal(calls.length,21);assert([...f.modules.keys()].every(file=>!file.includes(path.sep+'backend'+path.sep)&&!file.includes(path.sep+'contracts'+path.sep)));
});

test('workspace tool-workflow clients keep explicit creation and reviewed execution separate from readonly navigation/status',async()=>{
 const calls=[],answer={authority:'controlled-bridge-result'},f=clientModules({async invoke(method,data){calls.push({method,data});return answer;}}),{toolWorkflows}=f.load('frontend/api/tool-workflows.ts');
 const reference={task_id:'task',execution_id:'execution'},create={task_id:'task',workspace_id:'workspace',name:'CPU sequence',directory_name:'cpu-sequence',group_id:'group',group_version:'a'.repeat(64),configurations:[{step_id:'first',configuration_id:'configuration'}],request_id:'create-request'},prepare={...reference,step_id:'first',expected_revision:1,request_id:'prepare-request'},execute={...reference,step_id:'first',expected_revision:2,review_sha256:'b'.repeat(64)};
 for(const [method,args,channel,data]of [[toolWorkflows.context,['task'],'context',{task_id:'task'}],[toolWorkflows.list,['task'],'list',{task_id:'task'}],[toolWorkflows.locateRun,['run'],'locateRun',{run_id:'run'}],[toolWorkflows.create,[create],'create',create],[toolWorkflows.retryCreate,['task','create-request'],'retryCreate',{task_id:'task',request_id:'create-request'}],[toolWorkflows.prepareStep,[prepare],'prepareStep',prepare],[toolWorkflows.executeStep,[execute],'executeStep',execute],[toolWorkflows.status,[reference],'status',reference],[toolWorkflows.read,[reference],'read',reference]]){assert.equal(await method(...args),answer);assert.deepEqual(calls.at(-1),{method:'tools.workflows.'+channel,data});}
 assert.equal(calls.length,9);assert([...f.modules.keys()].every(file=>!file.includes(path.sep+'backend'+path.sep)&&!file.includes(path.sep+'contracts'+path.sep)));
});
