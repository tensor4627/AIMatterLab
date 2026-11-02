/** Sender-validated desktop selection actions; never exposed to scientific MCP. */
export async function selectConversation({catalog,records,workflowContext,agents,assertIdle},value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid conversation selection');
 const fresh=value.new===true&&Object.keys(value).length===1;
 if(!fresh&&(typeof value.id!=='string'||Object.keys(value).length!==1))throw Error('Invalid conversation selection');
 const conversation=fresh?null:catalog.get('conversation',value.id);
 if(!fresh&&!conversation)throw Error('Unknown conversation');
 assertIdle();
 if(fresh){
  // Revoke old selection tickets and active tool ownership before awaiting the provider bind.
  workflowContext.clear();
  const ticket=workflowContext.begin(agents.active,null);
  await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));
  workflowContext.assert(ticket);return {fresh:true};
 }
 if(agents.active!==conversation.provider){workflowContext.clear(agents.active);agents.disconnect(agents.active);}
 const ticket=workflowContext.begin(conversation.provider,conversation.threadId);
 await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));
 workflowContext.assert(ticket);
 return {...conversation,task:conversation.taskId?records.read(conversation.taskId):null};
}
