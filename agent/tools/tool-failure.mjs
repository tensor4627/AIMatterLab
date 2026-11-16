// Tool-level failures stay on the MCP channel so the Agent can correct its next
// action. This is guidance only: no retry, resource grant or dispatch occurs here.
export function toolFailure(error,{dispatched=false}={}){
 const message=String(error?.message||error||'Tool request failed').slice(0,4000);
 if(error?.operationNotStarted===true)dispatched=false;
 let code='tool_error',next_step='Inspect the tool details and correct the request before continuing.';
 if(/unknown (?:tool|project|environment)|not (?:bound|belong)|conversation-owned|active conversation|another conversation/i.test(message)){
  code='context_required';next_step='Read the current conversation workflow and its registered project/environment. Use those identities; do not create a replacement workflow or broaden access.';
 }else if(/stale|hash|newer human|existing graph in place|saved canonical|reload/i.test(message)){
  code='input_changed';next_step='Read the latest saved workflow and input hashes, preserve human edits, then update that same workflow. Do not reuse a stale preparation.';
 }else if(/permission|sharing|unshared|not authorized|not allowed|protected private|outside this workflow/i.test(message)){
  code='access_required';next_step='Use inputs already available to this conversation. If a specific file or resource is needed, describe it to the user; do not change access settings through tools.';
 }else if(/connect|disconnected|fetch failed|ECONN|timed? ?out|timeout/i.test(message)){
  code='connection_unavailable';next_step='Reconnect the service, then inspect the existing workflow or run status. Do not replay a write or submit operation whose result is unknown.';
 }else if(/required|invalid|missing|expected|must |请选择|参数|缺少/i.test(message)){
  code='invalid_input';next_step='Read the tool schema or engine contract and fill technical fields from the current workflow. Ask the user only for unresolved scientific choices.';
 }
 return {content:[{type:'text',text:JSON.stringify({status:dispatched?'unknown':code==='tool_error'?'failed':'blocked',code,message,next_step,operation_state:dispatched?'unconfirmed':'not_started',automatic_retry:false})}],isError:true};
}

export function toolValueResult(value){
 return {content:[{type:'text',text:JSON.stringify(value)??'null'}],isError:['blocked','permission_required','failed','unknown'].includes(value?.status)};
}

export function validToolCall(body){
 return body?.method==='tools/call'&&typeof body.params?.name==='string'&&body.params.name.length>0&&
  (body.params.arguments===undefined||body.params.arguments!==null&&typeof body.params.arguments==='object'&&!Array.isArray(body.params.arguments));
}

export function validRpcRequest(body){
 return body?.jsonrpc==='2.0'&&(typeof body.id==='string'||Number.isSafeInteger(body.id));
}

export function validToolResponse(body,id){
 if(!body||body.jsonrpc!=='2.0'||body.id!==id||Object.hasOwn(body,'result')===Object.hasOwn(body,'error'))return false;
 if(Object.hasOwn(body,'error'))return body.error&&Number.isInteger(body.error.code)&&typeof body.error.message==='string';
 const value=body.result;
 return !!value&&Array.isArray(value.content)&&(value.isError===undefined||typeof value.isError==='boolean')&&value.content.every(item=>item&&typeof item==='object'&&typeof item.type==='string'&&(item.type!=='text'||typeof item.text==='string'));
}
