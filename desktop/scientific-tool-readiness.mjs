import {isDeepStrictEqual} from 'node:util';
import {DEFINITION_ONLY_TOOLS} from './private-definition-scope.mjs';
const providers=new Set(['codex','kimi','qwen','deepseek']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Readiness observes the main-owned selection; it never selects a conversation or grants access. */
export async function scientificToolReadiness({worker,codex,workflowContext,records,privateAccess,selectedProvider},provider){
 try{
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
  };
  if(!connection)return {status:'blocked',count:0,message:'作业服务未连接；可以聊天，计算流程暂不能生成'};
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
  if(!object(status)||status.status!=='ready')throw Error(status?.message||'Scientific worker tools are not ready');
  if(provider==='codex'){
   // Probe the process-owned scoped server before any stored thread has been resumed.
   // Fresh thread/turn fences independently verify its native per-thread inventory.
   const inventory=await codex.request('mcpServerStatus/list',{serverName:'gpusampling',detail:'full'},15000);
   fresh();
   if(!Array.isArray(inventory?.data))throw Error('Agent 科学工具目录不可用，请重新连接');
   const servers=inventory.data.filter(value=>value?.name==='gpusampling'),server=servers[0];
   if(servers.length!==1||!object(server?.tools)||server.toolsError)throw Error('Agent 尚未挂载科学工具，请重新连接');
   if(initial.definitionOnly){
    const names=Object.keys(server.tools),required=new Set(DEFINITION_ONLY_TOOLS);
    const ambient=inventory.data.filter(row=>row?.name!=='gpusampling');
    const ambientEmpty=ambient.every(row=>object(row)&&typeof row.name==='string'&&row.name.length>0&&object(row.tools)&&Object.keys(row.tools).length===0&&Array.isArray(row.resources)&&row.resources.length===0&&Array.isArray(row.resourceTemplates)&&row.resourceTemplates.length===0);
    if(inventory.nextCursor||!ambientEmpty||names.length!==required.size||names.some(name=>!required.has(name)||!object(server.tools[name])||server.tools[name].name!==name)||!Array.isArray(server.resources)||server.resources.length||!Array.isArray(server.resourceTemplates)||server.resourceTemplates.length)throw Error('当前私有定义仅允许七个受限科学工具；工具目录不匹配，请重新连接');
   }else if(!server.tools.present_task)throw Error('Agent 尚未挂载科学工具，请重新连接');
  }
  const final=await access();fresh();
  if(final.definitionOnly!==initial.definitionOnly)throw Error('Scientific sharing scope changed during the tool check');
  return initial.definitionOnly?{...status,count:DEFINITION_ONLY_TOOLS.length,scope:'definition-only',message:'当前私有定义的七个受限科学工具已就绪'}:status;
 }catch(error){return {status:'blocked',count:0,message:error.message,checkedAt:Date.now()};}
}
