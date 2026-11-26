import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import * as defaults from "../../frontend/features/compute/project-setup-defaults.mjs";import * as policyOwner0 from "../../frontend/features/compute/project-policy-edit.mjs";
import * as policyOwner1 from "../../contracts/compute/project-policy.mjs";
const policy={...policyOwner0,...policyOwner1};

const compiled=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/compute/ProjectAuthorizationForm.tsx",import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const spec={name:'Owned test',policy:{engines:['pygas.build'],gpus:[0],max_seconds:60,max_concurrent:1,input_roots:['/owned/inputs'],environments:['env'],clusters:[]}};
function harness(submit=async()=>{},{props:extra={},invoke}={}){
 const slots=[],effects=[];let cursor=0,dirty=false,tree,submitted=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];};
 const useRef=initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old[j]))){slots[i]=deps;effects.push(fn);}};
 const module={exports:{}};
 const jsx=(type,props)=>type==='Field'?{type,props:{...props,children:[props.children({'aria-invalid':props.error?true:undefined}),props.error]}}
  : type==='Notice'?{type,props:{...props,role:props.severity==='error'?'alert':'status'}}
  : {type,props};
 new Function('require','module','exports',compiled)(name=>name==='react'?{useState,useRef,useEffect,useId:()=> 'gpu-hint-fixture'}:
  name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./project-setup-defaults.mjs'?defaults:
  ["./project-policy-edit.mjs","../../../contracts/compute/project-policy.mjs"].includes(name)?policy:
  ["../../ui/presentation/engines","../../ui/presentation/paths"].includes(name)?{engines:[['pygas.build','pyGAS']],wslPath:x=>x}:
  name==="../../ui/i18n"?{t:x=>x}:name==='../../ui/Field'?{default:'Field'}:name==='../../ui/Notice'?{default:'Notice'}:name==='../../api/studio'?{invoke}:{},module,module.exports);
 const props={defaults:structuredClone(spec),environments:[{id:'env',name:'Registered'}],onSubmit:async s=>{submitted++;await submit(s);},...extra};
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let n=0;n<10;n++){while(effects.length)effects.shift()();await Promise.resolve();if(dirty)render();}}
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[],
  text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';
 const find=p=>{const n=all(tree).find(p);assert(n,'actual component node missing');return n;};
 const button=label=>find(n=>n.type==='button'&&text(n)===label);
 render();
 return {flush,find,button,text,submitted:()=>submitted,alerts:()=>all(tree).filter(n=>n.props?.role==='alert').map(text)};
}
test('invalid JSON has one visible error; reset restores exact current form JSON, clears that error and never submits',async()=>{const h=harness();await h.flush();const input=()=>h.find(n=>n.props?.['aria-label']==='高级 JSON 授权');const before=input().props.value;input().props.onChange({target:{value:'{'}});await h.flush();h.button('应用 JSON').props.onClick();await h.flush();assert.equal(h.alerts().filter(x=>x.includes('JSON 格式无效')).length,1);h.button('从表单重置 JSON').props.onClick();await h.flush();assert.equal(input().props.value,before);assert.equal(h.alerts().filter(x=>x.includes('JSON 格式无效')).length,0);assert.equal(h.submitted(),0);});
test('reset removes JSON-specific validation issue but retains independent field issue without applying invalid policy',async()=>{const h=harness();await h.flush();h.find(n=>n.props?.['aria-label']==='高级 JSON 授权').props.onChange({target:{value:JSON.stringify({...spec,name:'',extra:true})}});await h.flush();h.button('应用 JSON').props.onClick();await h.flush();assert(h.alerts().includes('请填写项目名称'));h.button('从表单重置 JSON').props.onClick();await h.flush();assert(h.alerts().includes('请填写项目名称'));assert(!h.alerts().some(x=>x.includes('仅支持新项目')));assert.equal(h.find(n=>n.props?.['aria-label']==='项目名称').props.value,'Owned test');assert.equal(h.submitted(),0);});
test('reset preserves a separate failed-submit error and does not retry submission',async()=>{const h=harness(async()=>{throw Error('save unavailable');});await h.flush();h.button('创建项目').props.onClick();await h.flush();assert(h.alerts().includes('save unavailable'));h.button('从表单重置 JSON').props.onClick();await h.flush();assert(h.alerts().includes('save unavailable'));assert.equal(h.submitted(),1);});
test('clearing the local GPU field saves zero GPU grants while malformed text blocks creation',async()=>{
 let saved;
 const h=harness(async value=>{saved=value;});
 await h.flush();
 const gpu=()=>h.find(n=>n.props?.['aria-label']==='GPU 编号');
 const json=()=>JSON.parse(h.find(n=>n.props?.['aria-label']==='高级 JSON 授权').props.value);
 for(const value of ['2,,3','GPU 0','-1','9007199254740992','1e2']){
  gpu().props.onChange({target:{value}});
  await h.flush();
  h.button('创建项目').props.onClick();
  await h.flush();
  assert.equal(gpu().props['aria-invalid'],true);
  assert.equal(json().policy.gpus,value);
 }
 assert.equal(h.submitted(),0);
 gpu().props.onChange({target:{value:''}});
 await h.flush();
 assert.deepEqual(json().policy.gpus,[]);
 h.button('创建项目').props.onClick();
 await h.flush();
 assert.deepEqual(saved,{...spec,policy:{...spec.policy,gpus:[]}});
});

test('first SSH project grants a named scheduler, confirmed workfile, and tool check after explicit save',async()=>{
 let saved;
 const calls=[],h=harness(async value=>{saved=value;},{
  props:{defaults:undefined,resource:{profileId:'selected',profileVersion:2},suggestedSchedulerId:'saved-queue'},
  invoke:async (method,data)=>{
   calls.push({method,data});
   return {setups:[],targets:[],workfile_root:'/confirmed/ssh/workfile',
    schedulers:[{id:'saved-queue',name:'Fixture cluster scheduler',scheduler:'slurm',queue:'debug',queue_targets:false}]};
  },
 });
 await h.flush();
 assert.deepEqual(calls,[{method:'tools.resource.list',data:{resource_id:'ssh:selected',profile_version:2}}]);
 const checkbox=()=>h.find(node=>node.props?.['data-testid']==='project-resource-scheduler');
 assert.equal(checkbox().props.value,'saved-queue');
 assert.equal(checkbox().props.checked,true);
 checkbox().props.onChange({currentTarget:{checked:false}});
 await h.flush();
 assert.equal(checkbox().props.checked,false);
 checkbox().props.onChange({currentTarget:{checked:true}});
 h.button('使用此资源的 workfile 目录').props.onClick();
 h.find(node=>node.props?.['aria-label']==='项目名称').props.onChange({target:{value:'First scientific tool'}});
 await h.flush();
 const engine=h.find(node=>node.type==='label'&&h.text(node)==='工具安装与最小测试').props.children[0];
 engine.props.onChange({target:{checked:true}});
 await h.flush();
 assert.equal(h.submitted(),0);
 h.button('创建项目').props.onClick();
 await h.flush();
 assert.equal(h.submitted(),1);
 assert.deepEqual(saved.policy.clusters,['saved-queue']);
 assert.deepEqual(saved.policy.input_roots,['/confirmed/ssh/workfile']);
 assert.deepEqual(saved.policy.environments,[]);
 assert(saved.policy.engines.includes('installation.check'));
});
