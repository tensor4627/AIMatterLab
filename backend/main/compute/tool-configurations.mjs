import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createVerifiedWorkerScope} from './verified-worker-scope.mjs';
import {remember} from '../workspace/bounded-map.mjs';

const INDEX='tool-configuration-index',BINDING='tool-guidance-binding',METADATA='tool-guidance-metadata',DELEGATION='tool-guidance-repair-delegation';
const providers=new Set(['codex','kimi','qwen','deepseek','compatible']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Exact typed tool configuration request required');};
const id=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9_-]{8,80}$/.test(value))throw Error('Invalid tool configuration identity');return value;};
const bindingKey=owner=>owner?.provider&&owner?.threadId?owner.provider+':'+owner.threadId+':'+(owner.taskId??'-'):null;
const delegationOwner=owner=>Object.fromEntries(['provider','threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,owner?.[key]??null]));
const joined=(root,relative)=>/^[A-Za-z]:[\\/]|^\\\\/.test(root)?path.win32.join(root,...relative.split('/')):path.posix.join(root,relative);
const mergedResources=(...groups)=>[...new Map(groups.flat().map(item=>[JSON.stringify([item.path,item.role,item.package_id,item.package_version,item.configuration_id]),item])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function executionSnapshot(value){const skill=value?.execution_skill;if(!skill)return false;if(typeof skill.id!=='string'||!skill.id||typeof skill.body!=='string'||!skill.body||!/^[a-f0-9]{64}$/.test(skill.sha256||'')||createHash('sha256').update(skill.body).digest('hex')!==skill.sha256)throw Error('Worker execution skill snapshot identity differs');return true;}
function guidancePaths(record,relative){
 const result=new Set([relative]),links=(record.files||[]).filter(item=>item.kind==='symlink');let current=relative;
 for(let count=0;count<40;count++){
  const link=links.filter(item=>current===item.path||current.startsWith(item.path+'/')).sort((a,b)=>a.path.length-b.path.length)[0];if(!link)break;
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(link.path),link.target,current.slice(link.path.length)));
  if(target==='..'||target.startsWith('../')||path.posix.isAbsolute(target)||result.has(target))throw Error('Invalid registered guidance link closure');result.add(target);current=target;
 }
 return [...result];
}

/** Human configuration actions and desktop references; the worker owns all outcomes. */
export function createToolConfigurationController({catalog,packages,worker,getSettings,current,currentTarget=()=>null,getProvider=()=>current()?.provider||getSettings().agentProvider||'codex',getLease=provider=>worker.providerScopes?.scopes?.get(provider),getResourceIdentity=()=>({kind:'worker'}),assertIdle,confirm,toWorkerPath,now=Date.now}){
 const grants=new Map(),bindingOperations=new Map();
 const {currentBinding,capture,verified}=createVerifiedWorkerScope({worker,getSettings,current,currentTarget});
 function index(value){id(value);const found=catalog.get(INDEX,value);if(!found||found.schema_version!==1)throw Error('Unknown tool configuration reference');return found;}
 const recordFor=reference=>{try{return packages.read({package_id:reference.package_id,package_version:reference.package_version});}catch{if(reference.package_metadata)return reference.package_metadata;throw Error('Registered package metadata unavailable');}};
 function compatibleTarget(reference){
  const selected=currentTarget();if(!selected)return true;
  if(selected.kind!=='local'||!selected.projectId||!selected.environmentId||!selected.workerBinding||selected.projectId!==reference.project_id||selected.environmentId!==reference.environment_id||!equal(selected.workerBinding,reference.worker_binding))return false;
  const record=recordFor(reference);
  return !selected.engine||record.manifest.functions.some(feature=>feature.engine===selected.engine);
 }
 function note(reference,response){
  if(response.configuration_id!==reference.configuration_id)throw Error('Worker configuration identity differs');
  if(response.package_id!==reference.package_id||response.package_version!==reference.package_version||response.target?.project_id!==reference.project_id||response.target?.environment_id!==reference.environment_id)throw Error('Worker configuration target differs');
  const registered=recordFor(reference);
  if(response.manifest_sha256!==undefined&&response.manifest_sha256!==registered.manifest_sha256||response.source_commit!==undefined&&response.source_commit!==registered.source_commit||response.execution_skill&&(!response.manifest_sha256||!response.source_commit))throw Error('Worker package source identity differs');
  return catalog.transaction(()=>{
   const fresh=index(reference.configuration_id);if(!equal([fresh.package_id,fresh.package_version,fresh.worker_binding,fresh.project_id,fresh.environment_id],[reference.package_id,reference.package_version,reference.worker_binding,reference.project_id,reference.environment_id]))throw Error('Configuration index identity changed');
   if(!Number.isSafeInteger(response.revision)||response.revision<(fresh.last_revision??0)||(response.archive_revision??fresh.authority_metadata?.archive_revision??0)<(fresh.authority_metadata?.archive_revision??0))throw Error('Late configuration authority reply');
   const active=executionSnapshot(response),archived=response.archived_resources;
   const next={...fresh,last_revision:response.revision,has_execution:!!(fresh.has_execution||active),may_have_execution:!!(fresh.may_have_execution||active),...archived?{authority_metadata:{revision:response.revision,archive_revision:response.archive_revision??1,manifest_sha256:response.manifest_sha256,source_commit:response.source_commit,environment_sha256:response.current_environment_sha256??response.environment_sha256,functions:response.functions,archived_resources:mergedResources(fresh.authority_metadata?.archived_resources||[],archived)}}:{}};
   catalog.put(INDEX,reference.configuration_id,next);return response;
  });
 }
 async function request(configuration_id,target,extra={},beforeDispatch){
  const reference=index(configuration_id),ticket=await verified(reference.worker_binding);
  ticket.assert();beforeDispatch?.(reference);
  const result=await worker.request('POST',target,{configuration_id,...extra});ticket.assert();return note(reference,result);
 }
 function archiveResources(){
  const entries=new Map();
  for(const reference of catalog.list(INDEX).filter(value=>value.has_execution||value.may_have_execution)){
   const record=recordFor(reference);
   for(const resource of record.guidance){
    const key=reference.package_id+':'+reference.package_version+':'+resource.role+':'+resource.path;
    const entry=entries.get(key)||{id:key,role:resource.role,paths:[]};
    for(const root of [record.snapshot_root,record.package_root,reference.package_root,...record.package_roots??[],...reference.origin_roots??[]])for(const relative of guidancePaths(record,resource.path))if(root&&!entry.paths.includes(joined(root,relative)))entry.paths.push(joined(root,relative));
    entries.set(key,entry);
   }
   for(const resource of reference.authority_metadata?.archived_resources||[]){
    const key=reference.package_id+':'+reference.package_version+':'+resource.role+':worker:'+resource.path;
    entries.set(key,{id:key,role:resource.role,paths:[resource.path]});
   }
  }
  for(const saved of catalog.list(METADATA))for(const resource of saved.archived_resources){
   const key=resource.package_id+':'+resource.package_version+':'+resource.role+':worker:'+resource.path;
   const paths=[resource.path];
   if(process.platform==='win32'&&resource.path.startsWith('/')){
    const drive=/^\/mnt\/([a-z])\/(.*)$/.exec(resource.path);
    if(drive)paths.push(drive[1].toUpperCase()+':\\'+drive[2].replaceAll('/','\\'));
    else for(const host of ['wsl.localhost','wsl$'])paths.push('\\\\'+host+'\\'+saved.worker_binding.distribution+resource.path.replaceAll('/','\\'));
   }
   entries.set(key,{id:key,role:resource.role,paths:[...new Set([...(entries.get(key)?.paths||[]),...paths])]});
  }
  return [...entries.values()].sort((a,b)=>a.id.localeCompare(b.id));
 }
 function metadataFacts(reference,state,archived){
  const value=reference.authority_metadata,record=recordFor(reference);
  return {schemaVersion:1,revision:digest([state,reference.configuration_id,value,archived,currentTarget()]),state,package:{id:reference.package_id,version:reference.package_version,manifestSha256:value?.manifest_sha256||record.manifest_sha256,sourceCommit:value?.source_commit||record.source_commit},workerBinding:reference.worker_binding,target:{kind:'local',projectId:reference.project_id,environmentId:reference.environment_id,fingerprint:value?.environment_sha256||'unavailable'},archivedResources:archived,applicableFunctions:[],engines:(value?.functions||record.manifest.functions).map(feature=>feature.engine).filter(Boolean)};
 }
 async function refreshMetadata(){
  // Desktop package installations belong to WSL. A hosted SSH resource owns its
  // tool configurations and execution skills through the resource tool API.
  if(!worker.connection||worker.identity?.kind==='ssh')return;
  // Old services keep their existing routes and jobs; capability absence is not an upgrade request.
  if(worker.connection.health?.tool_configuration_schema!==1)return;
  const ticket=capture(),value=await worker.request('POST','/api/tool-guidance/state',{});ticket.assert();
  if(value.schema_version!==1||typeof value.revision!=='string'||!Array.isArray(value.configurations)||!Array.isArray(value.archived_resources)||JSON.stringify(value).includes('"body":'))throw Error('Invalid guidance metadata authority response');
  for(const entry of value.configurations){
   id(entry.configuration_id);if(entry.has_activation!==true||!Number.isSafeInteger(entry.revision)||typeof entry.package_id!=='string'||! /^[0-9a-f]{64}$/.test(entry.package_version)||entry.execution_skill&&(! /^[0-9a-f]{64}$/.test(entry.execution_skill.sha256)||Object.keys(entry.execution_skill).some(key=>!['id','sha256'].includes(key))))throw Error('Invalid activation metadata');
   const previous=catalog.get(INDEX,entry.configuration_id);
   if(previous&&!equal(previous.worker_binding,ticket.binding))throw Error('Configuration identity belongs to another original service');
   const reference=previous||{schema_version:1,configuration_id:entry.configuration_id,package_id:entry.package_id,package_version:entry.package_version,worker_binding:ticket.binding,project_id:entry.target.project_id,environment_id:entry.target.environment_id,created_at:now()};
   let registered;try{registered=recordFor(reference);}catch{}
   if(registered&&(entry.manifest_sha256!==registered.manifest_sha256||entry.source_commit!==registered.source_commit))throw Error('Guidance metadata source identity differs');
   const archived=value.archived_resources.filter(resource=>resource.configuration_id===entry.configuration_id);
   const guidance=archived.filter(resource=>resource.path.startsWith(entry.snapshot_root+'/')).map(resource=>({path:resource.path.slice(entry.snapshot_root.length+1),role:resource.role}));
   const fresh={...reference,has_execution:true,may_have_execution:true,last_revision:Math.max(reference.last_revision||0,entry.revision),origin_roots:[...new Set([...(reference.origin_roots||[]),...(entry.origin_roots||[])])],package_metadata:reference.package_metadata||{manifest:{functions:entry.functions},guidance,files:[],snapshot_root:entry.snapshot_root,package_roots:entry.origin_roots||[],manifest_sha256:entry.manifest_sha256,source_commit:entry.source_commit}};
   if((fresh.authority_metadata?.revision??0)<=entry.revision&&(fresh.authority_metadata?.archive_revision??0)<=entry.archive_revision)fresh.authority_metadata={revision:entry.revision,archive_revision:entry.archive_revision,manifest_sha256:entry.manifest_sha256,source_commit:entry.source_commit,environment_sha256:entry.environment_sha256,functions:entry.functions,archived_resources:mergedResources(fresh.authority_metadata?.archived_resources||[],archived)};
   catalog.put(INDEX,reference.configuration_id,fresh);
  }
  const key=digest(ticket.binding),previous=catalog.get(METADATA,key);
  catalog.put(METADATA,key,{schema_version:1,worker_binding:ticket.binding,revision:value.revision,archived_resources:mergedResources(previous?.archived_resources||[],value.archived_resources)});
 }
 const api={
  context(value={}){exact(value,[]);const owner=current(),provider=getProvider(),key=bindingKey(owner),bound=key?catalog.get(BINDING,key):null;return {provider,owner_key:key?digest([owner,currentTarget(),getLease(provider)?.epoch,{distribution:worker.identity?.distribution,root:worker.identity?.root,port:worker.connectionTarget?.port}]):null,hasConversation:!!key,configuration_id:bound?.configuration_id??null,providers:[...(bound?.providers||[])]};},
  async createProject(value){
   exact(value,['environment_id','name','request_id']);assertIdle();id(value.request_id);if(typeof value.name!=='string'||!value.name.trim()||value.name.length>200||/[\x00-\x1f]/.test(value.name)||typeof value.environment_id!=='string'||!value.environment_id)throw Error('Choose the project name and registered environment');
   const ticket=await verified(),environments=await worker.request('GET','/api/environments');ticket.assert();if(!Array.isArray(environments)||!environments.some(item=>item.id===value.environment_id))throw Error('Registered environment is unavailable');
   const projectId='tool-config-'+digest([ticket.binding,value.request_id]).slice(0,24),spec={id:projectId,name:value.name.trim(),policy:{engines:['installation.check'],gpus:[0],max_seconds:30,max_concurrent:1,input_roots:[path.posix.join(ticket.binding.root,'projects',projectId,'inputs')],environments:[value.environment_id]}},projects=await worker.request('GET','/api/projects');ticket.assert();
   if(!Array.isArray(projects))throw Error('Invalid project catalog response');const existing=projects.find(item=>item.id===projectId);
   if(existing){if(existing.name!==spec.name||!equal(existing.policy,spec.policy))throw Error('Configuration project was changed; its authorization is preserved');return existing;}
   const result=await worker.request('POST','/api/tool-configuration/project/create',{project_id:projectId,name:spec.name,environment_id:value.environment_id});ticket.assert();if(result.id!==projectId||result.name!==spec.name||result.authoring_only||!equal(result.policy,spec.policy))throw Error('Created project authorization differs from the reviewed scope');return result;
  },
  list(value={}){exact(value,[]);return catalog.list(INDEX).map(({schema_version,configuration_id,package_id,package_version,worker_binding,project_id,environment_id,created_at})=>({schema_version,configuration_id,package_id,package_version,worker_binding,project_id,environment_id,created_at}));},
  async plan(value){
   exact(value,['package_id','package_version','project_id','environment_id','request_id']);assertIdle();
   const record=packages.read({package_id:value.package_id,package_version:value.package_version}),ticket=await verified();
   await worker.request('POST','/api/tool-package/register',{snapshot_root:toWorkerPath(record.snapshot_root),origin_root:toWorkerPath(record.package_root),package_id:record.package_id,package_version:record.package_version});ticket.assert();
   const result=await worker.request('POST','/api/tool-configuration/plan',{package_id:value.package_id,package_version:value.package_version,target:{target:'local',project_id:value.project_id,environment_id:value.environment_id},request_id:value.request_id});ticket.assert();id(result.configuration_id);
   const reference={schema_version:1,configuration_id:result.configuration_id,package_id:value.package_id,package_version:value.package_version,worker_binding:ticket.binding,package_root:record.package_root,project_id:value.project_id,environment_id:value.environment_id,created_at:now(),has_execution:false};
   const previous=catalog.get(INDEX,reference.configuration_id),identity=value=>[value.configuration_id,value.package_id,value.package_version,value.worker_binding,value.project_id,value.environment_id];if(previous&&!equal(identity(previous),identity(reference)))throw Error('Configuration reference changed');
   if(!previous)catalog.put(INDEX,reference.configuration_id,reference);return note(previous||reference,result);
  },
  async execute(value,event){
   exact(value,['configuration_id','expected_revision','plan_sha256']);assertIdle();
   const reference=index(value.configuration_id),ticket=await verified(reference.worker_binding);
   const plan=await worker.request('POST','/api/tool-configuration/status',{configuration_id:value.configuration_id});ticket.assert();note(reference,plan);
   if(plan.revision!==value.expected_revision||plan.plan_sha256!==value.plan_sha256||plan.status!=='planned')throw Error('Configuration plan changed; review it again');
   if(!await confirm(plan,event)){ticket.assert();return {...plan,cancelled:true};}ticket.assert();assertIdle();
   return request(value.configuration_id,'/api/tool-configuration/execute',{expected_revision:value.expected_revision,plan_sha256:value.plan_sha256});
  },
  status(value){exact(value,['configuration_id']);return request(value.configuration_id,'/api/tool-configuration/status');},
  async activate(value){
   exact(value,['configuration_id','expected_revision','plan_sha256']);assertIdle();const reference=index(value.configuration_id),record=packages.read({package_id:reference.package_id,package_version:reference.package_version});
   const ticket=await verified(reference.worker_binding),observed=await worker.request('POST','/api/tool-configuration/status',{configuration_id:value.configuration_id});ticket.assert();note(reference,observed);
   if(observed.install?.status!=='passed'||observed.revision!==value.expected_revision||observed.plan_sha256!==value.plan_sha256)throw Error('Confirmed installed source required; configuration identity changed');
   return request(value.configuration_id,'/api/tool-configuration/activate',{expected_revision:value.expected_revision,plan_sha256:value.plan_sha256},fresh=>{
    // Persist only at the verified dispatch boundary; a reply may be lost after this call.
    catalog.transaction(()=>{const latest=index(value.configuration_id);if(!equal([latest.package_id,latest.package_version,latest.worker_binding,latest.project_id,latest.environment_id],[fresh.package_id,fresh.package_version,fresh.worker_binding,fresh.project_id,fresh.environment_id]))throw Error('Configuration reference changed');catalog.put(INDEX,value.configuration_id,{...latest,may_have_execution:true,package_metadata:{manifest:record.manifest,guidance:record.guidance,files:record.files,snapshot_root:record.snapshot_root,package_root:record.package_root,manifest_sha256:record.manifest_sha256,source_commit:record.source_commit}});});
   });
  },
  async read(value){exact(value,['configuration_id']);const result=await request(value.configuration_id,'/api/tool-execution-skill/read');return {...result,guidance_resources:archiveResources().filter(item=>item.id.startsWith(result.package_id+':'+result.package_version+':'))};},
  async bind(value){
   exact(value,['configuration_id','providers']);assertIdle();if(!Array.isArray(value.providers)||new Set(value.providers).size!==value.providers.length||value.providers.some(item=>!providers.has(item)))throw Error('Choose explicit execution skill sharing');
   const owner=structuredClone(current()),key=bindingKey(owner);if(!key)throw Error('Select an existing conversation before attaching a configuration');const operation=(bindingOperations.get(key)||0)+1;remember(bindingOperations,key,operation,{max:256});
   const result=await api.read({configuration_id:value.configuration_id});if(bindingOperations.get(key)!==operation||!equal(owner,current())||!executionSnapshot(result))throw Error('Current installed execution snapshot unavailable or a newer selection superseded it');
   const reference=index(value.configuration_id);if(currentTarget()?!compatibleTarget(reference):owner.projectId&&owner.projectId!==reference.project_id)throw Error('Configuration target differs from the current workflow');
   const previous=catalog.get(BINDING,key);catalog.put(BINDING,key,{schema_version:1,id:key,owner,configuration_id:value.configuration_id,providers:[...value.providers],revision:(previous?.revision||0)+1});grants.delete(key);catalog.remove?.(DELEGATION,key);return {status:'bound',configuration_id:value.configuration_id};
  },
  async resolveGuidance(scope){
   const check=()=>{if(scope.checkCurrent&&scope.checkCurrent()!==true)throw Error('Guidance owner changed');};check();await refreshMetadata();check();const selected=catalog.get(BINDING,bindingKey(scope)),archived=archiveResources();
   if(!selected)return {schemaVersion:1,revision:digest(archived),state:'legacy_unconfigured',archivedResources:archived};
   let reference=index(selected.configuration_id),result;
   const permitted=selected.providers.includes(scope.provider),targetMatches=compatibleTarget(reference);
   if(permitted&&targetMatches)try{result=await api.read({configuration_id:reference.configuration_id});check();reference=index(reference.configuration_id);}catch{check();}
   if(!equal(selected,catalog.get(BINDING,bindingKey(scope))))throw Error('Execution skill sharing changed');
   const state=!permitted?'revoked':!compatibleTarget(reference)?'stale':result?.status==='active'?'active':'stale',freshArchived=archiveResources(),facts=metadataFacts(reference,state,freshArchived);
   facts.revision=digest([facts.revision,selected.revision,result?.revision??reference.last_revision??0,result?.archive_revision??reference.authority_metadata?.archive_revision??1]);
   if(permitted&&compatibleTarget(reference)&&executionSnapshot(result)){
    facts.activation={id:result.execution_skill.id,revision:String(result.revision),configurationId:reference.configuration_id};
    facts.executionSkill={id:result.execution_skill.id,sha256:result.execution_skill.sha256,text:result.execution_skill.body,resources:[]};
    if(result.check_findings?.length)facts.checkFindings=structuredClone(result.check_findings);
   }
   const grant=grants.get(bindingKey(scope));if(facts.state!=='revoked'&&grant&&equal(grant.workerBinding,reference.worker_binding)&&grant.baseRevision===facts.revision&&grant.expiresAt>now())facts.readGrant={...grant.value,authorityRevision:facts.revision,activationId:facts.activation?.id??null};
   // This authority originates only in the sender-validated grant action below.
   // Probe/configuration evidence revisions do not revoke a repair delegation.
   const delegated=catalog.get(DELEGATION,bindingKey(scope)),lease=getLease(scope.provider),record=recordFor(reference);let observedBinding;try{observedBinding=currentBinding();}catch{}
   if(result&&facts.state!=='revoked'&&targetMatches&&delegated?.schema_version===1&&delegated.binding_revision===selected.revision&&delegated.configuration_id===reference.configuration_id&&equal(delegated.owner,delegationOwner(scope))&&equal(delegated.resourceIdentity,getResourceIdentity(scope.provider))&&equal(delegated.worker_binding,reference.worker_binding)&&equal(delegated.worker_binding,observedBinding)&&equal(delegated.package,{id:reference.package_id,version:reference.package_version,manifestSha256:record.manifest_sha256,sourceCommit:record.source_commit})&&equal(delegated.target,{projectId:reference.project_id,environmentId:reference.environment_id})&&lease&&['threadId','taskId','projectId','environmentId','inputRoot'].every(key=>equal(lease.context?.[key]??null,scope[key]??null))&&equal(delegated.resources,facts.archivedResources.filter(item=>delegated.value.resourceIds.includes(item.id))))facts.readGrant={...delegated.value,authorityRevision:facts.revision,activationId:facts.activation?.id??null};
   return facts;
  },
  async grant(value){
   exact(value,['configuration_id','purpose','resource_ids']);assertIdle();if(!['configure','repair','update'].includes(value.purpose)||!Array.isArray(value.resource_ids)||value.resource_ids.some(item=>typeof item!=='string'))throw Error('Invalid guidance read scope');
   const owner=structuredClone(current()),key=bindingKey(owner);if(!key)throw Error('Choose the conversation that will read configuration guidance');
   const selected=catalog.get(BINDING,key);if(selected?.configuration_id!==value.configuration_id||!selected.providers.includes(owner.provider))throw Error('Bind this configuration and explicitly share with the current provider first');
   const lease=getLease(owner.provider),leaseContext=structuredClone(lease?.context);if(!Number.isSafeInteger(lease?.epoch)||!['threadId','taskId','projectId','environmentId','inputRoot'].every(key=>equal(lease.context[key]??null,owner[key]??null)))throw Error('Connect the exact current conversation context before opening configuration guidance');
   const facts=await api.resolveGuidance({...owner,epoch:lease.epoch});if(!equal(owner,current())||!equal(selected,catalog.get(BINDING,key))||getLease(owner.provider)!==lease||!equal(lease.context,leaseContext)||facts.state==='revoked'||!compatibleTarget(index(value.configuration_id)))throw Error('Conversation, sharing or target changed');
   const prefix=facts.package.id+':'+facts.package.version+':',available=facts.archivedResources.filter(item=>item.id.startsWith(prefix)).map(item=>item.id),resourceIds=value.resource_ids;
   if(!resourceIds.length||new Set(resourceIds).size!==resourceIds.length||resourceIds.some(item=>!available.includes(item)))throw Error('Unknown archived guidance resource');
   if(value.purpose==='repair'){
    const record=recordFor(index(value.configuration_id)),grantId=randomUUID(),delegated={schema_version:1,id:key,binding_revision:selected.revision,configuration_id:value.configuration_id,owner:delegationOwner(owner),resourceIdentity:structuredClone(getResourceIdentity(owner.provider)),worker_binding:facts.workerBinding,target:{projectId:facts.target.projectId,environmentId:facts.target.environmentId},package:structuredClone(facts.package),resources:facts.archivedResources.filter(item=>resourceIds.includes(item.id)),value:{id:grantId,delegationId:grantId,duration:'delegation',purpose:'repair',resourceIds:[...resourceIds],owner:delegationOwner(owner),expiresAt:null}};
    if(record.manifest_sha256!==facts.package.manifestSha256||record.source_commit!==facts.package.sourceCommit)throw Error('Repair package identity changed');catalog.put(DELEGATION,key,delegated);grants.delete(key);return {status:'granted',duration:'delegation',expires_at:null};
   }
   const expiresAt=now()+10*60*1000;
   remember(grants,key,{baseRevision:facts.revision,workerBinding:facts.workerBinding,expiresAt,value:{id:randomUUID(),purpose:value.purpose,resourceIds,owner:{provider:owner.provider,threadId:owner.threadId,taskId:owner.taskId??null,leaseEpoch:lease.epoch},expiresAt}},{max:256});
   return {status:'granted',expires_at:expiresAt};
  }
 };
 return api;
}

export function registerToolConfigurationRoutes({handle,controller}){
 for(const method of ['context','list','createProject','plan','status','activate','read','bind','grant'])handle('tools.configurations.'+method,value=>controller[method](value));
 handle('tools.configurations.execute',(value,event)=>controller.execute(value,event));
}
