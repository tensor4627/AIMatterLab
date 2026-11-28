import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),integer=(v,min=1)=>Number.isSafeInteger(v)&&v>=min;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\r\n\0]/.test(v),absolute=v=>text(v)&&v.startsWith('/')&&!v.includes('\\')&&!v.slice(1).split('/').some(p=>['.','..',''].includes(p));
const stable=v=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const requireThat=(test,message)=>{if(!test)throw Error('Consumer target identity: '+message);};
function configShape(v){requireThat(object(v)&&equal(Object.keys(v).sort(),['target','projectId','targetId','inputSource','maxSeconds','directoryName','resources','gpu'].sort())&&v.target==='local'&&v.inputSource==='local'&&text(v.projectId)&&text(v.targetId)&&integer(v.maxSeconds)&&v.maxSeconds<=604800&&integer(v.gpu,0)&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.directoryName),'one complete canonical local deployment config required');const r=v.resources;requireThat(object(r)&&equal(Object.keys(r).sort(),['cpus','gpus','memory_mb','queue','account'].sort())&&integer(r.cpus)&&r.gpus===1&&integer(r.memory_mb)&&typeof r.queue==='string'&&typeof r.account==='string','first GPU consumer target requires explicit single-GPU resource declaration');return structuredClone(v);}
function policyShape(project,config,engine){
 requireThat(project?.id===config.projectId&&object(project.policy),'actual selected registered project required');const p=project.policy;
 for(const key of ['engines','environments','input_roots'])requireThat(Array.isArray(p[key])&&p[key].length>0&&p[key].length<=256&&p[key].every(text)&&new Set(p[key]).size===p[key].length,'bounded explicit project policy '+key+' required');
 requireThat(p.engines.includes(engine)&&p.environments.includes(config.targetId)&&Array.isArray(p.gpus)&&p.gpus.every(i=>integer(i,0))&&p.gpus.includes(config.gpu)&&integer(p.max_seconds)&&integer(p.max_concurrent)&&config.maxSeconds<=p.max_seconds,'target request is outside current project authorization; this helper cannot grant it');
 requireThat(p.input_roots.every(absolute),'project input root policy must be explicit absolute paths');return {engines:structuredClone(p.engines),environments:structuredClone(p.environments),input_roots:structuredClone(p.input_roots),gpus:structuredClone(p.gpus),max_seconds:p.max_seconds,max_concurrent:p.max_concurrent};
}
/** Pure verification only. Trusted main must reread guarded science, project and worker runtime receipts; this does not mint human authority. */
export function consumerTargetScope({task,science,config,project,runtime}){
 const c=configShape(config),engine=task?.parameters?.engine;
 requireThat(task?.workflowVersion===2&&text(task.id)&&['codex','kimi','qwen','deepseek','compatible'].includes(task.provider)&&text(task.threadId)&&integer(task.parameterRevision)&&['bias.validate','gpumd.sampling'].includes(engine)&&science?.engine===engine&&science.spec?.engine===engine&&sha(science.closureSha)&&['local-human','input-observation'].includes(science.authority?.kind)&&text(science.authority.id)&&sha(science.authority.sha256),'current independently human-reviewed scientific input closure required');
 const scoped=project?.conversation_scope;
 const producerProject=science.consumerConstraints?.projectId;
 const producerMatches=scoped?scoped.workflow===task.id&&scoped.owner===createHash('sha256').update(JSON.stringify([task.provider,task.threadId])).digest('hex')&&
  typeof producerProject==='string'&&producerProject===task.consumerArtifact?.producerProjectId:producerProject===c.projectId;
 requireThat(science.consumerConstraints?.target==='local'&&producerMatches&&science.consumerConstraints.artifactBackend==='torchscript','consumer scope/backend must match current actual successful producer constraint');
 const policy=policyShape(project,c,engine),facts=runtime?.facts;
 requireThat(runtime?.status==='observed'&&sha(runtime.receipt)&&facts?.state==='observed'&&facts.environment_id===c.targetId&&facts.engine===engine&&sha(facts.configuration_sha256)&&facts.python?.registration_match===true&&absolute(facts.python.executable)&&absolute(facts.executables?.python)&&facts.file_observations_status?.status==='passed'&&facts.cuda?.available===true,'current target-specific observed runtime, configured/observed Python and CUDA required');
 if(engine==='gpumd.sampling')requireThat(absolute(facts.executables['gpu-sampling'])&&['passed','not_run'].includes(facts.native_runtime?.status),'registered native GPU-Sampling runtime required; loader probe is distinct from actual execution');
 const base={kind:'consumer-target-scope-v1',taskId:task.id,provider:task.provider,threadId:task.threadId,parameterRevision:task.parameterRevision,engine,target:'local',config:c,projectPolicySha:hash(policy),scienceClosureSha:science.closureSha,scienceAuthority:structuredClone(science.authority),environmentId:c.targetId,configurationSha:facts.configuration_sha256,configuredPython:facts.executables.python,observedPython:facts.python.executable,runtimeReceiptSha:runtime.receipt,sourceBuildRelation:facts.source_build_relation?.status??'not_run',scientificValidation:'not_run'};
 return {...base,scopeSha:hash(base)};
}
/** Main must obtain workerIdentity from admin immutable run_id endpoint, not recompute a Python environment hash in JS. */
export function assertPreparedConsumerTarget({scope,task,science,config,project,runtime,run,workerIdentity,sourcePaths,execution=false}){
 const current=consumerTargetScope({task,science,config,project,runtime});requireThat(scope?.scopeSha===current.scopeSha&&equal(scope,current),'target review is stale after inputs, policy, target runtime or config changes');
 const c=current.config,identity=workerIdentity;
 requireThat(text(run?.id)&&run.engine===current.engine&&run.project_id===c.projectId&&run.environment_id===c.targetId&&run.gpu===c.gpu&&run.max_seconds===c.maxSeconds&&run.directory_name===c.directoryName&&object(run.environment_snapshot)&&run.environment_snapshot.id===c.targetId&&run.environment_snapshot.executables?.python===current.configuredPython,'actual prepared run target/resources differ from separately reviewed target');
 requireThat((execution?['draft','ready'].includes(run.status):run.status==='draft'&&run.validation?.status==='not_run')&&!run.identity&&!run.started_at&&!run.ended_at&&!run.exit&&!run.submitted_at&&!run.scheduler_id&&!run.job_id,'only an unstarted local draft may use target confirmation; reconcile existing or unknown jobs');
 requireThat(identity?.kind==='immutable-run-environment-identity-v1'&&identity.run_id===run.id&&identity.project_id===c.projectId&&identity.environment_id===c.targetId&&identity.engine===current.engine&&identity.configuration_sha256===current.configurationSha&&identity.interpreter===current.configuredPython,'worker-authoritative immutable full environment fingerprint differs; no ID-only/JS hash substitution');
 requireThat(equal(run.parameters,science.spec.parameters)&&object(sourcePaths)&&equal(run.inputs,sourcePaths)&&Array.isArray(science.entries)&&science.entries.length>0&&science.entries.length<=32&&Array.isArray(run.snapshots),'actual prepared science and input identities are required');
 const names=science.entries.map(v=>v.name).sort();requireThat(new Set(names).size===names.length&&equal(Object.keys(sourcePaths).sort(),names)&&run.snapshots.length===names.length&&new Set(run.snapshots.map(v=>v.name)).size===names.length,'actual snapshots must exactly equal reviewed dependency closure');
 for(const entry of science.entries){const snapshot=run.snapshots.find(v=>v.name===entry.name),source=sourcePaths[entry.name];requireThat(absolute(source)&&source.endsWith('/'+entry.name)&&snapshot?.source===source&&snapshot.sha256===entry.sha256&&sha(snapshot.sha256)&&snapshot.size===entry.size&&integer(snapshot.size),'actual snapshot name/source/hash/size differs from science review');}
 const versions=(science.privateBindings||[]).map(v=>({entry_id:v.id,spec_sha256:v.spec_sha256,code_sha256:v.code_sha256,parameters_sha256:v.parameters_sha256}));requireThat(equal(run.private_cv_versions||[],versions),'actual consumer private content versions differ');
 return {kind:'consumer-prepared-target-identity-v1',runId:run.id,scopeSha:current.scopeSha,configurationSha:current.configurationSha,scienceClosureSha:science.closureSha,requiresGuardedImmutableFileReadback:true,scientificValidation:'not_run'};
}
/** Pure shape/hash check after main actually reads each /api/run/input. Binary SHA/source review is distinct from ABI or force validation. */
export function assertConsumerSnapshotReadback(entry,value){
 requireThat(value?.name===entry.name&&value.sha256===entry.sha256&&value.size===entry.size&&!value.truncated,'actual immutable input metadata differs');
 if(entry.binary){requireThat(value.editable===false&&value.text===undefined&&typeof value.reason==='string'&&(value.reason.includes('Binary input')||entry.size>2*1024*1024&&value.reason==='Input exceeds text review limit'),'serialized binary must use SHA/source metadata review; no decoded private bytes');}
 else requireThat(value.editable===true&&typeof value.text==='string'&&Buffer.byteLength(value.text)===entry.size&&createHash('sha256').update(value.text,'utf8').digest('hex')===entry.sha256,'actual full immutable UTF8 readback differs');
 return true;
}
