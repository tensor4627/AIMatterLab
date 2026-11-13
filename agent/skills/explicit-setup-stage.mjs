const phases=new Set(['installation','setup','toolchain']);
/** A sender-validated manual function selection opens bounded instruction reads. */
export function explicitSetupStage({routes,current}){
 let next=0;const stages=new Map();
 const key=owner=>JSON.stringify([owner?.provider,owner?.threadId,owner?.taskId??null,owner?.projectId??null,owner?.environmentId??null,owner?.inputRoot??null,owner?.serial]);
 return {
  allowed(provider,route){const stage=stages.get(provider);if(!stage||stage.functionId!==route.id||!phases.has(route.phase)||stage.ownerKey!==key(current()))return false;try{if(stage.checkCurrent&&stage.checkCurrent()!==true)return false;stage.assertCurrent?.();return true;}catch{return false;}},
  async prepare(provider,functionId,callback,{retainForTurn=false,assertCurrent,checkCurrent}={}){
   const route=routes.get(functionId),owner=current();if(!route||!phases.has(route.phase)||owner?.provider!==provider||!owner.threadId||!Number.isSafeInteger(owner.serial)||typeof retainForTurn!=='boolean'||retainForTurn&&(typeof assertCurrent!=='function'||typeof checkCurrent!=='function'))throw Error('Select an explicit setup function in the actual current conversation');
   const stage={id:++next,functionId,ownerKey:key(owner),assertCurrent,checkCurrent};let retained=false;stages.set(provider,stage);
   try{const result=await callback();if(stages.get(provider)!==stage||!this.allowed(provider,route))throw Error('Setup selection changed during instruction preparation');retained=retainForTurn&&['passed','already_loaded'].includes(result?.status);return result;}finally{if(!retained&&stages.get(provider)===stage)stages.delete(provider);}
  },
  clear(provider){if(provider)stages.delete(provider);else stages.clear();}
 };
}
