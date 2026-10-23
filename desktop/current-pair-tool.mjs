// Provider-scoped saved composition reader; no implicit private-library consent.
// DeepSeek access is limited to the active conversation, per explicit user consent.
export const currentPairTool={name:'read_pygas_workflow',description:'Read the active conversation-owned saved CV/bias graph and its exact compare-and-swap receipt. Use composition.expected verbatim for the next render_pygas_workflow. This neither renders, approves nor executes. Do not invent graph_sha/source_sha aliases.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{workspace_id:{type:'string',maxLength:128}},required:['workspace_id'],additionalProperties:false}};
export async function readCurrentPair({records,worker,activeTasks,readTaskPygas,privateAccess},args,{provider}){
 if(!args||Object.keys(args).length!==1||typeof args.workspace_id!=='string'||!args.workspace_id||args.workspace_id.length>128||typeof privateAccess!=='function')throw Error('A validated active workspace and private-access guard are required');
 const id=activeTasks.get(provider);
 if(!id||args.workspace_id!==id)throw Error('Read only the active conversation-owned workspace');
 const task=records.read(id);
 const identity=t=>JSON.stringify({id:t.id,provider:t.provider,threadId:t.threadId,projectId:t.projectId,project:t.authoring?.projectId,environment:t.authoring?.environmentId,root:t.authoring?.inputRoot});
 const owner=identity(task);
 const current=()=>{const t=records.read(id);if(activeTasks.get(provider)!==id||t.provider!==provider||!t.threadId||records.deleted(provider,t.threadId)||records.bound(provider,t.threadId)?.id!==id||identity(t)!==owner)throw Error('Active conversation/workspace changed before returning the saved composition');return t;};
 if(await privateAccess(current(),provider)===false)throw Error('Current private scientific access is denied');
 current();
 const result=await readTaskPygas(records,worker,{taskId:id});
 if(await privateAccess(current(),provider)===false)throw Error('Current private scientific access is denied');
 const latest=current();
 if(result?.project_id!==(latest.authoring?.projectId||latest.projectId)||result?.workspace_id!==id)throw Error('Saved composition response belongs to another workflow');
 return {taskId:id,project_id:result.project_id,workspace_id:id,composition:result.composition,graph:result.graph,derived:result.derived,catalog_source:result.catalog?.source,ports_status:result.catalog?.ports?.status,settings_status:result.catalog?.settings_schema?.status,missing_fields:result.missing_fields,reasons:result.reasons,render_blocked:result.render_blocked,validation:'not_run',scope:'Exact saved pair and current source checks only; copy composition.expected without renaming fields. No artifact/runtime/scientific validation.'};
}
