import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {visibleUserText} from '../../../contracts/agent/user-message.mjs';
import {inspectDesktopSource,transferRelease,withDesktopRelease} from './resource-release-transfer.mjs';
import {bindResourceToolDefinition} from './resource-tool-definition.mjs';

const selection=/^ssh:[A-Za-z0-9_-]{1,100}$/;
const sha256=/^[a-f0-9]{64}$/;
const planFields=['request_id','route','manifest','project_id','cluster_id','environment_id'];
const fields=(value,required,optional=[])=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))||
    Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))throw Error('Invalid resource tool request');
};
const portablePath=(root,child)=>{
 const rel=path.posix.relative(root,child);
 return path.posix.isAbsolute(child)&&!path.posix.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../');
};
const ownerKey=({provider,threadId})=>JSON.stringify([provider,threadId]);
const setupRequest=/install|configur|setup|set up|adopt|register|tool|script|安装|配置|接入|登记|工具|脚本|\b(?:save|prepare|update)\b[^.!?\r\n]{0,48}\bdraft\b|(?:保存|准备|起草|更新)[^。！？\r\n]{0,24}草稿/i;
const hasDirectory=text=>/(?:~\/|(?<![A-Za-z0-9_.:/])\/[^\s/])/.test(text)||namesDirectory(text,'~');
function namesDirectory(text,value){
 if(!value)return false;
 for(let at=text.indexOf(value);at>=0;at=text.indexOf(value,at+1)){
  const after=text.slice(at+value.length);
  if((!at||!/[A-Za-z0-9_.:/~-]/.test(text[at-1]))&&
   (!after||/^[\s'"\x60),;:!?，。；：、！？）]/.test(after)||/^[./](?:\s|$)/.test(after)))return true;
 }
 return false;
}
const directoryRequired=()=>Object.assign(Error('Use the script directory designated by the user for this resource'),{operationNotStarted:true});
const input=(name,description,properties,required=Object.keys(properties),readOnlyHint=true)=>({
 name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint}
});
const resource_id={type:'string',pattern:selection.source};
const setup_id={type:'string',pattern:sha256.source};
const text={type:'string',minLength:1,maxLength:2048};
const string={type:'string'};
const integer={type:'integer'};
const strings={type:'array',items:string};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const record=additionalProperties=>({type:'object',additionalProperties});
const port=object({filename:string,format:string});
const artifact=object({kind:{enum:['archive','binary']},url:string,sha256:setup_id,filename:string,executable:string},
 ['kind','sha256','filename','executable']);
const parameters=record({type:['string','number','boolean']});
const selected_definition=object({
 package_ref:{type:'string',description:'Opaque package_ref from scientific_skill_catalog.selected_skill.definitions in this turn.'},
 function_id:text,test_case_id:text
});
const testInputs=record({anyOf:[object({path:{type:'string',description:'Absolute path on the selected resource, within an authorized input root.'}}),object({text:string})]});
const manifest={
 ...object({
  id:{type:'string',description:'Lowercase identifier using letters, digits and hyphens, beginning with a letter.'},
  name:string,version:string,description:string,
  source:{anyOf:[
   object({kind:{enum:['installed']},executable:{type:'string',description:'Absolute path of the program or reviewed script to execute on the selected resource.'},sha256:setup_id},['kind','executable']),
   object({kind:{enum:['git']},url:string,commit:string,executable:string}),
   artifact,
  ]},
  interpreter:{enum:['bash','python']},
  argv:{...strings,description:'Arguments after the executable. Use individual strings and optional {input:port}, {output:port} or {param:name} references. Use [] when there are no arguments. No shell operators or scheduler command.'},
  dependencies:strings,support_files:strings,parameters,
  citations:{type:'array',items:object({url:string,title:string,version:string},['url'])},
  build:object({steps:{type:'array',items:object({command:string,args:strings,cwd:string},['command','args'])},max_seconds:integer}),
  inputs:record(port),outputs:record(port),
  test:object({
   inputs:{...testInputs,description:'Supply one fixture per declared input port using {path} or {text}.'},
   outputs:record(object({sha256:setup_id,contains:string,json_keys:strings,min_bytes:integer},[])),
   parameters,max_seconds:{type:'integer',minimum:1,maximum:600},
   resources:object({cpus:integer,gpus:integer,memory_mb:integer,qos:string},[]),
  },['inputs','max_seconds']),
  git_bootstrap:{...artifact,properties:{...artifact.properties,kind:{enum:['archive']}}},
 },['id','name','version','source','argv','inputs','outputs','test']),
 description:'Tool definition and bounded test for desktop review. Supply inputs and outputs as maps keyed by port name.',
};
const definitions=[
 input('list_resource_tools','List tool setup progress and scheduler targets for the acquired SSH resource and current project. Active entries include their exact environment, execution skill, and minimal test job.',{resource_id}),
 input('discover_resource_tool_scripts','Scan a user-designated directory on the acquired SSH resource. Report script groups and representative file hashes for the user to select.',{resource_id,directory:text}),
 input('plan_resource_tool_setup','Save an editable resource tool setup for desktop review. The desktop starts installation or the allocation test after review. Use exact resource and scheduler IDs from list_resource_tools and read the bundled setup guide.',{
  resource_id,route:{enum:['fresh','existing','custom']},cluster_id:text,environment_id:text,queue_target_id:text,prior_run_id:{type:'string',pattern:'^[a-f0-9]{24}$'},
  manifest,selected_definition,candidate:{...object({path:text,sha256:setup_id}),description:'For the existing route, use the reviewed script path as manifest.source.executable and supply the digest of that same file.'}
 },['resource_id','route','cluster_id','environment_id','manifest'],false),
 input('read_resource_tool_setup','Read one verified tool setup for the acquired resource and project. Recover transfer and test progress here. Read the saved execution skill using read_project_skill with scope=resource.',{resource_id,setup_id}),
];
const names=new Set(definitions.map(tool=>tool.name));
const terminalStates=new Set(['active','failed','needs_file','planned']);

export function createResourceToolController({resources,workspaces,skills,developerCompute,chooseFile,confirm,resolveSelectedDefinition,emit=()=>{},
 current=()=>true,withRelease=withDesktopRelease,upload=transferRelease,inspect=inspectDesktopSource,setTimer=setTimeout,clearTimer=clearTimeout}){
 const desktopDownloads=new Map(),watches=new Map(),turns=new Map(),saveFailures=new Map();
 const selectedFiles=new Map(),setupFiles=new Map();
 let closed=false;

 function target(ref,guard=()=>{}){
  if(!selection.test(ref.resource_id)||ref.profile_version!==undefined&&(!Number.isSafeInteger(ref.profile_version)||ref.profile_version<1))throw Error('Select the authenticated SSH resource');
  const view=()=>resources.snapshot().find(row=>row.resourceId===ref.resource_id&&row.kind==='ssh');
  const selected=view();
  if(!selected||ref.profile_version!==undefined&&selected.profileVersion!==ref.profile_version)throw Error('SSH resource changed. Open its current tool setup');
  const service=()=>resources.listSources().find(row=>row.profileId===selected.profileId&&row.kind==='ssh');
  const origin=service();
  if(!origin||origin.health.resource_tool_schema!==1)throw Error('Connect the original job service with resource tool setup support');
  const registration=workspaces.resolveHostedResourceWorkspace(undefined,{profileId:selected.profileId,hostIdentity:origin.health.hostIdentity});
  if(!registration)throw Error('Confirm the workspace on this authenticated resource and login account');
  const check=()=>{
   guard();
   const live=view(),source=service();
   const workspace=workspaces.resolveHostedResourceWorkspace(registration.resourceId,{profileId:selected.profileId,hostIdentity:origin.health.hostIdentity});
   if(closed||!live||live.profileVersion!==selected.profileVersion||live.connectionId!==selected.connectionId||
      source?.generation!==origin.generation||source?.id!==origin.id||workspace?.workspaceId!==registration.workspaceId)throw Error('Tool setup resource or workspace changed');
  };
  const request=async(method,route,data,timeoutMs)=>{
   check();
   const result=await origin.request(method,route,data,{beforeDispatch:check,timeoutMs});
   check();return result;
  };
  const call=(operation,data={},timeoutMs)=>request('POST','/api/resource-tools/'+operation,{...data,resource_id:registration.resourceId},timeoutMs);
  const register=async()=>{check();await workspaces.registerWithWorker(registration,request);check();};
  return {ref,selected,origin,registration,check,call,register,request};
 }

 function receipt(value, selected, id){
  if(value?.resource_id!==selected.registration.resourceId||!sha256.test(value.id||'')||id&&value.id!==id||
     !Number.isSafeInteger(value.revision)||!sha256.test(value.plan_sha256||''))throw Error('Worker tool setup receipt differs from the selected resource');
  return {...value,resource_id:selected.ref.resource_id};
 }

 async function save(selected,row,{withBody=false,retry=false}={}){
  if(row.status!=='active'||!row.skill)return row;
  const previous=saveFailures.get(row.id);
  if(!retry&&previous?.sha256===row.skill.sha256)return {...row,skill:{...row.skill,error:previous.error}};
  try{
   const current=skills.readResourceExecutionSkill(selected.registration,row.skill,selected.check);
   if(current){
    const {body,...saved}=current;
    return {...row,skill:{...saved,...withBody?{body}:{}}};
   }
   const skill=await selected.call('skill',{setup_id:row.id});
   if(skill?.name!==row.skill.name||skill?.sha256!==row.skill.sha256)throw Error('Execution skill differs from the activation receipt');
   const saved=skills.saveResourceExecutionSkill(selected.registration,skill,selected.check);
   saveFailures.delete(row.id);
   return {...row,skill:{...saved,...withBody?{body:skill.body}:{}}};
  }catch(error){
   selected.check();
   if(saveFailures.size>=128)saveFailures.delete(saveFailures.keys().next().value);
   saveFailures.set(row.id,{sha256:row.skill.sha256,error:error.message});
   return {...row,skill:{...row.skill,error:error.message}};
  }
 }

 async function browse(selected,setup_id,{withBody=false,publishSkill=true}={}){
  const row=receipt(await selected.call('status',{setup_id}),selected,setup_id);
  return publishSkill?save(selected,row,{withBody}):row;
 }

 function fallback(selected,row){
  const key=row.id;
  if(desktopDownloads.has(key))return desktopDownloads.get(key);
  const source=row.supply==='git'?row.manifest.git_bootstrap:row.manifest.source;
  if(!source?.url)throw Error('Worker release source is unavailable');
  const request=(operation,value)=>selected.call(operation,{...value,setup_id:row.id},operation==='upload-finish'?120000:30000);
  let acquired=false;
  const pending=(async()=>{
   try{
    await withRelease(source,file=>upload(file,source,request,{acquired:()=>{acquired=true;}}));
   }catch(error){
    selected.check();
    if(!acquired)await selected.call('desktop-failed',{setup_id:row.id});
    else throw error;
   }finally{desktopDownloads.delete(key);}
  })();
  desktopDownloads.set(key,pending);
  return pending;
 }

 function fileFor(selected,row){
  const found=setupFiles.get(row.id);
  if(!found||found.account!==selected.registration.account||found.resourceId!==selected.registration.resourceId||
     found.workspaceId!==selected.registration.workspaceId||row.supply&&row.supply!=='package')return null;
  return found;
 }

 function attachFile(id,file){
  if(setupFiles.size>=64)setupFiles.delete(setupFiles.keys().next().value);
  setupFiles.set(id,file);
 }

 async function transferPicked(selected,row,file){
  const source=row.manifest.source;
  const request=(operation,value)=>selected.call(operation,{...value,setup_id:row.id},operation==='upload-finish'?120000:30000);
  return upload(file.path,source,request);
 }

 function watch(ref,row){
  if(closed||terminalStates.has(row.status)&&!(row.status==='needs_file'&&setupFiles.has(row.id))||watches.has(row.id)||watches.size>=64)return;
  const watch={failures:0,last:row.revision};
  watches.set(row.id,watch);
  const finish=()=>{if(watches.get(row.id)===watch)watches.delete(row.id);};
  const schedule=(delay)=>{
   if(closed){finish();return;}
   watch.timer=setTimer(async()=>{
    try{
     const selected=target(ref);
     const next=await browse(selected,row.id);
     if(next.revision!==watch.last||next.status==='active'){
      watch.last=next.revision;
      emit({resource_id:ref.resource_id,setup_id:row.id});
     }
     if(next.status==='needs_file'){
      const file=fileFor(selected,next);
      if(!file){finish();return;}
      try{await transferPicked(selected,next,file);setupFiles.delete(next.id);}
      catch(error){
       selected.check();
       if(watch.failures>=2)setupFiles.delete(next.id);
       throw error;
      }
     }else if(terminalStates.has(next.status)){setupFiles.delete(next.id);finish();return;}
     if(next.status==='desktop_fallback')await fallback(selected,next);
     watch.failures=0;
     schedule(3500);
    }catch{
     watch.failures++;
     if(watch.failures<3)schedule(5000*watch.failures);
     else finish(); // The original confirmed receipt resumes when the resource is opened again.
    }
   },delay);
   watch.timer.unref?.();
  };
  schedule(250);
 }

 const controller={
  async list(ref){
   fields(ref,['resource_id'],['profile_version']);
   const selected=target(ref);await selected.register();
   const data=await selected.call('list',{workspace_id:selected.registration.workspaceId});
   const setups=data.setups.map(value=>receipt(value,selected));
   for(const row of setups)watch(ref,row);
   const published=[];
   for(const row of setups)published.push(await save(selected,row));
   return {setups:published,targets:data.targets,schedulers:data.schedulers,workfile_root:data.workfile_root};
  },
  async discover(ref){
   fields(ref,['resource_id','directory'],['profile_version']);
   return discoverScripts(target(ref),ref.directory);
  },
  async plan(ref){
   fields(ref,['resource_id',...planFields],['profile_version','candidate','queue_target_id','prior_run_id','local_source']);
   const selected=target(ref);await selected.register();
   const file=ref.local_source===undefined?null:selectedFiles.get(ref.local_source);
   if(ref.local_source!==undefined&&!sameLocalSelection(file,selected,ref.manifest?.source))throw Error('Select the exact local program or release for this setup');
   const result=await plan(selected,ref);
   if(file)attachFile(result.id,file);
   return result;
  },
  async chooseSource(ref,event){
   fields(ref,['resource_id','kind'],['profile_version']);
   if(!['program','manual'].includes(ref.kind))throw Error('Choose a local program or a manual');
   const revision=current();
   const selected=target(ref,()=>{if(current()!==revision)throw Error('Tool setup context changed');});
   const file=await chooseFile(event,ref.kind);
   selected.check();
   if(!file)return null;
   const item=await inspect(file,ref.kind);
   selected.check();
   if(ref.kind==='manual')return item;
   const local_source=randomUUID();
   if(selectedFiles.size>=64)selectedFiles.delete(selectedFiles.keys().next().value);
   selectedFiles.set(local_source,{path:file,sha256:item.sha256,context:revision,
    resourceId:selected.registration.resourceId,workspaceId:selected.registration.workspaceId,account:selected.registration.account});
   return {...item,local_source};
  },
  async status(ref){
   fields(ref,['resource_id','setup_id'],['profile_version']);
   const selected=target(ref);
   const result=await browse(selected,ref.setup_id,{withBody:true});
   watch(ref,result);
   return result;
  },
  async start(ref,event){
   fields(ref,['resource_id','setup_id','revision','plan_sha256'],['profile_version']);
   const active=current(), guard=()=>{if(current()!==active)throw Error('Tool setup review context changed');};
   const selected=target(ref,guard);
   const row=await browse(selected,ref.setup_id,{publishSkill:false});
   if(row.status!=='planned'||row.revision!==ref.revision||row.plan_sha256!==ref.plan_sha256||
      row.workspace_id!==selected.registration.workspaceId)throw Error('The reviewed setup changed. Open its current plan');
   if(!await confirm(row,selected.selected,selected.registration,event)){
    selected.check();return {...row,cancelled:true};
   }
   selected.check();
   if(!fileFor(selected,row)){
    const files=[...selectedFiles.values()].filter(file=>sameLocalSelection(file,selected,row.manifest.source));
    if(files.length===1)attachFile(row.id,files[0]);
   }
   const result=receipt(await selected.call('start',{setup_id:ref.setup_id,revision:ref.revision,plan_sha256:ref.plan_sha256}),selected,ref.setup_id);
   watch(ref,result);
   return result;
  },
  async supplyFile(ref,event){
   fields(ref,['resource_id','setup_id','revision'],['profile_version']);
   const active=current();
   const selected=target(ref,()=>{if(current()!==active)throw Error('Tool setup context changed');});
   const row=await browse(selected,ref.setup_id,{publishSkill:false});
   if(row.status!=='needs_file'||row.revision!==ref.revision)throw Error('Refresh the release request before selecting a file');
   const file=await chooseFile(event);
   selected.check();
   if(!file)return {...row,cancelled:true};
   const source=row.supply==='git'?row.manifest.git_bootstrap:row.manifest.source;
   const result=receipt(await upload(file,source,(operation,data)=>selected.call(operation,{...data,setup_id:ref.setup_id},
    operation==='upload-finish'?120000:30000)),selected,ref.setup_id);
   watch(ref,result);
   return result;
  },
  async supplyRemote(ref){
   fields(ref,['resource_id','setup_id','revision','path'],['profile_version']);
   const selected=target(ref);
   const result=receipt(await selected.call('supply-remote',{setup_id:ref.setup_id,revision:ref.revision,path:ref.path},120000),selected,ref.setup_id);
   watch(ref,result);
   return result;
  },
  async saveSkill(ref){
   fields(ref,['resource_id','setup_id'],['profile_version']);
   const selected=target(ref);
   const row=await browse(selected,ref.setup_id,{publishSkill:false});
   return save(selected,row,{retry:true,withBody:true});
  },
 };

 function sameLocalSelection(file,selected,source){
  return !!file&&file.context===current()&&file.resourceId===selected.registration.resourceId&&
   file.workspaceId===selected.registration.workspaceId&&file.account===selected.registration.account&&
   ['archive','binary'].includes(source?.kind)&&!source.url&&file.sha256===source.sha256;
 }

 async function plan(selected,value,onboarding){
  const payload=Object.fromEntries([...planFields,'candidate','queue_target_id','prior_run_id'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  const result=receipt(await selected.call('plan',{...payload,workspace_id:selected.registration.workspaceId,...onboarding?{onboarding}:{}}),selected);
  if(!isDeepStrictEqual(result.onboarding,onboarding))throw Error('The target setup receipt differs from the selected package version');
  emit({resource_id:selected.ref.resource_id,setup_id:result.id});
  return result;
 }

 async function discoverScripts(selected,directory,instruction){
  if(typeof directory!=='string'||!directory)throw directoryRequired();
  const abbreviated=directory==='~'||directory.startsWith('~/');
  const designated=instruction===undefined||namesDirectory(instruction,directory);
  if(!designated&&!abbreviated&&!(directory.startsWith('/')&&(instruction.includes('~/')||namesDirectory(instruction,'~'))))throw directoryRequired();
  if(abbreviated||!designated){
   const health=await selected.request('GET','/api/health');
   const home=health?.home;
   if(typeof home!=='string'||!path.posix.isAbsolute(home)||path.posix.normalize(home)!==home||/[\\\x00-\x1f\x7f]/.test(home)){
    throw Error('The selected SSH service did not report its home directory. Use an absolute script directory.');
   }
   // Preserve the user's path components for validation by the remote worker.
   const prefix=home.replace(/\/$/,'');
   if(abbreviated){
    directory=prefix+(directory.slice(1)||'/');
    if(!designated&&!namesDirectory(instruction,directory))throw directoryRequired();
   }else{
    const homeNotation=directory===home?'~':directory.startsWith(prefix+'/')?'~'+directory.slice(prefix.length):null;
    if(!namesDirectory(instruction,homeNotation))throw directoryRequired();
   }
  }
  await selected.register();
  return selected.call('discover',{workspace_id:selected.registration.workspaceId,directory});
 }

 async function resolveSkills(scope,id,inventory=false,draftTurn){
  const captured=resources.capture(scope.provider,scope.threadId);
  const workspaceId=developerCompute&&resources.snapshot().find(resource=>resource.resourceId===id)?.workspace?.workspaceId;
  const development=developerCompute?.allows(scope,workspaceId)===true,revision=developerCompute?.revision(workspaceId);
  const guard=()=>{
   if(scope.checkCurrent?.()!==true||draftTurn&&turns.get(ownerKey(scope))!==draftTurn)throw Error('The resource tool conversation changed');
   if(development&&(!developerCompute.allows(scope,workspaceId)||developerCompute.revision(workspaceId)!==revision))throw Error('Developer workspace access changed');
   captured.assertCurrent();
  };
  guard();
  const ref=captured.resources.find(value=>value.resourceId===id);
  if(!ref)throw Error('Acquire this SSH resource in the current conversation');
  await resources.resolveLease(scope,id,scope.projectId&&!(inventory&&development)?'service':'inspect');
  guard();
  return target({resource_id:id,profile_version:ref.profileVersion},guard);
 }

 function rememberTurn(key,user,directoryInstruction){
  const previous=turns.get(key);
  // A later turn can select a hashed representative. Other example paths belong to the original scan turn.
  const turn={user,scan:previous?.scan?.representatives?previous.scan:null,examples:null,
   directoryInstruction:hasDirectory(user)?directoryInstruction:previous?.directoryInstruction};
  turns.delete(key);
  if(turns.size>=128)turns.delete(turns.keys().next().value);
  turns.set(key,turn);
  return turn;
 }

 function scanContext({selected,registration,origin},projectId){
  return JSON.stringify([projectId,selected.resourceId,selected.profileVersion,selected.connectionId,
   registration.resourceId,registration.workspaceId,registration.account,origin.id,origin.generation]);
 }

 function recordUserTurn({provider,method,projectId=null,params={}}){
  if(!['turn/start','turn/steer'].includes(method)||typeof params.threadId!=='string')return;
  const input=Array.isArray(params.input)?visibleUserText(params.input).slice(0,16000):'';
  const key=ownerKey({provider,threadId:params.threadId});
  let directoryInstruction;
  if(hasDirectory(input)){
   const owned=resources.capture(provider,params.threadId).resources.filter(row=>row.kind==='ssh');
   const candidates=owned.length?owned:resources.snapshot().filter(row=>row.kind==='ssh'&&!row.verificationPending);
   if(candidates.length===1){
    try{
     const selected=target({resource_id:candidates[0].resourceId});
     directoryInstruction={text:input,context:scanContext(selected,projectId)};
    }catch{/* A directory can be named again once this resource has a verified workspace. */}
   }
  }
  rememberTurn(key,input,directoryInstruction);
 }

 async function call(name,args,scope){
  if(!names.has(name)||!args||scope.checkCurrent?.()!==true)throw Error('Invalid resource tool arguments');
  const key=ownerKey(scope),turn=turns.get(key)??rememberTurn(key,'');
  const selected=await resolveSkills(scope,args.resource_id,name==='list_resource_tools'||name==='discover_resource_tool_scripts',
   name==='plan_resource_tool_setup'?turn:undefined);
  const project_id=scope.projectId;
  const workspace_id=selected.registration.workspaceId;
  const development=developerCompute?.allows(scope,workspace_id)===true;
  const user=turn.user;
  if(name==='discover_resource_tool_scripts'){
   fields(args,['resource_id','directory']);
   const scan={context:scanContext(selected,project_id??null),representatives:null};
   const remembered=turn.directoryInstruction;
   const instruction=remembered?.context===scan.context?remembered.text:user;
   turn.scan=scan;turn.examples=null;
   const result=await discoverScripts(selected,args.directory,development?undefined:instruction);
   if(turns.get(key)===turn&&turn.scan===scan){
    scan.representatives=new Map(result.candidates.filter(row=>sha256.test(row.sha256)).map(row=>[row.path,row.sha256]));
    turn.examples=new Set(result.candidates.flatMap(row=>row.examples));
   }
   return result;
  }
  if(development&&name==='list_resource_tools'&&!project_id){
   fields(args,['resource_id']);await selected.register();
   const result=await selected.call('list',{workspace_id});
   return {resource_id:args.resource_id,workfile_root:result.workfile_root,
    tools:result.setups.filter(row=>row.status==='active'&&row.workspace_id===workspace_id&&row.resource_id===selected.registration.resourceId).map(row=>({
     id:row.manifest.id,name:row.manifest.name,version:row.manifest.version,inputs:row.manifest.inputs,outputs:row.manifest.outputs
    }))};
  }
  if(!project_id)throw Error('Select the authorized project for this resource');
  if(name==='plan_resource_tool_setup'){
   fields(args,['resource_id','manifest','route','cluster_id','environment_id'],['candidate','queue_target_id','prior_run_id','selected_definition']);
   if(!development&&!setupRequest.test(user))throw Object.assign(Error('A current user request for tool setup is required before drafting'),{operationNotStarted:true});
   const source=args.manifest?.source;
   const scan=turn.scan;
   const reviewed=scan?.context===scanContext(selected,project_id)&&(turn.examples?.has(source?.executable)||
    args.route==='existing'&&args.candidate?.path===source?.executable&&sha256.test(args.candidate?.sha256)&&
    scan.representatives?.get(source?.executable)===args.candidate.sha256);
   if(source?.kind==='installed'&&(!source.executable||!portablePath(selected.registration.root,source.executable)&&
      !user.includes(source.executable)&&!reviewed)){
    throw Error('Use a script from the reviewed scan or an installed path designated by the user');
   }
   let binding,onboarding;
   if(args.selected_definition!==undefined){
    if(selected.origin.health.resource_tool_definition_schema!==1)throw Error('This job service needs the registered tool definition setup capability');
    fields(args.selected_definition,['package_ref','function_id','test_case_id']);
    if(typeof resolveSelectedDefinition!=='function')throw Error('Select a registered delivery package for this turn');
    binding=await resolveSelectedDefinition(args.selected_definition.package_ref,scope);
    onboarding=bindResourceToolDefinition(binding.record,args.selected_definition,args.manifest);
   }
   await selected.register();
   binding?.check();
   return plan(selected,{...args,request_id:randomUUID(),project_id},onboarding);
  }
  if(name==='read_resource_tool_setup'){
   fields(args,['resource_id','setup_id']);
   const result=await browse(selected,args.setup_id,{publishSkill:false});
   if(result.target.project_id!==project_id)throw Error('This setup is outside the current resource project');
   watch(selected.ref,result);
   return save(selected,result);
  }
  fields(args,['resource_id']);await selected.register();
  const result=await selected.call('list',{workspace_id,project_id});
  const setups=[];
  for(const value of result.setups){
   const current=receipt(value,selected);
   watch(selected.ref,current);
   const row=await save(selected,current);
   setups.push({id:row.id,resource_id:row.resource_id,route:row.route,status:row.status,stage:row.stage,target:row.target,test:row.test,skill:row.skill,
    tool:{id:row.manifest.id,name:row.manifest.name,version:row.manifest.version,inputs:row.manifest.inputs,outputs:row.manifest.outputs},
    activation_id:row.activation_id});
  }
  return {...result,setups};
 }

 return {controller,tools:()=>definitions,owns:name=>names.has(name),call,resolveSkills:(scope,id)=>resources.resolveSkillLibrary(scope,id),recordUserTurn,
  forget(provider,threadId){turns.delete(ownerKey({provider,threadId}));},
  close(){closed=true;for(const watch of watches.values())clearTimer(watch.timer);watches.clear();turns.clear();selectedFiles.clear();setupFiles.clear();}};
}

export function registerResourceToolRoutes(handle,controller){
 for(const name of ['list','discover','plan','chooseSource','status','start','supplyFile','supplyRemote','saveSkill']){
  handle('tools.resource.'+name,(data,event)=>controller[name](data,event));
 }
}
