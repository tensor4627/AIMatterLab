import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sourceAuthority,synchronizeGraphMirrors,reviewGraph} from './composition-authority.mjs';
const pairs=['workflow.json','build_bias.py'];
const operations=new WeakMap();
const anchor=task=>JSON.stringify({id:task.id,provider:task.provider,threadId:task.threadId,projectId:task.projectId,authoring:task.authoring,parameterRevision:task.parameterRevision,composition:task.composition,files:task.parameters?.files});
function beginOperation(records,task,expectedPath,write=false){let states=operations.get(records);if(!states){states=new Map();operations.set(records,states);}const previous=states.get(task.id);if(previous?.writePending)throw Error('A CV graph/source save is in progress; reload after it finishes');const token=(previous?.token||0)+1;states.set(task.id,{token,writePending:write});return {id:task.id,token,anchor:anchor(task),expectedPath,write};}
function assertOperation(records,owner){const current=records.read(owner.id);if(operations.get(records)?.get(owner.id)?.token!==owner.token||anchor(current)!==owner.anchor||records.deleted(current.provider,current.threadId)||records.bound(current.provider,current.threadId)?.id!==current.id)throw Error('CV workflow changed during the request; reload the current saved pair');return current;}
function finishOperation(records,owner){const current=operations.get(records)?.get(owner?.id);if(current?.token===owner.token)current.writePending=false;}

function taskContext(records,value){
 if(!value||typeof value.taskId!=='string')throw Error('Select the conversation-owned task');
 const task=records.read(value.taskId);
 if(!task.threadId||records.deleted(task.provider,task.threadId)||records.bound(task.provider,task.threadId)?.id!==task.id)throw Error('Workflow is not bound to its conversation');
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the execution request before changing the CV workflow');
 const projectId=task.authoring?.projectId||task.projectId,environmentId=task.authoring?.environmentId,inputRoot=task.authoring?.inputRoot;
 if(typeof projectId!=='string'||typeof environmentId!=='string'||typeof inputRoot!=='string')throw Error('Connect the worker and prepare this conversation workspace first');
 const files=Array.isArray(task.parameters?.files)?task.parameters.files:[];
 const candidates=[...new Set([task.composition?.graphPath,...files.filter(file=>typeof file==='string'&&path.posix.basename(file)==='workflow.json')].filter(Boolean))];
 const chosen=value.path||task.composition?.graphPath||(candidates.length===1?candidates[0]:null);
 if(!chosen&&candidates.length>1)throw Error('Select the workflow.json attached to this conversation');
 if(chosen&&(!candidates.includes(chosen)||!chosen.startsWith(inputRoot.replace(/\/$/,'')+'/')||chosen.split('/').some(part=>part==='..'||part==='.')||path.posix.basename(chosen)!=='workflow.json'))throw Error('CV graph is not an owned input of this workflow');
 return {task,args:{project_id:projectId,environment_id:environmentId,source_id:'pygas',workspace_id:task.id,...chosen?{path:chosen}:{}}};
}
export function invalidateComposition(records,id){
 if(operations.get(records)?.get(id)?.writePending)throw Error('A CV graph/source save is in progress; wait before starting another write');
 const task=records.read(id);
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile execution before editing');
 task.parameterRevision=(task.parameterRevision||0)+1;task.review={status:'not_run',summary:'CV/bias definition changed; review the saved input revision again'};
 if(task.deployment?.prepared){task.deployment={...task.deployment};delete task.deployment.prepared;}
 if(task.composition)task.composition={...task.composition,status:'blocked',render_blocked:true,reasons:['A graph/source write is pending; reload the saved pair before review']};
 return records.save(task);
}
export function bindComposition(records,id,result,owner){
 if(owner)assertOperation(records,owner);
 const task=records.read(id),original=structuredClone(records.read(id)),root=task.authoring?.inputRoot?.replace(/\/$/,'');
 const composition=result?.composition;
 if(result?.kind!=='pygas-composition'||result.project_id!==(task.authoring?.projectId||task.projectId)||result.workspace_id&&result.workspace_id!==task.id||!composition||!root||![composition.graphPath,composition.sourcePath].every((file,index)=>typeof file==='string'&&file.startsWith(root+'/')&&!file.split('/').some(part=>part==='..'||part==='.')&&path.posix.basename(file)===pairs[index]))throw Error('Composition result does not belong to this conversation workspace');
 if(owner&&composition.graphPath!==owner.expectedPath)throw Error('Composition response changed its owned graph path');
 if(!result.graph)return task;
 if(owner&&!owner.write&&(!task.composition||!isDeepStrictEqual({expected:task.composition.expected,graph_sha256:task.composition.graph_sha256,source_sha256:task.composition.source_sha256,status:task.composition.status,render_blocked:task.composition.render_blocked},{expected:composition.expected,graph_sha256:composition.graph_sha256,source_sha256:composition.source_sha256,status:composition.status,render_blocked:composition.render_blocked}))){
  task.parameterRevision=(task.parameterRevision||0)+1;task.review={status:'not_run',summary:'Saved CV graph/source revision changed; review the current inputs again'};
  if(task.deployment?.prepared){task.deployment={...task.deployment};delete task.deployment.prepared;}
 }
 task.composition={...composition};
 const savedFiles=result.files||[composition.sourcePath,composition.graphPath].filter(file=>Object.hasOwn(composition.expected?.files||{},path.posix.basename(file)));
 task.authoring={...task.authoring,compositionFiles:savedFiles,compositionRevision:composition.expected};
 if(owner?.origin==='human')task.authoring.lastHumanCompositionRevision=task.parameterRevision||0;
 const authority=sourceAuthority(task,result,owner?.origin||'read');
 if(authority){task.authoring.compositionAuthority=authority;delete task.authoring.compositionIntent;synchronizeGraphMirrors(task);}
 else{delete task.authoring.compositionAuthority;task.authoring.compositionIntent={origin:owner?.origin||'read',status:composition.status,parameterRevision:task.parameterRevision||0,graph:structuredClone(result.graph),expected:structuredClone(composition.expected),graphSha:composition.graph_sha256||null};}
 if(task.parameters?.engine==='pygas.build')task.parameters={...task.parameters,files:[...new Set([...(task.parameters.files||[]).filter(file=>!pairs.includes(path.posix.basename(file))),...savedFiles,...(result.io_bindings||[]).map(binding=>path.posix.dirname(composition.graphPath)+'/'+binding.name)])]};
 return isDeepStrictEqual(task,original)?task:records.save(task);
}
export async function readTaskPygas(records,worker,value){
 const {task,args}=taskContext(records,value),owner=beginOperation(records,task,args.path||task.authoring.inputRoot.replace(/\/$/,'')+'/cv-'+task.id+'/workflow.json');
 const result=await worker.request('POST','/api/pygas/composition/read',args);
 assertOperation(records,owner);if(result.graph)bindComposition(records,task.id,result,owner);
 return {taskId:task.id,...result};
}
export async function saveTaskPygas(records,worker,value,normalize=false){
 const {task,args}=taskContext(records,value);
 if(!value.expected||typeof value.expected!=='object'||!value.catalog_files||typeof value.catalog_files!=='object'||!normalize&&(!value.graph||typeof value.graph!=='object'))throw Error('Current pair hashes, source catalog and structured graph are required');
 if(!args.path)throw Error('Prepare the initial graph in this conversation before editing');
 const invalidated=invalidateComposition(records,task.id),owner={...beginOperation(records,invalidated,args.path,true),origin:normalize?'normalize':'human'};
 try{const result=await worker.request('POST',normalize?'/api/pygas/composition/normalize':'/api/pygas/composition/save',{...args,expected:value.expected,catalog_files:value.catalog_files,...normalize?{repair:task.composition?.status==='blocked'}:{graph:value.graph}});
 bindComposition(records,task.id,result,owner);return {taskId:task.id,...result};}finally{finishOperation(records,owner);}
}
// Runs before a provider can mutate the canonical pair, and after the real worker response.
export function compositionToolGuard(records,activeTasks){return {
 before(name,args,provider){
  if(!['render_pygas_workflow','write_project_input'].includes(name))return null;
  const id=activeTasks.get(provider);if(!id){if(name==='render_pygas_workflow')throw Error('Prepare a conversation-owned workflow before composing a bias');return null;}
  const task=records.read(id),turn=records.turns.get(provider+':'+task.threadId),authority=task.authoring?.compositionAuthority;
  if(Math.max(authority?.lastHumanRevision||0,task.authoring?.lastHumanCompositionRevision||0)>(turn?.revision??Infinity))throw Error('A newer human graph was saved during this turn; reload and start a new review');
  if(args.project_id!==(task.authoring?.projectId||task.projectId))throw Error('Scientific input does not belong to the active conversation');
  if(name==='write_project_input'){
   const root=task.authoring?.inputRoot||'',name=args.name;
   const affected=[task.composition?.graphPath,task.composition?.sourcePath].some(file=>file&&(file===name||file===root.replace(/\/$/,'')+'/'+name));
   if(affected&&turn?.reviewMode&&authority&&task.composition?.status==='rendered')throw Error('Review must preserve the saved canonical graph/source; read current files and synchronize metadata. Explicit newer mapped human edits use render_pygas_workflow.');
   if(affected){const invalidated=invalidateComposition(records,id);return {id,bind:false,owner:beginOperation(records,invalidated,task.composition.graphPath,true)};}return {id,bind:false};
  }
  if(args.workspace_id&&args.workspace_id!==task.id)throw Error('Composition belongs to another conversation');
  if(task.composition?.graphPath){if(args.path!==task.composition.graphPath||!args.expected)throw Error('Update the existing graph in place with its current pair hashes; do not create a second composition');}
  else if(args.path&&!args.path.startsWith(task.authoring.inputRoot.replace(/\/$/,'')+'/'))throw Error('Composition path is outside this workflow');
  if(turn?.reviewMode&&authority&&task.composition?.status==='rendered'&&!isDeepStrictEqual(args.graph,reviewGraph(task)))throw Error('Review cannot reverse or otherwise rewrite the current saved graph. Use its exact CV order and constructor parameters; only newer explicit mapped human edits may change it.');
  args.workspace_id=task.id;const invalidated=invalidateComposition(records,id);return {id,bind:true,owner:{...beginOperation(records,invalidated,args.path||task.authoring.inputRoot.replace(/\/$/,'')+'/cv-'+task.id+'/workflow.json',true),origin:'provider'}};
 },
 cancel(token){if(token?.owner)finishOperation(records,token.owner);},
 after(token,result){
  try{
   if(!token?.bind||result?.isError)return;
   const text=result?.content?.find(item=>item.type==='text')?.text;
   if(typeof text!=='string')return;
   let value;try{value=JSON.parse(text);}catch{return;}
   bindComposition(records,token.id,value,token.owner);
  }finally{if(token?.owner)finishOperation(records,token.owner);}
 }
};}
