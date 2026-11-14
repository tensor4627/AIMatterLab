import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspect} from 'node:util';
import {CodexBridge,PROTOCOL_VERSION} from '../../agent/providers/codex.mjs';
import {prepareIsolation,ISOLATION_FEATURES,isolationPreparationDiagnostic} from '../../desktop/platform/codex-isolation.mjs';
import {prepareModelCeiling} from '../../desktop/platform/codex-model-ceiling.mjs';

const sentinel='PRIVATE_PATH_TOKEN_AND_INSTRUCTIONS_MUST_NOT_ESCAPE';
function directory(t){const base=process.env.STUDIO_CODEX_FIX_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'studio-codex-preparation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const publicModel=()=>({slug:'synthetic-model',display_name:'Synthetic public model',supported_reasoning_levels:[],input_modalities:['text'],model_messages:{instructions_template:sentinel,persistent_instructions:sentinel}});
function fixture(t,{problem}={}){
 const root=directory(t),cache=path.join(root,'public-cache.json'),calls=[];
 if(problem!=='missing_cache')fs.writeFileSync(cache,problem==='malformed_cache'?'invalid '+sentinel:JSON.stringify({models:[{...publicModel(),...problem==='unknown_capability'?{unreviewed_native_tool:sentinel}:{}}]}));
 const dependencies={
  execute:async(_executable,args)=>{
   calls.push(args[0]);
   if(problem==='features_failed'&&args[0]==='features'||problem==='mcp_failed'&&args[0]==='mcp')throw Object.assign(Error(sentinel),{stderr:sentinel,stdout:sentinel});
   if(args[0]==='features')return {stdout:[...ISOLATION_FEATURES.filter(key=>problem!=='missing_feature'||key!=='shell_tool'),'skip_host_skill_discovery'].map(key=>key+' stable true').join('\n')};
   return {stdout:problem==='mcp_invalid'?'{}':'[]'};
  },
  prepareModels:target=>{calls.push('model_catalog');return prepareModelCeiling(target,'Public AIMatterLab only',{cachePath:cache});},
  probe:async()=>{calls.push('skill_bootstrap');if(problem==='skill_failed')throw Object.assign(Error(sentinel),{stderr:sentinel});return [];}
 };
 const bridge=new CodexBridge({strictIsolation:true,isolationRoot:path.join(root,'owned'),host:{
  execute:async()=>({stdout:'codex-cli 0.167.0-alpha.3.2'}),
  prepareIsolation:(executable,owned,config,worker)=>prepareIsolation(executable,owned,config,worker,dependencies),
  spawnProcess:()=>{calls.push('final_spawn');throw Error('Preparation failures must never spawn the final server');}
 }});
 t.after(()=>bridge.close());return {root,cache,calls,bridge,dependencies};
}

for(const [problem,failure,step,expected] of [
 ['features_failed','capability_probe_failed','capabilities',['features']],
 ['missing_feature','required_isolation_controls_missing','capabilities',['features']],
 ['mcp_failed','offline_mcp_probe_failed','mcp_inventory',['features','mcp']],
 ['mcp_invalid','offline_mcp_inventory_invalid','mcp_inventory',['features','mcp']],
 ['missing_cache','model_metadata_missing','model_catalog',['features','mcp','model_catalog']],
 ['malformed_cache','model_metadata_invalid','model_catalog',['features','mcp','model_catalog']],
 ['unknown_capability','model_catalog_schema_unsupported','model_catalog',['features','mcp','model_catalog']],
 ['skill_failed','skill_bootstrap_failed','skill_inventory',['features','mcp','model_catalog','skill_bootstrap']]
])test('preparation failure is actionable and never exposes the underlying cause: '+problem,async t=>{
 const f=fixture(t,{problem});
 await assert.rejects(f.bridge.start('controlled-cli'),error=>{
  assert.equal(error.code,'STUDIO_CODEX_COMPATIBILITY_FAILED');assert.equal(error.stage,'isolation_prepare');
  assert.equal(error.failure,failure);assert.equal(error.preparationStep,step);assert.equal(error.expectedVersion,PROTOCOL_VERSION);assert.equal(error.installedVersion,'0.167.0-alpha.3.2');
  assert.equal(error.cause,undefined);assert(!inspect(error).includes(sentinel));assert(!JSON.stringify(error).includes(sentinel));assert.match(error.message,/会话和计算流程仍保留/);return true;
 });
 assert.deepEqual(f.calls,expected);assert.equal(f.bridge.isolationReady,false);assert.equal(f.bridge.process??null,null);assert.equal(f.bridge.compatibility,null);
});

test('a valid newer CLI prepares the same restrictive model ceiling without changing the source cache',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.cache),isolation=await prepareIsolation('controlled-cli',path.join(f.root,'successful'),{},undefined,f.dependencies);
 assert(fs.readFileSync(f.cache).equals(before));assert.equal(isolation.config['features.shell_tool'],false);assert.equal(isolation.config['features.multi_agent'],false);
 const projected=JSON.parse(fs.readFileSync(isolation.catalog.path,'utf8')).models[0];
 assert.equal(projected.shell_type,'disabled');assert.equal(projected.tool_mode,'direct');assert.deepEqual(projected.experimental_supported_tools,[]);assert.equal(projected.node_repl_disabled,true);assert(!JSON.stringify(projected).includes(sentinel));
});

test('metadata snapshot write failure is classified without overwriting an existing owned file',t=>{
 const root=directory(t),cache=path.join(root,'cache.json'),output=path.join(root,'studio-model-capabilities.json');fs.writeFileSync(cache,JSON.stringify({models:[publicModel()]}));fs.writeFileSync(output,'preserve-existing');
 assert.throws(()=>prepareModelCeiling(root,'Public only',{cachePath:cache}),error=>error.code==='STUDIO_CODEX_MODEL_METADATA'&&error.failure==='model_snapshot_write_failed');assert.equal(fs.readFileSync(output,'utf8'),'preserve-existing');
});

test('only a bounded known preparation category can become a user diagnostic',()=>{
 for(const error of [{code:'STUDIO_CODEX_MODEL_METADATA',failure:sentinel},{code:'untrusted',failure:'model_metadata_missing'},Error(sentinel)])assert.equal(isolationPreparationDiagnostic(error),null);
 assert.deepEqual(isolationPreparationDiagnostic({code:'STUDIO_CODEX_MODEL_METADATA',failure:'model_metadata_missing',message:sentinel,step:sentinel}),{failure:'model_metadata_missing',step:'model_catalog',hint:'当前账户缺少公开模型目录；请先在官方 Codex 中刷新模型列表，再明确重连'});
});
