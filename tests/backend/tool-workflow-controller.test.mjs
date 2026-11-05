// Actual desktop controller/Catalog with controlled existing worker authority.
// No process, installation, scientific result or real passed-run evidence is fabricated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createToolGroupRecords} from "../../backend/main/tools/groups.mjs";
import {createToolWorkflowController,registerToolWorkflowRoutes} from "../../backend/main/workspace/tool-workflows.mjs";
import {toolDefinition,packageVersion,port} from "../helpers/tool-definitions.mjs";

const clone=value=>structuredClone(value),sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex'),INDEX='tool-workflow-index',INTENT='tool-workflow-creation';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-workflow-controller-'));let catalog=new Catalog(root),controller,groups,hook=null,configHook=null,confirmHook=null,clock=10,idle=true;
 t.after(()=>{catalog.db.close();const relative=path.relative(os.tmpdir(),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});
 const binding={distribution:'Fixture',root:'/worker',port:8888},calls=[],configCalls=[],confirmations=[],states=new Map(),requests=new Map();
 let owner={provider:'codex',threadId:'thread',taskId:'task',projectId:'authoring-project',environmentId:'authoring-env',inputRoot:'/authoring-inputs',serial:1},target={kind:'local',projectId:'compute-project',environmentId:'environment',engine:'installation.check',workerBinding:clone(binding)},task={id:'task',provider:'codex',threadId:'thread',workflowVersion:2,workspaceChoice:'workspace',workspace:{id:'workspace',root:'/worker/projects/workspace',workerBinding:clone(binding)}};
 const health={name:'gpu-sampling-studio',root:'/worker',runtime:'/fixture-runtime',execution_policy:'desktop-review-v1',tool_workflow_schema:1},settings={distribution:'Fixture',workerRoot:'/worker',workerPort:8888},worker={identity:{distribution:binding.distribution,root:binding.root},connectionTarget:{port:8888},connectionEpoch:1,connection:{health:clone(health)}};
 const manifest=toolDefinition();manifest.id='cpu-reference';manifest.name='Controlled CPU reference declaration';manifest.functions[0]={...manifest.functions[0],id:'worker-smoke',engine:'installation.check',inputs:[],outputs:[port('result')],parameters:[]};manifest.tests.directory='cpu-reference-tests';manifest.tests.introduction='cpu-reference-tests/README.md';Object.assign(manifest.tests.cases[0],{function_id:'worker-smoke',directory:'cpu-reference-tests/smoke',instructions:'cpu-reference-tests/smoke/README.md',resources:[]});
 const packages={read:({package_id,package_version})=>{assert.equal(package_id,manifest.id);assert.equal(package_version,packageVersion);return {package_version:packageVersion,manifest};}};
 const definition={schema_version:1,id:'reference-sequence',name:'Reference sequence',inputs:[],steps:[{id:'first',tool_id:manifest.id,package_version:packageVersion,function_id:'worker-smoke',inputs:{}},{id:'second',tool_id:manifest.id,package_version:packageVersion,function_id:'worker-smoke',inputs:{},depends_on:['first']}],outputs:[{id:'final',step_id:'second',port_id:'result'}]};
 groups=createToolGroupRecords({catalog,packages,now:()=>clock});const frozen=groups.save({definition,expected_revision:0}),configs=new Map(['configuration-a','configuration-b'].map(id=>[id,{schema_version:1,status:'active',configuration_id:id,revision:5,package_id:manifest.id,package_version:packageVersion,manifest_sha256:'b'.repeat(64),source_commit:'c'.repeat(40),target:{target:'local',project_id:'compute-project',environment_id:'environment'},environment_sha256:'d'.repeat(64),functions:clone(manifest.functions),execution_skill:{id:'existing-skill-'+id,sha256:sha('Existing controlled authority '+id),body:'Existing controlled authority '+id}}]));
 const configurationIndices=new Map([...configs.keys()].map(id=>[id,{schema_version:1,configuration_id:id,package_id:manifest.id,package_version:packageVersion,project_id:'compute-project',environment_id:'environment',worker_binding:clone(binding),created_at:1}]));
 const configurations={list:()=>[...configurationIndices.values()].map(clone),read:async value=>{configCalls.push(clone(value));const next=()=>{const found=configs.get(value.configuration_id);if(!found)throw Error('Unknown configuration');return clone(found);};return configHook?configHook(value,next):next();}};
 function envelope(state){return {workflow:clone(state.workflow),execution:clone(state.execution)};}
 function dispatch(method,route,args){
  if(route==='/api/health'){assert.equal(method,'GET');return clone(health);}assert.equal(method,'POST');
  if(route==='/api/run/status'){
   for(const state of states.values()){const step=state.execution.steps.find(item=>item.run_id===args.run_id);if(step)return {id:args.run_id,status:step.run_status,studio_workflow_binding:{schema_version:1,workflow_id:state.workflow.id,execution_id:state.execution.id,step_id:step.id,snapshot_sha256:state.execution.snapshot_sha256,group_id:state.execution.group.id,group_version:state.execution.group.version,configuration_id:step.configuration_id,execution_skill_id:step.execution_skill_id,execution_skill_sha256:configs.get(step.configuration_id).execution_skill.sha256}};}
   throw Error('Unknown controlled run');
  }
  if(route==='/api/workflow/tool-group/create'){
   assert.equal(args.target.target,'local');assert.equal(args.workspace_id,'workspace');assert.equal(args.tool_groups[0].definition_text,frozen.definition_text);assert.equal(sha('studio.tool-group/1\0'+args.tool_groups[0].definition_text),args.tool_groups[0].version);
   const previous=requests.get(args.request_id);if(previous){assert.equal(previous.identity,sha(args),'Worker rejects changed idempotent request');return envelope(states.get(previous.execution_id));}
   const suffix=sha(args.request_id).slice(0,12),execution_id='wire-execution-'+suffix,workflow_id='wire-workflow-'+suffix,base='/worker/projects/workspace/workflows/reference-'+workflow_id;
   const state={workflow:{schema_version:2,id:workflow_id,project_id:args.target.project_id,name:args.name,workspace_id:args.workspace_id,revision:1,root:base,execution_mode:'manual_step_review',tool_group_refs:[{id:frozen.id,version:frozen.version}],execution_ids:[execution_id],steps:clone(definition.steps),run_ids:[]},execution:{schema_version:1,id:execution_id,workflow_id,revision:1,status:'pending',execution_mode:'manual_step_review',workspace_id:args.workspace_id,target:clone(args.target),group:{id:frozen.id,version:frozen.version},root:base+'/executions/'+execution_id,snapshot_sha256:sha(args),steps:args.configurations.map(item=>({id:item.step_id,tool_id:manifest.id,package_version:packageVersion,function_id:'worker-smoke',configuration_id:item.configuration_id,execution_skill_id:configs.get(item.configuration_id).execution_skill.id,status:'pending',reason:null,run_id:null,run_status:null,eligible:item.step_id==='first',review:null}))}};
   states.set(execution_id,state);requests.set(args.request_id,{identity:sha(args),execution_id});return envelope(state);
  }
  const state=states.get(args.execution_id);if(!state)throw Error('Unknown worker execution');
  if(route==='/api/workflow/status'||route==='/api/workflow/read')return envelope(state);
  const step=state.execution.steps.find(item=>item.id===args.step_id);assert(step);if(route==='/api/workflow/prepare-step'&&step.status==='prepared'&&step.request_id===args.request_id)return envelope(state);assert.equal(args.expected_revision,state.execution.revision,'Worker rejects stale execution revision');
  if(route==='/api/workflow/prepare-step'){
   if(step.status==='prepared'&&step.request_id===args.request_id)return envelope(state);
   if(step.status!=='pending'||!step.eligible)throw Error('Worker refuses unknown/nonpending or blocked step');
   step.status='prepared';step.request_id=args.request_id;step.run_id='wire-run-'+step.id;step.run_status='draft';step.eligible=false;step.review={review_sha256:sha([state.execution.id,step.id,args.request_id]),run_id:step.run_id,request_hash:sha(args),argv:['/fixture/python','/worker/private/reference.py'],inputs:[{name:'run.py',sha256:'e'.repeat(64),size:10}],target:clone(state.execution.target),directory:state.execution.root+'/steps/001-cpu-reference-'+step.id+'/'+step.run_id,working_directory:state.execution.root+'/steps/001-cpu-reference-'+step.id+'/'+step.run_id+'/results',criteria:{scope:'controlled existing worker receipt, not process proof'},configuration_id:step.configuration_id,execution_skill_id:step.execution_skill_id,execution_skill_sha256:configs.get(step.configuration_id).execution_skill.sha256,package_id:manifest.id,package_version:packageVersion,function_id:step.function_id,group_id:frozen.id,group_version:frozen.version,environment_sha256:'d'.repeat(64),authorization_sha256:'f'.repeat(64),python:{path:'/fixture/python'},install_files:[],max_seconds:30};state.execution.revision++;state.execution.status='prepared';state.workflow.run_ids.push(step.run_id);return envelope(state);
  }
  if(route==='/api/workflow/execute-step'){
   if(step.status!=='prepared'||step.review.review_sha256!==args.review_sha256)throw Error('Worker refuses changed prepared review');step.status='queued';step.run_status='queued';state.execution.status='queued';state.execution.revision++;return envelope(state);
  }
  throw Error('Unexpected worker route '+route);
 }
 worker.request=async(method,route,args)=>{calls.push({method,route,args:clone(args)});const next=()=>dispatch(method,route,args);return hook?hook(method,route,args,next):next();};
 function compose(){controller=createToolWorkflowController({catalog,groups,configurations,worker,current:()=>clone(owner),currentTarget:()=>clone(target),getSettings:()=>clone(settings),getTask:id=>id===task.id?clone(task):null,assertIdle:()=>{if(!idle)throw Error('Agent is busy');},confirm:async(value,event)=>{confirmations.push({value:clone(value),event});return confirmHook?confirmHook(value,event):true;},now:()=>clock});}compose();
 const createRequest=()=>({task_id:'task',workspace_id:'workspace',name:'CPU group',directory_name:'reference',group_id:frozen.id,group_version:frozen.version,configurations:[{step_id:'second',configuration_id:'configuration-b'},{step_id:'first',configuration_id:'configuration-a'}],request_id:'human-create-1'});
 const ref=value=>({task_id:'task',execution_id:value.execution.id});
 const prepare=async value=>controller.prepareStep({...ref(value),step_id:'first',expected_revision:value.execution.revision,request_id:'human-prepare-1'});
 const execute=value=>({...ref(value),step_id:'first',expected_revision:value.execution.revision,review_sha256:value.execution.steps[0].review.review_sha256});
 function hold(route){const entered=deferred(),release=deferred();let used=false;hook=async(method,name,args,next)=>{if(name===route&&!used){used=true;const value=next();entered.resolve();await release.promise;return value;}return next();};return {entered:entered.promise,release:()=>release.resolve()};}
 return {get controller(){return controller;},get catalog(){return catalog;},get groups(){return groups;},frozen,definition,binding,worker,health,settings,calls,configCalls,confirmations,configs,configurationIndices,states,createRequest,ref,prepare,execute,create:()=>controller.create(createRequest()),hold,hook:value=>{hook=value;},configHook:value=>{configHook=value;},confirm:value=>{confirmHook=value;},owner:value=>{owner={...owner,...value};},target:value=>{target={...target,...value};},task:value=>{task={...task,...value};},get taskValue(){return clone(task);},set idle(value){idle=value;},advance:()=>clock++,reopen(){catalog.db.close();catalog=new Catalog(root);groups=createToolGroupRecords({catalog,packages,now:()=>clock});compose();}};
}

test('actual typed controller keeps frozen create as metadata, prepares without execution, and forwards exact reviewed facts only after confirmation',async t=>{
 const f=fixture(t),handlers=new Map();registerToolWorkflowRoutes({handle:(name,action)=>handlers.set(name,action),controller:f.controller});assert.equal(handlers.size,9);const context=await handlers.get('tools.workflows.context')({task_id:'task'});assert.equal(context.groups[0].has_frozen_version,true);assert.equal(context.workspace_id,'workspace');
 const created=await handlers.get('tools.workflows.create')(f.createRequest());assert.deepEqual(created.workflow.run_ids,[]);assert(created.execution.steps.every(step=>step.status==='pending'));const sent=f.calls.find(call=>call.route==='/api/workflow/tool-group/create').args;assert.deepEqual(sent.configurations.map(item=>item.step_id),['first','second']);assert.equal(sent.tool_groups[0].definition_text,f.frozen.definition_text);assert.equal(f.confirmations.length,0);assert(!f.calls.some(call=>/prepare-step|execute-step|\/api\/runs/.test(call.route)));
 const prepared=await f.prepare(created);assert.equal(prepared.execution.steps[0].status,'prepared');assert.equal(prepared.execution.steps[0].run_status,'draft');assert(!f.calls.some(call=>call.route==='/api/workflow/execute-step'));const event={sender:'controlled-native-review'};f.confirm(()=>false);const declined=await handlers.get('tools.workflows.executeStep')(f.execute(prepared),event);assert.equal(declined.cancelled,true);assert.equal(f.confirmations[0].event,event);assert.deepEqual(f.confirmations[0].value.step.review,prepared.execution.steps[0].review);assert(!f.calls.some(call=>call.route==='/api/workflow/execute-step'));
 f.confirm(()=>true);const queued=await f.controller.executeStep(f.execute(prepared),event);assert.equal(queued.execution.steps[0].status,'queued');assert.equal(f.calls.filter(call=>call.route==='/api/workflow/execute-step').length,1);assert.deepEqual(f.calls.find(call=>call.route==='/api/workflow/execute-step').args,{execution_id:created.execution.id,step_id:'first',expected_revision:prepared.execution.revision,review_sha256:prepared.execution.steps[0].review.review_sha256});
});

test('lost creation reply preserves a durable original intent, and explicit retry recovers the same metadata without creating a run',async t=>{
 const f=fixture(t);f.hook((method,route,args,next)=>{if(route==='/api/workflow/tool-group/create'){const intent=f.catalog.list(INTENT)[0];assert.equal(intent.status,'creating');assert.deepEqual(intent.source_request,f.createRequest());next();throw Error('Lost creation reply');}return next();});await assert.rejects(f.create(),/Lost creation/);assert.equal(f.catalog.list(INTENT)[0].status,'unknown');assert.equal(f.catalog.list(INDEX).length,0);assert.equal(f.states.size,1);
 f.hook(null);f.reopen();const before=f.calls.length;assert.equal((await f.controller.context({task_id:'task'})).creations[0].status,'unknown');assert(!f.calls.slice(before).some(call=>call.route==='/api/workflow/tool-group/create'));const recovered=await f.controller.retryCreate({task_id:'task',request_id:'human-create-1'});assert.equal(f.states.size,1);assert.equal(f.catalog.list(INTENT)[0].status,'created');assert.equal(f.catalog.list(INDEX)[0].execution_id,recovered.execution.id);assert.deepEqual(recovered.workflow.run_ids,[]);assert.equal(f.confirmations.length,0);
 const createCalls=f.calls.filter(call=>call.route==='/api/workflow/tool-group/create').length;f.advance();assert.equal((await f.create()).execution.id,recovered.execution.id);assert.equal(f.calls.filter(call=>call.route==='/api/workflow/tool-group/create').length,createCalls);assert.equal(f.catalog.list(INDEX)[0].created_at,10);
});

test('creation request identity conflicts retain the original intent and versioned group identity',async t=>{
 const f=fixture(t);await f.create();const original=f.catalog.list(INTENT)[0];await assert.rejects(f.controller.create({...f.createRequest(),name:'Changed'}),/different workflow/);assert.deepEqual(f.catalog.list(INTENT)[0],original);assert.equal(f.states.size,1);
 const legacy=f.catalog.get('tool-group',f.frozen.id);delete legacy.version;delete legacy.has_frozen_version;delete legacy.definition_text;f.catalog.put('tool-group',legacy.id,legacy);f.catalog.remove('tool-group-version',sha(f.frozen.id+'\0'+f.frozen.version));await assert.rejects(f.controller.create({...f.createRequest(),request_id:'new-request'}),/Unknown frozen/);assert.equal(f.states.size,1);
});

for(const [label,change]of [
 ['conversation',f=>f.owner({threadId:'other'})],['owner serial',f=>f.owner({serial:2})],['workspace',f=>f.task({workspace:{...f.taskValue.workspace,id:'other'}})],['workspace root',f=>f.task({workspace:{...f.taskValue.workspace,root:'/other-root'}})],['workspace source',f=>f.task({workspace:{...f.taskValue.workspace,workerBinding:{...f.binding,root:'/other'}}})],['target project',f=>f.target({projectId:'other'})],['target environment',f=>f.target({environmentId:'other'})],['target source',f=>f.target({workerBinding:{...f.binding,root:'/other'}})],['worker epoch',f=>{f.worker.connectionEpoch++;}],['worker object',f=>{f.worker.connection={health:clone(f.health)};}],['worker identity',f=>{f.worker.identity={...f.worker.identity,root:'/other'};}]
])test('a late '+label+' change across actual confirmation prevents execute dispatch',async t=>{
 const f=fixture(t),prepared=await f.prepare(await f.create()),entered=deferred(),release=deferred();f.confirm(async()=>{entered.resolve();await release.promise;return true;});const pending=f.controller.executeStep(f.execute(prepared),{human:true});await entered.promise;change(f);release.resolve();await assert.rejects(pending,/changed|original|Restore|Select|service/i);assert(!f.calls.some(call=>call.route==='/api/workflow/execute-step'));assert.equal(f.states.get(prepared.execution.id).execution.steps[0].status,'prepared');
});

test('scope changes while verified health or selected active configuration is awaiting are rejected before create',async t=>{
 for(const route of ['health','configuration']){const f=fixture(t),entered=deferred(),release=deferred();if(route==='health')f.hook(async(method,name,args,next)=>{const value=next();if(name==='/api/health'){entered.resolve();await release.promise;}return value;});else f.configHook(async(value,next)=>{const result=next();entered.resolve();await release.promise;return result;});const pending=f.create();await entered.promise;f.task({workspace:{...f.taskValue.workspace,id:'new-workspace'}});release.resolve();await assert.rejects(pending,/changed|Select/i);assert(!f.calls.some(call=>call.route==='/api/workflow/tool-group/create'));assert.equal(f.catalog.list(INTENT).length,0);}
});

for(const [label,change,expected]of [
 ['wrong version',f=>{f.configs.get('configuration-a').package_version='b'.repeat(64);},/exact package/],['wrong package',f=>{f.configs.get('configuration-a').package_id='other';},/exact package/],['wrong function',f=>{f.configs.get('configuration-a').functions=[];},/exact package/],['inactive',f=>{f.configs.get('configuration-a').status='stale';},/active exact/],['missing skill',f=>{delete f.configs.get('configuration-a').execution_skill;},/active exact/],['different environment',f=>{f.configs.get('configuration-b').target.environment_id='other';},/same explicitly authorized/],['different project',f=>{f.configs.get('configuration-b').target.project_id='other';},/same explicitly authorized/],['original source',f=>{f.configurationIndices.get('configuration-a').worker_binding.root='/other';},/original service/]
])test('create rejects '+label+' configuration facts before writing a creation intent',async t=>{const f=fixture(t);change(f);await assert.rejects(f.create(),expected);assert.equal(f.catalog.list(INTENT).length,0);assert(!f.calls.some(call=>call.route==='/api/workflow/tool-group/create'));});

test('every step needs an exact unique selected configuration and no caller command/status fields are accepted',async t=>{
 const f=fixture(t),request=f.createRequest();for(const configurations of [[request.configurations[0]],[request.configurations[0],request.configurations[0]],[{step_id:'missing',configuration_id:'configuration-a'}]])await assert.rejects(f.controller.create({...request,configurations}),/Every frozen|Duplicate or unknown/);await assert.rejects(f.controller.create({...request,passed:true}),/Exact typed/);await assert.rejects(f.controller.create({...request,configurations:[{...request.configurations[0],command:'echo success'}]}),/Exact typed/);assert.equal(f.states.size,0);
});

test('unknown/status/read only observe the existing execution and never prepare or submit a replacement',async t=>{
 const f=fixture(t),created=await f.create(),prepared=await f.prepare(created),state=f.states.get(created.execution.id);state.execution.status='unknown';state.execution.steps[0].status='unknown';state.execution.steps[0].run_status='unknown';state.execution.revision++;const before=f.calls.length;
 assert.equal((await f.controller.status(f.ref(created))).execution.status,'unknown');assert.equal((await f.controller.read(f.ref(created))).execution.steps[0].run_id,prepared.execution.steps[0].run_id);assert.equal(f.controller.list({task_id:'task'}).length,1);await assert.rejects(f.controller.executeStep({...f.execute(prepared),expected_revision:state.execution.revision}),/Prepared step or review changed/);assert.equal(f.confirmations.length,0);assert(f.calls.slice(before).every(call=>call.route==='/api/health'||call.route==='/api/workflow/status'||call.route==='/api/workflow/read'));assert.equal(f.states.size,1);assert.equal(state.workflow.run_ids.length,1);
});

test('changed prepared review and stale worker replies cannot overwrite a newer desktop revision',async t=>{
 const f=fixture(t),created=await f.create(),prepared=await f.prepare(created);await assert.rejects(f.controller.executeStep({...f.execute(prepared),review_sha256:'0'.repeat(64)}),/Prepared step or review changed/);assert.equal(f.confirmations.length,0);
 const gate=f.hold('/api/workflow/status'),late=f.controller.status(f.ref(created));await gate.entered;const state=f.states.get(created.execution.id);state.execution.revision++;await f.controller.read(f.ref(created));gate.release();await assert.rejects(late,/Late or changed/);assert.equal(f.catalog.list(INDEX)[0].last_revision,state.execution.revision);
});

test('unsupported workspace/service and a different task cannot reuse the original reference',async t=>{
 for(const change of [f=>f.task({workflowVersion:1}),f=>f.task({workspaceChoice:'default'}),f=>f.task({workspace:{...f.taskValue.workspace,workerBinding:{...f.binding,root:'/other'}}}),f=>{delete f.worker.connection.health.tool_workflow_schema;}]){const f=fixture(t);change(f);await assert.rejects(f.create(),/workspace|original|support|Restore/i);assert.equal(f.states.size,0);}
 const f=fixture(t),created=await f.create();await assert.rejects(f.controller.status({task_id:'other-task',execution_id:created.execution.id}),/Unknown tool workflow reference/);f.owner({taskId:'other-task'});assert.throws(()=>f.controller.list({task_id:'task'}),/original conversation/);
});

test('worker responses cannot change workspace, version, target or workflow identity for an existing execution',async t=>{
 for(const change of [value=>{value.execution.workspace_id='other';},value=>{value.execution.group.version='b'.repeat(64);},value=>{value.execution.target.environment_id='other';},value=>{value.workflow.tool_group_refs=[];},value=>{value.workflow.id='different';}]){const f=fixture(t),created=await f.create();f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/read')change(value);return value;});await assert.rejects(f.controller.read(f.ref(created)),/identity, version or target/);assert.equal(f.catalog.list(INDEX)[0].last_revision,1);}
});

test('a new creation reply cannot reuse an indexed execution ID for a different workflow',async t=>{
 const f=fixture(t),original=await f.create(),before=f.catalog.get(INDEX,original.execution.id);f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/tool-group/create')value.execution.id=original.execution.id;return value;});
 await assert.rejects(f.controller.create({...f.createRequest(),request_id:'human-create-2'}),/identity|Late or changed|differs/i);assert.deepEqual(f.catalog.get(INDEX,original.execution.id),before);assert.equal(f.catalog.list(INTENT).find(value=>value.request_id==='human-create-2').status,'unknown');
});

test('human run navigation verifies the actual binding and only returns the original indexed conversation',async t=>{
 const f=fixture(t),prepared=await f.prepare(await f.create()),run=prepared.execution.steps[0].run_id;f.owner({taskId:'other-selected-task',threadId:'other-thread'});const before=f.calls.length;
 const location=await f.controller.locateRun({run_id:run});assert.deepEqual(location,{task_id:'task',provider:'codex',thread_id:'thread',conversation_id:'codex:thread',workspace_id:'workspace',workflow_id:prepared.workflow.id,execution_id:prepared.execution.id,step_id:'first',run_id:run});assert(!f.calls.slice(before).some(call=>/prepare-step|execute-step/.test(call.route)));assert.equal(f.confirmations.length,0);
 for(const field of ['workflow_id','snapshot_sha256','group_version','configuration_id','execution_skill_id']){f.hook((method,route,args,next)=>{const value=next();if(route==='/api/run/status')value.studio_workflow_binding[field]='foreign';return value;});await assert.rejects(f.controller.locateRun({run_id:run}),/binding|reference|match/i);}f.hook(null);f.task({workspace:{...f.taskValue.workspace,id:'new-workspace'}});await assert.rejects(f.controller.locateRun({run_id:run}),/original conversation and workspace/);
});

test('a newly selected workspace cannot read, prepare or execute the old workspace’s steps',async t=>{
 const f=fixture(t),prepared=await f.prepare(await f.create());f.task({workspace:{...f.taskValue.workspace,id:'new-workspace'}});const before=f.calls.length;assert.deepEqual(f.controller.list({task_id:'task'}),[]);assert.deepEqual((await f.controller.context({task_id:'task'})).workflows,[]);
 for(const action of [()=>f.controller.read(f.ref(prepared)),()=>f.controller.status(f.ref(prepared)),()=>f.controller.prepareStep({...f.ref(prepared),step_id:'second',expected_revision:prepared.execution.revision,request_id:'new-prepare'}),()=>f.controller.executeStep(f.execute(prepared),{human:true})])await assert.rejects(action(),/original workspace/);
 assert(f.calls.slice(before).every(call=>call.route==='/api/health'));assert.equal(f.confirmations.length,0);assert.equal(f.states.get(prepared.execution.id).execution.steps[0].status,'prepared');
});

test('creation await scope changes preserve unknown intent and never manufacture a selected execution reference',async t=>{
 const f=fixture(t),gate=f.hold('/api/workflow/tool-group/create'),pending=f.create();await gate.entered;f.owner({serial:2});gate.release();await assert.rejects(pending,/changed/);assert.equal(f.catalog.list(INTENT)[0].status,'unknown');assert.equal(f.catalog.list(INDEX).length,0);assert.equal(f.states.size,1);assert([...f.states.values()][0].execution.steps.every(step=>step.run_id===null));
});

test('an explicit retry after a lost prepare reply reuses the exact original request and same worker draft',async t=>{
 const f=fixture(t),created=await f.create();let lost=false;f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/prepare-step'&&!lost){lost=true;throw Error('Lost prepare reply');}return value;});await assert.rejects(f.prepare(created),/Lost prepare/);assert.equal(f.catalog.list(INDEX)[0].last_revision,1);f.hook(null);const recovered=await f.prepare(created),calls=f.calls.filter(call=>call.route==='/api/workflow/prepare-step');assert.deepEqual(calls[1].args,calls[0].args);assert.equal(recovered.execution.steps[0].run_id,'wire-run-first');assert.equal(recovered.workflow.run_ids.length,1);assert(!f.calls.some(call=>call.route==='/api/workflow/execute-step'));
});

test('a lost execute response is reconciled by status on the same execution and cannot prompt or submit again',async t=>{
 const f=fixture(t),prepared=await f.prepare(await f.create());f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/execute-step')throw Error('Lost execute reply');return value;});await assert.rejects(f.controller.executeStep(f.execute(prepared),{human:true}),/Lost execute/);f.hook(null);const observed=await f.controller.status(f.ref(prepared));assert.equal(observed.execution.steps[0].status,'queued');assert.equal(observed.execution.steps[0].run_id,prepared.execution.steps[0].run_id);await assert.rejects(f.controller.executeStep(f.execute(prepared),{human:true}),/Prepared step or review changed/);assert.equal(f.confirmations.length,1);assert.equal(f.calls.filter(call=>call.route==='/api/workflow/execute-step').length,1);assert.equal(f.calls.filter(call=>call.route==='/api/workflow/prepare-step').length,1);
});

test('creation rejects substituted step package/function/configuration/skill identities before indexing the response',async t=>{
 for(const field of ['id','tool_id','package_version','function_id','configuration_id','execution_skill_id']){
  const f=fixture(t);f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/tool-group/create')value.execution.steps[0][field]='substituted';return value;});await assert.rejects(f.create(),/step configuration or execution skill differs/);assert.equal(f.catalog.list(INDEX).length,0);assert.equal(f.catalog.list(INTENT)[0].status,'unknown');assert([...f.states.values()][0].execution.steps.every(step=>step.run_id===null));
 }
});

test('read rejects changed or reordered frozen step bindings without mutating the historical index',async t=>{
 const f=fixture(t),created=await f.create(),before=f.catalog.get(INDEX,created.execution.id);assert.deepEqual(before.step_bindings.map(step=>step.id),['first','second']);
 for(const mutate of [...['id','tool_id','package_version','function_id','configuration_id','execution_skill_id'].map(field=>value=>{value.execution.steps[0][field]='substituted';}),value=>{value.execution.steps.reverse();},value=>{value.execution.steps.pop();}]){
  f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/read')mutate(value);return value;});await assert.rejects(f.controller.read(f.ref(created)),/step configuration or execution skill differs/);assert.deepEqual(f.catalog.get(INDEX,created.execution.id),before);
 }
});

test('an explicit new valid selection creates an independent index and leaves historical step identities unchanged',async t=>{
 const f=fixture(t),first=await f.create(),before=f.catalog.get(INDEX,first.execution.id),request={...f.createRequest(),request_id:'human-create-2',configurations:[{step_id:'first',configuration_id:'configuration-b'},{step_id:'second',configuration_id:'configuration-a'}]},second=await f.controller.create(request);assert.notEqual(second.execution.id,first.execution.id);assert.equal(f.catalog.list(INDEX).length,2);assert.deepEqual(f.catalog.get(INDEX,first.execution.id),before);assert.equal(f.catalog.get(INDEX,second.execution.id).step_bindings[0].configuration_id,'configuration-b');f.reopen();assert.equal((await f.controller.read(f.ref(first))).execution.steps[0].configuration_id,'configuration-a');
});

test('the same indexed execution/workflow pair cannot be rebound to a new selection through a later creation response',async t=>{
 const f=fixture(t),first=await f.create(),before=f.catalog.get(INDEX,first.execution.id);f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/tool-group/create'){value.execution.id=first.execution.id;value.execution.workflow_id=first.workflow.id;value.workflow.id=first.workflow.id;value.workflow.execution_ids=[first.execution.id];}return value;});
 const request={...f.createRequest(),request_id:'human-create-2',configurations:[{step_id:'first',configuration_id:'configuration-b'},{step_id:'second',configuration_id:'configuration-a'}]};await assert.rejects(f.controller.create(request),/identity|Late or changed|differs/i);assert.deepEqual(f.catalog.get(INDEX,first.execution.id),before);
});

test('snapshot substitution and a different creation request alias cannot rewrite the same execution/workflow pair',async t=>{
 const f=fixture(t),first=await f.create(),before=f.catalog.get(INDEX,first.execution.id);assert.equal(before.snapshot_sha256,first.execution.snapshot_sha256);assert.equal(before.creation_request_id,'human-create-1');assert.equal(before.request_sha256,sha(f.calls.find(call=>call.route==='/api/workflow/tool-group/create').args));
 f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/read')value.execution.snapshot_sha256='0'.repeat(64);return value;});await assert.rejects(f.controller.read(f.ref(first)),/snapshot|immutable|identity|changed|differs/i);assert.deepEqual(f.catalog.get(INDEX,first.execution.id),before);
 f.hook((method,route,args,next)=>{const value=next();if(route==='/api/workflow/tool-group/create'){value.execution.id=first.execution.id;value.execution.workflow_id=first.workflow.id;value.execution.snapshot_sha256=first.execution.snapshot_sha256;value.workflow.id=first.workflow.id;value.workflow.execution_ids=[first.execution.id];}return value;});await assert.rejects(f.controller.create({...f.createRequest(),request_id:'human-create-alias'}),/Late or changed|identity|differs/i);assert.deepEqual(f.catalog.get(INDEX,first.execution.id),before);assert.equal(f.catalog.list(INTENT).find(value=>value.request_id==='human-create-alias').status,'unknown');
});
