import {randomUUID} from 'node:crypto';
import {validatePlan} from "../../../contracts/workflows/plan.mjs";

/** Persist draft plans only; these routes neither prepare nor execute worker runs. */
export function registerWorkflowPlanRoutes({handle,catalog}){
handle('workflow.list',()=>catalog.list('workflow-plan'));
handle('workflow.save',value=>{
 const plan=validatePlan(value),id=value.id;
 if(id!==undefined&&(typeof id!=='string'||!catalog.get('workflow-plan',id)))throw Error('Unknown workflow plan');
 const key=id||randomUUID();return catalog.put('workflow-plan',key,{...plan,id:key,status:'draft',updatedAt:Date.now()});
});
}
