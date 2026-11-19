// Loaded only by the official DSH CLI in AIMatterLab's isolated profile.
function providerToolSchema(tool){const schema=structuredClone(tool.inputSchema);if(tool.name==='present_task'){const items=schema.properties?.steps?.items,object=items?.anyOf?.find(v=>v.type==='object');if(object)schema.properties.steps.items=object;}return schema;}

export const name='studio-dsh-policy';
export const inject=['tools','systemPrompt','appReady','llm'];
const READ=new Set(['project_skill_catalog','read_project_skill','write_project_skill','describe_engine','inspect_compute_resource','compute_readiness','discover_local_environments','read_project_input','read_pygas_workflow','read_custom_cv','scientific_skill_catalog','read_scientific_skill','diagnose_tools','suggest_parameters','search_materials_project','list_source_projects','inspect_source_project','inspect_pygas_catalog','inspect_environment_api','collect_cluster_artifacts','read_cluster_input','read_cluster_result','read_cluster_skill','cluster_browse','list_clusters','probe_cluster','cluster_run_status','cluster_read_log','list_workflows','list_projects','list_environments','list_runs','probe_environment','read_runtime_guide','run_status','read_log','collect_artifacts','inspect_asset','read_run_input','read_artifact','list_shared_terminals','read_shared_terminal','write_shared_terminal']);
const DRAFT=new Set(['copy_project_inputs','draft_local_environment','propose_custom_cv','import_materials_project','create_structure','render_pygas_workflow','present_task','draft_cluster_setup','prepare_cluster_run','create_workflow','prepare_run','resume_run','write_project_input']);
const EXECUTE=new Set(['validate_run','submit_run','cancel_run','validate_cluster_run','submit_cluster_run','cancel_cluster_run','reconcile_run']);
const MANAGED=new Set(['list_compute_resources','acquire_compute_resource','release_compute_resource','list_compute_terminals','read_compute_terminal','write_compute_terminal','inspect_compute_service','prepare_compute_run','read_compute_run_status','read_compute_run_log','validate_compute_run','submit_compute_run','cancel_compute_run','list_task_schedules','task_schedule_status','attach_task_schedule','stop_task_schedule']);
const prefix='mcp__gpusampling__';
export function dshToolAllowed(name,workflow){return READ.has(name)||MANAGED.has(name)||['setup_base_workspace','draft_local_environment','draft_cluster_setup'].includes(name)||workflow===true&&(DRAFT.has(name)||EXECUTE.has(name));}
export function checkDshInventory(names,expected){if(!Array.isArray(names)||names.some(n=>typeof n!=='string'||!expected.has(n))||names.length!==expected.size||new Set(names).size!==expected.size)throw Error('DSH tool inventory differs from the verified AIMatterLab capability set');return names;}
function send(method,params){process.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');}

export async function apply(ctx,config){
 try{
  await installPolicy(ctx,config);
 }catch(error){
  // Cordis can keep serving initialize after a plugin fails to activate.
  // Report the failure before rethrowing, without forwarding private diagnostics.
  const status=error?.httpStatus;
  send('studio/dshIsolation',{status:'failed',stage:'tool_setup',...Number.isInteger(status)?{httpStatus:status}:{}});
  throw error;
 }
}

async function installPolicy(ctx,config){
 const expected=new Set();let next=0;
 const rpc=async(method,params,signal)=>{
  if(!config.workerUrl)throw Error('Scientific tools are unavailable');
  const response=await fetch(config.workerUrl,{method:'POST',headers:{Authorization:'Bearer '+process.env.GSS_MCP_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++next,method,params}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Object.assign(Error('AIMatterLab tool service HTTP '+response.status),{httpStatus:response.status});
  const value=await response.json();if(value.error)throw Error('AIMatterLab tool service rejected the request');return value.result;
 };
 if(config.workerUrl){
  const [{createMcpToolDefinition},{validateJsonSchemaValue}]=await Promise.all([import(config.mcpModule),import(config.toolsModule)]);
  const result=await rpc('tools/list',{});
  if(!Array.isArray(result?.tools))throw Error('AIMatterLab tool inventory is unavailable');
  for(const tool of result.tools){
   if(!dshToolAllowed(tool.name,config.workflow))continue;
   if(!/^[a-z_][a-z0-9_]*$/.test(tool.name)||expected.has(prefix+tool.name))throw Error('Ambiguous AIMatterLab tool identity');
   const schema=providerToolSchema(tool),publicName=prefix+tool.name;expected.add(publicName);
   ctx.tools.register(createMcpToolDefinition(ctx,{name:publicName,rawName:tool.name,description:tool.description||tool.name,inputSchema:schema,call:async(args,exec)=>{
    const violations=validateJsonSchemaValue(schema,args,'arguments');if(violations.length)throw Error(violations.join('; '));
    if(!dshToolAllowed(tool.name,config.workflow))throw Error('This operation is unavailable in the current AIMatterLab conversation');
    if(tool.name==='present_task'&&args.task_id!==config.taskId)throw Error('The proposal belongs to another workflow');
    return rpc('tools/call',{name:tool.name,arguments:args},exec.signal);
   }}));
  }
 }
 const inventory=(scope,toolSet)=>checkDshInventory(ctx.tools.schemas(scope,toolSet).map(t=>t.name),expected);
 ctx.tools.guard(exec=>expected.has(exec.name??exec.tool?.name)?undefined:'Only the verified AIMatterLab tools are available');
 ctx.systemPrompt.section({name:'studio:instructions',order:0,text:config.instructions,interpolate:false,complete:true});
 ctx.on('system-prompt/assemble',async(assembly,context,next)=>{inventory(context.scope,context.toolSet);return next();});
 ctx.on('agent/assistant-stream',({agent,frame})=>{
  if(frame.type==='chunk'&&frame.chunk?.type==='text-delta')send('studio/dshText',{sessionId:String(agent.session.id),attemptId:frame.attemptId,text:frame.chunk.text});
 });
 ctx.effect(()=>ctx.appReady.onReady(async()=>{try{const tools=inventory(),models=await Promise.all((config.models||[]).map(id=>ctx.llm.resolveModelInfo(config.modelProvider||'deepseek-official',id)));send('studio/dshIsolation',{status:'verified',tools,nativeTools:0,models});}catch(error){send('studio/dshIsolation',{status:'failed',...(config.modelProvider?{message:String(error.message).replaceAll(process.env.STUDIO_MODEL_API_KEY||'\0','[REDACTED]').slice(0,500)}:{})});}}),'studio-dsh.readiness');
}
