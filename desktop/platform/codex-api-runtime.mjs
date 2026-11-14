// AIMatterLab-owned Codex profile for custom APIs. User Codex homes and authentication are never read.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {codexRuntime} from './codex-runtime.mjs';
import {agentEnvironment} from './agent-environment.mjs';
import {prepareIsolation,bootstrapSkills} from './codex-isolation.mjs';
import {projectModelCatalog} from './codex-model-ceiling.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export function codexApiHome(root,endpoint){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('A main-owned absolute API profile root is required');
 const home=path.join(root,'compatible-codex',sha(endpoint),'home');
 let current=path.parse(home).root;
 for(const segment of path.relative(current,home).split(path.sep)){
  current=path.join(current,segment);
  if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Custom API profile must be an unlinked directory');}
  else fs.mkdirSync(current,{mode:0o700});
 }
 const identity=value=>process.platform==='win32'?value.toLowerCase():value;
 if(identity(fs.realpathSync(home))!==identity(path.resolve(home)))throw Error('Custom API profile identity changed');
 return home;
}
export function prepareApiModelCeiling(directory,instructions,credential){
 // No unverified model context/usage numbers are advertised. The gateway owns the
 // user-selected upstream reasoning parameter; Codex does not invent an enum for it.
 const catalog=projectModelCatalog({models:[{slug:credential.model,display_name:credential.label||credential.model,description:'User-configured custom API model',default_reasoning_level:null,supported_reasoning_levels:[],input_modalities:['text'],visibility:'list',supported_in_api:true,priority:0,supports_reasoning_summary_parameter:false,default_reasoning_summary:'none',support_verbosity:false,default_verbosity:null,truncation_policy:{mode:'tokens',limit:10000}}]},instructions);
 const bytes=Buffer.from(JSON.stringify(catalog)),file=path.join(directory,'studio-model-capabilities.json');
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 return {path:file,sha256:sha(bytes),models:[credential.model],policy:'User-configured custom API; native execution and instruction discovery disabled'};
}
export function createCodexApiRuntime({home,credential,gateway,runtime=codexRuntime}){
 const environment=(options={},secret=false)=>{
  const env={...agentEnvironment(null),CODEX_HOME:home};
  if(secret)env.STUDIO_COMPATIBLE_API_KEY=gateway.apiKey;
  if(typeof options.env?.GSS_MCP_TOKEN==='string')env.GSS_MCP_TOKEN=options.env.GSS_MCP_TOKEN;
  return {...options,env};
 };
 const execute=(file,args,options)=>runtime.execute(file,args,environment(options));
 const spawnProcess=(file,args,options)=>runtime.spawnProcess(file,args,environment(options,true));
 const expected={name:'AIMatterLab custom API',base_url:gateway.baseUrl,env_key:'STUDIO_COMPATIBLE_API_KEY',wire_api:'responses',requires_openai_auth:false,supports_websockets:false};
 const modelConfig={model:credential.model,model_provider:'studio_compatible','model_providers.studio_compatible':expected};
 return {...runtime,execute,spawnProcess,
  prepareIsolation:async(file,root,config,worker)=>{
   const isolation=await prepareIsolation(file,root,config,worker,{provider:'compatible',execute,probe:(exe,args,cwd)=>bootstrapSkills(exe,[...args,...runtime.overrideArgs(modelConfig)],cwd,{spawnProcess}),prepareModels:(directory,instructions)=>prepareApiModelCeiling(directory,instructions,credential)});
   return {...isolation,config:{...isolation.config,...modelConfig}};
  },
  verifyIsolation:async(request,isolation,options)=>{
   const summary=await runtime.verifyIsolation(request,isolation,options);
   const {config}=await request('config/read',{includeLayers:false,cwd:isolation.cwd}),provider=config?.model_providers?.studio_compatible;
   if(config?.model_provider!=='studio_compatible'||config.model!==credential.model||!provider||Object.entries(expected).some(([key,value])=>provider[key]!==value)||provider.http_headers&&Object.keys(provider.http_headers).length||provider.env_http_headers&&Object.keys(provider.env_http_headers).length||provider.experimental_bearer_token)throw Error('Effective custom API provider differs');
   return summary;
  }
 };
}
