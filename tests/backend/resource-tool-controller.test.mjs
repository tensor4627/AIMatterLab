import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {inspectDesktopSource,transferRelease} from '../../backend/main/compute/resource-release-transfer.mjs';
import {createResourceToolController} from '../../backend/main/compute/resource-tools.mjs';
import {validateProjectSpec} from '../../contracts/compute/project-policy.mjs';
import {createProjectPolicyEditor} from '../../frontend/features/compute/project-policy-edit.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');

async function fixture(t,{confirm=async()=>true,withRelease,chooseFile=async()=>null,developerCompute,reportedHome,discover=()=>[]}={}){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'aimlab-resource-tools-'));
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const scope={provider:'codex',threadId:'setup-chat',projectId:'project1',checkCurrent:()=>true};
 const skills=new ProjectSkills({root:path.join(temp,'skills'),current:()=>scope});
 const rows=[],calls=[],events=[],timers=[];
 const registry=['first','second'].map((name,index)=>({
  resourceId:String(index+1).repeat(64),workspaceId:String(index+3).repeat(64),profileId:name,account:'same-name',
  root:'/opt/'+name,hostIdentity:{hostname:name,uid:1000,machineId:name}
 }));
 const views=registry.map(({profileId,workspaceId})=>({resourceId:'ssh:'+profileId,profileId,profileVersion:1,kind:'ssh',name:'Lab',connectionId:profileId,workspace:{workspaceId}}));
 const expectedSkill={name:'tool-example-123456789abc',body:'---\nname: tool-example-123456789abc\ndescription: Run this resource tool.\n---\n\nVerified invocation.\n'};
 expectedSkill.sha256=sha(expectedSkill.body);
 const resources={
  snapshot:()=>views,
  capture:()=>({resources:views,assertCurrent(){}}),
  async resolveLease(_scope,id){if(!views.find(row=>row.resourceId===id))throw Error('unknown lease');},
  async resolveSkillLibrary(scope,id){
   const index=views.findIndex(row=>row.resourceId===id);
   if(index<0)throw Error('unknown lease');
   return {registration:registry[index],check(){if(!scope.checkCurrent())throw Error('Scope changed');}};
  },
  listSources:()=>registry.map((registration,index)=>({
   profileId:registration.profileId,kind:'ssh',id:'service-'+index,generation:'generation-'+index,
   health:{hostIdentity:registration.hostIdentity,resource_tool_schema:1},
   async request(method,route,data,options){
    options.beforeDispatch?.();
    calls.push({method,route,data});
    const match=rows.find(row=>row.id===data.setup_id&&row.resource_id===data.resource_id);
    if(route==='/api/resource-workspace/register')return {id:data.workspace_id,...data};
    if(route==='/api/health')return {home:reportedHome};
    if(route==='/api/resource-tools/discover'){
     if(!path.posix.isAbsolute(data.directory))throw Error('Use an absolute path on the selected SSH resource');
     return {directory:data.directory,candidates:await discover(data.directory),truncated:false};
    }
    if(route==='/api/resource-tools/plan')return Object.assign(setup('planned',index),{manifest:data.manifest,target:{project_id:data.project_id}});
    if(route.endsWith('/list'))return {setups:rows.filter(row=>row.resource_id===data.resource_id),targets:[]};
    if(route.endsWith('/status')&&match)return match;
    if(route.endsWith('/skill')&&match)return expectedSkill;
    if(route.endsWith('/start')&&match){match.status='acquiring';match.revision++;return match;}
    if(route.endsWith('/desktop-failed')&&match){match.status='needs_file';match.revision++;return match;}
    throw Error('unexpected fixture dispatch '+route);
   },
  })),
 };
 let context=1;
 const controller=createResourceToolController({resources,skills,chooseFile,withRelease,confirm,developerCompute,current:()=>context,
  emit:value=>events.push(value),setTimer:value=>{timers.push(value);return {};},clearTimer:()=>{},
  workspaces:{
   resolveHostedResourceWorkspace:(id,{profileId,hostIdentity})=>registry.find(row=>row.profileId===profileId&&row.hostIdentity.machineId===hostIdentity.machineId&&(!id||id===row.resourceId)),
   registerWithWorker:(value,request)=>request('POST','/api/resource-workspace/register',{workspace_id:value.workspaceId}),
  }
 });
 skills.resolveResource=controller.resolveSkills;
 t.after(controller.close);
 function setup(status='planned',target=0){
  const registration=registry[target];
  const row={id:sha(String(rows.length)),resource_id:registration.resourceId,workspace_id:registration.workspaceId,revision:1,
   plan_sha256:sha('plan'+rows.length),status,manifest:{id:'example',name:'Example',version:'1',source:{kind:'binary',sha256:sha('payload'),url:'https://example.org/pkg'}},
   target:{project_id:'project1'},...status==='active'?{skill:{name:expectedSkill.name,sha256:expectedSkill.sha256,status:'available'}}:{}};
  rows.push(row);return row;
 }
 return {controller:controller.controller,api:controller,scope,skills,rows,calls,views,events,timers,setup,expectedSkill,temp,
  moveContext:()=>context++,ref:(index=0)=>({resource_id:views[index].resourceId,profile_version:1})};
}

test('the agent can discover the required manifest and bounded test fields before drafting a setup',async t=>{
 const {api}=await fixture(t);
 const plan=api.tools().find(tool=>tool.name==='plan_resource_tool_setup');
 const {manifest,candidate}=plan.inputSchema.properties;
 assert.deepEqual(manifest.required,['id','name','version','source','argv','inputs','outputs','test']);
 assert.equal(manifest.properties.argv.items.type,'string');
 assert.match(candidate.description,/manifest\.source\.executable/);
 const {source,inputs,outputs,test:smoke}=manifest.properties;
 assert.deepEqual(source.anyOf[0].required,['kind','executable']);
 assert.deepEqual(inputs.additionalProperties.required,['filename','format']);
 assert.deepEqual(outputs.additionalProperties.required,['filename','format']);
 assert.deepEqual(smoke.required,['inputs','max_seconds']);
 assert.deepEqual(smoke.properties.inputs.additionalProperties.anyOf.map(value=>value.required),[['path'],['text']]);
 assert.equal(smoke.properties.max_seconds.maximum,600);
 assert.deepEqual(Object.keys(smoke.properties.resources.properties),['cpus','gpus','memory_mb','qos']);
});

test('an unbound developer conversation can inspect activated tool interfaces in its selected workspace',async t=>{
 const developerCompute={allows:(_scope,id)=>id==='3'.repeat(64),revision:()=>0};
 const f=await fixture(t,{developerCompute});f.scope.projectId=null;
 const here=f.setup('active');f.setup('active',1);
 const previous=f.setup('active');previous.workspace_id='f'.repeat(64);
 f.setup('planned');
 const inventory=await f.api.call('list_resource_tools',{resource_id:'ssh:first'},f.scope);
 assert.deepEqual(inventory.tools.map(row=>row.id),[here.manifest.id]);
 assert.equal(JSON.stringify(inventory).includes('project1'),false);
 await assert.rejects(f.api.call('list_resource_tools',{resource_id:'ssh:second'},f.scope),/authorized project/);
});

test('both script discovery entries resolve a named home directory on their selected worker',async t=>{
 const home='/mounted storage/account';
 const f=await fixture(t,{reportedHome:home}),ref=f.ref();
 const directory='~/research archive';
 const expected=home+'/research archive';
 f.api.recordUserTurn({provider:f.scope.provider,method:'turn/start',params:{threadId:f.scope.threadId,input:[{type:'text',text:'Inspect '+directory}]}});
 const throughChat=await f.api.call('discover_resource_tool_scripts',{resource_id:ref.resource_id,directory},f.scope);
 const throughPanel=await f.controller.discover({...ref,directory});
 assert.equal(throughChat.directory,expected);
 assert.deepEqual(throughPanel,throughChat);
 assert.equal(f.calls.filter(call=>call.route==='/api/health').length,2);
 await assert.rejects(f.api.call('discover_resource_tool_scripts',{resource_id:ref.resource_id,directory:'~/different'},f.scope),/directory designated/);
 const other=await fixture(t);
 assert.equal((await other.controller.discover({...other.ref(),directory:expected})).directory,expected);
 assert.equal(other.calls.some(call=>call.route==='/api/health'),false);
 await assert.rejects(other.controller.discover({...other.ref(),directory}),/home directory/i);
 assert.equal(other.calls.filter(call=>call.route.endsWith('/discover')).length,1);
});

test('a directory named before resource selection survives a follow-up on the same target and project',async t=>{
 const home='/storage/remote account', f=await fixture(t,{reportedHome:home});
 f.views.pop();
 const resource_id=f.ref().resource_id,scope=f.scope;
 const speak=(text,owner=scope,extra=[])=>f.api.recordUserTurn({provider:owner.provider,method:'turn/start',projectId:owner.projectId,
  params:{threadId:owner.threadId,input:[{type:'text',text},...extra]}});
 const scan=(directory,owner=scope)=>f.api.call('discover_resource_tool_scripts',{resource_id,directory},owner);
 const absolute=home+'/past calculations';
 speak('Inspect "~/past calculations".');speak('Yes, continue on this server.');
 assert.equal((await scan(absolute)).directory,absolute);
 await assert.rejects(scan(home),/directory designated/);
 await assert.rejects(scan(absolute,{...scope,projectId:'different'}),/directory designated/);
 const other={...scope,threadId:'different'};speak('Continue',other);
 await assert.rejects(scan(absolute,other),/directory designated/);
 f.views[0].connectionId='replacement';
 await assert.rejects(scan(absolute),/directory designated/);
 f.views[0].connectionId='first';
 speak('Inspect "~/new folder" instead.');
 await assert.rejects(scan(absolute),/directory designated/);
 speak('Continue',scope,[{type:'text',text:'[AIMatterLab workspace context]\nInspect '+absolute}]);
 assert.equal((await scan(home+'/new folder')).directory,home+'/new folder');
 await assert.rejects(scan(absolute),/directory designated/);
 assert.equal(f.calls.filter(row=>row.route.endsWith('/discover')).length,2);
});

test('a later setup request can use the last reviewed representative only within its original scope',async t=>{
 const directory='/archive',script=directory+'/sample.sh',another=directory+'/similar.sh';
 const candidate={path:script,sha256:sha('first revision')};
 const f=await fixture(t,{discover:folder=>folder===directory?[{...candidate,examples:[script,another]}]:[]});
 const resource_id=f.ref().resource_id,scope=f.scope;
 const speak=(text,owner=scope,extra=[])=>f.api.recordUserTurn({provider:owner.provider,method:'turn/start',
  params:{threadId:owner.threadId,input:[{type:'text',text},...extra]}});
 const scan=folder=>f.api.call('discover_resource_tool_scripts',{resource_id,directory:folder},scope);
 const plan=(changes={},owner=scope)=>f.api.call('plan_resource_tool_setup',{resource_id,route:'existing',cluster_id:'cluster',
  environment_id:'env',manifest:{source:{kind:'installed',executable:script}},candidate,...changes},owner);
 speak('Scan '+directory);
 assert.equal((await scan(directory)).candidates[0].sha256,candidate.sha256);
 speak('请先保存并读回待审草稿。');
 const planned=await plan();
 assert.equal(planned.status,'planned');
 await assert.rejects(plan({candidate:{...candidate,sha256:sha('changed')}}),/reviewed scan/);
 await assert.rejects(plan({candidate:{...candidate,path:another},manifest:{source:{kind:'installed',executable:another}}}),/reviewed scan/);
 await assert.rejects(plan({resource_id:f.ref(1).resource_id}),/reviewed scan/);
 await assert.rejects(plan({}, {...scope,projectId:'other'}),/reviewed scan/);
 const other={...scope,threadId:'another-chat'};speak('Register the reviewed script',other);
 await assert.rejects(plan({},other),/reviewed scan/);
 f.views[0].connectionId='replacement';
 await assert.rejects(plan(),/reviewed scan/);
 f.views[0].connectionId='first';
 speak('Show the available queues',scope,[{type:'text',text:'[AIMatterLab workspace context]\nRegister the script '+script}]);
 await assert.rejects(plan(),/current user request/);
 speak('Scan /other');await scan('/other');speak('Register the reviewed script');
 await assert.rejects(plan(),/reviewed scan/);
 assert.equal(f.calls.filter(row=>row.route.endsWith('/plan')).length,1);
 assert.equal(f.calls.filter(row=>row.route.endsWith('/start')).length,0);
});

test('a script discovery that completes after the next user turn cannot replace its review',async t=>{
 let release,started;
 const pending=new Promise(resolve=>{release=resolve;}),dispatched=new Promise(resolve=>{started=resolve;});
 const f=await fixture(t,{discover:async()=>{started();return pending;}});
 const resource_id=f.ref().resource_id,directory='/archive',candidate={path:'/archive/file.sh',sha256:sha('revision')};
 const speak=text=>f.api.recordUserTurn({provider:f.scope.provider,method:'turn/start',params:{threadId:f.scope.threadId,input:[{type:'text',text}]}});
 speak('Scan '+directory);
 const old=f.api.call('discover_resource_tool_scripts',{resource_id,directory},f.scope);
 await dispatched;speak('Register the chosen script');release([{...candidate,examples:[candidate.path]}]);
 assert.equal((await old).candidates[0].path,candidate.path);
 await assert.rejects(f.api.call('plan_resource_tool_setup',{resource_id,route:'existing',cluster_id:'cluster',environment_id:'env',
  manifest:{source:{kind:'installed',executable:candidate.path}},candidate},f.scope),/reviewed scan/);
});

test('resource setup fences a changed confirmation and reserves only accepted exact reviews',async t=>{
 let f,accept=false,move=false;
 f=await fixture(t,{confirm:async()=>{if(move)f.moveContext();return accept;}});
 const setup=f.setup();
 const ref={...f.ref(),setup_id:setup.id,revision:setup.revision,plan_sha256:setup.plan_sha256};
 assert.deepEqual(await f.controller.start(ref),{...setup,resource_id:ref.resource_id,cancelled:true});
 assert.equal(f.calls.some(call=>call.route.endsWith('/start')),false);
 accept=true;move=true;
 await assert.rejects(()=>f.controller.start(ref),/review context changed/);
 assert.equal(f.calls.some(call=>call.route.endsWith('/start')),false);
 move=false;
 assert.equal((await f.controller.start(ref)).status,'acquiring');
 assert.equal(f.calls.filter(call=>call.route.endsWith('/start')).length,1);
 await assert.rejects(()=>f.controller.start(ref),/changed/);
 await assert.rejects(()=>f.controller.status({...f.ref(1),setup_id:setup.id}),/unexpected fixture dispatch/);
 await assert.rejects(()=>f.controller.status({...f.ref(),profile_version:2,setup_id:setup.id}),/resource changed/);
});

test('desktop download failure exposes file selection only after trying the pinned source',async t=>{
 const attempts=[];
 const f=await fixture(t,{withRelease:async source=>{attempts.push(source);throw Error('network failure');}});
 const row=f.setup('desktop_fallback');
 row.supply='package';
 await f.controller.status({...f.ref(),setup_id:row.id});
 assert.equal(row.status,'desktop_fallback');
 await f.timers.shift()();
 assert.deepEqual(attempts,[row.manifest.source]);
 assert.equal(row.status,'needs_file');
 assert.equal(f.calls.filter(call=>call.route.endsWith('/desktop-failed')).length,1);
});

test('active worker execution skill reads back in the exact acquired resource library',async t=>{
 const f=await fixture(t);
 const active=f.setup('active');
 const saved=await f.controller.status({...f.ref(),setup_id:active.id});
 assert.equal(saved.skill.status,'saved');
 assert.equal(saved.skill.body,f.expectedSkill.body);
 assert.equal(await fs.readFile(saved.skill.path,'utf8'),f.expectedSkill.body);
 const args={scope:'resource',resource_id:f.ref().resource_id};
 const seen=await f.skills.call('project_skill_catalog',args,f.scope);
 assert.deepEqual(seen.skills.map(row=>row.name),[f.expectedSkill.name]);
 assert.equal((await f.skills.call('read_project_skill',{...args,name:f.expectedSkill.name},f.scope)).sha256,f.expectedSkill.sha256);
 const other=await f.skills.call('project_skill_catalog',{...args,resource_id:f.ref(1).resource_id},f.scope);
 assert.deepEqual(other.skills,[]);
 await assert.rejects(()=>f.skills.call('write_project_skill',{...args,name:f.expectedSkill.name,body:f.expectedSkill.body,expected_sha256:saved.skill.sha256},f.scope),
  /verified execution skill/);
 assert.equal(f.calls.filter(call=>call.route.endsWith('/skill')).length,1);
 await f.controller.status({...f.ref(),setup_id:active.id});
 assert.equal(f.calls.filter(call=>call.route.endsWith('/skill')).length,1);
});

test('a local picker returns bounded evidence without exposing its absolute path',async t=>{
 let file;
 const f=await fixture(t,{chooseFile:async()=>file});
 file=path.join(f.temp,'usage.md');
 await fs.writeFile(file,'Example instruction\n'+ 'z'.repeat(20*1024));
 const chosen=await f.controller.chooseSource({...f.ref(),kind:'manual'});
 assert.equal(chosen.name,'usage.md');
 assert.equal(chosen.text.startsWith('Example instruction'),true);
 assert.equal(Buffer.byteLength(chosen.text),16*1024);
 assert.equal(chosen.truncated,true);
 assert.equal(chosen.path,undefined);
 assert.equal(chosen.local_source,undefined);
 assert.equal(chosen.sha256,sha(await fs.readFile(file)));
 const program=await f.controller.chooseSource({...f.ref(),kind:'program'});
 assert.match(program.local_source,/^[a-f0-9-]{36}$/);
});

test('release upload resumes on the original byte position and proves each chunk',async t=>{
 const f=await fixture(t);
 const bytes=Buffer.alloc(2*1024*1024+47,26);
 const file=path.join(f.temp,'release.bin');
 await fs.writeFile(file,bytes);
 assert.equal((await inspectDesktopSource(file,'program')).sha256,sha(bytes));
 let offset=91;
 const operations=[];
 const result=await transferRelease(file,{sha256:sha(bytes)},async (op,packet)=>{
  operations.push(op);
  assert.equal(packet.sha256,sha(bytes));
  assert.equal(packet.size,bytes.length);
  if(op==='upload-offset')return {offset};
  if(op==='upload-finish')return {offset};
  const chunk=Buffer.from(packet.chunk,'base64');
  assert.equal(packet.offset,offset);
  assert.equal(packet.chunk_sha256,sha(chunk));
  assert.deepEqual(chunk,bytes.subarray(offset,offset+chunk.length));
  offset+=chunk.length;
  return {offset};
 });
 assert.equal(result.offset,bytes.length);
 assert.deepEqual(operations,['upload-offset','upload-chunk','upload-chunk','upload-finish']);
 await assert.rejects(()=>transferRelease(file,{sha256:sha('wrong')},()=>assert.fail('unverified payload was transferred')),/checksum differs/);
});

test('a first SSH project can grant a test and later add an activated private engine',async ()=>{
 const native=['trajectory.density'];
 const first={name:'Resource project',policy:{engines:['installation.check'],gpus:[],max_seconds:30,max_concurrent:1,
  input_roots:['/data/workfile'],environments:[],clusters:['cluster-a']}};
 assert.doesNotThrow(()=>validateProjectSpec(first,native));
 assert.throws(()=>validateProjectSpec({...first,policy:{...first.policy,clusters:[],environments:['local']}},native),/invalid_fields/);
 let record={id:'research',...first,revision:0};
 const editor=createProjectPolicyEditor({projectId:record.id,engines:native,current:()=>true,
  read:async()=>[structuredClone(record)],write:async value=>(record={...value,revision:record.revision+1})});
 const loaded=await editor.open();
 loaded.spec.policy.engines.push('private.example');
 const result=await editor.save(loaded.spec);
 assert.deepEqual(result.policy.engines,['installation.check','private.example']);
 assert.deepEqual(result.policy.clusters,['cluster-a']);
});
