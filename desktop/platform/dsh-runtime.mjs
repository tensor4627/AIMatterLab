import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {agentEnvironment} from './agent-environment.mjs';

export const DSH_VERSION='0.2.2-rc.1';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const packagedResources=appRoot.endsWith('.asar')?process.resourcesPath:undefined;
const sourcePolicyPath=path.resolve(appRoot,'agent/providers/dsh-policy.mjs');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

/** Only an AIMatterLab-staged, pinned official installation is used; never the user's DSH home. */
export function resolveDshRuntime({resourcesPath=packagedResources,projectRoot=appRoot,executable}={}){
 const roots=resourcesPath?[path.join(resourcesPath,'agent-runtimes','dsh','node_modules')]:[path.join(projectRoot,'.studio','agent-runtimes','dsh','node_modules'),path.join(projectRoot,'node_modules')];
 for(const root of roots){
  const directory=path.join(root,'@deepseek-ai','dsh'),entry=executable||path.join(directory,'lib','bin.js'),manifest=path.join(directory,'package.json');
  if(!fs.existsSync(manifest)||!fs.existsSync(entry))continue;
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(pkg.name!=='@deepseek-ai/dsh'||pkg.version!==DSH_VERSION)throw Error('官方 DeepSeek Harness 版本不匹配；请重新配置 AIMatterLab 的模型运行组件');
  const mcpModule=path.join(root,'@deepseek-ai','dsh-mcp-client','lib','index.js');let toolsModule;
  try{toolsModule=createRequire(fs.realpathSync(mcpModule)).resolve('@deepseek-ai/dsh-tools');}catch{throw Error('官方 DeepSeek Harness 组件不完整；请重新配置模型运行组件');}
  if(!fs.existsSync(mcpModule)||!fs.existsSync(toolsModule))throw Error('官方 DeepSeek Harness 组件不完整；请重新配置模型运行组件');
  return {file:process.execPath,args:['--expose-internals',entry],version:pkg.version,mcpModule:pathToFileURL(mcpModule).href,toolsModule:pathToFileURL(toolsModule).href,policyPath:resourcesPath?path.join(resourcesPath,'studio-dsh','dsh-policy.mjs'):sourcePolicyPath};
 }
 throw Error('尚未配置官方 DeepSeek Harness；请运行 AIMatterLab 配置或重新安装包含模型运行组件的完整包');
}

export function scopedDshWorker(worker){
 if(!worker)return null;
 let url;try{url=new URL(worker.url);}catch{throw Error('A provider-scoped DeepSeek worker is required');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/providers/deepseek'||url.search||url.hash||url.username||url.password||worker.url!==url.origin+url.pathname||typeof worker.tokens?.mcp!=='string'||!worker.tokens.mcp)throw Error('A provider-scoped DeepSeek worker is required');
 return {url:worker.url+'/mcp',context:worker.context||{},token:worker.tokens.mcp};
}

const kernel=[
 ['sdk-app-startup','dsh-sdk-app',{profile:'sdk-minimal'}],
 ['sdk-jsonrpc-server','dsh-sdk-jsonrpc-server',{maxTokensAsSuccess:false}],
 ['deepseek-llm-api-extensions','dsh-deepseek-llm-api-extensions'],
 ['session-log-deepseek','dsh-session-log-deepseek'],
 ['llm-deepseek','dsh-llm-deepseek-api-key',{apiKeyEnv:'DEEPSEEK_API_KEY'}],
 ['sandbox','dsh-sandbox-local'],['filesystem','dsh-fs-local'],
 ['working-directory','dsh-working-directory'],['session-projection','dsh-session-projection'],
 ['token-meter','dsh-token-meter'],['compaction-basic','dsh-compaction-basic'],
 ['timer','@deepseek-ai/cordis-plugin-timer'],['llm','dsh-llm'],['session','dsh-session'],
 ['system-prompt','dsh-system-prompt',{includeHarnessIdentity:false,includeRuntimeContext:false}],
 ['tools','dsh-tools'],['tool-executor-native','dsh-tool-executor-native'],
 ['agent','dsh-agent'],['llm-retry','dsh-llm-retry'],['agent-loop','dsh-agent-loop',{agents:[]}],
 ['session-checkpoint-policy','dsh-session-checkpoint-policy']
];
export function prepareApiDshProfile(root,runtime,worker,instructions,selection){
 if(typeof selection?.profile?.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(selection.profile.id)||!['qwen','compatible'].includes(selection.provider))throw Error('Invalid API runtime provider identity');
 const id=selection.profile.id,route=selection.profile.catalogProvider||'studio-api-'+id,home=path.join(path.resolve(root),'model-providers',id),profile=path.join(home,'profiles','studio'),cwd=path.join(home,'workspace'),sessions=path.join(home,'sessions');
 for(const directory of [profile,cwd,sessions])ownedDirectory(directory);
 const scoped=scopedApiDshWorker(worker,selection.provider);
 const models=selection.profile.models.map(({thinkingFormat,supportsReasoningEffort,supportsDeveloperRole,requiresReasoningContentOnAssistantMessages,requiresThinkingAsText,...model})=>{
  const compat=Object.fromEntries(Object.entries({thinkingFormat,supportsReasoningEffort,supportsDeveloperRole,requiresReasoningContentOnAssistantMessages,requiresThinkingAsText}).filter(([,value])=>value!==undefined));
  return {...model,...Object.keys(compat).length?{compat}:{}};
 });
 const adapterProfile={displayName:selection.profile.name,api:selection.profile.api,baseURL:selection.profile.api==='anthropic-messages'?selection.profile.baseUrl.replace(/\/v1$/,''):selection.profile.baseUrl,apiKeyEnv:'STUDIO_MODEL_API_KEY',models,retryPolicy:{mode:'normal',maxRetries:0},defaultContextWindow:32768,defaultMaxTokens:8192};
 const entries=kernel.filter(([id])=>!['llm-deepseek','deepseek-llm-api-extensions','session-log-deepseek'].includes(id)).map(([id,name,config])=>({id,name:name.startsWith('@')?name:'@deepseek-ai/'+name,...config?{config}:{}}));
 const compaction=entries.find(v=>v.id==='compaction-basic');if(compaction)compaction.config={headroomTokens:2048,maxTokens:4096};
 const adapterPath=path.resolve(path.dirname(runtime.args[1]),'../../../@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
 entries.push({id:'models',name:adapterPath,config:{providers:{[route]:adapterProfile}}});
 entries.push({id:'sessions',name:'@deepseek-ai/dsh-session-persistence-jsonl',config:{root:sessions,compression:'none'}});
 entries.push({id:'studio-policy',name:runtime.policyPath||sourcePolicyPath,inject:['tools','systemPrompt','appReady','llm'],config:{mcpModule:runtime.mcpModule,toolsModule:runtime.toolsModule,workerUrl:scoped?.url||null,workflow:!!scoped?.context.taskId,taskId:scoped?.context.taskId||null,projectId:scoped?.context.projectId||null,modelProvider:route,models:selection.profile.models.map(v=>v.id),instructions}});
 fs.writeFileSync(path.join(home,'cordis.patch.yml'),'[]\n');fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'studio-model-profile',private:true,type:'module',dsh:{profile:{bundles:[]}}}));fs.writeFileSync(path.join(profile,'cordis.patch.yml'),JSON.stringify([{insert:entries}],null,2));
 const env={...agentEnvironment(null),DSH_HOME:home,STUDIO_MODEL_API_KEY:selection.profile.apiKey,GSS_MCP_TOKEN:scoped?.token||'',ELECTRON_RUN_AS_NODE:'1'};
 return {home,cwd,args:['--profile','studio'],env,route};
}
export function scopedApiDshWorker(worker,provider){
 if(!worker)return null;let url;try{url=new URL(worker.url);}catch{throw Error('A provider-scoped API worker is required');}
 if(!['qwen','compatible'].includes(provider)||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/providers/'+provider||url.search||url.hash||url.username||url.password||worker.url!==url.origin+url.pathname||!worker.tokens?.mcp)throw Error('A provider-scoped API worker is required');
 return {url:worker.url+'/mcp',context:worker.context||{},token:worker.tokens.mcp};
}
function ownedDirectory(directory){
 if(!path.isAbsolute(directory))throw Error('A main-owned DSH directory is required');
 let current=path.parse(directory).root;
 for(const part of path.relative(current,directory).split(path.sep)){if(!part)continue;current=path.join(current,part);if(fs.existsSync(current)&&(!fs.lstatSync(current).isDirectory()||fs.lstatSync(current).isSymbolicLink()))throw Error('DSH runtime directories cannot be links');}
 fs.mkdirSync(directory,{recursive:true});
}

/** An affirmative plugin list excludes all shell, file, skill, web and subagent producers. */
export function prepareDshProfile(root,runtime,worker,instructions,selection={}){
 if(!object(runtime)||typeof runtime.mcpModule!=='string'||typeof runtime.toolsModule!=='string'||typeof instructions!=='string')throw Error('Invalid DSH runtime configuration');
 const scoped=scopedDshWorker(worker),home=path.join(path.resolve(root),'deepseek-dsh-v1'),profile=path.join(home,'profiles','studio'),cwd=path.join(home,'workspace'),sessions=path.join(home,'sessions');
 for(const directory of [profile,cwd,sessions])ownedDirectory(directory);
 // The home-level overlay is owned by AIMatterLab as well. No user profile is loaded.
 fs.writeFileSync(path.join(home,'cordis.patch.yml'),'[]\n');
 fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'studio-deepseek-profile',private:true,type:'module',dsh:{profile:{bundles:[]}}},null,2));
 const entries=kernel.map(([id,name,config])=>({id,name:name.startsWith('@')?name:'@deepseek-ai/'+name,...config?{config}:{}}));
 entries.push({id:'sessions',name:'@deepseek-ai/dsh-session-persistence-jsonl',config:{root:sessions,compression:'none'}});
 entries.push({id:'studio-policy',name:runtime.policyPath||sourcePolicyPath,inject:['tools','systemPrompt','appReady','llm'],config:{mcpModule:runtime.mcpModule,toolsModule:runtime.toolsModule,workerUrl:scoped?.url||null,workflow:!!scoped?.context.taskId,taskId:scoped?.context.taskId||null,projectId:scoped?.context.projectId||null,models:selection.models||[],instructions}});
 fs.writeFileSync(path.join(profile,'cordis.patch.yml'),JSON.stringify([{insert:entries}],null,2));
 const env=agentEnvironment('deepseek',{overrides:{DSH_HOME:home,DEEPSEEK_API_KEY:'',DEEPSEEK_BASE_URL:'https://api.deepseek.com/anthropic',GSS_MCP_TOKEN:scoped?.token||'',ELECTRON_RUN_AS_NODE:'1'}});
 return {home,cwd,args:['--profile','studio'],env};
}

export const dshRuntime=Object.freeze({resolve:resolveDshRuntime,prepare:prepareDshProfile,spawn:(file,args,options)=>spawn(file,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,...options})});
