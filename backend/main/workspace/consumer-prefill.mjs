import {digest} from './review-authority.mjs';
const fields=['temperature_K','dt_fs','steps','cv_log_interval','cv_storage_interval','cv_change_interval','dump_thermo','dump_restart','dump_exyz'];
const valueAt=(value,key)=>key.split('.').reduce((v,k)=>v&&typeof v==='object'&&Object.hasOwn(v,k)?v[k]:undefined,value);
const missing=v=>v===undefined||v===null||v==='';
const valid=(key,v)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&(['temperature_K','dt_fs'].includes(key)||Number.isSafeInteger(v)&&v<=2147483647)&&(key!=='steps'||v<=1000000);
/** Trusted main passes its current same-task snapshot. Suggestions are not defaults or approval. */
export function consumerPrefill({task,engine,currentValues={},sourceSha}){
 if(!task||typeof task.id!=='string'||!Number.isSafeInteger(task.parameterRevision)||!task.parameters||typeof task.parameters!=='object'||typeof sourceSha!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha))throw Error('Current saved task/source identity required for prefill');
 const result={taskId:task.id,parameterRevision:task.parameterRevision,parametersSha:digest(task.parameters),sourceContractSha:sourceSha,proposals:[],conflicts:[],status:'no_explicit_source'};
 if(engine!=='gpumd.sampling')return result;
 const p=task.parameters,nve=p.dynamics?.ensemble==='nve',keys={temperature_K:nve?['dynamics.temperature_K','velocity']:['velocity'],dt_fs:nve?['dynamics.dt_fs','time_step']:['time_step'],steps:nve?['dynamics.steps','run']:['run']};
 for(const key of fields){
  const sources=(keys[key]||[key]).map(k=>({sourceKey:'parameters.'+k,value:valueAt(p,k)})).filter(s=>!missing(s.value));
  if(!sources.length)continue;
  if(sources.some(s=>!valid(key,s.value))){result.conflicts.push({key,reason:'invalid_explicit_value',sources});continue;}
  if(sources.some(s=>s.value!==sources[0].value)){result.conflicts.push({key,reason:'conflicting_explicit_sources',sources});continue;}
  const value=sources[0].value;
  if(!missing(currentValues[key])){if(currentValues[key]!==value)result.conflicts.push({key,reason:'saved_stage_value_differs',sources:[...sources,{sourceKey:'current_saved_stage.'+key,value:currentValues[key]}]});continue;}
  result.proposals.push({key,value,sources});
 }
 result.status=result.conflicts.length?'explicit_conflicts':result.proposals.length?'available':'no_explicit_source';return result;
}
