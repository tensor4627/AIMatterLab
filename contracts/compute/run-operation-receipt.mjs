const failureStatuses=new Set(['blocked','failed','needs_human_auth','needs_worker_update','unknown']);
const operationStates=new Set(['not_started','read_started','unconfirmed']);
export const executionNotStartedPrefix='execution_not_started: ';

export function runOperationFailure(value){
 if(!failureStatuses.has(value?.status)||!operationStates.has(value.operation_state)||
    typeof value.code!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(value.code)||typeof value.message!=='string')return null;
 if(value.status==='unknown'&&value.operation_state!=='unconfirmed')return null;
 return {status:value.status,code:value.code,message:value.message.slice(0,4000),operation_state:value.operation_state,automatic_retry:false,
  ...(typeof value.next_step==='string'?{next_step:value.next_step.slice(0,2000)}:{})};
}

export function workerRunOperationFailure(response,id){
 if(response?.status!==200)return Number.isInteger(response?.status)&&response.status>=400&&response.status<=599?runOperationFailure(response.data):null;
 const data=response.data,blocks=data?.result?.content;
 if(data?.jsonrpc!=='2.0'||data.id!==id||data.error||data.result?.isError!==true||
    !Array.isArray(blocks)||blocks.length!==1||blocks[0].type!=='text'||typeof blocks[0].text!=='string'||blocks[0].text.length>256*1024)return null;
 try{return runOperationFailure(JSON.parse(blocks[0].text));}catch{return null;}
}
