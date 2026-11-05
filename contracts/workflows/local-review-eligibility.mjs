import {engineContracts} from "../tools/engine-contracts.mjs";
import {parameterValue} from "./task-fields.mjs";
export const consumer=engine=>engine==='bias.validate'||engine==='gpumd.sampling';

// Read exactly the existing adapter aliases and its absent-value convention.
// This projection never changes inputs or certifies file identity/lineage.
function selections(engine,parameters){
 const p=parameters&&typeof parameters==='object'&&!Array.isArray(parameters)?parameters:{};
 return Object.fromEntries(['mode','manifest_file','kernel_capacity'].map(key=>[key,[key,...(engineContracts.engines[engine]?.aliases?.[key]||[]).filter(path=>path!==key)].map(path=>parameterValue(p,path)).filter(value=>value!==undefined&&value!==null&&value!=='')]));
}

/** Known unsupported/ambiguous selections only; never certifies a closure. */
export function localReviewUnsupportedCode(engine,parameters,savedMode){
 if(engine==='pygas.build')return savedMode==='opes'?'LOCAL_REVIEW_UNSUPPORTED_OPES':null;
 if(!consumer(engine))return null;
 const selected=selections(engine,parameters);
 if(Object.values(selected).some(values=>values.some(value=>JSON.stringify(value)!==JSON.stringify(values[0]))))return 'LOCAL_REVIEW_PARAMETER_CONFLICT';
 if(savedMode==='opes'||selected.mode.includes('opes'))return 'LOCAL_REVIEW_UNSUPPORTED_OPES';
 // Any explicit contract selection remains unsupported, including zero/invalid
 // values. Unlike mode, these never become an eligible presentation candidate.
 if(selected.manifest_file.length||selected.kernel_capacity.length)return 'LOCAL_REVIEW_UNSUPPORTED_CONSUMER_CONTRACT';
 if(!['metad','wtmetad','static'].includes(selected.mode[0]))return 'LOCAL_REVIEW_UNSUPPORTED_CONSUMER_MODE';
 return null;
}
