import {createHash} from 'node:crypto';
const ENGINE_ROUTES={'pydyn.md':'md.pydyn','gpumd.md':'md.gpumd','pydyn.sampling':'sampling.pydyn','gpumd.sampling':'sampling.gpumd','gpumd.neb':'neb.gpumd','pygas.build':'pygas.bias','bias.validate':'pygas.contract','nep.train':'training.nep','nep.eval':'training.nep','nep.analyze':'training.nep','hotpp.train':'training.hotpp','hotpp.eval':'training.hotpp','hotpp.export':'training.hotpp','pygas.reweight':'analysis.wtmetad','pygas.opes-reweight':'analysis.opes'};
export function selectScientificFunctions({text='',parameters={},hasWorkflow=false,manualFunction}={}){
 const value=String(text),engine=parameters.engine;let id;
 const consumerIntent=/分子动力学|\bmd\b|metad|opes|增强采样/i.test(value);
 const primaryTraining=/(?:^|[。！!？?;\n])\s*(?:(?:请|帮我|现在|接下来|先|首先|然后|随后|please\s+|next\s+|now\s+|first\s+|then\s+)\s*)*(?:训练|导出|评估|train\b|export\b|freeze\b|eval\b)/i.test(value);
 if(manualFunction!==undefined&&typeof manualFunction!=='string')throw Error('Invalid selected scientific function');
 // Present intent takes priority over the previous run: analysis never loads the build/install stack.
 if(manualFunction)id=manualFunction;
 else if(/(?:reweight|重加权)/i.test(value))id=/opes/i.test(value)?'analysis.opes':'analysis.wtmetad';
 else if(/(?:分析轨迹|轨迹分析|analy[sz]e.*traject|trajectory.*analy)/i.test(value))id='analysis.trajectory';
 else if(/(?:monitor|监测|监控).*?(?:cv|pygas)|(?:cv|pygas).*?(?:monitor|监测)/i.test(value))id='pygas.monitor';
 else if(/(?:自定义|custom|missing|不存在).*?cv|cv.*?(?:自定义|custom|不存在)/i.test(value))id='pygas.custom-cv';
 else if(/\bneb\b|最小能量路径/i.test(value))id=/gpumd|gpu.?sampling/i.test(value)?'neb.gpumd':/pydyn/i.test(value)||String(engine).startsWith('pydyn.')?'neb.pydyn':'neb.gpumd';
 else if((/(?:训练|train|导出|export|freeze)/i.test(value)||/(?:测试|eval|评估)/i.test(value)&&!/(?:分子动力学|\bmd\b|metad|opes|增强采样)/i.test(value))&&(!consumerIntent||primaryTraining)&&/hotpp|torchnep|nepmaker|activemiao|\bnep\b/i.test(value))id=/torchnep/i.test(value)?'training.torchnep':/nepmaker/i.test(value)?'learning.nepmaker':/activemiao/i.test(value)?'learning.activemiao':/hotpp/i.test(value)?'training.hotpp':'training.nep';
 else if(/\bcv[\s_-]*only\b|仅.*?cv|只(?:计算|生成|定义).*?cv/i.test(value))id='pygas.cv';
 else if(/metad|opes|umbrella|增强采样|偏置模拟/i.test(value))id=/pydyn/i.test(value)?'sampling.pydyn':/gpumd|gpu.?sampling/i.test(value)?'sampling.gpumd':String(engine).startsWith('pydyn.')?'sampling.pydyn':String(engine).startsWith('gpumd.')?'sampling.gpumd':'pygas.bias';
 else if(/分子动力学|\bmd\b/i.test(value)&&/gpumd|pydyn/i.test(value))id=/gpumd/i.test(value)?'md.gpumd':'md.pydyn';
 else if(ENGINE_ROUTES[engine])id=ENGINE_ROUTES[engine];
 else if(/\bneb\b|最小能量路径/i.test(value))id=/pydyn/i.test(value)?'neb.pydyn':'neb.gpumd';
 else if(/hotpp/i.test(value))id='training.hotpp';
 else if(/torchnep/i.test(value))id='training.torchnep';
 else if(/nepmaker/i.test(value))id='learning.nepmaker';
 else if(/activemiao/i.test(value))id='learning.activemiao';
 else if(/\bnep\b/i.test(value))id='training.nep';
 else if(/pygas|metad|opes|umbrella|增强采样|偏置|\bcvs?\b/i.test(value))id=/pydyn/i.test(value)?'sampling.pydyn':/gpumd|gpu.?sampling/i.test(value)?'sampling.gpumd':'pygas.bias';
 else if(/pydyn/i.test(value))id='md.pydyn';
 else if(/gpumd/i.test(value))id='md.gpumd';
 else if(/materials.?project|\bmp-[0-9]+/i.test(value))id='structure.materials-project';
 else if(/\base\b|生成.*结构|构建.*结构/i.test(value))id='structure.ase';
 return [...new Set([...(hasWorkflow?['workflow.orchestrate']:[]),...id?[id]:[]])];
}
export class ScientificSkillContext{
 constructor(router){this.router=router;this.accepted=new Map();}
 forget(key){for(const cached of this.accepted.keys())if(cached.endsWith('\0'+key))this.accepted.delete(cached);}
 async prepare(key,provider,options){
  const functions=selectScientificFunctions(options),receipts=[];for(const id of functions)receipts.push(await this.router.read(provider,id));
  const blocked=receipts.filter(r=>r.status!=='passed');
  if(blocked.length)return {status:blocked.some(r=>r.status==='permission_required')?'permission_required':'blocked',routes:functions,attach:false,attachments:[],text:'[Studio scientific guidance unavailable]\n'+blocked.map(r=>r.function_id+': '+(r.reason||r.status)).join('\n')+'\nUse real inspection tools; do not invent software parameters or bypass pyGAS.'};
  if(!functions.length)return {status:'not_run',routes:[],attach:false,attachments:[],text:''};
  const prior=this.accepted.get(provider+'\0'+key)||new Map(),changed=receipts.filter(r=>prior.get(r.function_id)!==r.digest),attach=changed.length>0;
  const digest=createHash('sha256').update(receipts.map(r=>r.function_id+':'+r.digest).join('\n')).digest('hex');
  return {status:attach?'passed':'already_loaded',routes:functions,digest,attach,provider,loaded:changed.map(r=>({id:r.function_id,digest:r.digest})),attachments:receipts.flatMap(r=>r.attachments),text:attach?'[Studio selected scientific guidance]\n'+changed.map(r=>r.text).join('\n'):''};
 }
 accept(key,result){if(result.attach&&result.status==='passed'){const cacheKey=result.provider+'\0'+key,accepted=this.accepted.get(cacheKey)||new Map();for(const item of result.loaded)accepted.set(item.id,item.digest);this.accepted.set(cacheKey,accepted);}}
}
