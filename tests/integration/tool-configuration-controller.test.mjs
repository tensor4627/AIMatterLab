// Production Node controller with controlled worker-authority responses only.
// These fixtures prove protocol/state behavior, not installation or process execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createToolConfigurationController,registerToolConfigurationRoutes} from "../../backend/main/compute/tool-configurations.mjs";
import {createReadPolicy} from "../../agent/skills/read-policy.mjs";

const clone=value=>structuredClone(value),sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const INDEX='tool-configuration-index',BINDING='tool-guidance-binding',V1='1'.repeat(64),V2='2'.repeat(64);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture({externalLease=false}={}){
 const data=new Map(),calls=[],confirmations=[],states=new Map(),records=new Map(),extraArchives=[];let clock=Date.now(),hook=null,confirmHook=null,scopeAlive=true;
 const binding={distribution:'Fixture',root:'/worker',port:8888};
 let owner={provider:'codex',threadId:'thread',taskId:'task',projectId:'compute-project',environmentId:'environment',inputRoot:'/inputs',serial:1};
 let target={kind:'local',projectId:'compute-project',environmentId:'environment',engine:'installation.check',workerBinding:clone(binding)};
 const catalog={get:(kind,id)=>clone(data.get(kind+':'+id)),put:(kind,id,value)=>{data.set(kind+':'+id,clone(value));return clone(value);},list:kind=>[...data.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>clone(value)),transaction:perform=>{const before=new Map([...data].map(([key,value])=>[key,clone(value)]));try{return perform();}catch(error){data.clear();for(const item of before)data.set(...item);throw error;}}};
 for(const version of [V1,V2])records.set(version,{schema_version:1,package_id:'atlas',package_version:version,manifest_sha256:'a'.repeat(64),source_commit:'b'.repeat(40),snapshot_root:'D:\\snapshots\\atlas\\'+version,package_root:'D:\\packages\\atlas-'+version[0],package_roots:['D:\\known-aliases\\A','D:\\known-aliases\\B'],guidance:[{role:'delivery',path:'SKILL.md'},{role:'installation',path:'setup/install.md'},{role:'configuration',path:'setup/config.md'}],files:[{kind:'file',path:'run.py',size:1,sha256:'c'.repeat(64)}],manifest:{id:'atlas',functions:[{id:'smoke',engine:'installation.check'}]}});
 const packages={read:({package_id,package_version=V1})=>{assert.equal(package_id,'atlas');const value=records.get(package_version);if(!value)throw Error('Unknown fixture package');return clone(value);}};
 const health={name:'gpu-sampling-studio',root:'/worker',runtime:'/fixture-runtime',execution_policy:'desktop-review-v1',tool_configuration_schema:1};
 const worker={connection:{health:clone(health)},identity:{distribution:binding.distribution,root:binding.root},connectionTarget:{port:binding.port},connectionEpoch:1,providerScopes:{scopes:new Map()}};
 const leaseMap=externalLease?new Map():worker.providerScopes.scopes;if(externalLease)delete worker.providerScopes;
 function lease(){const value={epoch:4,context:{threadId:owner.threadId,taskId:owner.taskId,projectId:owner.projectId,environmentId:owner.environmentId,inputRoot:owner.inputRoot}};leaseMap.set('codex',value);return value;}
 lease();
 function response(state,{body=false}={}){
  const pkg=records.get(state.package_version),value={schema_version:1,configuration_id:state.configuration_id,package_id:'atlas',package_version:state.package_version,manifest_sha256:pkg.manifest_sha256,target:clone(state.target),environment_sha256:'d'.repeat(64),revision:state.revision,status:state.status,plan_sha256:state.plan_sha256};
  // Real plan/status records omit read-only guidance identity extensions.
  if(body)Object.assign(value,{source_commit:pkg.source_commit,archive_revision:1,functions:clone(pkg.manifest.functions),archived_resources:archiveFor(state)});
  if(body&&state.status==='active')value.execution_skill={id:state.execution_skill.id,sha256:state.execution_skill.sha256,body:state.execution_skill.body};
  return value;
 }
 function archiveFor(state){return state.has_activation?[{path:'/worker/packages/'+state.package_version+'/SKILL.md',role:'delivery',configuration_id:state.configuration_id,package_id:'atlas',package_version:state.package_version},...extraArchives.filter(resource=>resource.configuration_id===state.configuration_id).map(clone)]:[];}
 function metadata(){
  const configurations=[...states.values()].filter(state=>state.has_activation).map(state=>{const pkg=records.get(state.package_version);return {configuration_id:state.configuration_id,revision:state.revision,status:state.status,has_activation:true,package_id:'atlas',package_version:state.package_version,source_commit:pkg.source_commit,manifest_sha256:pkg.manifest_sha256,target:clone(state.target),environment_sha256:'d'.repeat(64),archive_revision:1,snapshot_root:'/worker/packages/'+state.package_version,origin_roots:['/mnt/d/packages/atlas-'+state.package_version[0]],functions:clone(pkg.manifest.functions),execution_skill:{id:state.execution_skill.id,sha256:state.execution_skill.sha256}};});
  const value={schema_version:1,configurations,archived_resources:[...states.values()].flatMap(archiveFor),scope:'Persisted activation metadata only; controlled fixture, no runtime or file inspection'};return {...value,revision:sha(value)};
 }
 function activateState(state){
  if(state.status!=='tested'||state.proof!==true)throw Error('All controlled worker test evidence required');
  const body='Configured controlled worker fixture '+state.configuration_id;
  state.status='active';state.revision++;state.has_activation=true;state.execution_skill={id:sha(body),sha256:sha(body),body};
 }
 function dispatch(method,route,args){
  if(route==='/api/health'){assert.equal(method,'GET');return clone(health);}
  assert.equal(method,'POST');
  if(route==='/api/tool-guidance/state'){assert.deepEqual(args,{});return metadata();}
  if(route==='/api/tool-package/register'){assert.equal(args.package_id,'atlas');assert(records.has(args.package_version));return {schema_version:1,package_id:'atlas',package_version:args.package_version};}
  if(route==='/api/tool-configuration/plan'){
   const key=sha(args.request_id).slice(0,24),previous=states.get(key);if(previous){assert.equal(previous.request_sha256,sha(args));return response(previous);}
   const value={configuration_id:key,package_version:args.package_version,target:clone(args.target),request_sha256:sha(args),status:'planned',revision:1,proof:false,has_activation:false,plan_sha256:sha(args)};states.set(key,value);return response(value);
  }
  const state=states.get(args.configuration_id);if(!state)throw Error('Unknown controlled configuration');
  if(route==='/api/tool-configuration/status')return response(state);
  if(route==='/api/tool-execution-skill/read')return response(state,{body:true});
  assert.equal(args.expected_revision,state.revision,'Worker rejects stale expected revision');assert.equal(args.plan_sha256,state.plan_sha256);
  if(route==='/api/tool-configuration/execute'){assert.equal(state.status,'planned');state.status='testing';state.revision++;return response(state);}
  if(route==='/api/tool-configuration/activate'){activateState(state);return response(state,{body:true});}
  throw Error('Unexpected controlled worker route '+route);
 }
 worker.request=async(method,route,args)=>{calls.push({method,route,args:clone(args)});const next=()=>dispatch(method,route,args);return hook?hook(method,route,args,next):next();};
 const controller=createToolConfigurationController({catalog,packages,worker,...externalLease?{getLease:provider=>leaseMap.get(provider)}:{},current:()=>clone(owner),currentTarget:()=>clone(target),getSettings:()=>({distribution:'Fixture',workerRoot:'/worker',workerPort:8888}),assertIdle:()=>{},confirm:async(plan,event)=>{confirmations.push({plan:clone(plan),event});return confirmHook?confirmHook(plan,event):true;},toWorkerPath:value=>'/mnt/'+value[0].toLowerCase()+value.slice(2).replaceAll('\\','/'),now:()=>clock});
 const plan=async(version=V1,request_id='fixture-plan-1')=>controller.plan({package_id:'atlas',package_version:version,project_id:'compute-project',environment_id:'environment',request_id});
 const reviewed=value=>({configuration_id:value.configuration_id,expected_revision:value.revision,plan_sha256:value.plan_sha256});
 function complete(id){const state=states.get(id);assert.equal(state.status,'testing');state.proof=true;state.status='tested';state.revision++;return response(state);}
 async function active(version=V1,requestId='fixture-plan-1'){const planned=await plan(version,requestId);await controller.execute(reviewed(planned),{human:true});complete(planned.configuration_id);const tested=await controller.status({configuration_id:planned.configuration_id});return controller.activate(reviewed(tested));}
 function scope(){const selected=leaseMap.get(owner.provider);return {...clone(owner),epoch:selected?.epoch,checkCurrent:()=>scopeAlive&&leaseMap.get(owner.provider)===selected};}
 function hold(route,predicate=()=>true){const entered=deferred(),release=deferred();let used=false;hook=async(method,name,args,next)=>{if(name===route&&predicate(args)&&!used){used=true;const result=next();entered.resolve();await release.promise;return result;}return next();};return {entered:entered.promise,release:()=>release.resolve()};}
 return {controller,catalog,packages,worker,leaseMap,calls,confirmations,records,states,extraArchives,binding,plan,reviewed,complete,active,scope,hold,metadata,
  hook:value=>{hook=value;},confirm:value=>{confirmHook=value;},owner:value=>{owner={...owner,...value};},target:value=>{target=value===null?null:{...target,...value};},advance:value=>{clock+=value;},expireScope:()=>{scopeAlive=false;},get ownerValue(){return clone(owner);},get targetValue(){return clone(target);}};
}

test('typed plan, human confirmation, execution, observed tests, activation, binding and metadata-first resolution form one real controller chain',async()=>{
 const f=fixture(),plan=await f.plan();assert.equal(plan.status,'planned');assert.equal(f.confirmations.length,0);
 await assert.rejects(Promise.resolve().then(()=>f.controller.activate({...f.reviewed(plan),passed:true})),/Exact typed/);assert.equal(f.states.get(plan.configuration_id).status,'planned');
 await f.controller.execute(f.reviewed(plan),{sender:'controlled-human'});assert.equal(f.confirmations.length,1);assert.equal(f.confirmations[0].event.sender,'controlled-human');assert.equal(f.states.get(plan.configuration_id).status,'testing');
 await assert.rejects(f.controller.activate(f.reviewed(await f.controller.status({configuration_id:plan.configuration_id}))),/evidence required/);
 f.complete(plan.configuration_id);const tested=await f.controller.status({configuration_id:plan.configuration_id}),active=await f.controller.activate(f.reviewed(tested));assert.equal(active.status,'active');
 const read=await f.controller.read({configuration_id:active.configuration_id});assert.equal(read.execution_skill.sha256,sha(read.execution_skill.body));
 await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});f.calls.length=0;
 const facts=await f.controller.resolveGuidance(f.scope());assert.equal(facts.state,'active');assert.equal(facts.executionSkill.sha256,sha(facts.executionSkill.text));assert.equal(facts.target.environmentId,'environment');assert.deepEqual(facts.applicableFunctions,[]);assert.deepEqual(facts.engines,['installation.check']);
 const routes=f.calls.map(call=>call.route),metadata=routes.indexOf('/api/tool-guidance/state'),body=routes.indexOf('/api/tool-execution-skill/read');assert(metadata>=0&&body>metadata,'Resolve must read authority metadata before the execution body');
});

test('plan retry keeps its original local creation identity and typed aliases never reach the worker',async()=>{
 const f=fixture(),one=await f.plan(),before=f.catalog.get(INDEX,one.configuration_id);f.advance(500);assert.equal((await f.plan()).configuration_id,one.configuration_id);assert.equal(f.catalog.get(INDEX,one.configuration_id).created_at,before.created_at);
 const calls=f.calls.length;for(const action of ['status','read','activate','execute'])await assert.rejects(Promise.resolve().then(()=>f.controller[action]({configuration_id:one.configuration_id,passed:true})),/Exact typed/);assert.equal(f.calls.length,calls);
});

test('a declined human confirmation cannot install, test or activate the tool',async()=>{
 const f=fixture(),plan=await f.plan();f.confirm(()=>false);const result=await f.controller.execute(f.reviewed(plan),{human:true});assert.equal(result.cancelled,true);assert.equal(f.states.get(plan.configuration_id).status,'planned');assert(!f.calls.some(call=>call.route.endsWith('/execute')||call.route.endsWith('/activate')));
});

for(const [label,change]of [
 ['owner',f=>f.owner({threadId:'other'})],['project',f=>f.target({projectId:'other-project'})],['environment',f=>f.target({environmentId:'other-environment'})],
 ['target kind',f=>f.target({kind:'cluster'})],['source binding',f=>f.target({workerBinding:{...f.binding,root:'/other'}})],
 ['worker identity',f=>{f.worker.identity={...f.worker.identity,root:'/other'};}],['worker epoch',f=>{f.worker.connectionEpoch++;}],['worker connection',f=>{f.worker.connection={health:clone(f.worker.connection.health)};}],
])test('late '+label+' change during confirmation prevents configuration dispatch',async()=>{
 const f=fixture(),plan=await f.plan(),entered=deferred(),release=deferred();f.confirm(async()=>{entered.resolve();await release.promise;return true;});const action=f.controller.execute(f.reviewed(plan),{human:true});await entered.promise;change(f);release.resolve();await assert.rejects(action,/changed|Restore|verify|service/i);assert(!f.calls.some(call=>call.route==='/api/tool-configuration/execute'));assert.equal(f.states.get(plan.configuration_id).status,'planned');
});

test('deployment target, not an unrelated authoring project, defines a valid binding',async()=>{
 const f=fixture(),active=await f.active();f.owner({projectId:'authoring-only-project'});await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});assert.equal((await f.controller.resolveGuidance(f.scope())).state,'active');
});

for(const target of [{projectId:'wrong'},{environmentId:'wrong'},{workerBinding:{distribution:'Fixture',root:'/wrong',port:8888}},{kind:'cluster'},{environmentId:undefined}])test('binding rejects an incompatible or incomplete actual target '+JSON.stringify(target),async()=>{
 const f=fixture(),active=await f.active();f.target(target);await assert.rejects(f.controller.bind({configuration_id:active.configuration_id,providers:['codex']}),/target differs/);assert.equal(f.catalog.list(BINDING).length,0);
});

test('a slower older binding cannot overwrite a newer explicit sharing choice',async()=>{
 const f=fixture(),active=await f.active(),gate=f.hold('/api/tool-execution-skill/read');const old=f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});await gate.entered;await f.controller.bind({configuration_id:active.configuration_id,providers:[]});gate.release();await assert.rejects(old,/superseded|changed/);assert.deepEqual(f.catalog.list(BINDING)[0].providers,[]);
});

test('revoked sharing resolves metadata only and never fetches an execution body',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:[]});f.calls.length=0;const facts=await f.controller.resolveGuidance(f.scope());assert.equal(facts.state,'revoked');assert.equal(facts.executionSkill,undefined);assert(!f.calls.some(call=>call.route==='/api/tool-execution-skill/read'));
});

test('sharing revoked during an awaited resolution suppresses the old execution result',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const gate=f.hold('/api/tool-execution-skill/read'),pending=f.controller.resolveGuidance(f.scope());await gate.entered;await f.controller.bind({configuration_id:active.configuration_id,providers:[]});gate.release();await assert.rejects(pending,/sharing|changed|superseded/);assert.deepEqual(f.catalog.list(BINDING)[0].providers,[]);
});

test('an expired provider scope is rejected before any authority or body request',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});f.calls.length=0;const scope=f.scope();f.expireScope();await assert.rejects(f.controller.resolveGuidance(scope),/owner changed|scope/i);assert.equal(f.calls.length,0);
});

test('a target change during an awaited execution read cannot publish active facts',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const gate=f.hold('/api/tool-execution-skill/read'),pending=f.controller.resolveGuidance(f.scope());await gate.entered;f.target({environmentId:'new-environment'});gate.release();
 const denied=await pending.catch(error=>error);if(denied instanceof Error)assert.match(denied.message,/target|changed/i);else{assert.equal(denied.state,'stale');assert.equal(denied.executionSkill,undefined);}
});

test('late status replies cannot erase activation or a persisted lost-reply intent',async()=>{
 const f=fixture(),plan=await f.plan();await f.controller.execute(f.reviewed(plan),{human:true});f.complete(plan.configuration_id);const tested=await f.controller.status({configuration_id:plan.configuration_id}),gate=f.hold('/api/tool-configuration/status');
 const old=f.controller.status({configuration_id:plan.configuration_id}).catch(error=>error);await gate.entered;await f.controller.activate(f.reviewed(tested));gate.release();await old;
 const stored=f.catalog.get(INDEX,plan.configuration_id);assert.equal(stored.has_execution,true);assert.equal(stored.may_have_execution,true);assert(stored.last_revision>=f.states.get(plan.configuration_id).revision);
});

test('a lost activation reply seals known paths before dispatch and recovers from metadata without claiming selected activation',async()=>{
 const f=fixture(),plan=await f.plan();await f.controller.execute(f.reviewed(plan),{human:true});f.complete(plan.configuration_id);const tested=await f.controller.status({configuration_id:plan.configuration_id});
 f.hook((method,route,args,next)=>{if(route==='/api/tool-configuration/activate'){assert.equal(f.catalog.get(INDEX,args.configuration_id).may_have_execution,true);next();throw Error('Lost activation reply');}return next();});
 await assert.rejects(f.controller.activate(f.reviewed(tested)),/Lost activation reply/);f.hook(null);assert.equal(f.catalog.get(INDEX,plan.configuration_id).may_have_execution,true);f.calls.length=0;
 const facts=await f.controller.resolveGuidance(f.scope());assert.equal(facts.state,'legacy_unconfigured');assert.equal(facts.executionSkill,undefined);assert(facts.archivedResources.some(resource=>resource.paths.some(path=>path.endsWith('SKILL.md'))));assert(f.calls.some(call=>call.route==='/api/tool-guidance/state'));assert(!f.calls.some(call=>call.route==='/api/tool-execution-skill/read'));
});

test('a late tested reply preserves may-have-execution even when the activation response was lost',async()=>{
 const f=fixture(),plan=await f.plan();await f.controller.execute(f.reviewed(plan),{human:true});f.complete(plan.configuration_id);const tested=await f.controller.status({configuration_id:plan.configuration_id}),entered=deferred(),release=deferred();let held=false;
 f.hook(async(method,route,args,next)=>{
  if(route==='/api/tool-configuration/status'&&!held){held=true;const result=next();entered.resolve();await release.promise;return result;}
  if(route==='/api/tool-configuration/activate'){next();throw Error('Lost activation reply');}
  return next();
 });
 const old=f.controller.status({configuration_id:plan.configuration_id}).catch(error=>error);await entered.promise;await assert.rejects(f.controller.activate(f.reviewed(tested)),/Lost activation reply/);release.resolve();await old;
 const stored=f.catalog.get(INDEX,plan.configuration_id);assert.equal(stored.has_execution,false);assert.equal(stored.may_have_execution,true);assert(stored.package_metadata.guidance.length>0);
});

test('metadata-only discovery restores archive facts after local has-execution cache was absent',async()=>{
 const f=fixture(),active=await f.active(),stored=f.catalog.get(INDEX,active.configuration_id);delete stored.has_execution;delete stored.may_have_execution;delete stored.authority_metadata;f.catalog.put(INDEX,active.configuration_id,stored);f.calls.length=0;
 const facts=await f.controller.resolveGuidance(f.scope());assert.equal(facts.state,'legacy_unconfigured');assert(facts.archivedResources.length>0);assert.equal(f.catalog.get(INDEX,active.configuration_id).has_execution,true);assert(!f.calls.some(call=>call.route==='/api/tool-execution-skill/read'));
});

test('local Windows link metadata and historical roots are sealed without resolving a real filesystem link',async()=>{
 const f=fixture(),record=f.records.get(V1);record.guidance=[{role:'delivery',path:'redirect/SKILL.md'}];record.files.push({path:'redirect',kind:'symlink',target:'upstream/docs'});const active=await f.active(),facts=await f.controller.resolveGuidance(f.scope());
 assert.equal(facts.state,'legacy_unconfigured');const paths=facts.archivedResources.flatMap(resource=>resource.paths);for(const root of [record.snapshot_root,record.package_root,...record.package_roots])assert(paths.includes(root+'\\upstream\\docs\\SKILL.md'),root);assert(paths.some(path=>path.endsWith('redirect\\SKILL.md')));assert.equal(f.catalog.get(INDEX,active.configuration_id).has_execution,true);
});

test('grant scope is an exact current package version/resource subset and its bound live lease',async()=>{
 const f=fixture(),active=await f.active();await f.active(V2,'fixture-plan-2');await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});let facts=await f.controller.resolveGuidance(f.scope());
 const resource=facts.archivedResources.find(resource=>resource.role==='delivery'&&resource.paths.some(path=>path.includes('snapshots')&&path.includes(V1))),other=facts.archivedResources.find(resource=>resource.role==='delivery'&&resource.paths.some(path=>path.includes('snapshots')&&path.includes(V2)));assert(resource&&other);
 for(const ids of [[],['unknown-resource'],[other.id],[resource.id,resource.id]])await assert.rejects(f.controller.grant({configuration_id:active.configuration_id,purpose:'repair',resource_ids:ids}),/resource|scope/i);
 await f.controller.grant({configuration_id:active.configuration_id,purpose:'repair',resource_ids:[resource.id]});facts=await f.controller.resolveGuidance(f.scope());assert.deepEqual(facts.readGrant.resourceIds,[resource.id]);assert.equal(facts.readGrant.owner.leaseEpoch,4);assert.equal(facts.readGrant.authorityRevision,facts.revision);
 const scope=f.scope(),policy=createReadPolicy(facts,{scope});assert.equal(policy.hasReadGrant(),true);assert.equal(policy.isGrantedPath(resource.paths[0]),true);assert.equal(policy.isGrantedPath(other.paths[0]),false);
 f.worker.providerScopes.scopes.set('codex',{...f.worker.providerScopes.scopes.get('codex'),epoch:5});assert.equal(createReadPolicy(await f.controller.resolveGuidance(f.scope()),{scope:f.scope()}).hasReadGrant(),false);
});

test('a lease rotated or reshaped during grant preparation cannot receive a success receipt',async()=>{
 for(const mutation of [f=>f.worker.providerScopes.scopes.set('codex',{...f.worker.providerScopes.scopes.get('codex'),epoch:9}),f=>{f.worker.providerScopes.scopes.get('codex').context.environmentId='other';}]){
  const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const facts=await f.controller.resolveGuidance(f.scope()),resource=facts.archivedResources[0],gate=f.hold('/api/tool-execution-skill/read');const pending=f.controller.grant({configuration_id:active.configuration_id,purpose:'update',resource_ids:[resource.id]});await gate.entered;mutation(f);gate.release();await assert.rejects(pending,/lease|Conversation|sharing|changed/i);
 }
});

test('grant expires and an explicit rebind invalidates the previous scope revision',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const facts=await f.controller.resolveGuidance(f.scope()),resource=facts.archivedResources[0],grant=()=>f.controller.grant({configuration_id:active.configuration_id,purpose:'configure',resource_ids:[resource.id]});
 await grant();assert((await f.controller.resolveGuidance(f.scope())).readGrant);f.advance(600001);assert.equal((await f.controller.resolveGuidance(f.scope())).readGrant,undefined);
 await grant();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});assert.equal((await f.controller.resolveGuidance(f.scope())).readGrant,undefined);
});

test('an injected provider lease works without a global worker provider-scope registry',async()=>{
 const f=fixture({externalLease:true}),active=await f.active();assert.equal(f.worker.providerScopes,undefined);await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const initial=await f.controller.resolveGuidance(f.scope());
 await f.controller.grant({configuration_id:active.configuration_id,purpose:'repair',resource_ids:[initial.archivedResources[0].id]});const scope=f.scope(),facts=await f.controller.resolveGuidance(scope);assert.equal(createReadPolicy(facts,{scope}).hasReadGrant(),true);
});

test('typed production route registrations preserve the execute event and expose no generic caller success controls',async()=>{
 const f=fixture(),handlers=new Map();registerToolConfigurationRoutes({handle:(name,handler)=>handlers.set(name,handler),controller:f.controller});assert.deepEqual([...handlers.keys()].sort(),['context','list','createProject','plan','status','activate','read','bind','grant','execute'].map(name=>'tools.configurations.'+name).sort());const plan=await handlers.get('tools.configurations.plan')({package_id:'atlas',package_version:V1,project_id:'compute-project',environment_id:'environment',request_id:'typed-route-request'});const event={sender:'typed-human'};await handlers.get('tools.configurations.execute')(f.reviewed(plan),event);assert.equal(f.confirmations[0].event,event);await assert.rejects(Promise.resolve().then(()=>handlers.get('tools.configurations.read')({configuration_id:plan.configuration_id,passed:true})),/Exact typed/);
});

test('configuration context is metadata only, exposes sharing separately and changes its opaque owner on actual scope changes',async()=>{
 const f=fixture(),initial=f.controller.context({});assert.equal(initial.hasConversation,true);assert.equal(initial.provider,'codex');assert.deepEqual(initial.providers,[]);assert.equal(initial.configuration_id,null);assert.equal(f.calls.length,0);assert.match(initial.owner_key,/^[0-9a-f]{64}$/);
 f.target({environmentId:'new'});assert.notEqual(f.controller.context({}).owner_key,initial.owner_key);f.target({environmentId:'environment'});assert.equal(f.controller.context({}).owner_key,initial.owner_key);
 f.leaseMap.get('codex').epoch++;assert.notEqual(f.controller.context({}).owner_key,initial.owner_key);f.owner({threadId:null});const missing=f.controller.context({});assert.equal(missing.hasConversation,false);assert.equal(missing.owner_key,null);assert.equal(f.calls.length,0);
 assert.throws(()=>f.controller.context({provider:'qwen'}),/Exact typed/);
});

function projectApi(f,{environments=[{id:'environment'}],projects=[]}={}){
 let entries=projects;const requests=[];
 f.hook((method,route,value,next)=>{
  if(route==='/api/environments'){assert.equal(method,'GET');return clone(environments);}
  if(route==='/api/projects'&&method==='GET')return clone(entries);
  if(route==='/api/tool-configuration/project/create'&&method==='POST'){assert.deepEqual(Object.keys(value).sort(),['environment_id','name','project_id']);const created={id:value.project_id,name:value.name,policy:{engines:['installation.check'],gpus:[0],max_seconds:30,max_concurrent:1,input_roots:['/worker/projects/'+value.project_id+'/inputs'],environments:[value.environment_id]}},existing=entries.find(item=>item.id===created.id);if(existing&&!equalProject(existing,created))throw Error('Existing project authorization is preserved');requests.push(clone(value));if(!existing)entries=[...entries,clone(created)];return clone(existing||created);}
  return next();
 });
 return {requests,entries:()=>entries,replace:value=>{entries=value;}};
}
const equalProject=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

test('explicit configuration project creation grants only a new bounded CPU reference scope and never overwrites an old project',async()=>{
 const f=fixture(),old={id:'protected',name:'User project',policy:{engines:['gpumd.md'],environments:['private-env']}},service=projectApi(f,{projects:[old]}),request={environment_id:'environment',name:' Reference check ',request_id:'project-request-001'};
 const created=await f.controller.createProject(request);assert.match(created.id,/^tool-config-[0-9a-f]{24}$/);assert.equal(created.name,'Reference check');assert.deepEqual(created.policy,{engines:['installation.check'],gpus:[0],max_seconds:30,max_concurrent:1,input_roots:['/worker/projects/'+created.id+'/inputs'],environments:['environment']});assert.deepEqual(service.entries()[0],old);
 assert.deepEqual(await f.controller.createProject(request),created);assert.equal(service.requests.length,1);service.replace([old,{...created,policy:{...created.policy,engines:['gpumd.md']}}]);await assert.rejects(f.controller.createProject(request),/preserved/);assert.equal(service.requests.length,1);
});

test('project creation rejects unknown environments, invalid responses and typed privilege extensions before any create',async()=>{
 for(const mode of ['missing-env','invalid-projects','extra-policy']){const f=fixture(),service=projectApi(f,{environments:mode==='missing-env'?[]:[{id:'environment'}],projects:mode==='invalid-projects'?{}:[]}),request={environment_id:'environment',name:'CPU check',request_id:'project-request-001',...mode==='extra-policy'?{policy:{engines:['gpumd.md']}}:{}};await assert.rejects(f.controller.createProject(request),/unavailable|Invalid project|Exact typed/);assert.equal(service.requests.length,0);}
});

test('a scope change while reading configuration projects cannot dispatch a new authorization',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();let created=0;f.hook(async(method,route,args,next)=>{
  if(route==='/api/environments')return [{id:'environment'}];if(route==='/api/projects'&&method==='GET'){entered.resolve();await release.promise;return [];}
  if(route==='/api/projects'&&method==='POST'){created++;return args;}return next();
 });const pending=f.controller.createProject({environment_id:'environment',name:'CPU check',request_id:'project-request-001'});await entered.promise;f.owner({threadId:'new-owner'});release.resolve();await assert.rejects(pending,/changed/);assert.equal(created,0);
});

test('an activation rejected before dispatch cannot seal guidance or manufacture a lost-reply intent',async()=>{
 for(const mode of ['disconnected','unverified','untested']){
  const f=fixture(),plan=await f.plan();let reviewed=plan;if(mode!=='untested'){await f.controller.execute(f.reviewed(plan),{human:true});f.complete(plan.configuration_id);reviewed=await f.controller.status({configuration_id:plan.configuration_id});}
  if(mode==='disconnected')f.worker.connection=null;if(mode==='unverified')f.hook((method,route,args,next)=>route==='/api/health'?{name:'wrong-service'}:next());f.calls.length=0;
  await assert.rejects(f.controller.activate(f.reviewed(reviewed)),/verify|not verified|evidence required/i);const stored=f.catalog.get(INDEX,plan.configuration_id);assert.equal(stored.has_execution,false);assert.equal(stored.may_have_execution,false);assert(!f.calls.some(call=>call.route==='/api/tool-configuration/activate'));
  if(mode==='disconnected'){assert.equal(f.calls.length,0);const facts=await f.controller.resolveGuidance(f.scope());assert.equal(facts.archivedResources.length,0);assert.equal(createReadPolicy(facts).allowsPath('D:\\packages\\atlas-1\\SKILL.md'),true);}
 }
});

test('a project appearing after the GET snapshot reaches only the atomic create route and keeps its real authorization',async()=>{
 const f=fixture(),service=projectApi(f),request=f.worker.request;let protectedProject;
 f.worker.request=async(method,route,args)=>{
  if(route==='/api/tool-configuration/project/create'){protectedProject={id:args.project_id,name:'Concurrent human project',policy:{engines:['gpumd.md'],environments:['environment'],gpus:[0],max_seconds:1000,max_concurrent:2,input_roots:['/private-inputs']}};service.replace([clone(protectedProject)]);}
  return request(method,route,args);
 };
 await assert.rejects(f.controller.createProject({environment_id:'environment',name:'CPU check',request_id:'project-request-001'}),/preserved/);assert.deepEqual(service.entries(),[protectedProject]);assert.equal(service.requests.length,0);assert(!f.calls.some(call=>call.method==='POST'&&call.route==='/api/projects'));const call=f.calls.find(call=>call.route==='/api/tool-configuration/project/create');assert.deepEqual(Object.keys(call.args).sort(),['environment_id','name','project_id']);
});

test('old services without the configuration capability keep legacy reads and cached archive restrictions without an upgrade',async()=>{
 const fresh=fixture();delete fresh.worker.connection.health.tool_configuration_schema;const legacy=await fresh.controller.resolveGuidance(fresh.scope());assert.equal(legacy.state,'legacy_unconfigured');assert.equal(fresh.calls.length,0);
 const existing=fixture();await existing.active();delete existing.worker.connection.health.tool_configuration_schema;existing.calls.length=0;const cached=await existing.controller.resolveGuidance(existing.scope());assert.equal(cached.state,'legacy_unconfigured');assert(cached.archivedResources.length>0);assert.equal(existing.calls.length,0);
});

for(const [label,mutate]of [['owner',f=>f.owner({threadId:'new-thread'})],['target',f=>f.target({environmentId:'new-environment'})],['worker source',f=>{f.worker.identity={...f.worker.identity,root:'/other-service'};}]])test('metadata wait rejects a changed '+label+' before requesting an execution body',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const gate=f.hold('/api/tool-guidance/state'),pending=f.controller.resolveGuidance(f.scope());await gate.entered;mutate(f);gate.release();await assert.rejects(pending,/changed|source|service/i);assert(!f.calls.slice(f.calls.findLastIndex(call=>call.route==='/api/tool-guidance/state')+1).some(call=>call.route==='/api/tool-execution-skill/read'));
});

test('metadata responses cannot carry execution bodies into the metadata-only path',async()=>{
 const f=fixture();await f.active();f.hook((method,route,args,next)=>{const result=next();if(route==='/api/tool-guidance/state')result.configurations[0].execution_skill.body='MUST NOT BE METADATA';return result;});await assert.rejects(f.controller.resolveGuidance(f.scope()),/metadata|authority/i);
});

test('a late older metadata snapshot cannot reopen a newly observed archived resource',async()=>{
 const f=fixture(),active=await f.active(),copy='/worker/owned-copy/archived-SKILL.md',gate=f.hold('/api/tool-guidance/state');
 const older=f.controller.resolveGuidance(f.scope());await gate.entered;
 f.extraArchives.push({path:copy,role:'delivery',configuration_id:active.configuration_id,package_id:'atlas',package_version:V1});
 const newer=await f.controller.resolveGuidance(f.scope());assert(newer.archivedResources.some(resource=>resource.paths.includes(copy)));gate.release();
 const result=await older.catch(error=>error);if(!(result instanceof Error))assert(result.archivedResources.some(resource=>resource.paths.includes(copy)),'An old metadata reply must retain the newer archive restriction');
 assert((await f.controller.resolveGuidance(f.scope())).archivedResources.some(resource=>resource.paths.includes(copy)));
});

test('revocation while a grant is preparing cannot mint a new grant for the revoked revision',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const facts=await f.controller.resolveGuidance(f.scope()),gate=f.hold('/api/tool-guidance/state');
 const pending=f.controller.grant({configuration_id:active.configuration_id,purpose:'repair',resource_ids:[facts.archivedResources[0].id]});await gate.entered;await f.controller.bind({configuration_id:active.configuration_id,providers:[]});gate.release();await assert.rejects(pending,/sharing|Conversation|changed|Bind/i);
 const revoked=await f.controller.resolveGuidance(f.scope());assert.equal(revoked.state,'revoked');assert.equal(revoked.readGrant,undefined);
});

for(const key of ['projectId','environmentId','inputRoot'])test('an already mismatched '+key+' lease cannot open configuration guidance',async()=>{
 const f=fixture(),active=await f.active();await f.controller.bind({configuration_id:active.configuration_id,providers:['codex']});const facts=await f.controller.resolveGuidance(f.scope());f.worker.providerScopes.scopes.get('codex').context[key]='wrong-scope';
 await assert.rejects(f.controller.grant({configuration_id:active.configuration_id,purpose:'repair',resource_ids:[facts.archivedResources[0].id]}),/conversation|context|scope|lease|changed/i);
});

for(const [label,field,value]of [
 ['package version','package_version',V2],['manifest identity','manifest_sha256','e'.repeat(64)],['source commit','source_commit','f'.repeat(40)],
])test('an active worker reply cannot change the registered '+label+' for the same configuration',async()=>{
 const f=fixture(),active=await f.active();f.hook((method,route,args,next)=>{const result=next();if(route==='/api/tool-execution-skill/read')result[field]=value;return result;});
 await assert.rejects(f.controller.read({configuration_id:active.configuration_id}),/identity|source|manifest|package|target|differs/i);
});
