const phases=new Set(['installation','setup','toolchain']);
/** A sender-validated manual function selection opens bounded instruction reads. */
export function explicitSetupStage({routes,current}){
 let next=0;const stages=new Map();
 const conversation=(provider,threadId)=>JSON.stringify([provider,threadId]);
 const key=owner=>JSON.stringify([owner?.provider,owner?.threadId,owner?.taskId??null,owner?.projectId??null,owner?.environmentId??null,owner?.inputRoot??null,owner?.serial]);
 return {
  allowed(provider,route){const owner=current(),stage=stages.get(conversation(provider,owner?.threadId));if(!stage||stage.functionId!==route.id||!phases.has(route.phase)||stage.ownerKey!==key(owner))return false;try{if(stage.checkCurrent&&stage.checkCurrent()!==true)return false;stage.assertCurrent?.();return true;}catch{return false;}},
  async prepare(provider,functionId,callback,{retainForTurn=false,assertCurrent,checkCurrent}={}){
   const route=routes.get(functionId),owner=current();if(!route||!phases.has(route.phase)||owner?.provider!==provider||!owner.threadId||!Number.isSafeInteger(owner.serial)||typeof retainForTurn!=='boolean'||retainForTurn&&(typeof assertCurrent!=='function'||typeof checkCurrent!=='function'))throw Error('Select an explicit setup function in the actual current conversation');
   const stage={id:++next,provider,functionId,ownerKey:key(owner),assertCurrent,checkCurrent},id=conversation(provider,owner.threadId);let retained=false;stages.set(id,stage);
   try{const result=await callback();if(stages.get(id)!==stage||!this.allowed(provider,route))throw Error('Setup selection changed during instruction preparation');retained=retainForTurn&&['passed','already_loaded'].includes(result?.status);return result;}finally{if(!retained&&stages.get(id)===stage)stages.delete(id);}
  },
  clear(provider,threadId){if(threadId!==undefined)stages.delete(conversation(provider,threadId));else if(provider){for(const [id,stage]of stages)if(stage.provider===provider)stages.delete(id);}else stages.clear();}
 };
}
