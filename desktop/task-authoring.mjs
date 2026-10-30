import {linuxPath} from './security.mjs';
import {normalizeSteps,parameterValue} from '../shared/task-fields.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import {actualAuthoringWorker,assertTaskWorker,sameWorkerBinding,taskWorkerSource} from '../shared/task-worker-binding.mjs';
export function explicitStructures(text=''){
 const result=[];const patterns=[/["`']([A-Za-z]:[\\/][^"`'\r\n]+\.(?:extxyz|xyz|cif|pdb|vasp)|\/[^"`'\r\n]+\.(?:extxyz|xyz|cif|pdb|vasp))["`']/gi,/(?<![\w:/])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:mnt|home|tmp|data)\/)[^\s"`'<>]+\.(?:extxyz|xyz|cif|pdb|vasp)\b/gi];
 patterns.push(/["`']([A-Za-z]:[\\/][^"`'\r\n]+[\\/]POSCAR|\/(?!\/)[^"`'\r\n]+\/POSCAR)["`']/gi,/(?<![\w:/])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:mnt|home|tmp|data)\/)[^\s"`'<>]*[\\/]POSCAR\b/gi);
 for(const regex of patterns)for(const match of text.matchAll(regex)){const path=linuxPath(match[1]||match[0]);if(!result.includes(path))result.push(path);}
 return result.slice(0,16);
}
// Only paths explicitly present in the human request; no directory grants or inferred filenames.
export function explicitScientificInputs(text=''){
 const found=[];
 const quoted=/["`']((?:[A-Za-z]:[\\/](?![\\/])|\/(?!\/))[^"`'\r\n]+\.(?:extxyz|xyz|cif|pdb|vasp|txt|pt|pt2|pth|ckpt|yaml|yml|json|in|py|toml|dat|out))["`']/gi;
 const bare=/(?<![\w:/])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:mnt|home|tmp|data)\/)[^\s"`'<>]+\.(?:extxyz|xyz|cif|pdb|vasp|txt|pt|pt2|pth|ckpt|yaml|yml|json|in|py|toml|dat|out)\b/gi;
 const poscarQuoted=/["`']((?:[A-Za-z]:[\\/](?![\\/])|\/(?!\/))[^"`'\r\n]+[\\/]POSCAR)["`']/gi;
 const poscarBare=/(?<![\w:/])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:mnt|home|tmp|data)\/)[^\s"`'<>]*[\\/]POSCAR\b/gi;
 for(const regex of [quoted,bare,poscarQuoted,poscarBare])for(const match of text.matchAll(regex)){
  const previous=text.slice(Math.max(0,match.index-100),match.index).split(/[\n。；;，,]/).at(-1)||'';
  if(/(?:不要|别|禁止|勿|不(?:要)?(?:读取|导入|访问|使用)|do\s+not|don['’]t|never|without\s+(?:reading|importing|accessing))/i.test(previous))continue;
  try{const value=linuxPath(match[1]||match[0]);if(/\.out$/i.test(value)&&(value.split('/').some(part=>part.toLowerCase()==='skills')||/^\.[A-Za-z0-9_-]/.test(text.slice(match.index+match[0].length))))continue;if(!found.includes(value))found.push(value);}catch{}
 }
 return found.slice(0,32);
}
// Only desktop-recorded human file edits authorize importing an external asset.
export function selectedInputs(task){
 const fields=normalizeSteps(task.steps||[],task.parameters||{},[]).flatMap(step=>step.fields||[]),selected=[];
 for(const field of fields){
  const receipt=task.manualInputs?.[field.key],value=parameterValue(task.parameters,field.key);
  if(!receipt||receipt.type!==field.type||!['file','files'].includes(field.type)||JSON.stringify(receipt.value)!==JSON.stringify(value))continue;
  const values=field.type==='files'?value:[value];if(!Array.isArray(values))continue;
  for(const source of values){if(typeof source!=='string'||!source||!receipt.approvedValues?.includes(source))continue;try{selected.push({key:field.key,source,path:linuxPath(source)});}catch{}}
 }
 if(selected.length>64)throw Error('Too many selected scientific input files');return selected;
}
export async function ensureTaskAuthoring(records,worker,{provider,threadId,taskId,text='',guidance='',allowExplicitInputs=true,assertCurrent=()=>{}}){
 const task=taskId?records.read(taskId):records.bound(provider,threadId);if(!task)return null;
 if(task.provider!==provider||task.threadId!==threadId||records.deleted(provider,threadId))throw Error('Invalid authoring conversation');
 if(!worker.connection)throw Error('请先连接 WSL 作业服务，工作台会自动建立草稿项目；无需填写技术路径。');
 if(task.authoring?.projectId&&!taskWorkerSource(task))throw Error('旧草稿缺少服务来源，请使用“连接并关联此草稿”确认原服务后继续。');
 const connection=worker.connection,epoch=worker.connectionEpoch,identity=actualAuthoringWorker(worker),scope=value=>[value?.projectId,value?.environmentId,value?.inputRoot,value?.workerBinding];let expectedAuthoring=scope(task.authoring);
 const guard=()=>{assertCurrent();const latest=records.read(task.id);if(worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(identity,actualAuthoringWorker(worker))||latest.provider!==provider||latest.threadId!==threadId||records.deleted(provider,threadId)||records.bound(provider,threadId)?.id!==task.id||latest.workspace?.id!==task.workspace?.id||latest.workspaceChoice!==task.workspaceChoice||!equal(scope(latest.authoring),expectedAuthoring))throw Error('流程来源或连接已变化，请核对原流程；本次结果未关联到新上下文。');assertTaskWorker(latest,worker);if(latest.authoring?.workerBinding&&!sameWorkerBinding(latest.authoring.workerBinding,worker))throw Error('请恢复此流程原始编写服务，不能替换来源。');};
 const request=async(...args)=>{guard();const value=await worker.request(...args);guard();return value;};guard();
 const selections=selectedInputs(task);
 const approved=[...new Set([...(task.authoring?.pendingInputs||[]),...selections.map(value=>value.path),...(allowExplicitInputs?explicitScientificInputs(text):[])])],pending=task.workspaceChoice==='pending';
 const context=await request('POST','/api/authoring/context',{workspace_id:task.id,project_id:task.authoring?.projectId||task.projectId||records.conversation(provider,threadId)?.projectId,name:task.name,structure_paths:!pending&&!task.workspace&&allowExplicitInputs?explicitStructures(text).filter(path=>explicitScientificInputs(text).includes(path)):[],selected_paths:!pending&&!task.workspace?approved:[]});
 if(task.workspace&&!pending){for(const source of approved){if(source.startsWith(task.workspace.root.replace(/\/$/,'')+'/')){const read=await request('POST','/api/workspace/read',{project_id:task.workspace.id,name:source});const previous=(task.authoring?.imports||[]).find(a=>a.path===source&&a.mode==='link');if(previous&&read.sha256!==previous.sha256)throw Error('链接源文件内容已变化，请重新检查当前资产');context.imports.push({source,path:source,sha256:read.sha256,status:'passed',scope:'Already owned workspace input; no additional copy'});continue;}const asset=await request('POST','/api/studio-workspace/import',{project_id:task.workspace.id,source,mode:task.workspace.asset_mode||'copy',engine:task.parameters.engine,role:/\.(xyz|extxyz|cif|pdb|vasp)$/i.test(source)?'structure':/\.(pt|pt2|pth|ckpt|txt)$/i.test(source)?'model':'input'});context.imports.push({...asset,status:'passed'});}}

 const latest=records.read(task.id),mapping=new Map((context.imports||[]).filter(value=>value.status==='passed').map(value=>[value.source,value.path])),changes={};
 for(const key of new Set(selections.map(value=>value.key))){
  const value=parameterValue(latest.parameters,key),owned=selections.filter(item=>item.key===key),receipt=latest.manualInputs?.[key];
  if(!receipt||JSON.stringify(receipt.value)!==JSON.stringify(value))continue;
  const replace=source=>{const item=owned.find(item=>item.source===source);return item&&mapping.has(item.path)?mapping.get(item.path):source;};
  const next=Array.isArray(value)?value.map(replace):replace(value);if(JSON.stringify(value)!==JSON.stringify(next))changes[key]=next;
 }
 for(const field of normalizeSteps(latest.steps||[],latest.parameters||{},[]).flatMap(step=>step.fields||[])){const value=parameterValue(latest.parameters,field.key);if(field.type==='file'&&mapping.has(value)&&mapping.get(value)!==value)changes[field.key]=mapping.get(value);if(field.type==='files'&&Array.isArray(value)&&value.some(source=>mapping.has(source)&&mapping.get(source)!==source))changes[field.key]=value.map(source=>mapping.get(source)||source);}
 if(latest.workspace?.id!==task.workspace?.id||latest.workspaceChoice!==task.workspaceChoice)throw Error('工作区已切换，请重新读取当前流程');
 guard();if(Object.keys(changes).length)records.edit({id:task.id,changes});
 guard();const fresh=records.read(task.id);fresh.projectId=context.project.id;fresh.authoring={...(fresh.authoring?.projectId===context.project.id&&fresh.authoring?.environmentId===context.environment_id&&fresh.authoring?.inputRoot===context.input_root?fresh.authoring:{}),pendingInputs:pending?approved:[],workspacePending:pending,workerBinding:identity,workspaceLayout:task.workspace?{directories:task.workspace.directories,rule:'Use the software directories for new inputs; keep existing pyGAS graph contracts intact.'}:null,projectId:context.project.id,inputRoot:context.input_root,environmentId:context.environment_id,authoringOnly:!!context.project.authoring_only,imports:[...(fresh.authoring?.imports||[]),...(context.imports||[])].filter((value,index,all)=>all.findIndex(item=>item.source===value.source&&item.sha256===value.sha256)===index).slice(-128)};guard();records.save(fresh);expectedAuthoring=scope(fresh.authoring);
 guard();records.bindProject(provider,threadId,context.project.id);
 return {context,text:'[Studio authoring workspace]\n'+JSON.stringify({...context,...pending?{workspace_selection_required:true,instruction:'Ask the user to choose a workspace in the Studio page before importing external files; do not put workspace IDs in scientific parameters.'}:{},...task.workspace?{workspace_layout:task.workspace.directories}:{} })+'\nThis is the authoritative project/environment context for this conversation; older project lists or Unknown project errors in history are stale. For render_pygas_workflow always set workspace_id='+task.id+'; when an existing composition is provided, update its graphPath and expected pair hashes instead of creating another graph. Read inspect_pygas_catalog for the exact registered constructor parameters, source defaults and supported semantics. Use project_id='+context.project.id+' for create_structure, inspect_asset, suggest_parameters, render_pygas_workflow and write_project_input. Use the candidate environment_id for authoring and probe its actual capabilities when needed. Studio tool writes ARE allowed in planning/workflow/review despite the general read-only shell sandbox. Use read_project_input to read authorized Python/JSON/config text or binary model metadata instead of inspect_asset or Windows/WSL shell calls; use its sha256 as expected_sha256 when replacing existing nested inputs. Use engine_contracts (or describe_engine) for the actual adapter-required keys and explicit nested aliases. Reserved parameters.validation is only the declared numerical FD controls; runtime/scope/status explanations belong in step descriptions or a saved review manifest. Do not turn an empty diagnostic or missing-information list into a required scientific field. Keep values traceable to actual files/manifest/source; missing technical wrapper keys are your responsibility. Do not ask users to supply internal API names. Save actual source/graph/structure files here; never replace them with Python text in form fields or ask the user to supply generated output paths, dtype, CV count, PBC facts, or technical defaults. Continue completing independent authoring work before asking a focused scientific question. Do not build models or execute simulations; human execution gates remain mandatory.'+(guidance?'\n\n[Studio workflow authoring skill]\n'+guidance:'')};
}
