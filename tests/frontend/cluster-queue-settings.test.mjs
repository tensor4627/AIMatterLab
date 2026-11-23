import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL("../../frontend/features/cluster/ClusterQueueSettings.tsx",import.meta.url),'utf8');
const target=(id,usage='owned')=>({id,queue:id+'-q',usage_class:usage,enabled:true,engines:['pydyn.md'],environment:{executables:{python:'/registered/python'},repositories:{},variables:{}},activation:'source /registered/activate',limits:{cpus:4,gpus:1,memory_mb:8192,max_seconds:600}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({override,approved=false,legacy=false,missingPaid=false,paidOverride}={}){
 let props,tree,index=0,dirty=false,disposed=false;const hooks=[],effects=[],calls=[],agents=[],errors=[],validity=[];
 const profile={id:'cluster',version:4,queue:'legacy',environment:target('a').environment,activation:'source /registered/activate',limits:target('a').limits,...legacy?{}:{queue_targets:[target('a'),target('b'),target('paid','paid'),target('unknown','unknown')]}};
 const policy={profile_version:4,allowed_target_ids:approved?['a']:[],new_submission_order:approved?['a']:[],paid:{permitted:false,conditions_known:false,conditions:''}};
 if(missingPaid)delete policy.paid;if(paidOverride!==undefined)policy.paid=paidOverride;
 const project={id:'project',name:'Project',policy:{engines:['pydyn.md'],gpus:[0],input_roots:['/owned'],environments:['env'],max_seconds:40,max_concurrent:1,clusters:['other'],cluster_queue_policies:{other:{preserved:true},cluster:policy}}};
 let latest=structuredClone(project);latest.policy.newer_field='preserve newest';
 const useState=initial=>{const i=index++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,v=>{hooks[i].value=typeof v==='function'?v(hooks[i].value):v;dirty=true;}];},useRef=initial=>{const i=index++;return hooks[i]??(hooks[i]={current:initial});},useEffect=(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const api=async(method,path,data)=>{calls.push({method,path,data:structuredClone(data)});const intercepted=override?.(method,path,data);if(intercepted!==undefined)return intercepted;if(path==='/api/environments')return [{id:'env',name:'Registered environment',...target('a').environment}];if(path==='/api/engines')return ['pydyn.md','gpumd.md'];if(path==='/api/projects'&&method==='GET')return structuredClone([latest]);if(path==='/api/cluster/profile')return structuredClone(profile);if(path==='/api/projects'&&method==='POST'){latest=structuredClone(data);return latest;}throw Error('Unexpected route '+path);};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 new Function('require','module','exports','localStorage',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>n==='react'?{useState,useRef,useEffect}:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n==="../../api/worker"?{api}:n==="../../ui/i18n"?{t:v=>v,getLanguage:()=>'zh-CN'}:{default:n},module,module.exports,{getItem:()=>null});
 props={profile,project,worker:true,busy:false,profileDirty:false,visible:true,environmentText:JSON.stringify(profile.environment),probe:{queues:['detected-only']},onTargets:targets=>{props={...props,profile:{...props.profile,queue_targets:targets},profileDirty:true};dirty=true;},onValidity:v=>validity.push(v),onRefresh:()=>{},onError:e=>errors.push(String(e)),onQueueTest:text=>agents.push(text)};
 function render(changes={}){props={...props,...changes};index=0;dirty=false;tree=module.exports.default(props);return tree;}
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 function find(predicate){const n=all(tree).find(predicate);assert(n,'Queue UI node missing');return n;}
 const id=value=>find(n=>n.props?.['data-testid']===value),writes=()=>calls.filter(c=>c.path==='/api/projects'&&c.method==='POST');
 async function flush(){for(let i=0;i<12;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&!disposed)render();}}
 function unmount(){disposed=true;for(const h of hooks)h?.cleanup?.();}
 render();return {render,find,id,flush,unmount,calls,agents,errors,validity,writes,profile,project,readPolicy:()=>module.exports.queuePolicy(profile,project),get props(){return props;}};
}
test('detected queue fills an unknown, unapproved draft with registered environment, never saves',async()=>{
 const h=fixture();await h.flush();h.find(n=>n.type==="../compute/QueueChoices").props.onChange('detected-only');await h.flush();const added=h.props.profile.queue_targets.at(-1);assert.equal(added.queue,'detected-only');assert.equal(added.usage_class,'unknown');assert.deepEqual(added.environment,h.profile.environment);assert.equal(added.activation,h.profile.activation);assert.equal(added.engines.length,0);assert.equal(h.writes().length,0);assert.equal(h.validity.at(-1),false);assert.equal(h.id('queue-policy-approve').props.disabled,true);h.unmount();
});

test('a pending environment edit cannot clone a previous environment into a queue target',async()=>{
 const h=fixture({legacy:true});
 try{
  await h.flush();h.render({environmentText:null});
  h.id('queue-add').props.onClick();await h.flush();
  assert.equal(h.props.profile.queue_targets,undefined);
  assert(h.find(node=>node.props?.role==='status'&&String(node.props.children).includes('请先填写有效环境。')));
  assert.equal(h.writes().length,0);
 }finally{h.unmount();}
});
test('explicit queue approval preserves latest project policy and all other cluster grants',async()=>{
 const h=fixture();await h.flush();for(const id of ['a','b']){h.id('queue-allow-'+id).props.onChange({target:{checked:true}});await h.flush();}h.find(n=>n.props?.['aria-label']==='上移 b').props.onClick();await h.flush();assert.equal(h.writes().length,0);h.id('queue-policy-approve').props.onClick();await h.flush();const saved=h.writes()[0].data;assert.equal(saved.policy.newer_field,'preserve newest');assert.deepEqual(saved.policy.input_roots,['/owned']);assert.deepEqual(saved.policy.clusters,['other','cluster']);assert.deepEqual(saved.policy.cluster_queue_policies.other,{preserved:true});assert.deepEqual(saved.policy.cluster_queue_policies.cluster.new_submission_order,['b','a']);assert.equal(saved.policy.cluster_queue_policies.cluster.profile_version,4);assert.equal(h.errors.length,0);h.unmount();
});
test('unknown and paid queues are never granted by default; paid requires explicit known conditions',async()=>{
 const h=fixture();await h.flush();assert.equal(h.id('queue-allow-unknown').props.disabled,true);h.id('queue-allow-paid').props.onChange({target:{checked:true}});await h.flush();assert.equal(h.id('queue-policy-approve').props.disabled,true);h.id('queue-paid-permit').props.onChange({target:{checked:true}});await h.flush();assert.equal(h.id('queue-policy-approve').props.disabled,true);h.id('queue-paid-known').props.onChange({target:{checked:true}});h.id('queue-paid-conditions').props.onChange({target:{value:'Explicit reviewed charge cap'}});await h.flush();assert.equal(h.id('queue-policy-approve').props.disabled,false);assert.equal(h.writes().length,0);h.unmount();
});
for(const scenario of ['profile','project','version','dirty','worker','busy','cancel','unmount'])test('pending approval cannot write after '+scenario+' changes',async()=>{
 const read=deferred(),h=fixture({override:(m,p)=>p==='/api/projects'&&m==='GET'?read.promise:undefined});await h.flush();h.id('queue-allow-a').props.onChange({target:{checked:true}});await h.flush();h.id('queue-policy-approve').props.onClick();await h.flush();
 if(scenario==='profile')h.render({profile:{...h.profile,id:'other'}});if(scenario==='project')h.render({project:{...h.project,id:'other'}});if(scenario==='version')h.render({profile:{...h.profile,version:5}});if(scenario==='dirty')h.render({profileDirty:true});if(scenario==='worker')h.render({worker:false});if(scenario==='busy')h.render({busy:true});if(scenario==='cancel')h.id('queue-policy-cancel').props.onClick();if(scenario==='unmount')h.unmount();read.resolve([h.project]);await h.flush();assert.equal(h.writes().length,0);h.unmount();
});
test('authoritative changed profile version rejects approval rather than merging stale targets',async()=>{
 const h=fixture({override:(_m,p)=>p==='/api/cluster/profile'?Promise.resolve({id:'cluster',version:5}):undefined});await h.flush();h.id('queue-allow-a').props.onChange({target:{checked:true}});await h.flush();h.id('queue-policy-approve').props.onClick();await h.flush();assert.equal(h.writes().length,0);assert.match(h.errors[0],/版本或项目/);h.unmount();
});
test('bounded test creates natural-language review draft only, respecting project duration cap',async()=>{
 const h=fixture({approved:true});await h.flush();assert.equal(h.id('queue-test-0').props.disabled,false);h.id('queue-test-0').props.onClick();assert.equal(h.agents.length,1);assert.match(h.agents[0],/queue_target_id=a/);assert.match(h.agents[0],/"max_seconds":40/);assert.match(h.agents[0],/等待人工复核与点击执行/);assert.equal(h.id('queue-test-2').props.disabled,true);assert.equal(h.id('queue-test-3').props.disabled,true);assert.equal(h.writes().length,0);assert(!h.calls.some(c=>/submit|prepare|probe|auth/.test(c.path)));h.unmount();
});
test('invalid advanced environment blocks save validity and legacy has no opt-in field until edited',async()=>{
 const h=fixture();await h.flush();h.find(n=>n.type==='textarea'&&n.props?.['aria-invalid']===false).props.onChange({target:{value:'{invalid'}});await h.flush();assert.equal(h.validity.at(-1),false);assert.equal(h.id('queue-policy-approve').props.disabled,true);assert.equal(h.writes().length,0);h.unmount();const legacy=fixture({legacy:true});await legacy.flush();assert.equal(legacy.props.profile.queue_targets,undefined);assert.equal(legacy.writes().length,0);legacy.unmount();
});


test('clearing optional scheduler account removes its field instead of storing an invalid empty string',async()=>{
 const h=fixture();await h.flush();h.id('queue-account-0').props.onChange({target:{value:'reviewed-account'}});await h.flush();assert.equal(h.props.profile.queue_targets[0].account,'reviewed-account');h.id('queue-account-0').props.onChange({target:{value:''}});await h.flush();assert.equal(Object.hasOwn(h.props.profile.queue_targets[0],'account'),false);assert.equal(h.writes().length,0);h.unmount();
});
test('saved opt-in cannot escape to legacy; only a new unsaved opt-in has a local cancel action',async()=>{
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):typeof n==='string'?n:'';
 const h=fixture();await h.flush();assert.throws(()=>h.find(n=>n.type==='button'&&text(n)==='取消新队列配置'));h.render({canCancelOptIn:true});h.find(n=>n.type==='button'&&text(n)==='取消新队列配置').props.onClick();await h.flush();assert.equal(h.props.profile.queue_targets,undefined);assert.deepEqual(h.project.policy.cluster_queue_policies.cluster.allowed_target_ids,[]);assert.equal(h.writes().length,0);h.unmount();
});


for(const approved of [false,true])test('legal missing-paid '+(approved?'owned':'empty revocation')+' policy renders and reset stays read-only',async()=>{
 const h=fixture({approved,missingPaid:true});await h.flush();const before=structuredClone(h.project);assert.equal(h.id('queue-paid-permit').props.checked,false);assert.equal(h.id('queue-paid-known').props.checked,false);assert.equal(h.id('queue-paid-conditions').props.value,'');h.id('queue-paid-permit').props.onChange({target:{checked:true}});await h.flush();h.id('queue-policy-cancel').props.onClick();await h.flush();assert.equal(h.id('queue-paid-permit').props.checked,false);assert.equal(h.id('queue-allow-a').props.checked,approved);assert.deepEqual(h.project,before);assert.equal(Object.hasOwn(h.project.policy.cluster_queue_policies.cluster,'paid'),false);assert.equal(h.writes().length,0);h.unmount();
});
test('partial optional paid reader fills only missing defaults and deep-clones reviewed limits',async()=>{
 const limits={cpus:2,gpus:0,memory_mb:2048,max_seconds:30},h=fixture({paidOverride:{conditions:'Retain terms',limits}});await h.flush();const read=h.readPolicy();assert.deepEqual(read.paid,{permitted:false,conditions_known:false,conditions:'Retain terms',limits});read.paid.limits.cpus=99;assert.equal(h.project.policy.cluster_queue_policies.cluster.paid.limits.cpus,2);assert.equal(h.writes().length,0);h.unmount();
});
test('remove and re-add draft target id cannot show deleted advanced JSON for a new environment',async()=>{
 const h=fixture();await h.flush();const walk=n=>Array.isArray(n)?n.flatMap(walk):n&&typeof n==='object'?[n,...walk(n.props?.children)]:[];
 const editor=()=>walk(h.find(n=>n.type==='fieldset'&&n.props['aria-label']==='queue-5')).find(n=>n.type==='textarea'&&n.props['aria-invalid']!==undefined);
 h.id('queue-add').props.onClick();await h.flush();editor().props.onChange({target:{value:JSON.stringify({executables:{python:'/draft/deleted/python'}})}});await h.flush();h.id('queue-remove-4').props.onClick();await h.flush();h.id('queue-add').props.onClick();await h.flush();const fresh=h.props.profile.queue_targets.at(-1);assert.equal(fresh.id,'queue-5');assert.equal(fresh.environment.executables.python,'/registered/python');assert.equal(JSON.parse(editor().props.value).executables.python,fresh.environment.executables.python);assert.equal(h.writes().length,0);h.unmount();
});

test('approval is rejected when the saved project omits the approved policy',async()=>{
 const h=fixture({override:(method,path,data)=>path==='/api/projects'&&method==='POST'?{...structuredClone(data),policy:{...data.policy,cluster_queue_policies:{...data.policy.cluster_queue_policies,cluster:{...data.policy.cluster_queue_policies.cluster,allowed_target_ids:[]}}}}:undefined});
 await h.flush();h.id('queue-allow-a').props.onChange({target:{checked:true}});await h.flush();h.id('queue-policy-approve').props.onClick();await h.flush();
 assert.equal(h.writes().length,1);assert.match(h.errors[0]?String(h.errors[0]):'',/未按批准内容保存/);
 h.unmount();
});
