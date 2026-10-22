/** Delivery receipts describe acknowledged input, never model adoption or science. */
export async function deliverScientificTurn({provider,key,threadId,requestId,context,manager,dispatch,emit}){
 const report=(status,delivery,message)=>{if(context?.routes?.length)emit({method:'studio/skillsLoaded',provider,params:{threadId,requestId,status,delivery,names:context.routes,attachments:context.attachments,message,scope:'Bounded guidance read and input delivery only; actual model use and scientific validation require separate evidence.'}});};
 const initial=context?.status==='passed'?'prepared':context?.status;
 report(initial,'pending',['blocked','permission_required'].includes(context?.status)?context.text:undefined);
 try{
  const result=await dispatch();
  if(typeof result?.turn?.id!=='string'||!result.turn.id)throw Error('Agent returned no valid turn acknowledgment');
  if(context?.attach&&context.status==='passed')manager.accept(key,context);
  report(context?.status,'acknowledged',['blocked','permission_required'].includes(context?.status)?context.text:undefined);
  return result;
 }catch(error){
  const status=context?.attach?(error.rpcResponse===true?'failed':'unknown'):context?.status;
  report(status,error.rpcResponse===true?'rejected':'unconfirmed','The reply did not acknowledge this delivery. The input has not been marked loaded; retry requires the same source checks.');
  throw error;
 }
}
