const phases=new Set(['installation','setup','toolchain']);
/** A sender-validated manual function selection opens one bounded instruction read. */
export function explicitSetupStage({routes,current}){
 let next=0;const stages=new Map();
 const key=owner=>JSON.stringify([owner?.provider,owner?.threadId,owner?.taskId??null,owner?.projectId??null,owner?.environmentId??null,owner?.inputRoot??null,owner?.serial]);
 return {
  allowed(provider,route){const stage=stages.get(provider);return !!stage&&stage.functionId===route.id&&phases.has(route.phase)&&stage.ownerKey===key(current());},
  async prepare(provider,functionId,callback){const route=routes.get(functionId),owner=current();if(!route||!phases.has(route.phase)||owner?.provider!==provider||!owner.threadId||!Number.isSafeInteger(owner.serial))throw Error('Select an explicit setup function in the actual current conversation');const stage={id:++next,functionId,ownerKey:key(owner)};stages.set(provider,stage);try{const result=await callback();if(stages.get(provider)!==stage||key(current())!==stage.ownerKey)throw Error('Setup selection changed during instruction preparation');return result;}finally{if(stages.get(provider)===stage)stages.delete(provider);}},
  clear(){stages.clear();}
 };
}
