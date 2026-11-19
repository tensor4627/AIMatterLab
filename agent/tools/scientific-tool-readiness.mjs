import {isDeepStrictEqual} from 'node:util';
import {assertTaskWorker} from '../../contracts/compute/task-worker-binding.mjs';
import {DEFINITION_ONLY_TOOLS,sharedTerminalToolAllowed} from "./definition-scope.mjs";
const providers=new Set(['codex','kimi','qwen','deepseek','compatible']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hostedServiceTools=['list_compute_resources','acquire_compute_resource','inspect_compute_service'];

/** Observe the conversation's tool channel without acquiring or probing a compute resource. */
export async function managedToolReadiness({agents,terminalMcp},provider,threadId){
 const session=agents.sessionIdentity(provider,threadId),bridge=agents.bridge(provider,threadId),process=bridge?.process;
 if(!session||!process||bridge.starting||!bridge.info)return {status:'not_run',count:0};
 const connection=agents.toolConnection(provider,threadId),receipt=bridge.info?.studioIsolation;
 const current=()=>{
  const owner=agents.sessionIdentity(provider,threadId);
  return owner?.id===session.id&&owner.threadId===session.threadId&&agents.bridge(provider,threadId)===bridge&&bridge.process===process&&
   agents.toolConnection(provider,threadId)===connection;
 };
 try{
  const names=new Set(await terminalMcp.observeToolNames(provider,connection));
  if(!current())return {status:'not_run',count:0};
  let loaded;
  if(['deepseek','qwen','compatible'].includes(provider)){
   loaded=new Set(receipt?.status==='verified'&&Array.isArray(receipt.tools)?receipt.tools.filter(name=>typeof name==='string'&&name.startsWith('mcp__gpusampling__')).map(name=>name.slice('mcp__gpusampling__'.length)):[]);
  }else if(provider==='codex'){
   const inventory=await bridge.request('mcpServerStatus/list',{serverName:'gpusampling',detail:'full'},10000);
   const servers=inventory?.data?.filter?.(server=>server?.name==='gpusampling')??[];
   loaded=new Set(servers.length===1&&!servers[0].toolsError&&object(servers[0].tools)?Object.keys(servers[0].tools):[]);
  }else if(bridge.info?.agentCapabilities?.mcpCapabilities?.http!==true){loaded=new Set();}
  if(!current())return {status:'not_run',count:0};
  const count=hostedServiceTools.filter(name=>names.has(name)&&(!loaded||loaded.has(name))).length;
  return count===hostedServiceTools.length?{status:'ready',count}:{status:'blocked',count,message:'当前对话的托管计算工具清单不完整。'};
 }catch{
  return current()?{status:'blocked',count:0,message:'当前对话无法读取托管计算工具清单。'}:{status:'not_run',count:0};
 }
}
/** Readiness observes the main-owned selection; it never selects a conversation or grants access. */
export async function scientificToolReadiness({worker,codex,workflowContext,records,privateAccess,selectedProvider},provider){
 try{
  if(worker.connecting||worker.restoring)return {status:'blocked',count:0,message:'计算连接正在核对；可以继续聊天，请等待核对完成。',checkedAt:Date.now()};
  const snapshot=()=>{
   if(!providers.has(provider)||selectedProvider()!==provider)throw Error('Selected Agent provider changed during the scientific tool check');
   const context=structuredClone(workflowContext.current());
   if(context&&(context.provider!==provider||!Number.isSafeInteger(context.serial)||context.serial<1))throw Error('A trusted current conversation is required for the scientific tool check');
   let task=null;
   if(context?.threadId){
    if(records.deleted(provider,context.threadId))throw Error('The selected conversation was deleted');
    const bound=records.bound(provider,context.threadId);
    if((bound?.id||null)!==context.taskId)throw Error('The selected workflow binding changed');
    if(context.taskId){
     task=records.read(context.taskId);
     if(!isDeepStrictEqual(bound,task)||task.id!==context.taskId||task.provider!==provider||task.threadId!==context.threadId)throw Error('The selected workflow ownership changed');
    }
   }else if(context?.taskId)throw Error('Wait for the current conversation context to finish binding');
   return {context,task};
  };
  // Capture before the first await. Full task equality includes science, pair/CV CAS and review revisions.
  const original=snapshot(),connection=worker.connection,connectionState=structuredClone(connection),nativeProcess=codex?.process,nativeLifecycle=codex?.lifecycle;
  const fresh=()=>{
   if(worker.connection!==connection||!isDeepStrictEqual(worker.connection,connectionState)||provider==='codex'&&(codex?.process!==nativeProcess||codex?.lifecycle!==nativeLifecycle)||!isDeepStrictEqual(snapshot(),original))throw Error('Selected conversation, workflow revision or worker changed during the scientific tool check');
   if(original.task)assertTaskWorker(original.task,worker);
  };
  if(!connection)return {status:'blocked',count:0,...(worker.connectionFailure||{message:'作业服务未连接；可以聊天，计算流程暂不能生成'})};
  const access=async()=>{
   fresh();
   if(!original.task)return {definitionOnly:false};
   const value=await privateAccess.assertTask(structuredClone(original.task),provider);
   fresh();
   if(!object(value)||typeof value.definitionOnly!=='boolean')throw Error('The current scientific access policy is unavailable');
   return value;
  };
  const initial=await access();fresh();
  if(initial.definitionOnly&&provider!=='codex')throw Error('Definition-only sharing requires the isolated Codex scientific tool connection');
  const status=await worker.probeTools();fresh();
  if(!object(status)||!['ready','warning'].includes(status.status))throw Error(status?.message||'Scientific worker tools are not ready');
  let warning=status.status==='warning',actualPrivateCount=DEFINITION_ONLY_TOOLS.length;
  if(provider==='codex'){
   // Probe the process-owned scoped server before any stored thread has been resumed.
   // Fresh thread/turn fences independently verify its native per-thread inventory.
   const inventory=await codex.request('mcpServerStatus/list',{serverName:'gpusampling',detail:'full'},15000);
   fresh();
   if(!Array.isArray(inventory?.data))throw Error('Agent 科学工具目录不可用，请重新连接');
   const servers=inventory.data.filter(value=>value?.name==='gpusampling'),server=servers[0];
   if(servers.length>1||servers.length===1&&!object(server?.tools))throw Error('Agent 科学工具目录格式无效，请核对连接');
   if(!server||server.toolsError)warning=true;
   if(initial.definitionOnly){
    const names=Object.keys(server?.tools||{}),required=new Set(DEFINITION_ONLY_TOOLS);
    const ambient=inventory.data.filter(row=>row?.name!=='gpusampling');
    const ambientEmpty=ambient.every(row=>object(row)&&typeof row.name==='string'&&row.name.length>0&&object(row.tools)&&Object.keys(row.tools).length===0&&Array.isArray(row.resources)&&row.resources.length===0&&Array.isArray(row.resourceTemplates)&&row.resourceTemplates.length===0);
    if(inventory.nextCursor||!ambientEmpty||names.some(name=>(!required.has(name)&&!sharedTerminalToolAllowed(name))||!object(server.tools[name])||server.tools[name].name!==name)||server&&(!Array.isArray(server.resources)||server.resources.length||!Array.isArray(server.resourceTemplates)||server.resourceTemplates.length))throw Error('当前私有定义仅允许七个受限科学工具；工具目录不匹配，请重新连接');
    actualPrivateCount=names.filter(name=>required.has(name)).length;
    if(actualPrivateCount<DEFINITION_ONLY_TOOLS.length)warning=true;
   }else if(!server?.tools?.present_task)warning=true;
  }
  const final=await access();fresh();
  if(final.definitionOnly!==initial.definitionOnly)throw Error('Scientific sharing scope changed during the tool check');
  if(warning)return {...status,status:'ready',warning:true,...initial.definitionOnly?{count:actualPrivateCount,scope:'definition-only'}:{},message:'工具清单待核对，可继续讨论并通过已授权终端配置环境；实际执行能力尚未验证。',checkedAt:Date.now()};
  return initial.definitionOnly?{...status,count:actualPrivateCount,scope:'definition-only',message:'当前私有定义的七个受限科学工具已就绪'}:status;
 }catch(error){return {status:'blocked',count:0,message:error.message,checkedAt:Date.now()};}
}
