import {withComputeProject} from "../helpers/deployment-worker-fixture.mjs";
import {test} from 'node:test';import assert from 'node:assert/strict';
import {manifestDefinitionCorrection as helper} from "../../backend/main/workspace/manifest-binding.mjs";import {prepareDeployment as prepareActualDeployment} from "../../backend/main/workspace/task-deployment.mjs";import {fixture,invoke,definition} from "../helpers/manifest-fixtures.mjs";
test('synthetic failed WT/current/newdraft replay accepts only metadata correction and immutable old input read',async()=>{const f=fixture(),before=structuredClone({task:f.task,prior:f.prior,next:f.next});const correction=await invoke(helper,f);assert.equal(correction.kind,'unstarted-optional-manifest-definition');assert.deepEqual(correction.droppedFields,['bias.manifest_file','manifest_file']);assert.deepEqual(f.readCalls,[{id:f.prior.id,name:'bias.definition.json'}]);assert.deepEqual(f.task,before.task);assert.deepEqual(f.prior,before.prior);assert.deepEqual(f.next,before.next);});
test('synthetic prepare replay binds only fresh draft, keeps old failed artifact and semantic not_run',async()=>{const f=fixture();let value=structuredClone(f.task),calls=[];const oldRecord=structuredClone(f.prior),records={read(){return structuredClone(value);},save(next){value=structuredClone(next);return next;}};const worker={async request(method,url,data){calls.push({method,url,data});if(url==='/api/runs/prepare')return structuredClone(f.next);if(url==='/api/run/status')return structuredClone(f.prior);if(url==='/api/run/input'){assert.deepEqual(data,{run_id:f.prior.id,name:'bias.definition.json'});return f.readResult;}throw Error('Unexpected endpoint '+url);}};const run=await prepareDeployment(records,worker,{taskId:f.task.id});assert.equal(run.id,f.next.id);assert.equal(value.inputBinding.artifactId,f.next.id);assert.equal(value.inputBinding.semanticStatus,'not_run');assert.equal(value.inputBinding.correction.previousArtifactId,f.prior.id);assert(value.artifacts.some(a=>a.id===f.prior.id));assert.equal(value.deployment.prepared.artifactId,f.next.id);assert.equal(run.validation.status,'not_run');assert.equal(value.review.status,'ready');assert.equal(calls.some(c=>/validate|submit|execute|workspace/.test(c.url)),false);assert.deepEqual(f.prior,oldRecord);});
const rejects={
 cluster:f=>f.task.deployment.config.target='cluster',
 pydyn:f=>f.task.parameters.engine='pydyn.sampling',
 wrongContract:f=>f.task.inputBinding.contractVersion=1,
 priorSemanticPassed:f=>f.task.inputBinding.semanticStatus='passed',
 wrongPriorID:f=>f.task.inputBinding.artifactId='other',
 wrongTaskProject:f=>f.task.projectId='other',
 wrongPriorProject:f=>f.prior.project_id='other',
 wrongNextProject:f=>f.next.project_id='other',
 wrongEnvironment:f=>f.next.environment_id='other',
 sameRun:f=>f.next.id=f.prior.id,
 priorRunning:f=>f.prior.status='running',
 priorUnknown:f=>f.prior.status='unknown',
 priorReady:f=>f.prior.status='ready',
 priorIdentity:f=>f.prior.identity={pid:123},
 priorStartedZero:f=>f.prior.started_at=0,
 priorExited:f=>f.prior.exit_code=0,
 priorExitRecord:f=>f.prior.exit={exit_code:0},
 nextStarted:f=>f.next.started_at=123,
 nextIdentity:f=>f.next.identity={pid:1},
 nextValidated:f=>f.next.validation.status='passed',
 wrongFailure:f=>f.prior.validation.message='Model path differs',
 priorNotFailed:f=>f.prior.validation.status='blocked',
 changedSnapshotHash:f=>f.next.snapshots[0].sha256='a'.repeat(64),
 changedSnapshotSource:f=>f.next.snapshots[0].source+='.different',
 changedSnapshotSize:f=>f.next.snapshots[0].size++,
 duplicateSnapshot:f=>f.next.snapshots.push(structuredClone(f.next.snapshots[0])),
 bindingHashMismatch:f=>f.task.inputBinding.hashes[0].sha256='a'.repeat(64),
 changedInputSource:f=>f.next.inputs['run.in']+='x',
 changedScience:f=>f.parameters.dynamics.steps++,
 addedUnknownControl:f=>f.parameters.unknown_key=1,
 removedUnknownControl:f=>f.task.inputBinding.parameters.unknown_key=1,
 nullInsteadOfRemoved:f=>f.parameters.manifest_file=null,
 oneAliasRetained:f=>f.parameters.bias.manifest_file=f.task.inputBinding.parameters.bias.manifest_file,
 oldAliasConflict:f=>f.task.inputBinding.parameters.bias.manifest_file+='.other',
 priorParameterMismatch:f=>f.prior.parameters.cv_size++,
 nextParameterMismatch:f=>f.next.parameters.cutoff++,
 humanManifest:f=>f.task.manualEdits.manifest_file=1,
 humanNestedManifest:f=>f.task.manualEdits['bias.manifest_file']=1,
 humanBiasParent:f=>f.task.manualEdits.bias=1,
 humanFiles:f=>f.task.manualEdits.files=1,
 humanChosenManifest:f=>f.task.manualInputs.files={type:'files',approvedValues:[f.prior.inputs['bias.definition.json']]},
 pt2Selected:f=>{f.parameters.bias_file='bias.pt2';f.parameters.bias.file='bias.pt2';},
 explicitAOTI:f=>f.parameters.bias.artifact_format='aoti',
 readerFailure:f=>f.readError=true,
 truncated:f=>f.readResult.truncated=true,
 binary:f=>f.readResult.binary=true,
 notEditable:f=>f.readResult.editable=false,
 oversize:f=>f.readResult.size=65537,
 badReadSHA:f=>f.readResult.sha256='a'.repeat(64),
 badReadName:f=>f.readResult.name='other.json',
 changedReadText:f=>f.readResult.text+=' ',
 invalidUTF8Surrogate:f=>f.readResult.text='\ud800',
 badJSON:f=>definition(f,'not json'),
 arraysJSON:f=>definition(f,[]),
 missingSchema:f=>{const d=JSON.parse(f.readResult.text);delete d.schema;definition(f,d);},
 realManifestSchema:f=>{const d=JSON.parse(f.readResult.text);d.schema='pygas-artifact/1';definition(f,d);},
 deploymentSchema:f=>{const d=JSON.parse(f.readResult.text);d.schema='deployment-manifest/1';definition(f,d);},
 multipleArtifacts:f=>{const d=JSON.parse(f.readResult.text);d.artifacts=[];definition(f,d);},
 abiDeclaration:f=>{const d=JSON.parse(f.readResult.text);d.nested={abi:{version:1}};definition(f,d);},
 toolchainDeclaration:f=>{const d=JSON.parse(f.readResult.text);d.nested={toolchain:{torch:'2'}};definition(f,d);},
 backendDeclaration:f=>{const d=JSON.parse(f.readResult.text);d.nested={deployment_backend:'torchscript'};definition(f,d);},
 deepPt2Declaration:f=>{const d=JSON.parse(f.readResult.text);d.nested={model:'candidate.pt2'};definition(f,d);},
 artifactHashMismatch:f=>{const d=JSON.parse(f.readResult.text);d.artifact.sha256='a'.repeat(64);definition(f,d);},
 artifactPathMismatch:f=>{const d=JSON.parse(f.readResult.text);d.artifact.file='../wtmetad.pt';definition(f,d);},
 extraArtifactFields:f=>{const d=JSON.parse(f.readResult.text);d.artifact.backend='torchscript';definition(f,d);},
 secondPathAlias:f=>{const d=JSON.parse(f.readResult.text);d.artifact.path=d.artifact.file;definition(f,d);},
 missingArtifact:f=>{const d=JSON.parse(f.readResult.text);delete d.artifact;definition(f,d);},
 deepPayload:f=>{const d=JSON.parse(f.readResult.text);let v=d;for(let i=0;i<12;i++){v.nested={};v=v.nested;}definition(f,d);},
};
for(const [name,mutate] of Object.entries(rejects))test('reject '+name,async()=>{const f=fixture();mutate(f);assert.equal(await invoke(helper,f),null);});
test('generic single-artifact provenance schema accepted without engineering fixture special case',async()=>{const f=fixture();definition(f,{schema:'public-bias-definition/1',scope:'Single TorchScript source provenance',artifact:{path:'wtmetad.pt',sha256:f.prior.snapshots.find(s=>s.name==='wtmetad.pt').sha256},cv:{indices:[0,1]},parameters:{sigma:0.1}});assert.equal((await invoke(helper,f)).kind,'unstarted-optional-manifest-definition');});
test('rejected correction leaves scientific hash gate active and keeps old binding',async()=>{const f=fixture();f.task.manualEdits['bias.manifest_file']=6;let value=structuredClone(f.task),reads=0;const records={read(){return structuredClone(value);},save(n){value=structuredClone(n);}};const worker={async request(method,url){if(url==='/api/runs/prepare')return f.next;if(url==='/api/run/status')return f.prior;if(url==='/api/run/input'){reads++;return f.readResult;}throw Error(url);}};await assert.rejects(prepareDeployment(records,worker,{taskId:f.task.id}),/科学参数已修改/);assert.equal(reads,0);assert.equal(value.inputBinding.artifactId,f.prior.id);assert.equal(value.deployment.request,null);});

test('coherent unchanged selected PT2 is rejected, not merely a science-delta mismatch',async()=>{const f=fixture();for(const run of [f.prior,f.next]){const model=run.snapshots.find(s=>s.name==='wtmetad.pt');model.name='bias.pt2';model.source=model.source.replace('wtmetad.pt','bias.pt2');run.inputs['bias.pt2']=model.source;delete run.inputs['wtmetad.pt'];}for(const p of [f.task.inputBinding.parameters,f.parameters]){p.bias_file='bias.pt2';p.bias.file=f.prior.inputs['bias.pt2'];p.bias.artifact_format='aoti';}f.prior.parameters=structuredClone(f.task.inputBinding.parameters);f.next.parameters=structuredClone(f.parameters);f.task.inputBinding.hashes=f.prior.snapshots.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name));assert.equal(await invoke(helper,f),null);assert.equal(f.readCalls.length,0);});
test('coherent unchanged explicit backend declaration blocks correction',async()=>{const f=fixture();for(const p of [f.task.inputBinding.parameters,f.parameters])p.bias.backend='torchscript';f.prior.parameters=structuredClone(f.task.inputBinding.parameters);f.next.parameters=structuredClone(f.parameters);assert.equal(await invoke(helper,f),null);assert.equal(f.readCalls.length,0);});
test('coherent old nested/canonical alias conflict blocks before read',async()=>{const f=fixture();f.task.inputBinding.parameters.bias.manifest_file+='x';f.prior.parameters=structuredClone(f.task.inputBinding.parameters);assert.equal(await invoke(helper,f),null);assert.equal(f.readCalls.length,0);});
test('reader rejection is reached after all exact synthetic identity guards',async()=>{const f=fixture();f.readError=true;assert.equal(await invoke(helper,f),null);assert.equal(f.readCalls.length,1);});

test('late immutable-reader response cannot overwrite a changed input binding anchor',async()=>{const f=fixture();let value=structuredClone(f.task),release,enteredResolve;const entered=new Promise(resolve=>enteredResolve=resolve),gate=new Promise(resolve=>release=resolve),calls=[];const records={read(){return structuredClone(value);},save(n){value=structuredClone(n);}};const worker={async request(method,url){calls.push(url);if(url==='/api/runs/prepare')return f.next;if(url==='/api/run/status')return f.prior;if(url==='/api/run/input'){enteredResolve();await gate;return f.readResult;}throw Error(url);}};const pending=prepareDeployment(records,worker,{taskId:f.task.id});await entered;value.inputBinding.artifactId='newer-current-anchor';release();await assert.rejects(pending,/原输入绑定已变化/);assert.equal(value.inputBinding.artifactId,'newer-current-anchor');assert.equal(value.artifacts.some(a=>a.id===f.next.id),false);assert.equal(calls.some(url=>/validate|submit/.test(url)),false);});

function prepareDeployment(records,worker,args,localReview){return prepareActualDeployment(records,withComputeProject(worker,records.read(args.taskId)),args,localReview);}
