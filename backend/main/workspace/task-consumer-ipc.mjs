import {createTaskLocalReview} from './task-local-review.mjs';import {createTaskConsumerReview} from './task-consumer-review.mjs';import {createTaskConsumerTarget} from './task-consumer-target.mjs';import {createTaskConsumerStage} from './task-consumer-stage.mjs';import {createConsumerArtifactAccess} from './consumer-artifact-access.mjs';import {isDeepStrictEqual as equal} from 'node:util';
/** Typed trusted desktop registration only; none of these actions are MCP or generic worker tools. */
export function registerCalculationReview({handle,targetReceiptStore,consumerReceiptStore,confirmTarget,...deps}){
 if(!consumerReceiptStore||consumerReceiptStore===deps.receiptStore||consumerReceiptStore===targetReceiptStore)throw Error('Distinct main-owned consumer science/target/build receipt stores required');
 const artifacts=createConsumerArtifactAccess(deps),build=createTaskLocalReview(deps);let target;
 const consumer=createTaskConsumerReview({...deps,receiptStore:consumerReceiptStore,artifactAccess:artifacts,targetReview:()=>target});
 target=createTaskConsumerTarget({...deps,scienceService:consumer,receiptStore:targetReceiptStore,confirm:confirmTarget});
 const stage=createTaskConsumerStage({...deps,artifactAccess:artifacts});
 const select=id=>['bias.validate','gpumd.sampling'].includes(deps.records.read(id).parameters?.engine)?consumer:build;
 const facade={};for(const name of ['inspect','read','confirm','status']){facade[name]=(value,event)=>select(value.taskId)[name](value,event);handle('task.localReview.'+name,facade[name]);}
 for(const name of ['verifyPrepared','beginOperation'])facade[name]=(id,...args)=>select(id)[name](id,...args);
 facade.verify=async id=>{const selected=select(id),checked=await selected.verify(id);if(selected===consumer)await target.verify(id);return checked;};
 facade.assertOperation=token=>select(token.taskId).assertOperation(token);
 facade.authority=(task,kind)=>select(task.id).authority(task,kind);
 facade.verifyDeployment=async(id,config)=>{const task=deps.records.read(id);if(['bias.validate','gpumd.sampling'].includes(task.parameters?.engine)){const current=await target.verify(id);if(!equal(current.config,config))throw Error('Saved deployment differs from current separately confirmed target');return current;}if(config.target!=='local'||config.inputSource!=='local'||config.targetId!==task.authoring?.environmentId)throw Error('Canonical build requires its exact human-reviewed authoring runtime');return build.verify(id);};
 handle('task.stage.artifacts',(v,e)=>artifacts.list(v,e));handle('task.stage.adoptArtifact',(v,e)=>artifacts.adopt(v,e));
 for(const name of ['inspect','propose','save'])handle('task.consumerStage.'+name,(v,e)=>stage[name](v,e));
 for(const name of ['inspect','confirm','status'])handle('task.consumerTarget.'+name,(v,e)=>target[name](v,e));
 return facade;
}
