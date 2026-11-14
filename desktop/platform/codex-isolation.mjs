// Process-local Codex capability isolation. Never writes user config or copies authentication.
import fs from 'node:fs';
import {STUDIO_VERSION} from './studio-version.mjs';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {prepareModelCeiling,assertModelCeiling,verifiedModel}from'./codex-model-ceiling.mjs';
import {agentEnvironment} from './agent-environment.mjs';
const exec=promisify(execFile),object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const PREPARATION_FAILURES=Object.freeze({
 isolation_preferences_invalid:['preferences','请检查 Studio 中的上下文与压缩预算，再明确重连'],
 isolation_directory_unavailable:['directory','无法创建独立会话目录；请检查 Studio 数据目录权限，再明确重连'],
 capability_probe_failed:['capabilities','无法读取所选 CLI 的隔离能力；请检查 CLI 是否可启动，再明确重连'],
 required_isolation_controls_missing:['capabilities','所选 CLI 缺少必需隔离控制；请检查受支持的 CLI，再明确重连'],
 offline_mcp_probe_failed:['mcp_inventory','无法安全读取本机 MCP 清单；请检查所选 CLI 的配置，再明确重连'],
 offline_mcp_inventory_invalid:['mcp_inventory','本机 MCP 清单格式无法安全识别；请检查所选 CLI 的配置，再明确重连'],
 model_metadata_location_unavailable:['model_catalog','无法确定公开模型目录位置；请检查当前 Windows 账户及 CODEX_HOME，再明确重连'],
 model_metadata_missing:['model_catalog','当前账户缺少公开模型目录；请先在官方 Codex 中刷新模型列表，再明确重连'],
 model_metadata_unreadable:['model_catalog','无法读取公开模型目录；请检查当前账户和目录权限，再明确重连'],
 model_metadata_invalid:['model_catalog','公开模型目录损坏或不是安全的常规文件；请在官方 Codex 中刷新模型列表，再明确重连'],
 model_metadata_changed:['model_catalog','公开模型目录正在变化；请待官方 Codex 刷新完成后明确重连'],
 model_catalog_schema_unsupported:['model_catalog','公开模型能力格式尚未适配；请保留当前 CLI 和模型目录信息供检查，不会放宽工具权限'],
 model_snapshot_write_failed:['model_catalog','无法保存独立模型能力快照；请检查 Studio 数据目录权限，再明确重连'],
 model_snapshot_changed:['model_catalog','独立模型能力快照已变化；请明确重连以重新核验'],
 model_metadata_unavailable:['model_catalog','无法准备公开模型能力；请检查模型目录与 Studio 数据目录，再明确重连'],
 skill_bootstrap_failed:['skill_inventory','所选 CLI 未能完成受限技能清单检查；请检查 CLI 配置与隔离能力，再明确重连'],
 worker_endpoint_unscoped:['worker_endpoint','当前工具地址不是受限的 Studio 连接；请重新核对当前计算资源，再明确重连']
});
export function isolationPreparationDiagnostic(error){
 if(!['STUDIO_CODEX_ISOLATION_PREPARATION','STUDIO_CODEX_MODEL_METADATA'].includes(error?.code)||!Object.hasOwn(PREPARATION_FAILURES,error.failure))return null;
 const [step,hint]=PREPARATION_FAILURES[error.failure];return {failure:error.failure,step,hint};
}
function preparationError(failure,message){const error=Error(message);error.code='STUDIO_CODEX_ISOLATION_PREPARATION';error.failure=failure;return error;}
export const ISOLATION_FEATURES=['apps','plugins','remote_plugin','plugin_sharing','recommended_plugins','tool_suggest','code_mode','code_mode_host','code_mode_tool_search','code_mode_only','code_mode_only_strict_3p_tools','code_mode_prewarm','shell_tool','shell_snapshot','unified_exec','unified_exec_tty','browser_annotation_api','browser_use','browser_use_external','browser_use_full_cdp_access','computer_use','image_generation','in_app_browser','memories','external_agent_memory_import','guardian_conversation_history_tools','multi_agent','multi_agent_v2','multi_agent_v2_dynamic_tools','agent_message_board','workspace_dependencies','artifact','skill_search','skill_mcp_dependency_install','hooks','view_image','context_management','goals','sleep_tool','request_permissions_tool'];
const PUBLIC_INSTRUCTIONS='You are GPU Sampling Studio. Use the explicit conversation inputs and only the Studio scientific MCP tools. Do not discover other MCP resources; recover argument errors using the tool response and its legal Studio call.';
const canonical=p=>{const value=path.resolve(p).replaceAll('\\','/');return process.platform==='win32'?value.toLowerCase():value;};
export function toml(value){if(typeof value==='string')return JSON.stringify(value);if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return String(value);if(Array.isArray(value))return '['+value.map(toml).join(',')+']';if(object(value))return '{ '+Object.entries(value).map(([k,v])=>JSON.stringify(k)+' = '+toml(v)).join(',')+' }';throw Error('Unsupported isolated configuration value');}
export const overrideArgs=value=>Object.entries(value).flatMap(([key,v])=>['-c',key+'='+toml(v)]);
function unlinked(directory){if(!path.isAbsolute(directory))throw Error('A main-owned absolute isolation root is required');let current=path.parse(directory).root;for(const part of path.relative(current,directory).split(path.sep)){if(!part)continue;current=path.join(current,part);if(fs.existsSync(current)&&(!fs.lstatSync(current).isDirectory()||fs.lstatSync(current).isSymbolicLink()))throw Error('Isolation root must be an unlinked directory');}fs.mkdirSync(directory,{recursive:true});if(canonical(fs.realpathSync(directory))!==canonical(directory))throw Error('Isolation root identity changed');}
export function ownedDirectory(root){unlinked(root);const directory=fs.mkdtempSync(path.join(root,'context-')),cwd=path.join(directory,'workspace'),instructions=path.join(directory,'studio-instructions.md');fs.mkdirSync(cwd);fs.writeFileSync(instructions,PUBLIC_INSTRUCTIONS,{flag:'wx'});return {directory,cwd,instructions};}
export function ambientOverrides(entries,disabledCommand){if(!Array.isArray(entries)||entries.length>256)throw Error('Invalid offline MCP inventory');const result={};for(const entry of entries){if(!object(entry)||typeof entry.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(entry.name)||entry.name==='gpusampling'||!object(entry.transport))throw Error('Ambiguous or reserved ambient MCP identity');const prefix='mcp_servers.'+entry.name;if(entry.transport.type==='stdio'){result[prefix+'.command']=disabledCommand;result[prefix+'.args']=[];}else if(['streamable_http','http'].includes(entry.transport.type))result[prefix+'.url']='http://127.0.0.1:9/studio-disabled';else throw Error('Unsupported ambient MCP transport');result[prefix+'.enabled']=false;}return result;}
export function isolationConfiguration(owned,ambient,paths=[]){const config={...ambient,project_doc_max_bytes:0,project_doc_fallback_filenames:[],model_instructions_file:owned.instructions,instructions:'',developer_instructions:'',include_environment_context:false,include_permissions_instructions:false,include_apps_instructions:false,include_collaboration_mode_instructions:false,notify:[],'memories.use_memories':false,'memories.generate_memories':false,web_search:'disabled','apps._default.enabled':false,'features.skip_host_skill_discovery':true,'skills.config':paths.map(p=>({path:p,enabled:false}))};for(const key of ISOLATION_FEATURES)config['features.'+key]=false;return config;}
function skillPaths(value){if(!Array.isArray(value?.data)||value.data.length>16)throw Error('Malformed native skill inventory');const result=[];for(const entry of value.data){if(!Array.isArray(entry.skills)||entry.skills.length>1024)throw Error('Malformed native skill inventory');for(const skill of entry.skills){if(typeof skill.path!=='string'||!path.isAbsolute(skill.path))throw Error('Ambiguous native skill path');result.push(skill.path);if(/SKILL\.(md|json)$/i.test(skill.path))result.push(path.dirname(skill.path));}}return [...new Set(result)];}
export async function bootstrapSkills(executable,args,cwd,{spawnProcess=spawn}={}){const child=spawnProcess(executable,['app-server','--listen','stdio://',...args],{cwd,env:agentEnvironment('codex'),stdio:['pipe','pipe','pipe'],windowsHide:true});if(typeof child.stdin?.on==='function')child.stdin.on('error',()=>{});const pending=new Map();let next=0;const reader=createInterface({input:child.stdout});child.stderr.on('data',()=>{});const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Isolated bootstrap disconnected'));}pending.clear();};child.on('error',fail);child.on('exit',fail);reader.on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('Isolated bootstrap RPC rejected')):p.resolve(m.result);}});const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated bootstrap timed out'));},20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});try{await request('initialize',{clientInfo:{name:'gpu_sampling_studio_isolation',version:STUDIO_VERSION}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');return skillPaths(await request('skills/list',{cwds:[cwd],forceReload:true}));}finally{child.kill();reader.close();for(const p of pending.values())clearTimeout(p.timer);}}
export function checkedClientConfig(value={}){if(!object(value)||Object.keys(value).some(k=>!['features.shell_tool','features.unified_exec','model_context_window','model_auto_compact_token_limit'].includes(k)))throw Error('Only Studio token-budget configuration is accepted in isolation');for(const [k,v]of Object.entries(value))if(k.startsWith('features.')?v!==false:!Number.isSafeInteger(v)||v<1024)throw Error('Invalid Studio isolation preference');return {...value};}
export async function prepareIsolation(executable,root,baseConfig={},worker,{execute=exec,probe=bootstrapSkills,prepareModels=prepareModelCeiling,provider='codex'}={}){
 if(!['codex','compatible'].includes(provider))throw preparationError('worker_endpoint_unscoped','A scoped Studio provider is required');
 try{baseConfig=checkedClientConfig(baseConfig);}catch{throw preparationError('isolation_preferences_invalid','Only Studio token-budget configuration is accepted in isolation');}
 let owned;try{owned=ownedDirectory(root);}catch{throw preparationError('isolation_directory_unavailable','Cannot create the owned Studio isolation directory');}
 const options={cwd:owned.cwd,env:agentEnvironment('codex'),windowsHide:true,timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']};
 let raw;try{raw=await execute(executable,['features','list'],options);if(typeof raw?.stdout!=='string')throw Error();}catch{throw preparationError('capability_probe_failed','Cannot inspect selected Codex capabilities');}
 const known=new Set(raw.stdout.split(/\r?\n/).map(line=>line.trim().split(/\s+/)[0]));
 if([...ISOLATION_FEATURES,'skip_host_skill_discovery'].some(key=>!known.has(key)))throw preparationError('required_isolation_controls_missing','Installed Codex lacks required isolation controls');
 let entries;try{entries=JSON.parse((await execute(executable,['mcp','list','--json'],options)).stdout);}catch{throw preparationError('offline_mcp_probe_failed','Cannot inspect offline MCP names safely');}
 let ambient;try{ambient=ambientOverrides(entries,path.join(owned.directory,'disabled-server-never-execute'));}catch{throw preparationError('offline_mcp_inventory_invalid','Cannot safely interpret offline MCP names');}
 let catalog;try{catalog=prepareModels(owned.directory,PUBLIC_INSTRUCTIONS);}catch(error){if(isolationPreparationDiagnostic(error))throw error;throw preparationError('model_metadata_unavailable','Cannot prepare public Codex model capabilities');}
 const bootstrap={...isolationConfiguration(owned,ambient),model_catalog_json:catalog.path};
 let paths;try{paths=await probe(executable,overrideArgs({...baseConfig,...bootstrap}),owned.cwd);}catch{throw preparationError('skill_bootstrap_failed','Isolated native skill inventory bootstrap failed');}
 const config={...isolationConfiguration(owned,ambient,paths),model_catalog_json:catalog.path};
 if(worker){
  let endpoint;try{endpoint=new URL(worker.url);}catch{throw preparationError('worker_endpoint_unscoped','A scoped Studio loopback worker is required');}
  const scope='/providers/'+provider;
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.username||endpoint.password||endpoint.pathname!==scope||worker.url!==endpoint.origin+scope||endpoint.search||endpoint.hash||typeof worker.tokens?.mcp!=='string')throw preparationError('worker_endpoint_unscoped','A scoped Studio loopback worker is required');
  config['mcp_servers.gpusampling.enabled']=true;config['mcp_servers.gpusampling.url']=worker.url+'/mcp';config['mcp_servers.gpusampling.bearer_token_env_var']='GSS_MCP_TOKEN';
 }
 return {...owned,catalog,config,worker:worker?{url:worker.url}:null,ambientCount:entries.length,nativeSkillPathCount:paths.length};
}
function field(config,key){return key.split('.').reduce((v,k)=>v?.[k],config);}
export function assertEffectiveConfiguration(config,isolation){if(!object(config)||ISOLATION_FEATURES.some(key=>config.features?.[key]!==false)||config.features?.skip_host_skill_discovery!==true||config.project_doc_max_bytes!==0||config.web_search!=='disabled'||config.memories?.use_memories!==false||canonical(config.model_instructions_file||'')!==canonical(isolation.instructions)||config.instructions!==''||config.developer_instructions!==''||['include_environment_context','include_permissions_instructions','include_apps_instructions','include_collaboration_mode_instructions'].some(key=>config[key]!==false)||!Array.isArray(config.notify)||config.notify.length!==0)throw Error('Effective Codex isolation controls do not match');if(isolation.catalog){assertModelCeiling(isolation.catalog);if(canonical(config.model_catalog_json||'')!==canonical(isolation.catalog.path))throw Error('Effective model capability snapshot differs');}if(!object(config.mcp_servers))throw Error('Effective MCP configuration is unavailable');for(const [name,value]of Object.entries(config.mcp_servers)){if(name==='gpusampling'&&isolation.worker){if(value.enabled!==true||value.url!==isolation.worker.url+'/mcp'||value.command||value.bearer_token_env_var!=='GSS_MCP_TOKEN')throw Error('Effective Studio MCP endpoint differs');}else if(value.enabled!==false)throw Error('An ambient MCP server is still enabled');}if(isolation.worker&&config.mcp_servers.gpusampling?.enabled!==true)throw Error('Studio MCP server missing');}
function knownFields(params,allowed){if(!object(params)||Object.keys(params).some(key=>!allowed.includes(key)))throw Error('Unknown native request override is unavailable in Studio isolation');}
function textInputs(input){if(!Array.isArray(input)||input.some(item=>!object(item)||item.type!=='text'||typeof item.text!=='string'||Object.keys(item).some(key=>!['type','text','text_elements'].includes(key))||item.text_elements!==undefined&&(!Array.isArray(item.text_elements)||item.text_elements.length)))throw Error('Studio isolation accepts only main-authorized text inputs');return input.map(item=>({type:'text',text:item.text,...item.text_elements!==undefined?{text_elements:[]}:{} }));}
export function constrainedRequest(method,params,isolation){
 if(['thread/start','thread/resume'].includes(method)){
  if(params.path!==undefined||params.history!==undefined||params.dynamicTools!==undefined)throw Error('Unscoped native history/tools are unavailable');
  knownFields(params,['threadId','model','serviceTier','cwd','approvalPolicy','approvalsReviewer','sandbox','config','serviceName','baseInstructions','developerInstructions','personality','ephemeral','sessionStartSource','threadSource','excludeTurns']);
  return {...params,...isolation.catalog?{model:verifiedModel(params.model,isolation)}:{},cwd:isolation.cwd,sandbox:'read-only',config:{...checkedClientConfig(params.config),...isolation.config}};
 }
 if(method==='turn/start'||method==='turn/steer'){
  if(params.toolOutput!==undefined)throw Error('Studio isolation accepts only main-authorized text inputs');
  const input=textInputs(params.input);
  knownFields(params,method==='turn/steer'?['threadId','clientUserMessageId','input','expectedTurnId']:['threadId','disabledPluginIds','clientUserMessageId','input','turnTrigger','cwd','approvalPolicy','approvalsReviewer','sandboxPolicy','model','serviceTier','serviceTierForTurn','effort','summary','personality','outputSchema']);
  return method==='turn/steer'?{...params,input}:{...params,input,...isolation.catalog?{model:verifiedModel(params.model,isolation)}:{},cwd:isolation.cwd,sandboxPolicy:{type:'readOnly',networkAccess:false}};
 }
 if(/^(command|fs|process|config\/.*write|externalAgentConfig|skills\/config\/write|mcpServer\/tool\/call|mcpServer\/resource\/read)/.test(method))throw Error('Native privileged RPC is unavailable in Studio isolation');return params;
}
export function assertInstructionSources(response,isolation){if(response?.cwd!==undefined&&canonical(response.cwd)!==canonical(isolation.cwd)||!Array.isArray(response?.instructionSources)||response.instructionSources.some(p=>canonical(p)!==canonical(isolation.instructions)))throw Error('Unexpected native instruction source');}
export async function verifyIsolation(request,isolation,{threadId}={}){
 const config=(await request('config/read',{includeLayers:false,cwd:isolation.cwd})).config;assertEffectiveConfiguration(config,isolation);if(isolation.catalog)isolation.defaultModel=config.model;
 const skills=await request('skills/list',{cwds:[isolation.cwd],forceReload:true});skillPaths(skills);if(skills.data.some(entry=>entry.skills.some(skill=>skill.enabled!==false)))throw Error('Native skills remain enabled');
 let cursor=null,count=0,studioTools=0;const warnings=new Set();
 for(let page=0;page<8;page++){
  const value=await request('mcpServerStatus/list',{limit:100,detail:'full',...cursor?{cursor}:{},...threadId?{threadId}:{}});if(!Array.isArray(value?.data))throw Error('Invalid effective MCP inventory');
  for(const server of value.data){
   const tools=Object.keys(server.tools||{}),resources=[...(server.resources||[]),...(server.resourceTemplates||[])];
   if(server.name!=='gpusampling'||!isolation.worker){if(tools.length||resources.length)throw Error('Unscoped MCP capabilities are exposed');}
   else{if(resources.length)throw Error('Unscoped Studio MCP resources are exposed');if(server.toolsError)warnings.add('studio_tool_inventory_unavailable');if(threadId&&Object.hasOwn(server,'runtimeStatus')&&server.runtimeStatus!=='connected')warnings.add('studio_tool_runtime_unavailable');studioTools+=tools.length;}
   count++;
  }
  cursor=value.nextCursor;if(!cursor){if(isolation.worker&&!studioTools)warnings.add('studio_tool_inventory_unavailable');return {status:'verified',ambientServersDisabled:isolation.ambientCount,nativeSkillsEnabled:0,studioTools,servers:count,...warnings.size?{warnings:[...warnings]}:{}};}
 }
 throw Error('MCP inventory exceeds bounded verification');
}
